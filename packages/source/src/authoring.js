import { validateAuthoredObject, validateAuthoredSlide, isParagraphFormatValue } from '@stagecraft/core/document';
import { jsonEqual as equal } from '@stagecraft/core/lib/jsonEqual.js';
import { NS, is, child, children, all, attr, attrs, locate, xmlPart, validText, resolvePptxTarget } from './xml.js';
import { patchOdp } from './odp.js';
import { odpFormattingWriter, reservedOdpStyleNames } from './odp-format.js';
import { createPptxChartParts, createOdpChartParts } from './chart-authoring.js';
const REL = NS.r + '/';
// FU-CR: a CRLF split across adjacent runs within ONE paragraph must render a single native
// break. PowerPoint renders a preserved CR plus the next run's LF as two breaks (native-verified),
// and a literal CR alone is normalized to LF by any XML parser anyway, so encoding cannot help:
// instead the writers drop the trailing CR of a run when the next non-empty run of the same
// paragraph starts with LF (that LF is the single break). Empty runs are skipped by the lookahead;
// a CR/LF pair across two paragraphs is canonical content and is written as-is. The canonical
// reopen therefore carries the folded text (the CR is lost) — accepted: native rendering wins
// over byte identity, and the folded display is unchanged.
const coalesceSplitBreaks = runs => runs.map((run, index) => {
  let next = index + 1;
  while (next < runs.length && runs[next].text === '') next++;
  return run.text.endsWith('\r') && runs[next]?.text.startsWith('\n') ? run.text.slice(0, -1) : run.text;
});

const plain = value => !!value && typeof value === 'object' && !Array.isArray(value);
const paragraphAliases = { algn: 'alignment', lvl: 'level', marL: 'indentStart', marR: 'indentEnd', indent: 'firstLineIndent' };
const paragraphKeys = new Set(['alignment','level','indentStart','indentEnd','firstLineIndent','spaceBefore','spaceAfter','lineSpacing','bullet']);
function validateParagraphChange(before = {}, after = {}) {
    if (!plain(after)) throw new Error('Invalid paragraph style');
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
        if (equal(before[key], after[key])) continue;
        if (paragraphKeys.has(key)) {
            if (after[key] !== undefined && !isParagraphFormatValue(key, after[key])) throw new Error('Invalid paragraph formatting');
        } else if (!(paragraphAliases[key] && !Object.hasOwn(after, key)
            && (Object.hasOwn(before, paragraphAliases[key]) || Object.hasOwn(after, paragraphAliases[key])))) {
            throw new Error('Unsupported opaque paragraph edit');
        }
    }
}
function validateLayoutChange(before = {}, after = {}) {
    if (!plain(after)) throw new Error('Invalid text layout');
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
        if (equal(before[key], after[key])) continue;
        if (!['anchor','wrap','autofit','insets'].includes(key)) throw new Error('Unsupported text layout');
        const value = after[key];
        if (value === undefined) continue;
        if (key === 'insets') {
            if (!plain(value)) throw new Error('Invalid text insets');
            for (const side of new Set([...Object.keys(before.insets ?? {}), ...Object.keys(value)])) {
                if (equal(before.insets?.[side], value[side])) continue;
                if (!['left','top','right','bottom'].includes(side) || value[side] !== undefined && (!Number.isSafeInteger(value[side]) || value[side] < 0 || value[side] > 10000000)) throw new Error('Invalid text inset');
            }
        } else if (!({anchor:['top','middle','bottom'],wrap:['square','none'],autofit:['none','shrink','resize']}[key].includes(value))) throw new Error('Invalid text layout value');
    }
}

function* sourceObjects(document) {
    function* descend(objects) {
        for (const object of objects ?? []) {
            yield object;
            yield* descend(object.children);
        }
    }
    for (const owner of [...document.slides, ...document.layouts, ...document.masters]) yield* descend(owner.objects);
}

