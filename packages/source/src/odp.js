import { createDocument } from '@stagecraft/core/document';
import { NS, is, all, child, children, attr, attrs, source, id, locate, xmlPart } from './xml.js';
import { odpAppearanceReader, reservedOdpStyleNames } from './odp-format.js';
import { readOdpChartData } from './chart-authoring.js';
export const ODP_MIME = 'application/vnd.oasis.opendocument.presentation';
/**
 * Faithful plain text of an ODF text container: expands text:s/text:tab/text:line-break and walks
 * nested spans/anchors. Shared by notes and table cells so whitespace cannot drift between them.
 */
export function odfText(node, limit = 1048576) {
    let out = '', budget = 0;
    const add = value => { budget += value.length; if (budget > limit) throw new Error('ODP text expansion limit'); out += value; };
    const walk = parent => {
        for (const child of Array.from(parent.childNodes)) {
            if (child.nodeType === 3 || child.nodeType === 4) { add(child.data); continue; }
            if (is(child, 'text', 's')) {
                const count = Number(attr(child, 'text', 'c') || 1);
                if (!Number.isSafeInteger(count) || count < 1 || count > 1000) throw new Error('ODP text space expansion limit');
                add(' '.repeat(count));
                continue;
            }
            if (is(child, 'text', 'tab')) { add('\t'); continue; }
            if (is(child, 'text', 'line-break')) { add('\n'); continue; }
            if (child.nodeType === 1) walk(child);
        }
    };
    walk(node);
    return out;
}
/** Canonical, previewable ODP table (read-only: native cells are not authored). */
export function readOdpTable(node, part) {
    const table = child(node, 'table', 'table');
    if (!table)
        return null;
    const columns = children(table).filter(n => is(n, 'table', 'table-column')).map(n => {
        const raw = attr(n, 'style', 'column-width');
        const numeric = Number(raw.replace(/[^\d.]/g, ''));
        return { id: id(part, n, 'column'), width: raw && Number.isFinite(numeric) && numeric > 0 ? Math.max(1, Math.round(numeric)) : 0 };
    });
    const rows = children(table).filter(n => is(n, 'table', 'table-row')).map(tr => ({
        id: id(part, tr, 'row'),
        cells: children(tr).filter(n => is(n, 'table', 'table-cell')).map(tc => ({ id: id(part, tc, 'cell'), text: odpCellText(tc, part) }))
    }));
    if (!columns.length || !rows.length)
        return null;
    if (rows.some(row => row.cells.length !== columns.length))
        return null;
    // ODP column widths are optional; an unusable one falls back to a unit width.
    for (const column of columns) if (!column.width) column.width = 1;
    return { columns, rows };
}
function odpCellText(cell, part) {
    const paragraphs = [];
    // Lists are structural wrappers, not paragraph text. Walk only supported text containers so
    // a nested drawing/table cannot leak its paragraphs into the enclosing cell's preview.
    const pending = children(cell).reverse().map(node => ({ node, depth: 0 }));
    let visited = 0;
    while (pending.length) {
        const { node, depth } = pending.pop();
        if (++visited > 10000 || depth > 128) throw new Error('ODP cell text structure limit');
        if (is(node, 'text', 'p') || is(node, 'text', 'h')) {
            paragraphs.push({ id: id(part, node), runs: [{ id: id(part, node, 'run'), text: odfText(node), editable: false, style: {} }] });
        } else if (is(node, 'text', 'list') || is(node, 'text', 'list-item') || is(node, 'text', 'list-header')) {
            for (const child of children(node).reverse()) pending.push({ node: child, depth: depth + 1 });
        }
    }
    if (!paragraphs.length)
        paragraphs.push({ id: id(part, cell, 'empty'), runs: [{ id: id(part, cell, 'empty-run'), text: '', editable: false, style: {} }] });
    return { paragraphs };
}
/** Page name, solid page background and notes text lifted from a draw:page. */
function odpSlideProperties(page, content) {
    const out = {};
    const styleName = attr(page, 'draw', 'style-name');
    const pageStyle = all(content, 'style', 'style').find(s => attr(s, 'style', 'name') === styleName && attr(s, 'style', 'family') === 'drawing-page');
    const properties = child(pageStyle, 'style', 'drawing-page-properties');
    const fill = attr(properties, 'draw', 'fill-color');
    const competing = ['draw:fill-gradient-name', 'draw:fill-image-name', 'draw:fill-hatch-name'].some(name => properties?.hasAttribute(name));
    if (attr(properties, 'draw', 'fill') === 'solid' && !competing && /^#[0-9a-f]{6}$/i.test(fill))
        out.background = { type: 'solid', color: fill };
    const notes = child(page, 'presentation', 'notes');
    if (notes) {
        const body = [notes, ...Array.from(notes.getElementsByTagNameNS('*', '*'))].find(n => is(n, 'draw', 'frame') && attr(n, 'presentation', 'class') === 'notes') ?? notes;
        const text = children(child(body, 'draw', 'text-box')).filter(n => is(n, 'text', 'p')).map(p => odfText(p)).join('\n');
        if (text) out.notes = text;
    }
    return out;
}
const length = s => {
    const m = /^(-?[\d.]+)(cm|mm|in|pt|pc|px)$/.exec(s);
    if (!m)
        throw new Error('Unsupported ODP length');
    return Math.round(Number(m[1]) * { cm: 360000, mm: 36000, in: 914400, pt: 12700, pc: 152400, px: 9525 }[m[2]]);
};
export async function readOdp(zip, xml, mapping) {    if (await zip.file('mimetype')?.async('string') !== ODP_MIME)
        throw new Error('Invalid ODP mimetype');
    const manifest = await xmlPart(zip, 'META-INF/manifest.xml', xml);
    if (!is(manifest.documentElement, 'manifest', 'manifest') || all(manifest, 'manifest', 'encryption-data').length)
        throw new Error('Invalid or encrypted ODP manifest');
    if (!all(manifest, 'manifest', 'file-entry').some(n => attr(n, 'manifest', 'full-path') === '/' && attr(n, 'manifest', 'media-type') === ODP_MIME))
        throw new Error('Invalid ODP manifest identity');
    const content = await xmlPart(zip, 'content.xml', xml), styles = await xmlPart(zip, 'styles.xml', xml);
    if (!is(content.documentElement, 'office', 'document-content') || !is(styles.documentElement, 'office', 'document-styles'))
        throw new Error('Unsupported ODP document root');
    const body = child(child(content.documentElement, 'office', 'body'), 'office', 'presentation');
    if (!body)
        throw new Error('Missing ODP presentation');
    const appearance = odpAppearanceReader(content, styles);
    const styleNames = reservedOdpStyleNames(content, styles);
    const styleIndex = new Map();
    for (const [part, doc] of [['content.xml', content], ['styles.xml', styles]]) {
        for (const node of all(doc, 'style', 'style')) {
            const key = `${part}:${attr(node, 'style', 'family')}:${attr(node, 'style', 'name')}`;
            styleIndex.set(key, styleIndex.has(key) ? null : node);
        }
    }
    const findStyle = (part, family, name) => {
        const key = `${part}:${family}:${name}`;
        return styleIndex.has(key) ? styleIndex.get(key) : styleIndex.get(`styles.xml:${family}:${name}`);
    };
    const paragraphStyle = (p, part) => {
        const chain = [], seen = new Set();
        let node = findStyle(part, 'paragraph', attr(p, 'text', 'style-name'));
        while (node && !seen.has(node) && chain.length < 64) {
            seen.add(node); chain.push(node);
            node = findStyle('styles.xml', 'paragraph', attr(node, 'style', 'parent-style-name'));
        }
        const result = { ...attrs(p) };
        for (const style of chain.reverse()) {
            const props = child(style, 'style', 'paragraph-properties');
            if (!props) continue;
            const align = attr(props, 'fo', 'text-align');
            const alignment = { start: 'left', left: 'left', center: 'center', end: 'right', right: 'right', justify: 'justify' }[align];
            if (alignment) result.alignment = alignment;
            for (const [name, key, points] of [['margin-top', 'spaceBefore', true], ['margin-bottom', 'spaceAfter', true], ['margin-left', 'indentStart'], ['margin-right', 'indentEnd'], ['text-indent', 'firstLineIndent']]) {
                const value = attr(props, 'fo', name);
                if (!value) continue;
                try { const emu = length(value); if (Number.isSafeInteger(emu)) result[key] = points ? emu / 12700 : emu; } catch { /* Unsupported native units stay opaque. */ }
            }
            const line = /^(\d+(?:\.\d+)?)%$/.exec(attr(props, 'fo', 'line-height'));
            if (line) result.lineSpacing = Number(line[1]);
        }
        return result;
    };
    const listStyle = (list, part, level) => {
        let name = attr(list, 'text', 'style-name');
        for (let parent = list.parentNode; !name && parent; parent = parent.parentNode) if (is(parent, 'text', 'list')) name = attr(parent, 'text', 'style-name');
        const local = all(part === 'content.xml' ? content : styles, 'text', 'list-style').filter(n => attr(n, 'style', 'name') === name);
        const candidates = local.length ? local : all(styles, 'text', 'list-style').filter(n => attr(n, 'style', 'name') === name);
        if (candidates.length !== 1) return {};
        const definition = children(candidates[0]).find(n => attr(n, 'text', 'level') === String(level + 1));
        if (!definition) return {};
        if (is(definition, 'text', 'list-level-style-bullet')) return { bullet: { type: 'char', char: attr(definition, 'text', 'bullet-char') }, level };
        if (is(definition, 'text', 'list-level-style-number')) {
            const format = { '1': attr(definition, 'style', 'num-suffix') === ')' ? 'arabicParenR' : 'arabicPeriod', a: 'lowerAlphaPeriod', A: 'upperAlphaPeriod', i: 'lowerRomanPeriod', I: 'upperRomanPeriod' }[attr(definition, 'style', 'num-format')];
            if (format) return { bullet: { type: 'number', format }, level };
        }
        return {};
    };
    const paragraphNodes = (container, part) => {
        const result = [];
        const walk = (parent, listInfo = {}, depth = 0) => {
            if (depth > 128) throw new Error('ODP list nesting limit');
            for (const node of children(parent)) {
                if (is(node, 'text', 'p')) result.push({ p: node, listInfo });
                else if (is(node, 'text', 'list')) {
                    const level = listInfo.level === undefined ? 0 : listInfo.level + 1;
                    walk(node, { level, ...listStyle(node, part, level) }, depth + 1);
                } else if (is(node, 'text', 'list-item')) walk(node, listInfo, depth + 1);
                else if (is(node, 'text', 'list-header')) walk(node, {}, depth + 1);
            }
        };
        walk(container);
        return result;
    };
    const d = createDocument({ id: 'odp-document' }), masters = new Map(), layouts = new Map();
    d.extensions.sourceFormat = 'odp';
    const nodeAssets = new WeakMap();
    const xlink = 'http://www.w3.org/1999/xlink';
    const external = href => /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(href) || href.startsWith('//');
    function internalTarget(href) {
        let decoded;
        try {
            decoded = decodeURIComponent(href);
        }
        catch {
            throw new Error('Invalid ODP reference encoding');
        }
        if (!decoded || /[\\?#:\x00-\x1f]/.test(decoded) || /%[0-9a-f]{2}/i.test(decoded) || decoded.startsWith('/'))
            throw new Error('Unsafe ODP embedded reference');
        const segments = [];
        for (const segment of decoded.replace(/\/$/, '').split('/')) {
            if (segment === '..') {
                if (!segments.length)
                    throw new Error('ODP reference escapes package');
                segments.pop();
            }
            else if (segment !== '.') {
                if (!segment)
                    throw new Error('Ambiguous ODP reference');
                segments.push(segment);
            }
        }
        const target = segments.join('/');
        if (!target || !zip.file(target) && !Object.keys(zip.files).some(p => p.startsWith(target + '/')))
            throw new Error('Missing ODP embedded target');
        return target;
    }
    for (const [part, doc] of [['content.xml', content], ['styles.xml', styles]]) {
        for (const n of Array.from(doc.getElementsByTagNameNS('*', '*'))) {
            const embedded = ['image', 'object', 'object-ole'].some(name => is(n, 'draw', name));
            const hyperlink = is(n, 'text', 'a');
            if (!embedded && !hyperlink)
                continue;
            const href = n.getAttributeNS(xlink, 'href');
            if (!href) {
                if (embedded && !child(n, 'office', 'binary-data'))
                    throw new Error('Missing ODP embedded href');
                continue;
            }
            const fragment = hyperlink && href.startsWith('#');
            const mode = fragment ? 'internal' : hyperlink || external(href) ? 'external' : 'internal';
            const target = fragment ? part : mode === 'external' ? href : internalTarget(href);
            const relationship = { id: id(part, n, 'relationship'), ownerPart: part, target, type: `${NS[n.namespaceURI === NS.text ? 'text' : 'draw']}#${n.localName}`, mode, ...(fragment ? { extensions: { fragment: href.slice(1) } } : {}) };
            d.relationships.push(relationship);
            if (embedded) {
                const asset = { id: id(part, n, 'asset'), relationshipId: relationship.id, extensions: { kind: n.localName, ...(mode === 'internal' && !zip.file(target) ? { directory: true } : {}) }, ...(mode === 'internal' ? { source: { format: 'odp', part: target, path: [] } } : {}) };
                d.assets.push(asset);
                nodeAssets.set(n, asset.id);
            }
        }
    }
    for (const [part, doc] of [['styles.xml', styles], ['content.xml', content]]) {
        d.themes.push({ id: `styles:${part}`, source: source('odp', part, doc.documentElement), extensions: { styles: all(doc, 'style', 'style').map(n => ({ name: attr(n, 'style', 'name'), family: attr(n, 'style', 'family'), parentStyleName: attr(n, 'style', 'parent-style-name'), source: source('odp', part, n), attributes: attrs(n), properties: children(n).map(p => ({ name: p.localName, namespace: p.namespaceURI, attributes: attrs(p) })) })) } });
        for (const n of all(doc, 'style', 'page-layout')) {
            const name = attr(n, 'style', 'name');
            if (!name || layouts.has(name))
                throw new Error('Ambiguous page layout');
            layouts.set(name, { part, n });
        }
        for (const n of all(doc, 'style', 'master-page')) {
            const name = attr(n, 'style', 'name');
            if (!name || masters.has(name))
                throw new Error('Ambiguous master page');
            const m = { id: id(part, n, 'master'), source: source('odp', part, n), themeId: 'styles:styles.xml', extensions: { attributes: attrs(n) } };
            masters.set(name, { node: n, part, entity: m });
            d.masters.push(m);
        }
    }
    const linked = new Map();
    let budget = 0;
    const account = s => {
        budget += s.length;
        if (budget > 1048576)
            throw new Error('ODP text expansion limit');
        return s;
    };
    /** Paragraphs/runs of a text container (a draw:text-box, or a shape's direct text:p children). */
    const parseParagraphs = (container, part) => paragraphNodes(container, part).map(({ p, listInfo }) => {
                        const runs = [];
                        function walk(parent, style) {
                            if (!parent.childNodes.length) {
                                const run = { id: id(part, parent, 'empty-run'), text: '', style: { ...style, overrides: {} }, editable: true, source: source('odp',part,parent), extensions: { odpAppearance: appearance({parentNode:parent},part) } };
                                runs.push(run); mapping.set(run.id,{...run.source,kind:'odp',styleNames,emptyContainer:true});
                            }
                            for (const n of Array.from(parent.childNodes)) {
                                if (is(n, 'text', 'span')) {
                                    walk(n, { attributes: attrs(n), ancestors: [...(style.ancestors ?? []), style.attributes] });
                                    continue;
                                }
                                let text = '', editable = n.nodeType === 3 || n.nodeType === 4;
                                if (editable)
                                    text = n.data;
                                else if (is(n, 'text', 's')) {
                                    const count = Number(attr(n, 'text', 'c') || 1);
                                    if (!Number.isSafeInteger(count) || count < 1 || count > 1000)
                                        throw new Error('ODP text space expansion limit');
                                    text = ' '.repeat(count);
                                }
                                else if (is(n, 'text', 'tab'))
                                    text = '\t';
                                else if (is(n, 'text', 'line-break'))
                                    text = '\n';
                                else if (n.nodeType === 1)
                                    text = n.textContent;
                                else
                                    continue;
                                editable = editable || ((is(n, 'text', 's') || is(n, 'text', 'tab') || is(n, 'text', 'line-break')) && n.childNodes.length === 0 && Array.from(n.attributes).every(a => a.namespaceURI === 'http://www.w3.org/2000/xmlns/' || is(n, 'text', 's') && a.namespaceURI === NS.text && a.localName === 'c'));
                                const run = { id: id(part, n, 'run'), text: account(text), style: { ...style, overrides: {} }, editable, source: source('odp', part, n), extensions: { odpAppearance: appearance(n, part) } };
                                runs.push(run);
                                if (editable)
                                    mapping.set(run.id, { ...run.source, kind: 'odp', styleNames });
                            }
                        }
                        walk(p, { attributes: attrs(p), ancestors: [] });
                        return { id: id(part, p), source: source('odp', part, p), style: { ...paragraphStyle(p, part), ...listInfo }, runs };
                    });
    function objects(parent, part, nested = false) {
        return children(parent).filter(n => n.namespaceURI === NS.draw).map(n => {
            const group = is(n, 'draw', 'g'), box = child(n, 'draw', 'text-box');
            const o = { id: id(part, n), type: group ? 'group' : box ? 'text' : 'opaque', source: source('odp', part, n), extensions: { attributes: attrs(n) } };
            const media = [n, ...Array.from(n.getElementsByTagNameNS('*', '*'))].map(n => nodeAssets.get(n)).filter(Boolean);
            if (media.length) {
                o.assetId = media[0];
                if (media.length > 1)
                    o.extensions.assetIds = media;
            }            if (is(n,'draw','rect') || is(n,'draw','ellipse')) {
                o.type = 'shape'; o.shape = n.localName;
                const styleName = attr(n,'draw','style-name');
                const local = all(part === 'content.xml' ? content : styles,'style','style').filter(s => attr(s,'style','name') === styleName && attr(s,'style','family') === 'graphic');
                const properties = local.length === 1 ? child(local[0],'style','graphic-properties') : null;
                const fill = attr(properties,'draw','fill-color');
                if (/^#[0-9a-f]{6}$/i.test(fill)) o.fill = fill;
                // setPaint eligibility: one unambiguous local graphic style, a solid fill, and no
                // gradient / image / hatch / pattern fill that a colour rewrite would destroy.
                const competing = ['draw:fill-gradient-name', 'draw:fill-image-name', 'draw:fill-hatch-name', 'draw:fill-pattern-name'].some(name => properties?.hasAttribute(name));
                if (local.length === 1 && !competing && attr(properties, 'draw', 'fill') === 'solid' && /^#[0-9a-f]{6}$/i.test(fill))
                    o.extensions.editableFill = true;
            }
            if (is(n, 'draw', 'frame') || is(n, 'draw', 'g')) {
                const table = readOdpTable(n, part);
                if (table) { o.type = 'table'; o.table = table; }
            }
            // Text-body autofit lives on the frame's local graphic style (auto-grow = fit to size).
            if (!group) {
                const styleName = attr(n, 'draw', 'style-name');
                if (styleName) {
                    const pool = part === 'content.xml' ? content : styles;
                    const style = all(pool, 'style', 'style').find(node => attr(node, 'style', 'name') === styleName && attr(node, 'style', 'family') === 'graphic');
                    const properties = child(style, 'style', 'graphic-properties');
                    const grow = properties?.getAttributeNS(NS.draw, 'auto-grow-height');
                    if (grow !== null && grow !== undefined) o.bodyLayout = { autofit: grow === 'true' ? 'resize' : 'none' };
                }
            }
            if (is(n, 'draw', 'frame') && child(n, 'draw', 'image') && o.type !== 'table') {
                o.type = 'image';
                if (media.length) o.image = { assetId: media[0] };
            }
            if (group)
                o.children = objects(n, part, true);
            if (['x', 'y', 'width', 'height'].every(k => attr(n, 'svg', k)))
                o.geometry = Object.fromEntries(['x', 'y', 'width', 'height'].map(k => [k, length(attr(n, 'svg', k))]));
            if (!nested && !group && o.geometry && !attr(n, 'draw', 'transform') && Object.values(o.geometry).every(Number.isSafeInteger) && o.geometry.width > 0 && o.geometry.height > 0) o.extensions.editableGeometry = true;
            const parsedParagraphs = box ? parseParagraphs(box, part)
                : (is(n, 'draw', 'rect') || is(n, 'draw', 'ellipse')) ? parseParagraphs(n, part)
                : null;
            // Shapes carry text:p children directly (draw:text-box is only valid in a frame).
            if (parsedParagraphs && parsedParagraphs.length) o.text = { paragraphs: parsedParagraphs };
            return o;
        });
    }
    for (const master of masters.values())
        master.entity.objects = objects(master.node, master.part);
    for (const page of children(body)) {
        if (!is(page, 'draw', 'page'))
            throw new Error('Unsupported ODP presentation child');
        const name = attr(page, 'draw', 'master-page-name'), master = masters.get(name);
        if (!master)
            throw new Error('Missing ODP master page reference');
        let layout = linked.get(name);
        if (!layout) {
            const record = layouts.get(attr(master.node, 'style', 'page-layout-name'));
            if (!record)
                throw new Error('Missing ODP page layout reference');
            layout = { id: `layout:${master.entity.id}`, masterId: master.entity.id, source: source('odp', record.part, record.n), extensions: { attributes: attrs(record.n) } };
            d.layouts.push(layout);
            linked.set(name, layout);
            const props = child(record.n, 'style', 'page-layout-properties'), fo = 'urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0';
            const w = props?.getAttributeNS(fo, 'page-width'), h = props?.getAttributeNS(fo, 'page-height');
            if (!w || !h)
                throw new Error('Missing ODP page dimensions');
            const size = { width: length(w), height: length(h) };
            if (d.slides.length && (size.width !== d.size.width || size.height !== d.size.height))
                throw new Error('Mixed ODP page sizes unsupported');
            d.size = size;
        }
        d.slides.push({
            id: id('content.xml', page, 'slide'),
            ...(attr(page, 'draw', 'name') ? { name: attr(page, 'draw', 'name') } : {}),
            layoutId: layout.id, source: source('odp', 'content.xml', page), objects: objects(page, 'content.xml'),
            ...odpSlideProperties(page, content)
        });
    }
    // Chart data preview from an embedded internal chart package (directory holding content.xml).
    for (const slide of d.slides) {
        for (const object of slide.objects) {
            if (object.type !== 'opaque' || !object.source) continue;
            const node = locate(await xmlPart(zip, object.source.part, xml), object.source.path);
            const reference = child(node, 'draw', 'object');
            if (!reference) continue;
            const href = reference.getAttributeNS(xlink, 'href');
            if (!href) continue;
            let target;
            try { target = internalTarget(href); } catch { continue; }
            try {
                const chart = readOdpChartData(await xmlPart(zip, `${target}/content.xml`, xml));
                if (chart) { object.type = 'chart'; object.chart = chart; }
            } catch { /* Unsupported chart stays opaque and is never rewritten. */ }
        }
    }
    return d;
}
export function patchOdp(node, text, styleName, replaceText = true) {
    if (styleName && !replaceText) {
        const span = node.ownerDocument.createElementNS(NS.text, 'text:span');
        span.setAttributeNS(NS.text, 'text:style-name', styleName);
        node.parentNode.replaceChild(span, node);
        span.appendChild(node);
        return;
    }
    const doc = node.ownerDocument, fragment = doc.createDocumentFragment();
    for (const token of text.match(/ +|\t|\r\n|\r|\n|[^ \t\r\n]+/g) ?? []) {
        if (token[0] === ' ') {
            for (let left = token.length; left > 0; left -= 1000) {
                const e = doc.createElementNS(NS.text, 'text:s');
                e.setAttributeNS(NS.text, 'text:c', String(Math.min(left, 1000)));
                fragment.appendChild(e);
            }
        }
        else if (token === '\t' || /^[\r\n]+$/.test(token))
            fragment.appendChild(doc.createElementNS(NS.text, token === '\t' ? 'text:tab' : 'text:line-break'));
        else
            fragment.appendChild(doc.createTextNode(token));
    }
    if (styleName) {
        const span = doc.createElementNS(NS.text, 'text:span');
        span.setAttributeNS(NS.text, 'text:style-name', styleName);
        span.appendChild(fragment);
        node.parentNode.replaceChild(span, node);
    } else node.parentNode.replaceChild(fragment, node);
}
