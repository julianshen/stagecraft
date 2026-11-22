import { createDocument } from '@stagecraft/core/document';
import { is, all, child, children, attr, attrs, source, id, xmlPart, locate } from './xml.js';
import { readPptxChartData } from './chart-authoring.js';
import { readPptxParagraphStyle, readPptxBodyLayout } from './authoring.js';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
/** Canonical, previewable table from an a:tbl node (read-only: native cells are not authored). */
function readTable(frame, part) {
    const tbl = child(child(child(frame, 'a', 'graphic'), 'a', 'graphicData'), 'a', 'tbl');
    if (!tbl)
        return null;
    const columns = children(child(tbl, 'a', 'tblGrid')).filter(n => is(n, 'a', 'gridCol'))
        .map(n => ({ id: id(part, n, 'column'), width: Math.max(1, Math.round(Number(n.getAttribute('w')) || 0)) }));
    const rows = children(tbl).filter(n => is(n, 'a', 'tr')).map(tr => ({
        id: id(part, tr, 'row'),
        cells: children(tr).filter(n => is(n, 'a', 'tc')).map(tc => ({ id: id(part, tc, 'cell'), text: readCellText(tc, part) }))
    }));
    if (!columns.length || !rows.length)
        return null;
    if (rows.some(row => row.cells.length !== columns.length))
        return null;
    return { columns, rows };
}
function readCellText(cell, part) {
    const paragraphs = children(child(cell, 'a', 'txBody')).filter(n => is(n, 'a', 'p')).map(p => ({
        id: id(part, p),
        runs: children(p).filter(n => is(n, 'a', 'r')).map(r => ({
            id: id(part, r), text: child(r, 'a', 't')?.textContent ?? '', editable: false, style: attrs(child(r, 'a', 'rPr'))
        }))
    })).filter(paragraph => paragraph.runs.length);
    if (!paragraphs.length)
        paragraphs.push({ id: id(part, cell, 'empty'), runs: [{ id: id(part, cell, 'empty-run'), text: '', editable: false, style: {} }] });
    return { paragraphs };
}
/** Body placeholder text of a notes slide (kept verbatim; no trimming). */
function notesBodyText(notes) {
    const lines = [];
    for (const sp of children(child(child(notes.documentElement, 'p', 'cSld'), 'p', 'spTree')).filter(n => is(n, 'p', 'sp'))) {
        const placeholder = child(child(child(sp, 'p', 'nvSpPr'), 'p', 'nvPr'), 'p', 'ph');
        if (!placeholder || (placeholder.getAttribute('type') ?? 'body') !== 'body')
            continue;
        for (const p of children(child(sp, 'p', 'txBody')).filter(n => is(n, 'a', 'p')))
            lines.push(children(p).filter(n => is(n, 'a', 'r')).map(r => child(r, 'a', 't')?.textContent ?? '').join(''));
    }
    return lines.join('\n');
}
function resolve(owner, raw) {
    if (!raw || /[\\?#\x00-\x20]/.test(raw))
        throw new Error('Unsafe relationship target');
    let decoded;
    try {
        decoded = decodeURIComponent(raw);
    }
    catch {
        throw new Error('Invalid relationship encoding');
    }
    if (/[\\?#:\x00-\x1f]/.test(decoded) || /%[0-9a-f]{2}/i.test(decoded))
        throw new Error('Ambiguous relationship target');
    const parts = decoded.startsWith('/') ? [] : owner === '[package]' ? [] : owner.split('/').slice(0, -1);
    for (const s of decoded.replace(/^\//, '').split('/')) {
        if (s === '..') {
            if (!parts.length)
                throw new Error('Relationship escapes package');
            parts.pop();
        }
        else if (s !== '.') {
            if (!s)
                throw new Error('Empty relationship segment');
            parts.push(s);
        }
    }
    return parts.join('/');
}
export async function readPptx(zip, xml, mapping) {
    const types = await xmlPart(zip, '[Content_Types].xml', xml);
    if (!is(types.documentElement, 'ct', 'Types'))
        throw new Error('Invalid content types');
    const d = createDocument({ id: 'pptx-document' });
    d.extensions.sourceFormat = 'pptx';
    for (const part of Object.keys(zip.files).filter(p => p.endsWith('.rels'))) {
        const owner = part === '_rels/.rels' ? '[package]' : part.replace(/(^|\/)\_rels\/([^/]+)\.rels$/, '$1$2');
        if (owner === part || owner !== '[package]' && !zip.file(owner))
            throw new Error('Invalid relationship owner');
        const doc = await xmlPart(zip, part, xml);
        if (!is(doc.documentElement, 'rel', 'Relationships'))
            throw new Error('Invalid relationships');
        const seen = new Set();
        for (const n of children(doc.documentElement)) {
            if (!is(n, 'rel', 'Relationship'))
                throw new Error('Unsupported relationship element');
            const rid = n.getAttribute('Id'), type = n.getAttribute('Type'), mode = n.getAttribute('TargetMode') || 'Internal';
            if (!rid || seen.has(rid) || !type || !['Internal', 'External'].includes(mode))
                throw new Error('Invalid relationship');
            seen.add(rid);
            const raw = n.getAttribute('Target');
            const target = mode === 'Internal' ? resolve(owner, raw) : raw;
            if (!target || mode === 'Internal' && !zip.file(target))
                throw new Error('Missing relationship target');
            d.relationships.push({ id: `rel:${owner}:${rid}`, ownerPart: owner, type, target, mode: mode.toLowerCase() });
        }
    }
    const rels = owner => d.relationships.filter(r => r.ownerPart === owner);
    const office = rels('[package]').filter(r => r.type === REL + 'officeDocument' && r.mode === 'internal');
    if (office.length !== 1)
        throw new Error('Unsupported presentation package identity');
    const main = office[0].target;
    if (!all(types, 'ct', 'Override').some(n => n.getAttribute('PartName') === '/' + main && n.getAttribute('ContentType') === 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml'))
        throw new Error('Unsupported presentation content type');
    const presentation = await xmlPart(zip, main, xml);
    if (!is(presentation.documentElement, 'p', 'presentation'))
        throw new Error('Invalid presentation');
    const size = child(presentation.documentElement, 'p', 'sldSz');
    if (size)
        d.size = { width: Number(size.getAttribute('cx')), height: Number(size.getAttribute('cy')) };
    for (const r of d.relationships.filter(r => r.type === REL + 'image'))
        d.assets.push({ id: `asset:${r.id}`, relationshipId: r.id, ...(r.mode === 'internal' ? { source: { format: 'pptx', part: r.target, path: [] } } : { extensions: { externalTarget: r.target } }) });
    const entityIds = new Map();
    async function entity(part, kind) {
        if (entityIds.has(part))
            return entityIds.get(part);
        const doc = await xmlPart(zip, part, xml), root = doc.documentElement;
        const expected = { slides: ['p', 'sld'], layouts: ['p', 'sldLayout'], masters: ['p', 'sldMaster'], themes: ['a', 'theme'] }[kind];
        if (!is(root, ...expected))
            throw new Error('Invalid native part root');
        const item = { id: `${kind}:${part}`, source: source('pptx', part, root) };
        entityIds.set(part, item.id);
        d[kind].push(item);
        if (kind !== 'themes')
            item.objects = objects(child(child(root, 'p', 'cSld'), 'p', 'spTree'), part);
        const edge = { slides: ['slideLayout', 'layouts', 'layoutId'], layouts: ['slideMaster', 'masters', 'masterId'], masters: ['theme', 'themes', 'themeId'] }[kind];
        if (edge) {
            const refs = rels(part).filter(r => r.type === REL + edge[0] && r.mode === 'internal');
            if (refs.length > 1)
                throw new Error('Ambiguous inheritance');
            if (refs.length)
                item[edge[2]] = await entity(refs[0].target, edge[1]);
        }
        return item.id;
    }
    function objects(tree, part, nested = false) {
        return children(tree).filter(n => !is(n, 'p', 'nvGrpSpPr') && !is(n, 'p', 'grpSpPr') && !is(n, 'p', 'extLst')).map(n => {
            const group = is(n, 'p', 'grpSp'), shape = is(n, 'p', 'sp');
            const o = { id: id(part, n), type: group ? 'group' : shape ? 'shape' : 'opaque', source: source('pptx', part, n), extensions: { attributes: attrs(n) } };
            if (is(n, 'p', 'pic')) {
                const blip = all(n, 'a', 'blip')[0], rid = attr(blip, 'r', 'embed') || attr(blip, 'r', 'link');
                const asset = d.assets.find(a => a.relationshipId === `rel:${part}:${rid}`);
                if (!asset)
                    throw new Error('Invalid image relationship');
                o.assetId = asset.id;
                o.type = 'image';
                o.image = { assetId: asset.id };
                const descr = child(child(n, 'p', 'nvPicPr'), 'p', 'cNvPr')?.getAttribute('descr');
                if (descr) o.image.alt = descr;
            }
            if (is(n, 'p', 'graphicFrame')) {
                const table = readTable(n, part);
                if (table) { o.type = 'table'; o.table = table; }
            }
            if (group)
                o.children = objects(n, part, true);
            const xfrm = is(n, 'p', 'graphicFrame') ? child(n, 'p', 'xfrm') : child(child(n, 'p', 'spPr'), 'a', 'xfrm');
            const off = child(xfrm, 'a', 'off'), ext = child(xfrm, 'a', 'ext');
            if (off && ext)
                o.geometry = { x: Number(off.getAttribute('x')), y: Number(off.getAttribute('y')), width: Number(ext.getAttribute('cx')), height: Number(ext.getAttribute('cy')), ...(xfrm.hasAttribute('rot') ? { rotation: Number(xfrm.getAttribute('rot')) / 60000 } : {}) };
            if (!nested && !group && off && ext && !xfrm.hasAttribute('flipH') && !xfrm.hasAttribute('flipV') && Object.values(o.geometry).every(Number.isFinite) && ['x','y','width','height'].every(k => Number.isSafeInteger(o.geometry[k])) && o.geometry.width > 0 && o.geometry.height > 0) o.extensions.editableGeometry = true;
            const preset = child(child(n, 'p', 'spPr'), 'a', 'prstGeom')?.getAttribute('prst');
            const props = child(n, 'p', 'spPr');
            const solid = child(child(props, 'a', 'solidFill'), 'a', 'srgbClr');
            const fillValue = solid?.getAttribute('val');
            // A plain solid sRGB fill with no competing fill model is the only fill this writer can
            // rewrite in place, so it is also the eligibility signal for presentation.setPaint.
            const competing = ['gradFill', 'pattFill', 'blipFill', 'grpFill', 'noFill'].some(name => child(props, 'a', name));
            const plainFill = !!solid && !competing && children(solid).length === 0 && /^[0-9a-f]{6}$/i.test(fillValue ?? '');
            const isGeometricShape = shape && ['rect', 'ellipse'].includes(preset);
            const body = shape && child(n, 'p', 'txBody');
            const declaredTextBox = attr(child(n, 'p', 'cNvSpPr'), 'txBox') === '1';
            if (isGeometricShape && plainFill) {
                o.shape = preset;
                o.fill = `#${fillValue}`;
                o.extensions.editableFill = true;
            } else if (isGeometricShape && !body) {
                o.shape = preset; // unfilled geometric shape with no text
            }
            const textBody = shape && child(n, 'p', 'txBody');
            const layout = readPptxBodyLayout(child(textBody, 'a', 'bodyPr'));
            if (layout && Object.keys(layout).length) o.bodyLayout = layout;
            if (textBody) {
                // A filled geometric sp keeps its shape identity so authored shape text and paint
                // survive a reopen; an unfilled sp with text is a text box.
                o.type = isGeometricShape && plainFill ? 'shape' : 'text';
                o.text = { paragraphs: children(textBody).filter(n => is(n, 'a', 'p')).map(p => ({ id: id(part, p), source: source('pptx', part, p), style: readPptxParagraphStyle(p), runs: children(p).filter(n => !is(n, 'a', 'pPr') && !is(n, 'a', 'endParaRPr')).map(r => {
                            const t = child(r, 'a', 't'), editable = is(r, 'a', 'r') && !!t && children(r).filter(c => is(c, 'a', 'rPr')).length <= 1 && children(r).every(c => is(c, 'a', 'rPr') || c === t) && children(t).length === 0;
                            const run = { id: id(part, r), text: t?.textContent ?? (is(r, 'a', 'br') ? '\n' : r.textContent ?? ''), editable, source: source('pptx', part, t ?? r), style: attrs(child(r, 'a', 'rPr')) };
                            const runProperties = child(r, 'a', 'rPr');
                            const family = child(runProperties, 'a', 'latin')?.getAttribute('typeface');
                            const colour = child(child(runProperties, 'a', 'solidFill'), 'a', 'srgbClr');
                            // Retain direct font aliases too: deleting this key must reset theme-font references.
                            if (child(runProperties, 'a', 'latin')) run.style.typeface = family || null;
                            // null denotes an opaque direct fill, not inherited colour. Reset removes its key.
                            const fills = children(runProperties).filter(n => is(n, 'a', n.localName) && ['noFill','solidFill','gradFill','blipFill','pattFill','grpFill'].includes(n.localName));
                            if (fills.length) run.style.color = fills.length === 1 && colour && children(colour).length === 0 && /^[0-9a-f]{6}$/i.test(colour.getAttribute('val') ?? '') ? `#${colour.getAttribute('val').toLowerCase()}` : null;
                            const properties = child(r, 'a', 'rPr');
                            const typeface = child(properties, 'a', 'latin')?.getAttribute('typeface');
                            const color = child(child(properties, 'a', 'solidFill'), 'a', 'srgbClr');
                            // Derived preview data is immutable to the retained-source writer.
                            const appearance = {};
                            if (typeface && !typeface.startsWith('+')) appearance.fontFamily = typeface;
                            if (color && children(color).length === 0 && /^[0-9a-f]{6}$/i.test(color.getAttribute('val') ?? '')) appearance.color = `#${color.getAttribute('val')}`;
                            if (Object.keys(appearance).length) run.extensions = { pptxAppearance: appearance };
                            if (editable)
                                mapping.set(run.id, { ...run.source, kind: 'pptx' });
                            return run;
                        }) })) };
            }
            return o;
        });
    }
    const list = child(presentation.documentElement, 'p', 'sldIdLst');
    for (const n of children(list)) {
        if (!is(n, 'p', 'sldId'))
            throw new Error('Unsupported slide list');
        const ref = rels(main).find(r => r.id === `rel:${main}:${attr(n, 'r', 'id')}`);
        if (!ref || ref.type !== REL + 'slide' || ref.mode !== 'internal')
            throw new Error('Invalid slide reference');
        if (entityIds.has(ref.target))
            throw new Error('Duplicate slide');
        await entity(ref.target, 'slides');
    }
    // Slide-level properties the canonical view can carry: name, a plain solid background, notes.
    const slideByPart = new Map();
    for (const r of d.relationships.filter(r => r.type === REL + 'slide' && r.mode === 'internal')) slideByPart.set(r.target, r.ownerPart);
    for (const slide of d.slides) {
        const part = slide.source?.part;
        if (!part) continue;
        const doc = await xmlPart(zip, part, xml);
        const root = doc.documentElement, cSld = child(root, 'p', 'cSld');
        const name = cSld?.getAttribute('name');
        if (name) slide.name = name;
        const bgPr = child(child(cSld, 'p', 'bg'), 'p', 'bgPr');
        const colour = child(child(bgPr, 'a', 'solidFill'), 'a', 'srgbClr');
        const value = colour?.getAttribute('val');
        if (value && /^[0-9a-f]{6}$/i.test(value) && children(colour).length === 0) slide.background = { type: 'solid', color: `#${value.toLowerCase()}` };
        const notesRelationship = rels(part).find(r => r.type === REL + 'notesSlide' && r.mode === 'internal');
        if (notesRelationship) {
            const notes = await xmlPart(zip, notesRelationship.target, xml);
            const text = notesBodyText(notes);
            if (text) slide.notes = text;
        }
    }
    // Chart data preview: only an authorized internal chart part referenced from this slide is read.
    // Anything unreadable or unsupported stays an opaque object rather than failing the open.
    for (const slide of d.slides) {
        for (const object of slide.objects) {
            if (object.type !== 'opaque' || !object.source) continue;
            const node = locate(await xmlPart(zip, object.source.part, xml), object.source.path);
            const reference = child(child(child(node, 'a', 'graphic'), 'a', 'graphicData'), 'c', 'chart');
            if (!reference) continue;
            const relationship = d.relationships.find(r => r.id === `rel:${object.source.part}:${attr(reference, 'r', 'id')}` && r.mode === 'internal' && /\/chart$/.test(r.type));
            if (!relationship) continue;
            try {
                const chart = readPptxChartData(await xmlPart(zip, relationship.target, xml));
                if (chart) { object.type = 'chart'; object.chart = chart; }
            } catch { /* Unsupported chart stays opaque and is never rewritten. */ }
        }
    }
    return d;
}