/** Structural authorization is based exclusively on the retained private baseline. */
export function authoringDiff(baseline, snapshot, diff) {
    if (!snapshot.slides.length && !equal(baseline, snapshot)) throw new Error('Native export requires at least one slide');
    const structures = [], geometries = [], fills = [], slideProperties = [], paragraphFormats = [], bodyLayouts = [];
    const ids = new Set();
    function collect(value) {
        if (!value || typeof value !== 'object') return;
        if (typeof value.id === 'string') { if (ids.has(value.id)) throw new Error('Duplicate source identity'); ids.add(value.id); }
        for (const key of ['slides','layouts','masters','themes','assets','relationships','objects','children','paragraphs','runs']) for (const item of value[key] ?? []) collect(item);
        if (value.text && typeof value.text === 'object') collect(value.text);
    }
    collect(baseline);
    const owners = new Map([[baseline.slides, 'slides']]);
    for (const slide of baseline.slides) owners.set(slide.objects, slide);
    /** Per-baseline-object edit rules: which keys this writer can rewrite in place. */
    const objectRules = new Map();
    const slideObjects = new Set(baseline.slides.flatMap(s => s.objects));
    for (const object of sourceObjects(baseline)) {
        objectRules.set(object, {
            geometry: slideObjects.has(object) && object.extensions?.editableGeometry === true,
            fill: slideObjects.has(object) && object.extensions?.editableFill === true && ['rect', 'ellipse'].includes(object.shape),
            // Directly representable text formatting: PPTX paragraphs/bodyPr are attribute-based.
            paragraphs: object.text !== undefined && object.source?.format === 'pptx',
            bodyLayout: object.text !== undefined && (object.source?.format === 'pptx' || object.source?.format === 'odp')
        });
    }
    const baselineSlides = new Map(baseline.slides.map(slide => [slide, slide]));
    const assetsAdded = [];
    const baselineAssets = new Map(baseline.assets.map(asset => [asset.id, asset]));
    const SLIDE_PROPERTIES = ['name', 'background', 'notes'];
    const hook = (a,b) => {
        if (a === baseline.assets) {
            // Authored images register an asset descriptor; existing assets are opaque and immutable.
            if (!Array.isArray(b)) throw new Error('Invalid source structure');
            for (const item of b) {
                if (baselineAssets.has(item?.id)) { diff(baselineAssets.get(item.id), item); continue; }
                if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Invalid asset descriptor');
                if (Object.keys(item).some(key => !['id', 'extensions'].includes(key))) throw new Error('Unsupported asset descriptor');
                if (typeof item.id !== 'string' || !item.id || ids.has(item.id)) throw new Error('Source identity collision');
                const extensions = item.extensions;
                if (!extensions || extensions.stagecraftAuthored !== true || !['image/png', 'image/jpeg'].includes(extensions.contentType)) throw new Error('Unsupported asset descriptor');
                if (Object.keys(extensions).some(key => !['stagecraftAuthored', 'contentType'].includes(key))) throw new Error('Unsupported asset descriptor');
                ids.add(item.id);
                assetsAdded.push(item);
            }
            for (const asset of a) if (!b.some(item => item?.id === asset.id)) throw new Error('Source assets cannot be removed');
            return true;
        }
        if (owners.has(a)) {
            if (!Array.isArray(b)) throw new Error('Invalid source structure');
            const owner = owners.get(a), before = new Map(a.map(v=>[v.id,v]));
            for (const item of b) {
                if (before.has(item.id)) diff(before.get(item.id), item);
                else {
                    (owner === 'slides' ? validateAuthoredSlide : validateAuthoredObject)(item);
                    const check = v => {
                        if (!v || typeof v !== 'object') return;
                        if (typeof v.id === 'string' && ids.has(v.id)) throw new Error('Source identity collision');
                        if (typeof v.text === 'string') validText(v.text);
                        for (const x of Object.values(v)) check(x);
                    };
                    check(item);
                }
            }
            if (!equal(a.map(v=>v.id), b.map(v=>v.id))) structures.push({owner, before:a, after:b});
            return true;
        }
        if (baselineSlides.has(a)) {
            const properties = {};
            for (const key of SLIDE_PROPERTIES) {
                if (equal(a[key], b[key])) continue;
                if (b[key] === undefined) properties[key] = null;
                else {
                    // Only portable, writer-representable values may cross.
                    if (key === 'name' && (typeof b.name !== 'string' || b.name.length > 256)) throw new Error('Invalid slide name');
                    if (key === 'notes' && (typeof b.notes !== 'string' || b.notes.length > 20000)) throw new Error('Invalid slide notes');
                    if (key === 'background' && !(b.background?.type === 'solid' && /^#[0-9a-f]{6}$/i.test(b.background.color))) throw new Error('Invalid slide background');
                    if (typeof b[key] === 'string') validText(b[key]);
                    properties[key] = b[key];
                }
            }
            for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
                if (key === 'objects' || SLIDE_PROPERTIES.includes(key)) continue;
                if (!equal(a[key], b[key])) throw new Error('Unsupported slide property');
            }
            if (Object.keys(properties).length) slideProperties.push({slide: a, properties});
            diff(a.objects, b.objects);
            return true;
        }
        const rule = objectRules.get(a);
        if (rule) {
            const changed = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(key => !equal(a[key], b[key]));
            if (!changed.length) return false;
            const object = a;
            if (changed.includes('geometry')) {
                if (!rule.geometry) throw new Error('Unsupported geometry edit');
                const geometry = b.geometry;
                if (!geometry || ['x','y','width','height'].some(k=>!Number.isSafeInteger(geometry[k])) || geometry.width<=0 || geometry.height<=0 || geometry.rotation!==undefined && !Number.isFinite(geometry.rotation)) throw new Error('Invalid editable geometry');
                for (const key of new Set([...Object.keys(a.geometry),...Object.keys(geometry)])) if (!['x','y','width','height','rotation'].includes(key) && !equal(a.geometry[key], geometry[key])) throw new Error('Unsupported geometry edit');
                geometries.push({object, geometry});
            }
            if (changed.includes('fill')) {
                if (!rule.fill) throw new Error('Unsupported fill edit');
                if (typeof b.fill !== 'string' || !/^#[0-9a-f]{6}$/i.test(b.fill)) throw new Error('Invalid editable fill');
                fills.push({object, fill: b.fill});
            }
            if (changed.includes('text') && rule.paragraphs) {
                for (const key of new Set([...Object.keys(a.text), ...Object.keys(b.text)]))
                    if (key !== 'paragraphs' && !equal(a.text[key], b.text[key])) throw new Error('Unsupported text structure');
                if (!equal(a.text.paragraphs.length, b.text.paragraphs.length)) throw new Error('Unsupported text structure');
                for (let index = 0; index < a.text.paragraphs.length; index++) {
                    const before = a.text.paragraphs[index], after = b.text.paragraphs[index];
                    if (before.id !== after.id) throw new Error('Unsupported text structure');
                    if (!equal(before.style, after.style)) { validateParagraphChange(before.style, after.style); paragraphFormats.push({ object, paragraph: before, style: after.style }); }
                    diff(before.runs, after.runs);
                    for (const key of new Set([...Object.keys(before), ...Object.keys(after)]))
                        if (key !== 'runs' && key !== 'style' && !equal(before[key], after[key])) throw new Error('Unsupported paragraph structure');
                }
            }
            if (changed.includes('bodyLayout') && rule.bodyLayout) { validateLayoutChange(a.bodyLayout, b.bodyLayout); bodyLayouts.push({ object, before: a.bodyLayout ?? null, after: b.bodyLayout ?? null }); }
            const handledText = changed.includes('text') && rule.paragraphs;
            const handledLayout = changed.includes('bodyLayout') && rule.bodyLayout;
            // Anything not handled above keeps the generic walk, so an unsupported edit is still
            // rejected (e.g. ODP paragraph formatting) instead of being silently dropped.
            for (const key of changed) {
                if (key === 'geometry' || key === 'fill') continue;
                if (key === 'text' && handledText) continue;
                if (key === 'bodyLayout' && handledLayout) continue;
                diff(a[key], b[key]);
            }
            return true;
        }
        return false;
    };
    return {hook, structures, geometries, fills, slideProperties, assetsAdded, paragraphFormats, bodyLayouts};
}

const element = (doc, ns, name, attributes = {}) => {
    const node = doc.createElementNS(NS[ns], `${ns}:${name}`);
    for (const [key,value] of Object.entries(attributes)) {
        const [prefix,local] = key.split(':');
        if (local) node.setAttributeNS(NS[prefix],key,String(value)); else node.setAttribute(key,String(value));
    }
    return node;
};
const append = (parent,ns,name,attrs) => { const n=element(parent.ownerDocument,ns,name,attrs);parent.appendChild(n);return n; };
function pptxGeometry(node,g) {
    const doc=node.ownerDocument;
    const frame=is(node,'p','graphicFrame'), props=frame?node:child(node,'p','spPr'), ns=frame?'p':'a';
    let xfrm=child(props,ns,'xfrm');
    if (!xfrm) {xfrm=element(doc,ns,'xfrm');props.insertBefore(xfrm,frame?child(node,'a','graphic'):props.firstChild);}
    let off=child(xfrm,'a','off'), ext=child(xfrm,'a','ext');
    if (!off) off=append(xfrm,'a','off'); if (!ext) ext=append(xfrm,'a','ext');
    off.setAttribute('x',String(g.x));off.setAttribute('y',String(g.y));ext.setAttribute('cx',String(g.width));ext.setAttribute('cy',String(g.height));
    if (g.rotation === undefined) xfrm.removeAttribute('rot'); else xfrm.setAttribute('rot',String(Math.round(g.rotation*60000)));
}
async function pptxObject(doc,object,nextId,ctx) {
    if (object.type === 'table' && object.table) return pptxTable(doc, object, nextId);
    if (object.type === 'image' && object.image) return pptxPicture(doc, object, nextId, await ctx.imageRel(object.image.assetId));
    if (object.type === 'chart' && object.chart) return ctx.chart(object, nextId);
    const node=element(doc,'p','sp'), nv=append(node,'p','nvSpPr');
    append(nv,'p','cNvPr',{id:nextId,name:`Stagecraft ${nextId}`});append(nv,'p','cNvSpPr',object.type==='text'?{txBox:1}:{});append(nv,'p','nvPr');
    const props=append(node,'p','spPr');pptxGeometry(node,object.geometry);
    append(append(props,'a','prstGeom',{prst:object.shape??'rect'}),'a','avLst');
    if(object.type==='shape')append(append(props,'a','solidFill'),'a','srgbClr',{val:object.fill.slice(1)});
    else append(props,'a','noFill');
    append(append(props,'a','ln'),'a','noFill');
    if(object.text) {
        const body=append(node,'p','txBody');const bodyProperties=append(body,'a','bodyPr');append(body,'a','lstStyle');
        if(object.bodyLayout) applyPptxBodyLayout(bodyProperties, object.bodyLayout);
        for(const paragraph of pptxParagraphs(doc, object.text, 'a')) body.appendChild(paragraph);
    }
    return node;
}
const XML_SPACE='http://www.w3.org/XML/1998/namespace';
/** One <a:p>/<a:r> per authored paragraph/run, sharing the authored style attributes. */
function pptxParagraphs(doc, text, ns) {
    const paragraphs=[];
    for(const paragraph of text.paragraphs) {
        const p=element(doc,ns,'p');
        // Authored paragraph formatting is written from the semantic keys the commands store.
        if(paragraph.style && Object.keys(paragraph.style).length) applyPptxParagraphFormat(p, {}, paragraph.style);
        const written=coalesceSplitBreaks(paragraph.runs);
        for(const [index,run] of paragraph.runs.entries()) {
            const r=element(doc,ns,'r'), properties=element(doc,ns,'rPr');
            for(const [key,value] of Object.entries(run.style ?? {})) if(!['typeface','color'].includes(key)) properties.setAttribute(key,String(value));
            applyPptxRunTypography(properties, run);
            r.appendChild(properties);
            const t=element(doc,ns,'t');t.textContent=written[index];
            if(/^\s|\s$/.test(written[index])) t.setAttributeNS(XML_SPACE,'xml:space','preserve');
            r.appendChild(t);p.appendChild(r);
        }
        paragraphs.push(p);
    }
    return paragraphs;
}
function pptxTable(doc, object, nextId) {
    const frame=element(doc,'p','graphicFrame'), nv=append(frame,'p','nvGraphicFramePr');
    append(nv,'p','cNvPr',{id:nextId,name:`Stagecraft table ${nextId}`});append(nv,'p','cNvGraphicFramePr');append(nv,'p','nvPr');
    pptxGeometry(frame,object.geometry);
    const data=append(append(frame,'a','graphic'),'a','graphicData',{uri:'http://schemas.openxmlformats.org/drawingml/2006/table'});
    const tbl=append(data,'a','tbl');
    append(tbl,'a','tblPr',{firstRow:1,bandRow:1});
    const grid=append(tbl,'a','tblGrid');
    for(const column of object.table.columns) append(grid,'a','gridCol',{w:column.width});
    const rowHeight=Math.max(1,Math.round(object.geometry.height/object.table.rows.length));
    for(const row of object.table.rows) {
        const tr=append(tbl,'a','tr',{h:rowHeight});
        for(const cell of row.cells) {
            const tc=append(tr,'a','tc'), body=append(tc,'a','txBody');
            append(body,'a','bodyPr');append(body,'a','lstStyle');
            for(const paragraph of pptxParagraphs(doc, cell.text, 'a')) body.appendChild(paragraph);
            append(tc,'a','tcPr');
        }
    }
    return frame;
}
function pptxPicture(doc, object, nextId, rid) {
    const pic=element(doc,'p','pic'), nv=append(pic,'p','nvPicPr');
    append(nv,'p','cNvPr',{id:nextId,name:`Stagecraft image ${nextId}`,...(object.image.alt ? {descr:object.image.alt} : {})});
    append(append(nv,'p','cNvPicPr'),'a','picLocks',{noChangeAspect:1});
    append(nv,'p','nvPr');
    const fill=append(pic,'p','blipFill');
    append(fill,'a','blip',{'r:embed':rid});
    append(append(fill,'a','stretch'),'a','fillRect');
    // p:pic carries its own p:spPr; build the transform directly so the schema order stays
    // nvPicPr, blipFill, spPr.
    const props=append(pic,'p','spPr'), xfrm=append(props,'a','xfrm');
    append(xfrm,'a','off',{x:object.geometry.x,y:object.geometry.y});
    append(xfrm,'a','ext',{cx:object.geometry.width,cy:object.geometry.height});
    if(object.geometry.rotation!==undefined&&object.geometry.rotation!==0) xfrm.setAttribute('rot',String(Math.round(object.geometry.rotation*60000)));
    append(append(props,'a','prstGeom',{prst:'rect'}),'a','avLst');
    return pic;
}
function odpGeometry(node,g) {
    for(const key of ['x','y','width','height']) node.setAttributeNS(NS.svg,`svg:${key}`,`${g[key]/914400}in`);
    if (g.rotation !== undefined && g.rotation !== 0) throw new Error('ODP rotation editing is unsupported');
    else node.removeAttributeNS(NS.draw,'transform');
}

/** Capture all original node identities before any text patch inserts/removes siblings. */
export async function prepareAuthoring(zip,xml,baseline,delta,getDoc,assets={get:()=>null}) {
    const nodes=new Map();
    for(const slide of baseline.slides) {
        nodes.set(slide,locate(await getDoc(slide.source.part),slide.source.path));
    }
    for(const object of sourceObjects(baseline)) {
        nodes.set(object,locate(await getDoc(object.source.part),object.source.path));
        for(const paragraph of object.text?.paragraphs ?? []) if(paragraph.source) nodes.set(paragraph,locate(await getDoc(paragraph.source.part),paragraph.source.path));
    }
    const format=baseline.slides[0]?.source.format ?? baseline.masters[0]?.source.format;
    const media=new Map(); // assetId -> {part, contentType}
    const relative=(from,to)=>{const a=from.split('/').slice(0,-1),b=to.split('/');while(a.length&&a[0]===b[0]){a.shift();b.shift();}return '../'.repeat(a.length)+b.map(encodeURIComponent).join('/');};
    return async () => {
        const dirty=new Set(), mark=part=>dirty.add(part);
        for(const {object,geometry} of delta.geometries) { (format==='pptx'?pptxGeometry:odpGeometry)(nodes.get(object),geometry);mark(object.source.part); }
        for(const {object,fill} of delta.fills) {
            if(format==='pptx') patchPptxFill(object,fill,nodes.get(object));
            else patchOdpFill(object,fill,nodes.get(object),await getDoc('styles.xml'));
            mark(object.source.part);
        }
        for(const {object,paragraph,style} of delta.paragraphFormats ?? []) {
            const node=nodes.get(paragraph); if(!node) throw new Error('Missing mapped paragraph node');
            applyPptxParagraphFormat(node, paragraph.style ?? {}, style ?? {});
            mark(paragraph.source.part);
        }
        for(const {object,before,after} of delta.bodyLayouts ?? []) {
            const node=nodes.get(object); if(!node) throw new Error('Missing mapped object node');
            const patch={};
            for(const key of new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]))
                if(!equal(before?.[key], after?.[key])) {
                    if(key==='insets') {
                        patch.insets={};
                        for(const side of new Set([...Object.keys(before?.insets ?? {}),...Object.keys(after?.insets ?? {})]))
                            if(!equal(before?.insets?.[side],after?.insets?.[side])) patch.insets[side]=after?.insets?.[side] ?? null;
                    } else patch[key]=after && Object.hasOwn(after, key) ? after[key] : null;
                }
            if(format==='odp') {
                if(Object.keys(patch).some(key=>key!=='autofit')) throw new Error('Unsupported ODP text layout');
                if(patch.autofit==='shrink') throw new Error('ODP autofit shrink is unsupported');
                const styleName=attr(node,'draw','style-name');
                const docNode=node.ownerDocument, stylesDoc=await getDoc('styles.xml');
                const matching=d=>all(d,'style','style').filter(n=>attr(n,'style','name')===styleName&&attr(n,'style','family')==='graphic');
                const local=matching(docNode), common=matching(stylesDoc);
                const candidates=local.length?local:common;
                if(styleName && candidates.length!==1) throw new Error('Unsupported ODP text layout');
                // Copy rather than mutate a shared style; preserve every unrelated graphic property.
                const style=styleName ? docNode.importNode(candidates[0],true) : element(docNode,'style','style',{'style:family':'graphic'});
                const reserved=new Set(reservedOdpStyleNames(docNode,stylesDoc));
                let index=1,name;do{name=`StagecraftBody${index++}`;}while(reserved.has(name));
                style.setAttributeNS(NS.style,'style:name',name);
                let automatic=child(docNode.documentElement,'office','automatic-styles');
                if(!automatic){automatic=element(docNode,'office','automatic-styles');docNode.documentElement.insertBefore(automatic,child(docNode.documentElement,'office','master-styles') ?? child(docNode.documentElement,'office','body'));}
                automatic.appendChild(style);
                node.setAttributeNS(NS.draw,'draw:style-name',name);
                let properties=child(style,'style','graphic-properties');
                if(!properties){ properties=append(style,'style','graphic-properties'); }
                const value=patch.autofit==='resize'?'true':patch.autofit==='none'?'false':null;
                if(value===null){ properties.removeAttributeNS(NS.draw,'auto-grow-height'); properties.removeAttributeNS(NS.draw,'auto-grow-width'); }
                else {
                    properties.setAttributeNS(NS.draw,'draw:auto-grow-height',value);
                    properties.setAttributeNS(NS.draw,'draw:auto-grow-width',value);
                    properties.setAttributeNS(NS.draw,'draw:fit-to-size','false');
                    properties.setAttributeNS(NS.style,'style:shrink-to-fit','false');
                }
                mark(object.source.part);
                continue;
            }
            const bodyPr=child(child(node,'p','txBody'),'a','bodyPr');
            if(!bodyPr) throw new Error('Unsupported text body');
            if(Object.keys(patch).length){ applyPptxBodyLayout(bodyPr, patch); mark(object.source.part); }
        }
        if(!delta.structures.length && !delta.slideProperties.length) return dirty;
        if(format==='pptx') {
            const main=baseline.relationships.find(r=>r.ownerPart==='[package]'&&r.type===REL+'officeDocument').target;
            const relPart=main.replace(/(^|\/)([^/]+)$/, '$1_rels/$2.rels');
            const presentation=await getDoc(main), rels=await getDoc(relPart), types=await getDoc('[Content_Types].xml');
            const usedRels=new Set(children(rels.documentElement).map(n=>n.getAttribute('Id')));
            const newSlideNotes=new Map();
            const usedPartNames=new Set(Object.keys(zip.files));
            const addPartContentType=(path,contentType)=>{
                if(!contentType||/\.rels$/.test(path)) return;
                if(!all(types,'ct','Override').some(n=>n.getAttribute('PartName')==='/'+path))
                    append(types.documentElement,'ct','Override',{PartName:'/'+path,ContentType:contentType});
                mark('[Content_Types].xml');
            };
            /** Chart graphicFrame + parts + slide relationship, isolated per owning slide. */
            const chartFor=(part,R,relsPath)=>async(object,nonVisualId)=>{
                const created=await createPptxChartParts({ chart:object.chart, geometry:object.geometry, nonVisualId, ownerPart:part, usedPartNames,
                    usedRelationshipIds:new Set(children(R.documentElement).map(n=>n.getAttribute('Id'))) });
                for(const entry of created.parts){ zip.file(entry.path,entry.data); mark(entry.path); addPartContentType(entry.path,entry.contentType); }
                append(R.documentElement,'rel','Relationship',{Id:created.relationship.id,Type:created.relationship.type,Target:created.relationship.target});
                mark(relsPath);
                return xml.parse(created.frameXml).documentElement;
            };
            const ensureMedia=assetId=>{
                if(media.has(assetId)) return media.get(assetId);
                const image=assets.get(assetId);if(!image) throw new Error('Missing image bytes for a referenced asset');
                const extension=image.contentType==='image/png'?'png':'jpeg';
                let n=1, target;do{target=`ppt/media/stagecraft${n++}.${extension}`;}while(zip.file(target));
                zip.file(target,image.bytes);
                if(!all(types,'ct','Default').some(node=>node.getAttribute('Extension')===extension))
                    append(types.documentElement,'ct','Default',{Extension:extension,ContentType:image.contentType});
                media.set(assetId,{part:target,contentType:image.contentType});
                return media.get(assetId);
            };
            const imageRel=(part,R)=>assetId=>{
                const source=ensureMedia(assetId), existing=children(R.documentElement).find(n=>n.getAttribute('Type')===REL+'image'&&n.getAttribute('TargetMode')!=='External'&&resolvePptxTarget(part,n.getAttribute('Target'))===source.part);
                if(existing) return existing.getAttribute('Id');
                // Uniqueness is per owning part, so two images on one slide can never collide.
                const ids=new Set(children(R.documentElement).map(n=>n.getAttribute('Id')));
                let index=1,rid;
                do{rid=`rIdStagecraftImg${index++}`;}while(ids.has(rid));
                append(R.documentElement,'rel','Relationship',{Id:rid,Type:REL+'image',Target:relative(part,source.part)});
                return rid;
            };
            const slideRelsDoc=async part=>{
                const path=part.replace(/(^|\/)([^/]+)$/, '$1_rels/$2.rels');
                if(!zip.file(path)) zip.file(path,`<Relationships xmlns="${NS.rel}"/>`);
                return {path,doc:await getDoc(path)};
            };
            let list=child(presentation.documentElement,'p','sldIdLst');
            if(!list)list=append(presentation.documentElement,'p','sldIdLst');
            const existingRefs=new Map(baseline.slides.map(s=>{
                const relationship=baseline.relationships.find(r=>r.ownerPart===main&&r.target===s.source.part&&r.type===REL+'slide');
                const rid=relationship.id.slice(`rel:${main}:`.length);
                return [s.id,children(list).find(n=>attr(n,'r','id')===rid)];
            }));
            let nextPart=1,nextRel=1,nextSlide=Math.max(255,...children(list).map(n=>Number(n.getAttribute('id'))));
            const partFor=slide=>slide.source?.part;
            const addSlide=async slide=> {
                let part;do{part=`ppt/slides/stagecraft${nextPart++}.xml`;}while(zip.file(part) || all(types,'ct','Override').some(n=>n.getAttribute('PartName')==='/'+part));
                let rid;do{rid=`rIdStagecraft${nextRel++}`;}while(usedRels.has(rid));usedRels.add(rid);
                const doc=xml.parse(`<p:sld xmlns:p="${NS.p}" xmlns:a="${NS.a}" xmlns:r="${NS.r}"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`);
                const cSld=child(doc.documentElement,'p','cSld'), tree=child(cSld,'p','spTree');
                // Authored slide properties belong to the slide being created, so write them here.
                if(typeof slide.name==='string'&&slide.name) cSld.setAttribute('name',slide.name);
                if(slide.background?.type==='solid'){
                    const background=element(doc,'p','bg'), propertiesNode=append(background,'p','bgPr');
                    append(append(propertiesNode,'a','solidFill'),'a','srgbClr',{val:slide.background.color.slice(1).toUpperCase()});
                    append(propertiesNode,'a','effectLst');
                    cSld.insertBefore(background,cSld.firstChild);
                }
                if(typeof slide.notes==='string'&&slide.notes) newSlideNotes.set(slide.id,{part,notes:slide.notes});
                const slideRels=part.replace(/(^|\/)([^/]+)$/,'$1_rels/$2.rels');
                const relations=xml.parse(`<Relationships xmlns="${NS.rel}"/>`);
                relations.documentElement.appendChild(element(relations,'rel','Relationship',{Id:'rId1',Type:REL+'slideLayout',Target:relative(part,baseline.layouts[0]?.source.part)}));
                const slideCtx={imageRel:imageRel(part,relations),chart:chartFor(part,relations,slideRels)};
                for(const [index,object] of slide.objects.entries()) tree.appendChild(await pptxObject(doc,object,index+2,slideCtx));
                zip.file(part,xml.serialize(doc));mark(part);
                const layout=baseline.layouts[0]?.source.part;if(!layout)throw new Error('New slides require an existing native layout');
                zip.file(slideRels,xml.serialize(relations));mark(slideRels);
                append(rels.documentElement,'rel','Relationship',{Id:rid,Type:REL+'slide',Target:relative(main,part)});
                append(types.documentElement,'ct','Override',{PartName:'/'+part,ContentType:'application/vnd.openxmlformats-officedocument.presentationml.slide+xml'});
                return element(presentation,'p','sldId',{id:++nextSlide,'r:id':rid});
            };
            for(const change of delta.structures) {
                if(change.owner==='slides') {
                    for(const node of existingRefs.values())node?.parentNode?.removeChild(node);
                    for(const slide of change.after)list.appendChild(existingRefs.get(slide.id)??await addSlide(slide));
                    const kept=new Set(change.after.map(s=>s.id));
                    for(const slide of change.before.filter(s=>!kept.has(s.id))) {
                        const slideRef=existingRefs.get(slide.id);if(!slideRef)continue;
                        const rid=attr(slideRef,'r','id'),nativeId=slideRef.getAttribute('id');
                        for(const n of all(presentation,'p','sld')) if(attr(n,'r','id')===rid) n.parentNode.removeChild(n);
                        for(const n of Array.from(presentation.getElementsByTagNameNS('http://schemas.microsoft.com/office/powerpoint/2010/main','sldId'))) if(n.getAttribute('id')===nativeId) n.parentNode.removeChild(n);
                        for(const n of children(rels.documentElement))if(n.getAttribute('Id')===rid)rels.documentElement.removeChild(n);
                    }
                    mark(main);
                    if(change.before.some(s=>!kept.has(s.id)) || change.after.some(s=>!existingRefs.has(s.id))) mark(relPart);
                    if(change.after.some(s=>!existingRefs.has(s.id)))mark('[Content_Types].xml');
                } else {
                    const part=partFor(change.owner);
                    const tree=child(child(nodes.get(change.owner),'p','cSld'),'p','spTree');
                    let nativeId=Math.max(1,...all(tree,'p','cNvPr').map(n=>Number(n.getAttribute('id'))||0));
                    const before=new Map(change.before.map(o=>[o.id,nodes.get(o)]));
                    for(const node of before.values())tree.removeChild(node);
                    const relsFile=await slideRelsDoc(part), slideCtx={imageRel:imageRel(part,relsFile.doc),chart:chartFor(part,relsFile.doc,relsFile.path)};
                    const usedImageRels=children(relsFile.doc.documentElement).length;
                    for(const object of change.after)tree.insertBefore(before.get(object.id)??await pptxObject(tree.ownerDocument,object,++nativeId,slideCtx),child(tree,'p','extLst')??null);
                    mark(part);
                    if(children(relsFile.doc.documentElement).length!==usedImageRels) mark(relsFile.path);
                    if(change.after.some(o=>o.type==='image')) mark('[Content_Types].xml');
                }
            }
            await applyPptxSlideProperties({xml,getDoc,zip,baseline,nodes,slideProperties:delta.slideProperties,mark,main,rels,relPart,types,presentation,existingRefs,nextSlideRef:()=>++nextSlide,relative,newSlideNotes});
        } else {
            const doc=await getDoc('content.xml'), styles=await getDoc('styles.xml'), body=child(child(doc.documentElement,'office','body'),'office','presentation');
            const reserved=new Set(reservedOdpStyleNames(doc,styles));let nextStyle=1,nextName=1,nextObject=1;
            const usedPartNames=new Set(Object.keys(zip.files));
            const objectIds=new Set([doc,styles].flatMap(d=>Array.from(d.getElementsByTagNameNS('*','*')).flatMap(n=>[attr(n,'draw','id'),n.getAttributeNS(XML_SPACE,'id')])));
            const names=new Set(all(doc,'draw','page').map(n=>attr(n,'draw','name')));
            const textStyle=odpFormattingWriter(doc,[...reserved]);
            const automaticStyles=()=>{let auto=child(doc.documentElement,'office','automatic-styles');if(!auto){auto=element(doc,'office','automatic-styles');doc.documentElement.insertBefore(auto,child(doc.documentElement,'office','body'));}return auto;};
            const nextStyleName=prefix=>{let style;do{style=`${prefix}${nextStyle++}`;}while(reserved.has(style));reserved.add(style);return style;};
            const odfAutofit=layout=>{
                if(!layout) return null;
                if(Object.keys(layout).some(key=>key!=='autofit')) throw new Error('Unsupported ODP text layout');
                if(layout.autofit===undefined) return null;
                if(layout.autofit==='resize') return 'true';
                if(layout.autofit==='none') return 'false';
                throw new Error('ODP autofit shrink is unsupported');
            };
            const graphicStyle=(n,extra={})=>{
                let style=nextStyleName('StagecraftGraphic');
                const s=append(automaticStyles(),'style','style',{'style:name':style,'style:family':'graphic'});
                append(s,'style','graphic-properties',{'draw:stroke':'none','draw:fill':'none',...extra});
                n.setAttributeNS(NS.draw,'draw:style-name',style);
            };
            // Authored paragraph formatting: ODP needs a named paragraph style; bullets need a list.
            const LIST_NUM_FORMAT={arabicPeriod:'1',arabicParenR:'1',lowerAlphaPeriod:'a',upperAlphaPeriod:'A',lowerRomanPeriod:'i',upperRomanPeriod:'I'};
            const listStyles=new Map();
            const listStyleFor=bullet=>{
                const key=bullet.type==='char'?`char:${bullet.char}`:`num:${bullet.format}`;
                if(listStyles.has(key)) return listStyles.get(key);
                const name=nextStyleName('StagecraftList');
                const style=append(automaticStyles(),'text','list-style',{'style:name':name});
                for(let level=1;level<=9;level++){
                    if(bullet.type==='char') append(style,'text','list-level-style-bullet',{'text:level':String(level),'text:bullet-char':bullet.char});
                    else append(style,'text','list-level-style-number',{'text:level':String(level),'style:num-format':LIST_NUM_FORMAT[bullet.format],'style:num-suffix':bullet.format==='arabicParenR'?')':'.'});
                }
                listStyles.set(key,name);
                return name;
            };
            const paragraphStyleFor=style=>{
                if(!style||!Object.keys(style).length) return null;
                const name=nextStyleName('StagecraftParagraph');
                const node=append(automaticStyles(),'style','style',{'style:name':name,'style:family':'paragraph'});
                const properties={};
                if(style.alignment) properties['fo:text-align']={left:'start',center:'center',right:'end',justify:'justify'}[style.alignment];
                if(style.spaceBefore!==undefined) properties['fo:margin-top']=`${style.spaceBefore}pt`;
                if(style.spaceAfter!==undefined) properties['fo:margin-bottom']=`${style.spaceAfter}pt`;
                if(style.indentStart!==undefined) properties['fo:margin-left']=`${style.indentStart/914400}in`;
                if(style.indentEnd!==undefined) properties['fo:margin-right']=`${style.indentEnd/914400}in`;
                if(style.firstLineIndent!==undefined) properties['fo:text-indent']=`${style.firstLineIndent/914400}in`;
                if(style.lineSpacing!==undefined) properties['fo:line-height']=`${style.lineSpacing}%`;
                append(node,'style','paragraph-properties',properties);
                return name;
            };
            const fillParagraph=(container,paragraph,inList=false)=>{
                const p=append(container,'text','p');
                const styleName=paragraphStyleFor(paragraph.style);
                if(styleName) p.setAttributeNS(NS.text,'text:style-name',styleName);
                if(paragraph.style?.level&&!inList) throw new Error('Non-list ODP paragraph levels are unsupported');
                const written=coalesceSplitBreaks(paragraph.runs);
                for(let index=0;index<paragraph.runs.length;index++){const run=paragraph.runs[index];const placeholder=doc.createTextNode('');p.appendChild(placeholder);const overrides={...(run.style.b!==undefined?{bold:run.style.b==='1'}:{}),...(run.style.i!==undefined?{italic:run.style.i==='1'}:{}),...(run.style.sz!==undefined?{fontSize:Number(run.style.sz)/100}:{}),...(run.style.typeface?{fontFamily:run.style.typeface}:{}),...(run.style.color?{color:run.style.color}:{})};patchOdp(placeholder,written[index],textStyle(overrides));}
                return p;
            };
            const fillText=(box,text)=>{
                const stack=[];
                for(const paragraph of text.paragraphs){
                    const bullet=paragraph.style?.bullet;
                    if(!bullet||bullet.type==='none'){stack.length=0;fillParagraph(box,paragraph);continue;}
                    const level=paragraph.style?.level??0;
                    const key=bullet.type==='char'?`char:${bullet.char}`:`num:${bullet.format}`;
                    if(stack.length>level+1) stack.length=level+1;
                    for(let depth=0;depth<=level;depth++){
                        if(stack[depth]&&(depth!==level||stack[depth].key===key)) continue;
                        stack.length=depth;
                        let container=box;
                        if(depth>0){
                            const parent=stack[depth-1];
                            parent.lastItem??=append(parent.list,'text','list-item');
                            container=parent.lastItem;
                        }
                        const list=append(container,'text','list',{'text:style-name':listStyleFor(bullet)});
                        stack.push({list,key,lastItem:null});
                    }
                    const current=stack[level];
                    current.lastItem=append(current.list,'text','list-item');
                    fillParagraph(current.lastItem,paragraph,true);
                }
            };
            const makeTable=object=>{
                const frame=element(doc,'draw','frame');odpGeometry(frame,object.geometry);graphicStyle(frame,{});
                const tableStyle=nextStyleName('StagecraftTable'), columnStyles=object.table.columns.map(()=>nextStyleName('StagecraftColumn'));
                const ts=append(automaticStyles(),'style','style',{'style:name':tableStyle,'style:family':'table'});
                append(ts,'style','table-properties',{'style:width':`${object.geometry.width/914400}in`});
                for(const [index,column] of object.table.columns.entries()){
                    const cs=append(automaticStyles(),'style','style',{'style:name':columnStyles[index],'style:family':'table-column'});
                    append(cs,'style','table-column-properties',{'style:column-width':`${column.width/914400}in`});
                }
                let tableName;do{tableName=`StagecraftTable${nextName++}`;}while(names.has(tableName));names.add(tableName);
                const table=append(frame,'table','table',{'table:name':tableName,'table:style-name':tableStyle});
                for(const style of columnStyles) append(table,'table','table-column',{'table:style-name':style});
                for(const row of object.table.rows){
                    const tr=append(table,'table','table-row');
                    for(const cell of row.cells){const tc=append(tr,'table','table-cell',{'office:value-type':'string'});fillText(tc,cell.text);}
                }
                return frame;
            };
            const makeImage=object=>{
                const image=assets.get(object.image.assetId);if(!image) throw new Error('Missing image bytes for a referenced asset');
                const frame=element(doc,'draw','frame');odpGeometry(frame,object.geometry);graphicStyle(frame,{});
                let target;if(!media.has(object.image.assetId)){
                    const extension=image.contentType==='image/png'?'png':'jpeg';
                    let n=1;do{target=`Pictures/stagecraft${n++}.${extension}`;}while(zip.file(target));
                    zip.file(target,image.bytes);media.set(object.image.assetId,{part:target,contentType:image.contentType});
                } else target=media.get(object.image.assetId).part;
                const picture=append(frame,'draw','image');picture.setAttributeNS('http://www.w3.org/1999/xlink','xlink:href',target);
                if(object.image.alt){const title=append(frame,'svg','title');title.textContent=object.image.alt;}
                return frame;
            };
            const makeObject=async object=> {
                if(object.type==='table'&&object.table) return makeTable(object);
                if(object.type==='image'&&object.image) return makeImage(object);
                if(object.type==='chart'&&object.chart){
                    const created=createOdpChartParts({ chart:object.chart, geometry:object.geometry, name:`Chart ${nextName++}`, usedPartNames });
                    for(const entry of created.parts){ zip.file(entry.path,entry.data); mark(entry.path); }
                    if(created.manifestEntries.length){
                        const manifest=await getDoc('META-INF/manifest.xml');
                        for(const entry of created.manifestEntries)
                            if(!all(manifest,'manifest','file-entry').some(n=>attr(n,'manifest','full-path')===entry.path))
                                append(manifest.documentElement,'manifest','file-entry',{'manifest:full-path':entry.path,'manifest:media-type':entry.mediaType});
                        mark('META-INF/manifest.xml');
                    }
                    return xml.parse(created.frameXml).documentElement;
                }
                const n=element(doc,'draw',object.type==='text'?'frame':object.shape==='rect'?'rect':'ellipse');odpGeometry(n,object.geometry);
                let nativeId;do{nativeId=`StagecraftObject${nextObject++}`;}while(objectIds.has(nativeId));objectIds.add(nativeId);n.setAttributeNS(NS.draw,'draw:id',nativeId);
                let style;do{style=`StagecraftGraphic${nextStyle++}`;}while(reserved.has(style));reserved.add(style);
                const grow=odfAutofit(object.bodyLayout);
                const graphicProperties={'draw:stroke':'none','draw:fill':object.type==='text'?'none':'solid',...(object.fill?{'draw:fill-color':object.fill}:{}),...(grow!==null?{'draw:auto-grow-height':grow,'draw:auto-grow-width':grow,'draw:fit-to-size':'false','style:shrink-to-fit':'false'}:{})};
                const s=append(automaticStyles(),'style','style',{'style:name':style,'style:family':'graphic'});append(s,'style','graphic-properties',graphicProperties);n.setAttributeNS(NS.draw,'draw:style-name',style);
                if(object.text){
                    // ODF: draw:frame carries a draw:text-box, but draw:rect/draw:ellipse take text:p
                    // children directly. A text-box inside a shape is not native-valid and LibreOffice
                    // renders nothing, so nest by node kind.
                    if(object.type==='text'){const box=append(n,'draw','text-box');fillText(box,object.text);}
                    else fillText(n,object.text);
                }
                return n;
            };
            const master=baseline.slides[0] ? attr(nodes.get(baseline.slides[0]),'draw','master-page-name') : attr(locate(await getDoc(baseline.masters[0].source.part),baseline.masters[0].source.path),'style','name');
            for(const change of delta.structures) {
                const before=new Map(change.before.map(o=>[o.id,nodes.get(o)])), parent=change.owner==='slides'?body:nodes.get(change.owner);
                for(const node of before.values())parent.removeChild(node);
                for(const item of change.after) {
                    let node=before.get(item.id);
                    if(!node&&change.owner==='slides') {
                        const authoredName=typeof item.name==='string'&&item.name?item.name:null;
                        let name=authoredName;if(!name){do{name=`Stagecraft Slide ${nextName++}`;}while(names.has(name));}names.add(name);
                        node=element(doc,'draw','page',{'draw:name':name,'draw:master-page-name':master});
                        for(const object of item.objects) node.appendChild(await makeObject(object));
                        // Authored slide properties belong to the slide being created.
                        const properties={...(authoredName?{name:authoredName}:{}), ...(item.background?{background:item.background}:{}), ...(typeof item.notes==='string'&&item.notes?{notes:item.notes}:{})};
                        if(Object.keys(properties).length)
                            applyOdpSlideProperties({doc,styles,nodes:new Map([[item,node]]),slide:item,properties,automaticStyles,nextStyleName,mark,baseline});
                    }
                    else if(!node)node=await makeObject(item);
                    parent.insertBefore(node,change.owner === 'slides' ? null : children(parent).find(n=>n.namespaceURI!==NS.draw)??null);
                }
            }
            for(const {slide,properties} of delta.slideProperties) applyOdpSlideProperties({doc,styles,nodes,slide,properties,automaticStyles,nextStyleName,reserved,textStyle,zip,xml,getDoc,mark,baseline});
            mark('content.xml');
            if(media.size) {
                const manifest=await getDoc('META-INF/manifest.xml');
                for(const entry of media.values()) if(!all(manifest,'manifest','file-entry').some(n=>attr(n,'manifest','full-path')===entry.part))
                    append(manifest.documentElement,'manifest','file-entry',{'manifest:full-path':entry.part,'manifest:media-type':entry.contentType});
                mark('META-INF/manifest.xml');
            }
        }
        return dirty;
    };
}
/** Rewrite the existing solid sRGB fill of a native PPTX shape in place. */
function patchPptxFill(object,fill,node) {
    const props=child(node,'p','spPr'), solid=child(props,'a','solidFill'), colour=child(solid,'a','srgbClr');
    if(!solid||!colour) throw new Error('Unsupported native fill target');
    colour.setAttribute('val',fill.slice(1).toUpperCase());
    void object;
}
/** Rewrite the local graphic style's solid fill for a native ODP shape. */
function patchOdpFill(object,fill,node,stylesDoc) {
    const styleName=attr(node,'draw','style-name'), doc=node.ownerDocument;
    const candidates=all(doc,'style','style').filter(s=>attr(s,'style','name')===styleName&&attr(s,'style','family')==='graphic');
    if(candidates.length!==1) throw new Error('Unsupported native fill target');
    // Native graphic styles can be shared across shapes and slides.
    const style=candidates[0].cloneNode(true);
    const properties=child(style,'style','graphic-properties');
    if(!properties) throw new Error('Unsupported native fill target');
    const reserved=new Set(reservedOdpStyleNames(doc,stylesDoc));
    let index=1,name;do{name=`StagecraftFill${index++}`;}while(reserved.has(name));
    style.setAttributeNS(NS.style,'style:name',name);
    let automatic=child(doc.documentElement,'office','automatic-styles');
    if(!automatic){automatic=element(doc,'office','automatic-styles');doc.documentElement.insertBefore(automatic,child(doc.documentElement,'office','body'));}
    automatic.appendChild(style);
    node.setAttributeNS(NS.draw,'draw:style-name',name);
    properties.setAttributeNS(NS.draw,'draw:fill','solid');
    properties.setAttributeNS(NS.draw,'draw:fill-color',fill);
    void object;
}


