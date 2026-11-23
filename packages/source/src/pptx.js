import { createDocument } from '@stagecraft/core/document';
import { is, all, child, children, attr, attrs, source, id, xmlPart, locate, resolvePptxTarget } from './xml.js';
import { readPptxChartData } from './chart-authoring.js';
import { readPptxParagraphStyle, readPptxBodyLayout } from './authoring.js';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
const paragraphRuns = p => children(p).filter(n => !is(n, 'a', 'pPr') && !is(n, 'a', 'endParaRPr'));
const runText = r => child(r, 'a', 't')?.textContent ?? (is(r, 'a', 'br') ? '\n' : r.textContent ?? '');
// Only ordinary first-level defaults are supported; custom inherited metrics remain opaque.
function plainTextDefaults(node) {
    if (!node) return true;
    for (const p of children(node).filter(n => is(n, 'a', 'defPPr') || is(n, 'a', 'lvl1pPr'))) {
        const harmless = { marL: '0', marR: '0', indent: '0', algn: 'l', defTabSz: '914400', rtl: '0', eaLnBrk: '1', latinLnBrk: '0', hangingPunct: '1' };
        if (Object.entries(attrs(p)).some(([key, value]) => harmless[key] !== value)) return false;
        for (const n of children(p)) {
            if (is(n, 'a', 'buNone')) continue;
            if (!is(n, 'a', 'defRPr')) return false;
            if (Object.entries(attrs(n)).some(([key, value]) => key !== 'sz' && !(key === 'kern' && value === '1200') && !(key === 'lang' && value === 'en-US'))) return false;
            for (const slot of children(n)) {
                if (is(slot, 'a', 'solidFill')) continue;
                const expected = { latin: '+mn-lt', ea: '+mn-ea', cs: '+mn-cs' }[slot.localName];
                if (!is(slot, 'a', slot.localName) || !expected || slot.getAttribute('typeface') !== expected) return false;
            }
        }
    }
    return true;
}
/** Whether the projected canonical text contains all metrics this measurer supports. */
function textMetrics(shape, body) {
    const ref = child(child(shape, 'p', 'style'), 'a', 'fontRef')?.getAttribute('idx') ?? 'minor';
    const bodyPr = child(body, 'a', 'bodyPr');
    const geometries = children(child(shape, 'p', 'spPr')).filter(n => is(n, 'a', 'prstGeom') || is(n, 'a', 'custGeom'));
    // Other presets/custom geometry can have an inset text rectangle we do not project.
    const rectangular = geometries.length === 0 || geometries.length === 1
        && is(geometries[0], 'a', 'prstGeom') && geometries[0].getAttribute('prst') === 'rect'
        && children(geometries[0]).every(n => is(n, 'a', 'avLst') && children(n).length === 0);
    const unsupportedAttrs = (node, allowed) => Object.keys(attrs(node)).some(name => !allowed.includes(name));
    let supported = rectangular && ['major', 'minor'].includes(ref) && !all(shape, 'p', 'ph').length
        && !children(child(body, 'a', 'lstStyle')).length
        && !unsupportedAttrs(bodyPr, ['wrap', 'anchor', 'lIns', 'rIns', 'tIns', 'bIns'])
        && children(bodyPr).every(n => is(n, 'a', n.localName) && ['normAutofit', 'noAutofit', 'spAutoFit'].includes(n.localName));
    for (const paragraph of children(body).filter(n => is(n, 'a', 'p'))) {
        const props = child(paragraph, 'a', 'pPr');
        if (unsupportedAttrs(props, ['algn', 'lvl', 'marL', 'marR', 'indent'])) supported = false;
        for (const n of children(props)) {
            const spacing = { lnSpc: 'spcPct', spcBef: 'spcPts', spcAft: 'spcPts' }[n.localName];
            if (spacing ? !is(n, 'a', n.localName) || children(n).length !== 1 || !is(children(n)[0], 'a', spacing)
                : !is(n, 'a', 'buNone')) supported = false;
        }
        const end = child(paragraph, 'a', 'endParaRPr');
        if (children(end).length || unsupportedAttrs(end, ['lang', 'dirty'])) supported = false;
        for (const run of paragraphRuns(paragraph)) {
            const rp = child(run, 'a', 'rPr');
            if (!is(run, 'a', 'r') || unsupportedAttrs(rp, ['lang', 'altLang', 'sz', 'b', 'i', 'dirty', 'smtClean', 'u'])) supported = false;
            if (children(rp).some(n => !is(n, 'a', n.localName) || !['latin', 'ea', 'cs', 'solidFill', 'highlight'].includes(n.localName))) supported = false;
        }
    }
    return { fontRef: ref, supported };
}
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
        runs: paragraphRuns(p).map(r => ({
            id: id(part, r), text: runText(r), editable: false, style: attrs(child(r, 'a', 'rPr'))
        }))
    }));
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
            lines.push(paragraphRuns(p).map(runText).join(''));
    }
    return lines.join('\n');
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
            const target = mode === 'Internal' ? resolvePptxTarget(owner, raw) : raw;
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
    d.extensions.pptxTextDefaultsSupported = plainTextDefaults(child(presentation.documentElement, 'p', 'defaultTextStyle'));
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
        if (kind === 'masters') item.extensions = { ...item.extensions, pptxTextDefaultsSupported: plainTextDefaults(child(child(root, 'p', 'txStyles'), 'p', 'otherStyle')) };
        if (rels(part).some(r => r.type === REL + 'themeOverride')) item.extensions = { ...item.extensions, pptxThemeOverride: true };
        if (kind === 'themes') {
            const scheme = child(child(root, 'a', 'themeElements'), 'a', 'fontScheme');
            if (scheme) {
                const fonts = {};
                for (const [key, tag] of [['major', 'majorFont'], ['minor', 'minorFont']]) {
                    const group = child(scheme, 'a', tag);
                    if (!group) continue;
                    fonts[key] = Object.fromEntries([['latin', 'latin'], ['eastAsian', 'ea'], ['complexScript', 'cs']]
                        .filter(([, slot]) => child(group, 'a', slot)?.hasAttribute('typeface'))
                        .map(([name, slot]) => [name, child(group, 'a', slot).getAttribute('typeface')]));
                    fonts[key].supplemental = Object.fromEntries(children(group).filter(n => is(n, 'a', 'font') && n.hasAttribute('script') && n.hasAttribute('typeface'))
                        .map(n => [n.getAttribute('script'), n.getAttribute('typeface')]));
                }
                // Appearance only: source export retains the original theme part.
                item.extensions = { ...item.extensions, pptxFontScheme: fonts };
            }
        }
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
                o.extensions.pptxTextMetrics = textMetrics(n, textBody);
                // A filled geometric sp keeps its shape identity so authored shape text and paint
                // survive a reopen; an unfilled sp with text is a text box.
                o.type = isGeometricShape && plainFill ? 'shape' : 'text';
                o.text = { paragraphs: children(textBody).filter(n => is(n, 'a', 'p')).map(p => ({ id: id(part, p), source: source('pptx', part, p), style: readPptxParagraphStyle(p), runs: paragraphRuns(p).map(r => {
                            const t = child(r, 'a', 't'), editable = is(r, 'a', 'r') && !!t && children(r).filter(c => is(c, 'a', 'rPr')).length <= 1 && children(r).every(c => is(c, 'a', 'rPr') || c === t) && children(t).length === 0;
                            const run = { id: id(part, r), text: runText(r), editable, source: source('pptx', part, t ?? r), style: attrs(child(r, 'a', 'rPr')) };
                            const runProperties = child(r, 'a', 'rPr');
                            const family = child(runProperties, 'a', 'latin')?.getAttribute('typeface');
                            const colour = child(child(runProperties, 'a', 'solidFill'), 'a', 'srgbClr');
                            // Retain direct font aliases too: deleting this key must reset theme-font references.
                            if (child(runProperties, 'a', 'latin')) run.style.typeface = family || null;
                            // null denotes an opaque direct fill, not inherited colour. Reset removes its key.
                            const fills = children(runProperties).filter(n => is(n, 'a', n.localName) && ['noFill','solidFill','gradFill','blipFill','pattFill','grpFill'].includes(n.localName));
                            if (fills.length) run.style.color = fills.length === 1 && colour && children(colour).length === 0 && /^[0-9a-f]{6}$/i.test(colour.getAttribute('val') ?? '') ? `#${colour.getAttribute('val').toLowerCase()}` : null;
                            for (const [key, slot] of [['eastAsian', 'ea'], ['complexScript', 'cs']]) {
                                const node = child(runProperties, 'a', slot);
                                if (node) run.style[key] = node.getAttribute('typeface') || null;
                            }
                            const properties = child(r, 'a', 'rPr');
                            const typeface = child(properties, 'a', 'latin')?.getAttribute('typeface');
                            const color = child(child(properties, 'a', 'solidFill'), 'a', 'srgbClr');
                            // Derived preview data is immutable to the retained-source writer.
                            const appearance = {};
                            if (typeface && !typeface.startsWith('+')) appearance.fontFamily = typeface;
                            for (const key of ['eastAsian', 'complexScript'])
                                if (run.style[key] && !run.style[key].startsWith('+')) appearance[key] = run.style[key];
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
