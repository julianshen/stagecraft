import { NS, is, all, child, children, attr } from './xml.js';
const FO = 'urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0';

/** Bounded paragraph/span preview only; graphic/master defaults remain unresolved. */
export function odpAppearanceReader(content, styles) {
    const common = new Map(), local = new Map();
    const faces = new Map();
    for (const doc of [content, styles]) {
        const map = new Map();
        for (const face of all(doc, 'style', 'font-face')) {
            const name = attr(face, 'style', 'name');
            map.set(name, map.has(name) ? null : face);
        }
        faces.set(doc, map);
    }
    const fontFace = (doc, name) => {
        const localFaces = faces.get(doc);
        return localFaces?.has(name) ? localFaces.get(name) : faces.get(styles).get(name);
    };
    const index = parent => {
        const map = new Map();
        for (const n of children(parent).filter(n => is(n, 'style', 'style'))) {
            const key = `${attr(n, 'style', 'family')}:${attr(n, 'style', 'name')}`;
            map.set(key, map.has(key) ? null : n);
        }
        return map;
    };
    for (const [part, doc] of [['content.xml', content], ['styles.xml', styles]]) {
        local.set(part, index(child(doc.documentElement, 'office', 'automatic-styles')));
        for (const [key, n] of index(child(doc.documentElement, 'office', 'styles'))) common.set(key, common.has(key) ? null : n);
    }
    const apply = (result, properties) => {
        if (!properties) return;
        for (const [name, key, positive, negative] of [['font-weight', 'bold', 'bold', 'normal'], ['font-style', 'italic', 'italic', 'normal']]) {
            const value = properties.getAttributeNS(FO, name);
            if (value) result[key] = [positive, negative].includes(value) ? value === positive : null;
        }
        const size = properties.getAttributeNS(FO, 'font-size');
        if (size) {
            const m = /^(\d+(?:\.\d+)?)(pt|pc|in|cm|mm|px)$/.exec(size);
            const points = m ? Number(m[1]) * { pt: 1, pc: 12, in: 72, cm: 72 / 2.54, mm: 72 / 25.4, px: .75 }[m[2]] : NaN;
            result.fontSize = Number.isFinite(points) && points > 0 ? points : null;
        }
        const color = properties.getAttributeNS(FO, 'color');
        if (color) result.color = /^#[0-9a-f]{6}$/i.test(color) ? color : null;
        const family = properties.getAttributeNS(FO, 'font-family');
        if (family) result.fontFamily = family;
        for (const [key, suffix] of [['fontFamily', ''], ['eastAsian', '-asian'], ['complexScript', '-complex']]) {
            const ref = properties.getAttributeNS(NS.style, `font-name${suffix}`);
            const direct = suffix ? properties.getAttributeNS(NS.style, `font-family${suffix}`) : family;
            if (direct) result[key] = direct;
            if (properties.hasAttributeNS(NS.style, `font-name${suffix}`)) {
                result.fontReferences = { ...result.fontReferences, [key]: ref };
                const face = fontFace(properties.ownerDocument, ref);
                result[key] = face?.getAttributeNS(NS.svg, 'font-family') || null;
            } else if (direct) {
                result.fontReferences = { ...result.fontReferences, [key]: null };
            }
        }
    };
    const cache = new WeakMap();
    function resolve(node, family) {
        if (!node) return {};
        if (cache.has(node)) return cache.get(node);
        const chain = [], seen = new Set();
        while (node && !seen.has(node) && chain.length < 64) {
            seen.add(node); chain.push(node);
            node = common.get(`${family}:${attr(node, 'style', 'parent-style-name')}`);
        }
        const result = {};
        for (const n of chain.reverse()) apply(result, child(n, 'style', 'text-properties'));
        cache.set(chain[chain.length - 1], result);
        return result;
    }
    return (node, part) => {
        const ancestors = [];
        for (let parent = node.parentNode; parent && ancestors.length < 128; parent = parent.parentNode) {
            if (is(parent, 'text', 'span') || is(parent, 'text', 'p')) ancestors.push(parent);
        }
        const result = {};
        for (const n of ancestors.reverse()) {
            const family = is(n, 'text', 'p') ? 'paragraph' : 'text';
            const key = `${family}:${attr(n, 'text', 'style-name')}`;
            const map = local.get(part);
            const resolved = resolve(map.has(key) ? map.get(key) : common.get(key), family);
            const refs = { ...result.fontReferences, ...resolved.fontReferences };
            Object.assign(result, resolved);
            if (Object.keys(refs).length) result.fontReferences = refs;
        }
        if (result.fontReferences) {
            result.fontReferences = Object.fromEntries(Object.entries(result.fontReferences).filter(([, value]) => value !== null));
            if (!Object.keys(result.fontReferences).length) delete result.fontReferences;
        }
        return Object.fromEntries(Object.entries(result).filter(([, value]) => value !== null));
    };
}