/* ---------------------------------------------------------------- text formatting */

const ALIGN_TO_PPTX = { left: 'l', center: 'ctr', right: 'r', justify: 'just' };
const PPTX_TO_ALIGN = { l: 'left', ctr: 'center', r: 'right', just: 'justify' };
const BULLET_AUTONUM = {
    arabicPeriod: 'arabicPeriod', arabicParenR: 'arabicParenR', lowerAlphaPeriod: 'alphaLcPeriod',
    upperAlphaPeriod: 'alphaUcPeriod', lowerRomanPeriod: 'romanLcPeriod', upperRomanPeriod: 'romanUcPeriod'
};
const PPTX_TO_BULLET = Object.fromEntries(Object.entries(BULLET_AUTONUM).map(([k, v]) => [v, k]));
const pointsToEmu = points => String(Math.round(points * 12700));
const emuToPoints = emu => Number(emu) / 12700;

/** Semantic paragraph style read from a PPTX pPr node (semantics that survive a reopen). */
export function readPptxParagraphStyle(p) {
    const properties = child(p, 'a', 'pPr');
    const style = attrs(properties);
    if (!properties) return style;
    if (style.algn && PPTX_TO_ALIGN[style.algn]) style.alignment = PPTX_TO_ALIGN[style.algn];
    if (/^\d+$/.test(style.lvl ?? '')) style.level = Number(style.lvl);
    if (/^-?\d+$/.test(style.marL ?? '')) style.indentStart = Number(style.marL);
    if (/^-?\d+$/.test(style.marR ?? '')) style.indentEnd = Number(style.marR);
    if (/^-?\d+$/.test(style.indent ?? '')) style.firstLineIndent = Number(style.indent);
    const before = child(child(properties, 'a', 'spcBef'), 'a', 'spcPts')?.getAttribute('val');
    const after = child(child(properties, 'a', 'spcAft'), 'a', 'spcPts')?.getAttribute('val');
    if (/^\d+$/.test(before ?? '')) style.spaceBefore = Number(before) / 100;
    if (/^\d+$/.test(after ?? '')) style.spaceAfter = Number(after) / 100;
    const line = child(child(properties, 'a', 'lnSpc'), 'a', 'spcPct')?.getAttribute('val');
    if (/^\d+$/.test(line ?? '')) style.lineSpacing = Math.round(Number(line) / 1000);
    const character = child(properties, 'a', 'buChar')?.getAttribute('char');
    const number = child(properties, 'a', 'buAutoNum')?.getAttribute('type');
    if (child(properties, 'a', 'buNone')) style.bullet = { type: 'none' };
    else if (character) style.bullet = { type: 'char', char: character };
    else if (number && PPTX_TO_BULLET[number]) style.bullet = { type: 'number', format: PPTX_TO_BULLET[number] };
    return style;
}

