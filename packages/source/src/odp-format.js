import { NS, is, all, child, children, attr } from './xml.js';
const FO = 'urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0';

/** Bounded paragraph/span preview only; graphic/master defaults remain unresolved. */
export function odpAppearanceReader(content, styles) {
    const common = new Map(), local = new Map();
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
            Object.assign(result, resolve(map.has(key) ? map.get(key) : common.get(key), family));
        }
        return Object.fromEntries(Object.entries(result).filter(([, value]) => value !== null));
    };
}

export function reservedOdpStyleNames(...docs) {
    const names = new Set();
    for (const doc of docs) for (const n of all(doc, 'style', 'style')) names.add(attr(n, 'style', 'name'));
    for (const doc of docs) for (const n of Array.from(doc.getElementsByTagNameNS('*', '*'))) {
        for (const a of Array.from(n.attributes)) if (/style-name$|class-names$/.test(a.localName)) {
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
            if (key === 'fontFamily') {
                props.setAttributeNS(FO, 'fo:font-family', value);
                props.setAttributeNS(NS.style, 'style:font-name', value);
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