export function reservedOdpStyleNames(...docs) {
    const names = new Set();
    for (const doc of docs) for (const kind of ['style', 'font-face']) for (const n of all(doc, 'style', kind)) names.add(attr(n, 'style', 'name'));
    for (const doc of docs) for (const n of Array.from(doc.getElementsByTagNameNS('*', '*'))) {
        for (const a of Array.from(n.attributes)) if (/^font-name(?:-asian|-complex)?$/.test(a.localName)) names.add(a.value);
        else if (/style-name$|class-names$/.test(a.localName)) {
            for (const name of a.value.split(/\s+/)) names.add(name);
        }
    }
    return [...names];
}

/** New run-local styles never modify an existing shared style definition. */
export function odpFormattingWriter(doc, reserved) {
    const names = new Set(reserved);
    let next = 1;
    let section;
    let nextFont = 1, declarations, fontFamilies;
    const fontName = family => {
        if (!fontFamilies) {
            const sections = children(doc.documentElement).filter(n => is(n, 'office', 'font-face-decls'));
            if (sections.length > 1) throw new Error('Ambiguous font face declarations');
            declarations = sections[0];
            const faces = children(declarations).filter(n => is(n, 'style', 'font-face'));
            const counts = new Map();
            for (const face of faces) {
                const name = attr(face, 'style', 'name');
                counts.set(name, (counts.get(name) ?? 0) + 1); names.add(name);
            }
            fontFamilies = new Map();
            // Only plain declarations are interchangeable: embedded fonts / charset metadata matter.
            for (const face of faces) {
                const name = attr(face, 'style', 'name'), value = attr(face, 'svg', 'font-family');
                if (name && value && counts.get(name) === 1 && children(face).length === 0
                    && [...face.attributes].every(a => a.namespaceURI === 'http://www.w3.org/2000/xmlns/'
                        || a.namespaceURI === NS.style && a.localName === 'name'
                        || a.namespaceURI === NS.svg && a.localName === 'font-family')
                    && !fontFamilies.has(value)) fontFamilies.set(value, name);
            }
        }
        if (fontFamilies.has(family)) return fontFamilies.get(family);
        if (!declarations) {
            declarations = doc.createElementNS(NS.office, 'office:font-face-decls');
            const following = children(doc.documentElement).find(n => n.namespaceURI === NS.office && ['styles', 'automatic-styles', 'master-styles', 'body'].includes(n.localName));
            doc.documentElement.insertBefore(declarations, following ?? null);
        }
        let name; do { name = `StagecraftFont${nextFont++}`; } while (names.has(name));
        names.add(name);
        const face = doc.createElementNS(NS.style, 'style:font-face');
        face.setAttributeNS(NS.style, 'style:name', name);
        face.setAttributeNS(NS.svg, 'svg:font-family', family);
        declarations.appendChild(face);
        fontFamilies.set(family, name);
        return name;
    };
    return overrides => {
        if (!section) {
            const sections = children(doc.documentElement).filter(n => is(n, 'office', 'automatic-styles'));
            if (sections.length > 1) throw new Error('Ambiguous automatic styles');
            section = sections[0];
            if (!section) {
                section = doc.createElementNS(NS.office, 'office:automatic-styles');
                const following = children(doc.documentElement).find(n => is(n, 'office', 'body') || is(n, 'office', 'master-styles'));
                doc.documentElement.insertBefore(section, following ?? null);
            }
        }
        let name;
        do { name = `StagecraftRun${next++}`; } while (names.has(name));
        names.add(name);
        const style = doc.createElementNS(NS.style, 'style:style');
        style.setAttributeNS(NS.style, 'style:name', name);
        style.setAttributeNS(NS.style, 'style:family', 'text');
        const props = doc.createElementNS(NS.style, 'style:text-properties');
        for (const [key, value] of Object.entries(overrides)) {
            if (['fontFamily', 'eastAsian', 'complexScript'].includes(key)) {
                if (key === 'fontFamily') props.setAttributeNS(FO, 'fo:font-family', value);
                const suffix = { fontFamily: '', eastAsian: '-asian', complexScript: '-complex' }[key];
                props.setAttributeNS(NS.style, `style:font-name${suffix}`, fontName(value));
                continue;
            }
            if (key === 'color') {
                props.setAttributeNS(FO, 'fo:color', value);
                continue;
            }
            const attribute = { bold: 'font-weight', italic: 'font-style', fontSize: 'font-size' }[key];
            if (!attribute) continue;
            const native = key === 'fontSize' ? `${value}pt` : value ? (key === 'bold' ? 'bold' : 'italic') : 'normal';
            props.setAttributeNS(FO, `fo:${attribute}`, native);
            for (const suffix of ['asian', 'complex']) props.setAttributeNS(NS.style, `style:${attribute}-${suffix}`, native);
        }
        style.appendChild(props); section.appendChild(style);
        return name;
    };
}