/** Semantic text-body layout read from an a:bodyPr node. */
export function readPptxBodyLayout(bodyPr) {
    if (!bodyPr) return undefined;
    const layout = {};
    const wrap = bodyPr.getAttribute('wrap');
    if (wrap === 'none') layout.wrap = 'none';
    else if (wrap === 'square') layout.wrap = 'square';
    const anchor = bodyPr.getAttribute('anchor');
    if (anchor === 't') layout.anchor = 'top';
    else if (anchor === 'ctr') layout.anchor = 'middle';
    else if (anchor === 'b') layout.anchor = 'bottom';
    const insets = {};
    for (const [side, name] of [['left', 'lIns'], ['top', 'tIns'], ['right', 'rIns'], ['bottom', 'bIns']]) {
        const raw = bodyPr.getAttribute(name);
        if (/^\d+$/.test(raw ?? '')) insets[side] = Number(raw);
    }
    if (Object.keys(insets).length) layout.insets = insets;
    if (child(bodyPr, 'a', 'spAutoFit')) layout.autofit = 'resize';
    else if (child(bodyPr, 'a', 'normAutofit')) layout.autofit = 'shrink';
    else if (child(bodyPr, 'a', 'noAutofit')) layout.autofit = 'none';
    return layout;
}

const removeChildren = (parent, ns, name) => {
    for (const node of children(parent).filter(n => is(n, ns, name))) parent.removeChild(node);
};

const paragraphOrder = ['lnSpc','spcBef','spcAft','buClrTx','buClr','buSzTx','buSzPct','buSzPts','buFontTx','buFont','buNone','buAutoNum','buChar','buBlip','tabLst','defRPr','extLst'];
function appendParagraphProperty(parent, name, attributes = {}) {
    const node = element(parent.ownerDocument, 'a', name, attributes);
    const following = children(parent).find(n => n.namespaceURI === NS.a && paragraphOrder.indexOf(n.localName) > paragraphOrder.indexOf(name));
    parent.insertBefore(node, following ?? null);
    return node;
}
/** Patch paragraph formatting in place; only keys present in `after` are touched. */
export function applyPptxParagraphFormat(node, beforeStyle, afterStyle) {
    const doc = node.ownerDocument;
    let properties = child(node, 'a', 'pPr');
    if (!properties) {
        properties = element(doc, 'a', 'pPr');
        node.insertBefore(properties, node.firstChild);
    }
    const touched = new Set([...Object.keys(beforeStyle ?? {}), ...Object.keys(afterStyle ?? {})]);
    for (const key of touched) {
        const value = afterStyle?.[key];
        const had = beforeStyle?.[key];
        if (equal(had, value)) continue;
        if (key === 'alignment') {
            if (value === null || value === undefined) properties.removeAttribute('algn');
            else properties.setAttribute('algn', ALIGN_TO_PPTX[value]);
        } else if (key === 'level') {
            if (value === null || value === undefined) properties.removeAttribute('lvl');
            else properties.setAttribute('lvl', String(value));
        } else if (key === 'indentStart' || key === 'indentEnd' || key === 'firstLineIndent') {
            const attribute = { indentStart: 'marL', indentEnd: 'marR', firstLineIndent: 'indent' }[key];
            if (value === null || value === undefined) properties.removeAttribute(attribute);
            else properties.setAttribute(attribute, String(value));
        } else if (key === 'spaceBefore' || key === 'spaceAfter') {
            const name = key === 'spaceBefore' ? 'spcBef' : 'spcAft';
            removeChildren(properties, 'a', name);
            if (value !== null && value !== undefined) {
                const spacing = appendParagraphProperty(properties, name);
                append(spacing, 'a', 'spcPts', { val: Math.round(value * 100) });
            }
        } else if (key === 'lineSpacing') {
            removeChildren(properties, 'a', 'lnSpc');
            if (value !== null && value !== undefined) append(appendParagraphProperty(properties, 'lnSpc'), 'a', 'spcPct', { val: value * 1000 });
        } else if (key === 'bullet') {
            for (const name of ['buNone', 'buChar', 'buAutoNum', 'buBlip']) removeChildren(properties, 'a', name);
            if (value && value.type === 'none') appendParagraphProperty(properties, 'buNone');
            else if (value?.type === 'char') appendParagraphProperty(properties, 'buChar', { char: value.char });
            else if (value?.type === 'number') appendParagraphProperty(properties, 'buAutoNum', { type: BULLET_AUTONUM[value.format] });
        }
    }
}

/**
 * Patch a:text body layout. Autofit children are only touched when the caller sent an `autofit`
 * value, so an anchor/inset edit preserves normAutofit's fontScale/lnSpcReduction untouched.
 */
export function applyPptxBodyLayout(bodyPr, layout) {
    if (!bodyPr || !layout) return;
    if (Object.hasOwn(layout, 'wrap')) {
        if (layout.wrap === null || layout.wrap === undefined) bodyPr.removeAttribute('wrap');
        else bodyPr.setAttribute('wrap', layout.wrap === 'none' ? 'none' : 'square');
    }
    if (Object.hasOwn(layout, 'anchor')) {
        if (layout.anchor === null || layout.anchor === undefined) bodyPr.removeAttribute('anchor');
        else bodyPr.setAttribute('anchor', { top: 't', middle: 'ctr', bottom: 'b' }[layout.anchor]);
    }
    if (Object.hasOwn(layout, 'insets')) {
        for (const [side, name] of [['left', 'lIns'], ['top', 'tIns'], ['right', 'rIns'], ['bottom', 'bIns']]) {
            if (!Object.hasOwn(layout.insets ?? {}, side)) continue;
            const value = layout.insets[side];
            if (value === null || value === undefined) bodyPr.removeAttribute(name);
            else bodyPr.setAttribute(name, String(value));
        }
    }
    if (Object.hasOwn(layout, 'autofit')) {
        // Explicit choice incl. 'none' (a:noAutofit); null removes the choice and inherits.
        for (const name of ['spAutoFit', 'normAutofit', 'noAutofit']) removeChildren(bodyPr, 'a', name);
        const value = layout.autofit;
        const name = { resize: 'spAutoFit', shrink: 'normAutofit', none: 'noAutofit' }[value];
        if (name) {
            const node = element(bodyPr.ownerDocument, 'a', name);
            const following = children(bodyPr).find(n => n.namespaceURI === NS.a && ['scene3d','sp3d','flatTx','extLst'].includes(n.localName));
            bodyPr.insertBefore(node, following ?? null);
        }
    }
}

/** Run typography children (typeface/colour) for authored and native runs. */
export function applyPptxRunTypography(properties, run) {
    // a:rPr is a sequence: fill must precede a:latin or PowerPoint ignores the colour.
    removeChildren(properties, 'a', 'latin');
    removeChildren(properties, 'a', 'solidFill');
    if (run.style?.color)
        append(append(properties, 'a', 'solidFill'), 'a', 'srgbClr', { val: run.style.color.slice(1).toUpperCase() });
    if (run.style?.typeface)
        append(properties, 'a', 'latin', { typeface: run.style.typeface });
}

const REL_NOTES = REL + 'notesSlide';
const REL_NOTES_MASTER = REL + 'notesMaster';
const NOTES_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml';
const NOTES_MASTER_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml';
/** Replace only a notes slide's body-placeholder text; everything else in the part is preserved. */
function patchNotesBody(doc, text) {
    const cSld = child(doc.documentElement, 'p', 'cSld');
    const tree = child(cSld, 'p', 'spTree');
    if (!tree) return false;
    let body = null;
    for (const sp of children(tree).filter(n => is(n, 'p', 'sp'))) {
        const placeholder = child(child(child(sp, 'p', 'nvSpPr'), 'p', 'nvPr'), 'p', 'ph');
        if (placeholder && (placeholder.getAttribute('type') ?? 'body') === 'body') { body = sp; break; }
    }
    if (!body) {
        // A notes part without a body placeholder is legal but cannot show notes. Add one rather
        // than silently dropping the edit; every other node in the part stays untouched.
        let maxId = 0;
        for (const node of all(tree, 'p', 'cNvPr')) maxId = Math.max(maxId, Number(node.getAttribute('id')) || 0);
        body = element(doc, 'p', 'sp');
        const nonVisual = append(body, 'p', 'nvSpPr');
        append(nonVisual, 'p', 'cNvPr', { id: maxId + 1, name: `Notes Placeholder ${maxId + 1}` });
        append(append(nonVisual, 'p', 'cNvSpPr'), 'a', 'spLocks', { noGrp: 1 });
        append(append(nonVisual, 'p', 'nvPr'), 'p', 'ph', { type: 'body', idx: 1 });
        append(body, 'p', 'spPr');
        tree.appendChild(body);
    }
    let textBody = child(body, 'p', 'txBody');
    if (!textBody) {
        textBody = append(body, 'p', 'txBody');
        append(textBody, 'a', 'bodyPr');
        append(textBody, 'a', 'lstStyle');
    }
    for (const paragraph of children(textBody).filter(n => is(n, 'a', 'p'))) textBody.removeChild(paragraph);
    for (const line of String(text).split(/\r\n|\r|\n/)) {
        const paragraph = element(doc, 'a', 'p');
        const run = append(paragraph, 'a', 'r');
        append(run, 'a', 'rPr');
        const t = append(run, 'a', 't');
        t.textContent = line;
        if (/^\s|\s$/.test(line)) t.setAttributeNS(XML_SPACE, 'xml:space', 'preserve');
        textBody.appendChild(paragraph);
    }
    return true;
}
/**
 * Slide name, solid background and notes for PPTX-backed slides.
 * Existing notes parts are patched in place (only the body text changes); a part is created only
 * when the slide has none, together with a notes master when the presentation has none.
 */
async function applyPptxSlideProperties({xml,getDoc,zip,baseline,slideProperties,mark,main,rels,relPart,types,presentation,relative,newSlideNotes=new Map()}) {
    // Newly created slides carry their properties at creation except notes, which need rels/parts.
    const pending=[...slideProperties, ...[...newSlideNotes].map(([id,entry])=>({slide:{id,source:{part:entry.part}},properties:{notes:entry.notes}}))];
    for (const {slide, properties} of pending) {
        const part = slide.source?.part;
        if (!part) continue; // new authored slides carry their properties at creation
        const doc = await getDoc(part);
        const cSld = child(doc.documentElement, 'p', 'cSld');
        if (!cSld) continue;
        if (Object.hasOwn(properties, 'name')) {
            if (properties.name === null) cSld.removeAttribute('name');
            else cSld.setAttribute('name', properties.name);
            mark(part);
        }
        if (Object.hasOwn(properties, 'background')) {
            const existing = child(cSld, 'p', 'bg');
            if (existing) cSld.removeChild(existing);
            if (properties.background !== null) {
                const background = element(doc, 'p', 'bg');
                const backgroundProperties = append(background, 'p', 'bgPr');
                append(append(backgroundProperties, 'a', 'solidFill'), 'a', 'srgbClr', { val: properties.background.color.slice(1).toUpperCase() });
                append(backgroundProperties, 'a', 'effectLst');
                cSld.insertBefore(background, cSld.firstChild);
            }
            mark(part);
        }
        if (!Object.hasOwn(properties, 'notes')) continue;
        const relation = baseline.relationships.find(r => r.ownerPart === part && r.type === REL_NOTES);
        const relsPath = part.replace(/(^|\/)([^/]+)$/, '$1_rels/$2.rels');
        if (properties.notes === null) {
            // Keep the part and its relationship; clear only the body text so header/footer/other
            // notes metadata survives.
            if (relation) {
                const notes = await getDoc(relation.target);
                if (patchNotesBody(notes, '')) mark(relation.target);
            }
            continue;
        }
        if (relation) {
            const notes = await getDoc(relation.target);
            if (!patchNotesBody(notes, properties.notes)) throw new Error('Unsupported notes structure');
            mark(relation.target);
            continue;
        }
        let counter = 1, notesPart;
        do { notesPart = `ppt/notesSlides/notesSlide${counter++}.xml`; } while (zip.file(notesPart));
        const notesDoc = xml.parse(`<p:notes xmlns:p="${NS.p}" xmlns:a="${NS.a}" xmlns:r="${NS.r}"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Notes Placeholder"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/></p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>`);
        patchNotesBody(notesDoc, properties.notes);
        zip.file(notesPart, xml.serialize(notesDoc));
        mark(notesPart);
        append(types.documentElement, 'ct', 'Override', { PartName: '/' + notesPart, ContentType: NOTES_CONTENT_TYPE });
        mark('[Content_Types].xml');
        // Slide -> notes back-reference.
        const slideRelsPath = part.replace(/(^|\/)([^/]+)$/, '$1_rels/$2.rels');
        const hasSlideRels = Boolean(zip.file(slideRelsPath));
        const slideRels = hasSlideRels ? await getDoc(slideRelsPath) : xml.parse(`<Relationships xmlns="${NS.rel}"/>`);
        let slideRid = 1;
        while (children(slideRels.documentElement).some(n => n.getAttribute('Id') === `rId${slideRid}`)) slideRid++;
        append(slideRels.documentElement, 'rel', 'Relationship', { Id: `rId${slideRid}`, Type: REL_NOTES, Target: relative(part, notesPart) });
        // New relationship documents are not in getDoc's serialization cache.
        if (!hasSlideRels) zip.file(slideRelsPath, xml.serialize(slideRels));
        mark(slideRelsPath);
        // Notes master: reuse the presentation's, else create one alongside the existing theme.
        let masterRel = children(rels.documentElement).find(n => n.getAttribute('Type') === REL_NOTES_MASTER);
        if (!masterRel) {
            const themeRel = children(rels.documentElement).find(n => n.getAttribute('Type') === REL + 'theme');
            let masterCounter = 1, masterPath;
            do { masterPath = `ppt/notesMasters/notesMaster${masterCounter++}.xml`; } while (zip.file(masterPath));
            const masterDoc = xml.parse(`<p:notesMaster xmlns:p="${NS.p}" xmlns:a="${NS.a}" xmlns:r="${NS.r}"><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:notesStyle><a:lvl1pPr><a:defRPr sz="1200"/></a:lvl1pPr></p:notesStyle></p:notesMaster>`);
            zip.file(masterPath, xml.serialize(masterDoc));
            mark(masterPath);
            append(types.documentElement, 'ct', 'Override', { PartName: '/' + masterPath, ContentType: NOTES_MASTER_CONTENT_TYPE });
            const masterRelsPath = masterPath.replace(/(^|\/)([^/]+)$/, '$1_rels/$2.rels');
            const masterRels = xml.parse(`<Relationships xmlns="${NS.rel}"/>`);
            if (themeRel) append(masterRels.documentElement, 'rel', 'Relationship', { Id: 'rId1', Type: REL + 'theme', Target: relative(masterPath, resolvePptxTarget(main, themeRel.getAttribute('Target'))) });
            zip.file(masterRelsPath, xml.serialize(masterRels));
            mark(masterRelsPath);
            let masterRelId = 1;
            while (children(rels.documentElement).some(n => n.getAttribute('Id') === `rIdNotesMaster${masterRelId}`)) masterRelId++;
            const id = `rIdNotesMaster${masterRelId}`;
            append(rels.documentElement, 'rel', 'Relationship', { Id: id, Type: REL_NOTES_MASTER, Target: relative(main, masterPath) });
            mark(relPart);
            let masterList = child(presentation.documentElement, 'p', 'notesMasterIdLst');
            if (!masterList) {
                masterList = element(presentation, 'p', 'notesMasterIdLst');
                presentation.documentElement.insertBefore(masterList, child(presentation.documentElement, 'p', 'sldIdLst') ?? null);
            }
            append(masterList, 'p', 'notesMasterId', { 'r:id': id });
            mark(main);
            masterRel = children(rels.documentElement).find(n => n.getAttribute('Type') === REL_NOTES_MASTER);
        }
        const masterPath = resolvePptxTarget(main, masterRel.getAttribute('Target'));
        const notesRelsPath = notesPart.replace(/(^|\/)([^/]+)$/, '$1_rels/$2.rels');
        const notesRels = xml.parse(`<Relationships xmlns="${NS.rel}"/>`);
        append(notesRels.documentElement, 'rel', 'Relationship', { Id: 'rId1', Type: REL + 'slide', Target: relative(notesPart, part) });
        append(notesRels.documentElement, 'rel', 'Relationship', { Id: 'rId2', Type: REL_NOTES_MASTER, Target: relative(notesPart, masterPath) });
        zip.file(notesRelsPath, xml.serialize(notesRels));
        mark(notesRelsPath);
    }
}

/** Slide name, solid background and notes for ODP-backed slides. */
function applyOdpSlideProperties({doc,styles,nodes,slide,properties,automaticStyles,nextStyleName,mark,baseline}) {
    const page = nodes.get(slide);
    if (!page) return;
    if (Object.hasOwn(properties, 'name')) {
        if (properties.name === null) page.removeAttributeNS(NS.draw, 'name');
        else page.setAttributeNS(NS.draw, 'draw:name', properties.name);
    }
    if (Object.hasOwn(properties, 'background')) {
        if (properties.background === null) {
            // Clearing must not drop unrelated page-style semantics (transitions, header/footer flags,
            // visibility...). Override only the fill by inheriting the current style and setting
            // draw:fill="none"; when there is no current style there is nothing to preserve.
            const current = attr(page, 'draw', 'style-name');
            if (current) {
                const style = nextStyleName('StagecraftPage');
                const node = append(automaticStyles(), 'style', 'style', {
                    'style:family': 'drawing-page', 'style:name': style, 'style:parent-style-name': current
                });
                append(node, 'style', 'drawing-page-properties', { 'draw:fill': 'none' });
                page.setAttributeNS(NS.draw, 'draw:style-name', style);
            }
        } else {
            // Attribute set mirrored from a Microsoft PowerPoint-saved reference (native-background.odp):
            // the page's own drawing-page style carries the fill while the master page stays white, so
            // per-slide backgrounds never mutate a shared master.
            const parent = attr(page, 'draw', 'style-name');
            const style = nextStyleName('StagecraftPage');
            const node = append(automaticStyles(), 'style', 'style', {
                'style:family': 'drawing-page', 'style:name': style, ...(parent ? { 'style:parent-style-name': parent } : {})
            });
            append(node, 'style', 'drawing-page-properties', {
                // Background-specific attributes only: visibility and the display-* flags stay inherited
                // from the parent style so hidden slides and header/footer settings survive.
                'draw:fill': 'solid',
                'draw:fill-color': properties.background.color.toLowerCase(),
                'draw:opacity': '100%',
                'draw:background-size': 'border',
                'presentation:background-objects-visible': 'false',
                'presentation:background-visible': 'false'
            });
            page.setAttributeNS(NS.draw, 'draw:style-name', style);
        }
    }
    if (Object.hasOwn(properties, 'notes')) {
        const findBody = notes => [notes, ...Array.from(notes.getElementsByTagNameNS('*', '*'))].find(n => is(n, 'draw', 'frame') && attr(n, 'presentation', 'class') === 'notes');
        if (properties.notes === null) {
            // Remove body text only: page thumbnails, header/footer frames and unknown metadata stay.
            const notes = child(page, 'presentation', 'notes');
            if (!notes) return;
            const body = findBody(notes);
            if (!body) return; // unknown notes structure: leave it untouched rather than delete metadata
            const textBox = child(body, 'draw', 'text-box');
            if (!textBox) return;
            for (const paragraph of children(textBox).filter(n => is(n, 'text', 'p'))) textBox.removeChild(paragraph);
        } else {
            let notes = child(page, 'presentation', 'notes');
            if (!notes) {
                const style = nextStyleName('StagecraftNotes');
                append(automaticStyles(), 'style', 'style', { 'style:name': style, 'style:family': 'presentation' });
                notes = element(doc, 'presentation', 'notes', { 'draw:style-name': style });
                page.appendChild(notes);
            }
            let body = findBody(notes);
            if (!body) {
                body = element(doc, 'draw', 'frame', { 'presentation:class': 'notes' });
                notes.appendChild(body);
            }
            let textBox = child(body, 'draw', 'text-box');
            if (!textBox) textBox = append(body, 'draw', 'text-box');
            for (const paragraph of children(textBox).filter(n => is(n, 'text', 'p'))) textBox.removeChild(paragraph);
            for (const line of String(properties.notes).split(/\r\n|\r|\n/)) {
                const paragraph = append(textBox, 'text', 'p');
                // Tokenised write (patchOdp) so repeated spaces, tabs and line breaks survive ODF's
                // whitespace collapsing rules; a bare text node would be normalised by any reader.
                const placeholder = doc.createTextNode('');
                paragraph.appendChild(placeholder);
                patchOdp(placeholder, line);
            }
        }
    }
    mark('content.xml');
}
