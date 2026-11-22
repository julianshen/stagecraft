import { describe, it, expect, vi } from 'vitest';
import JSZip from 'jszip';
import { writePptx } from '../../pptx/src/index.js';
import { writeOdp } from '../../odp/src/index.js';
import { createEditor } from '../../core/src/editor/index.js';
import { documentPlugin, validateDocument } from '../../core/src/document/index.js';
import { openPresentation } from './index.js';

const deck = { title: 'Source', sections: [{ id: 's', name: 'One', slides: ['one'] }], slides: [
  { id: 'one', title: 'One', layout: 'blank', elements: [
    { id: 'text', type: 'text', x: 100, y: 200, w: 500, h: 100, content: 'EditableA', color: '#123456', fontSize: 32, bold: true },
    { id: 'text2', type: 'text', x: 100, y: 400, w: 500, h: 100, content: 'EditableB', color: '#654321', fontSize: 24, italic: true },
  ] },
] };
export async function fixture(format, change) {
  const bytes = await (format === 'pptx' ? writePptx(deck) : writeOdp(deck));
  const zip = await JSZip.loadAsync(bytes);
  zip.file('unknown/data.bin', new Uint8Array([1, 2, 3, 4]));
  zip.file('unknown/custom.xml', '<custom xmlns="urn:plugin"><feature keep="true"/></custom>');
  await change?.(zip);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
export function runs(document) {
  const result = [];
  function visit(objects) {
    for (const object of objects ?? []) {
      for (const paragraph of object.text?.paragraphs ?? []) result.push(...paragraph.runs);
      visit(object.children);
    }
  }
  for (const slide of document.slides) visit(slide.objects);
  return result;
}
function edited(document, from = 'EditableA', to = 'Revised') {
  const next = structuredClone(document);
  const run = runs(next).find(run => run.text === from);
  expect(run, `expected imported run ${from}`).toBeTruthy();
  run.text = to;
  return next;
}
async function assertUntouched(beforeBytes, afterBytes, dirtyParts) {
  const before = await JSZip.loadAsync(beforeBytes), after = await JSZip.loadAsync(afterBytes);
  expect(Object.keys(after.files).sort()).toEqual(Object.keys(before.files).sort());
  for (const [path, entry] of Object.entries(before.files)) {
    if (!entry.dir && !dirtyParts.includes(path)) expect(await after.file(path).async('uint8array'), path).toEqual(await entry.async('uint8array'));
  }
}

describe.each(['pptx', 'odp'])('%s source preservation', format => {
  it('derives stable IDs and retains explicit inheritance references', async () => {
    const bytes = await fixture(format);
    const a = await openPresentation(bytes, { format });
    const b = await openPresentation(bytes, { format });
    expect(a.document).toEqual(b.document);
    expect(a.document.layouts.length).toBeGreaterThan(0);
    expect(a.document.masters.length).toBeGreaterThan(0);
    const layout = a.document.layouts.find(layout => layout.id === a.document.slides[0].layoutId);
    expect(layout).toBeTruthy();
    expect(a.document.masters.some(master => master.id === layout.masterId)).toBe(true);
    a.document.metadata.unsupported = true;
    await expect(a.export(a.document)).rejects.toThrow();
  });
  it('returns exact independent original bytes without embedding package handles in the model', async () => {
    const bytes = await fixture(format);
    const session = await openPresentation(bytes, { format });
    expect(validateDocument(session.document)).toBe(true);
    expect(JSON.stringify(session.document)).not.toContain('Uint8Array');
    const output = await session.export(session.document);
    expect(output.bytes).toEqual(bytes);
    expect(output.bytes).not.toBe(bytes);
    expect(output.dirtyParts).toEqual([]);
    output.bytes.fill(0); bytes.fill(0);
    expect((await session.export(session.document)).bytes[0]).toBe(0x50);
  });
  it('exports unchanged private bytes without rereading entries and still enforces tighter limits', async () => {
    const bytes = await fixture(format);
    const session = await openPresentation(bytes, { format });
    const probe = new JSZip().file('probe', 'x').file('probe');
    const reads = vi.spyOn(Object.getPrototypeOf(probe), 'async');
    try {
      expect((await session.export(session.document)).bytes).toEqual(bytes);
      for (const limits of [{ maxBytes: bytes.length - 1 }, { maxEntries: 0 }, { maxEntryBytes: 0 }, { maxExpandedBytes: 0 }]) {
        await expect(session.export(session.document, limits)).rejects.toThrow();
      }
      for (const key of ['maxEntries', 'maxEntryBytes', 'maxExpandedBytes']) {
        await expect(session.export(session.document, { [key]: -1 })).rejects.toThrow(/non-negative/);
      }
      expect(reads).not.toHaveBeenCalled();
    } finally { reads.mockRestore(); session.dispose(); }
  });
  it('patches text only and preserves all untouched entries including unknown features', async () => {
    const bytes = await fixture(format);
    const session = await openPresentation(bytes, { format });
    const next = edited(session.document);
    const result = await session.export(next);
    expect(result.dirtyParts).toEqual([format === 'pptx' ? 'ppt/slides/slide1.xml' : 'content.xml']);
    await assertUntouched(bytes, result.bytes, result.dirtyParts);
    const reopened = await openPresentation(result.bytes, { format });
    expect(runs(reopened.document).some(run => run.text === 'Revised')).toBe(true);
    const originalStyle = runs(session.document).find(run => run.text === 'EditableA').style;
    expect(runs(reopened.document).find(run => run.text === 'Revised').style).toEqual(originalStyle);
    expect(runs(session.document).some(run => run.text === 'EditableA')).toBe(true);
  });
  it('works through engine commands and undo restores exact original bytes', async () => {
    const bytes = await fixture(format);
    const session = await openPresentation(bytes, { format });
    const editor = createEditor({ document: session.document, validateDocument, plugins: [documentPlugin] });
    const runId = runs(session.document).find(run => run.text === 'EditableA').id;
    editor.dispatch('document.setRunText', { runId, text: 'Command edit' });
    expect((await session.export(editor.getSnapshot().document)).dirtyParts).toHaveLength(1);
    editor.undo();
    expect((await session.export(editor.getSnapshot().document)).bytes).toEqual(bytes);
  });
  it('rejects unsupported mutations, source tampering and projected documents', async () => {
    const session = await openPresentation(await fixture(format), { format });
    for (const mutate of [d => { d.metadata.extra = 'new'; }, d => { d.slides = []; },
      d => { runs(d)[0].source.path = [999]; }, d => { runs(d)[0].style = { changed: true }; }]) {
      const next = structuredClone(session.document); mutate(next);
      await expect(session.export(next)).rejects.toThrow();
    }
    await expect(session.export(edited(session.document, 'EditableA', '\u0000'))).rejects.toThrow();
  });
  it('snapshots export input and supports independent concurrent exports', async () => {
    const session = await openPresentation(await fixture(format), { format });
    const first = edited(session.document, 'EditableA', 'Captured');
    const pending = session.export(first);
    first.metadata.malicious = true;
    runs(first).find(run => run.text === 'Captured').text = 'Too late';
    const second = session.export(edited(session.document, 'EditableA', 'Independent'));
    const [a, b] = await Promise.all([pending, second]);
    expect(runs((await openPresentation(a.bytes, { format })).document).some(run => run.text === 'Captured')).toBe(true);
    expect(runs((await openPresentation(b.bytes, { format })).document).some(run => run.text === 'Independent')).toBe(true);
  });
  it('rejects signed edits while preserving signed no-op packages exactly', async () => {
    const bytes = await fixture(format, zip => zip.file(format === 'pptx' ? '_xmlsignatures/sig1.xml' : 'META-INF/documentsignatures.xml', '<signatures/>'));
    const session = await openPresentation(bytes, { format });
    expect((await session.export(session.document)).bytes).toEqual(bytes);
    await expect(session.export(edited(session.document))).rejects.toThrow(/sign/i);
  });
  it('honors limits, cancellation and disposal, including in-flight export', async () => {
    const bytes = await fixture(format);
    await expect(openPresentation(bytes, { format, maxBytes: 1 })).rejects.toThrow();
    await expect(openPresentation(bytes, { format, signal: AbortSignal.abort() })).rejects.toThrow();
    const session = await openPresentation(bytes, { format });
    await expect(session.export(edited(session.document), { signal: AbortSignal.abort() })).rejects.toThrow();
    const pending = session.export(edited(session.document));
    session.dispose();
    await expect(pending).rejects.toThrow(/dispos/i);
    await expect(session.export(session.document)).rejects.toThrow(/dispos/i);
  });
});

it('retains PPTX external links without fetching and rejects broken internal relationships', async () => {
  const bytes = await fixture('pptx', async zip => {
    const path = 'ppt/slides/_rels/slide1.xml.rels';
    const rels = await zip.file(path).async('string');
    zip.file(path, rels.replace('</Relationships>', '<Relationship Id="link" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.invalid/path" TargetMode="External"/></Relationships>'));
  });
  const session = await openPresentation(bytes, { format: 'pptx' });
  expect(session.document.relationships.some(r => r.mode === 'external' && r.target === 'https://example.invalid/path')).toBe(true);
  await assertUntouched(bytes, (await session.export(edited(session.document))).bytes, ['ppt/slides/slide1.xml']);
  const broken = await fixture('pptx', async zip => {
    const path = 'ppt/_rels/presentation.xml.rels';
    zip.file(path, (await zip.file(path).async('string')).replace('slides/slide1.xml', '../../../../escape.xml'));
  });
  await expect(openPresentation(broken, { format: 'pptx' })).rejects.toThrow();
});

it('preserves ODP neighboring rich runs and encodes edited whitespace explicitly', async () => {
  const bytes = await fixture('odp', async zip => {
    zip.file('content.xml', (await zip.file('content.xml').async('string')).replace('EditableA', 'Alpha<text:span>Beta</text:span><text:s text:c="2"/><text:tab/><text:line-break/>'));
  });
  const session = await openPresentation(bytes, { format: 'odp' });
  const next = structuredClone(session.document);
  const alpha = runs(next).find(r => r.text === 'Alpha'), beta = runs(next).find(r => r.text === 'Beta');
  expect(alpha).toBeTruthy(); expect(beta).toBeTruthy();
  alpha.text = '  One\tTwo\n'; beta.text = 'Changed';
  const result = await session.export(next);
  const zip = await JSZip.loadAsync(result.bytes);
  const xml = await zip.file('content.xml').async('string');
  expect(xml).toContain('text:s'); expect(xml).toContain('text:tab'); expect(xml).toContain('text:line-break');
  const reopened = await openPresentation(result.bytes, { format: 'odp' });
  const text = runs(reopened.document).map(r => r.text).join('');
  expect(text).toContain('  One\tTwo\nChanged  \t\n');
});

it('preserves PPTX whitespace and XML metacharacters and supports an empty run', async () => {
  const session=await openPresentation(await fixture('pptx'),{format:'pptx'});
  const next=edited(session.document,'EditableA','  <New & "text">  ');
  const out=await session.export(next);
  const zip=await JSZip.loadAsync(out.bytes);
  expect(await zip.file('ppt/slides/slide1.xml').async('string')).toContain('xml:space="preserve"');
  expect(runs((await openPresentation(out.bytes,{format:'pptx'})).document).some(r=>r.text==='  <New & "text">  ')).toBe(true);
  const empty=await session.export(edited(session.document,'EditableA',''));
  expect(runs((await openPresentation(empty.bytes,{format:'pptx'})).document).some(r=>r.text==='' && r.editable)).toBe(true);
});
it('keeps PPTX field results read-only even if the caller forges editable flags',async()=>{
  const bytes=await fixture('pptx',async zip=>{
    const p='ppt/slides/slide1.xml';zip.file(p,(await zip.file(p).async('string')).replace(/<a:r>([\s\S]*?<a:t>EditableA<\/a:t>)<\/a:r>/,'<a:fld id="field" type="slidenum">$1</a:fld>'));
  });
  const s=await openPresentation(bytes,{format:'pptx'});
  const next=structuredClone(s.document),r=runs(next).find(r=>r.text==='EditableA');
  expect(r.editable).toBe(false);r.text='forged';r.editable=true;
  await expect(s.export(next)).rejects.toThrow();
});
it('rejects malformed XML, wrong namespace identity and missing internal targets',async()=>{
  for(const change of [
    async zip=>zip.file('ppt/presentation.xml','<broken>'),
    async zip=>zip.file('ppt/presentation.xml',(await zip.file('ppt/presentation.xml').async('string')).replace('http://schemas.openxmlformats.org/presentationml/2006/main','urn:wrong')),
    async zip=>zip.remove('ppt/slides/slide1.xml'),
  ])await expect(openPresentation(await fixture('pptx',change),{format:'pptx'})).rejects.toThrow();
});
it('rejects ODP space expansion and preserves explicit whitespace with XML characters',async()=>{
  const invalid=await fixture('odp',async zip=>zip.file('content.xml',(await zip.file('content.xml').async('string')).replace('EditableA','<text:s text:c="999999999999"/>')));
  await expect(openPresentation(invalid,{format:'odp'})).rejects.toThrow(/expansion/);
  const s=await openPresentation(await fixture('odp'),{format:'odp'});
  const out=await s.export(edited(s.document,'EditableA','<A & B>  \t\n'));
  const reopened=await openPresentation(out.bytes,{format:'odp'});
  expect(runs(reopened.document).map(r=>r.text).join('')).toContain('<A & B>  \t\n');
  const bytes=out.bytes, view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  expect(view.getUint16(8,true)).toBe(0);
  expect(new TextDecoder().decode(bytes.subarray(30,30+view.getUint16(26,true)))).toBe('mimetype');
  s.dispose();s.dispose();
});
it('does not authorize run-shaped metadata using a forged mapped id',async()=>{
  const bytes=await fixture('pptx');
  const initial=await openPresentation(bytes,{format:'pptx'}),runId=runs(initial.document).find(r=>r.text==='EditableA').id;
  const zip=await JSZip.loadAsync(bytes),part='ppt/slides/slide1.xml';
  zip.file(part,(await zip.file(part).async('string')).replace('<p:sp>','<p:sp id="'+runId+'" text="metadata">'));
  const s=await openPresentation(await zip.generateAsync({type:'uint8array'}),{format:'pptx'});
  const next=structuredClone(s.document),object=next.slides[0].objects.find(o=>o.extensions?.attributes.text==='metadata');
  expect(object).toBeTruthy();object.extensions.attributes.text='forged';
  await expect(s.export(next)).rejects.toThrow();
});

it('edits ODP explicit whitespace runs and retains source style inheritance',async()=>{
  const bytes=await fixture('odp',async zip=>zip.file('content.xml',(await zip.file('content.xml').async('string')).replace('EditableA','A<text:s text:c="2"/><text:tab/><text:line-break/>')));
  const s=await openPresentation(bytes,{format:'odp'}),next=structuredClone(s.document);
  for(const r of runs(next)){if(r.text==='  ')r.text='space';if(r.text==='\t')r.text='tab';if(r.text==='\n')r.text='break';}
  const out=await s.export(next),reopened=await openPresentation(out.bytes,{format:'odp'});
  expect(runs(reopened.document).map(r=>r.text).join('')).toContain('Aspacetabbreak');
  expect(s.document.themes.some(t=>t.extensions.styles.some(s=>s.family==='paragraph'))).toBe(true);
  expect(s.document.masters[0].themeId).toBe('styles:styles.xml');
});
it('rejects ODP mixed slide sizes instead of projecting only the first size',async()=>{
  const bytes=await fixture('odp',async zip=>{
    zip.file('styles.xml',(await zip.file('styles.xml').async('string')).replace('</office:automatic-styles>','<style:page-layout style:name="Other"><style:page-layout-properties fo:page-width="10in" fo:page-height="10in"/></style:page-layout></office:automatic-styles>').replace('</office:master-styles>','<style:master-page style:name="Other" style:page-layout-name="Other"/></office:master-styles>'));
    zip.file('content.xml',(await zip.file('content.xml').async('string')).replace('</office:presentation>','<draw:page draw:name="Other" draw:master-page-name="Other"/></office:presentation>'));
  });
  await expect(openPresentation(bytes,{format:'odp'})).rejects.toThrow(/Mixed/);
});
describe.each(['pptx','odp'])('%s structural preservation',format=>{
  it('retains opaque extension XML inside an edited part',async()=>{
    const part=format==='pptx'?'ppt/slides/slide1.xml':'content.xml';
    const bytes=await fixture(format,async zip=>{
      const close=format==='pptx'?'</p:sld>':'</office:document-content>';
      zip.file(part,(await zip.file(part).async('string')).replace(close,'<plugin:unknown xmlns:plugin="urn:plugin" keep="yes"><plugin:feature>Opaque payload</plugin:feature></plugin:unknown>'+close));
    });
    const s=await openPresentation(bytes,{format}),out=await s.export(edited(s.document));
    const zip=await JSZip.loadAsync(out.bytes),doc=new DOMParser().parseFromString(await zip.file(part).async('string'),'application/xml');
    const unknown=doc.getElementsByTagNameNS('urn:plugin','unknown')[0];expect(unknown.getAttribute('keep')).toBe('yes');expect(unknown.textContent).toBe('Opaque payload');
  });
  it('accepts equivalent object key ordering without rewriting source bytes',async()=>{
    const bytes=await fixture(format),s=await openPresentation(bytes,{format});
    const reorder=v=>Array.isArray(v)?v.map(reorder):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).reverse().map(([k,v])=>[k,reorder(v)])):v;
    expect((await s.export(reorder(s.document))).bytes).toEqual(bytes);
  });
});
it('refuses changed signed OPC packages at nonstandard signature locations',async()=>{
  const bytes=await fixture('pptx',async zip=>{
    zip.file('_rels/.rels',(await zip.file('_rels/.rels').async('string')).replace('</Relationships>','<Relationship Id="signatureOrigin" Type="http://schemas.openxmlformats.org/package/2006/relationships/digital-signature/origin" Target="signing/origin.sigs"/></Relationships>'));
    zip.file('signing/origin.sigs','');
    zip.file('signing/_rels/origin.sigs.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="signature" Type="http://schemas.openxmlformats.org/package/2006/relationships/digital-signature/signature" Target="signature.xml"/></Relationships>');
    zip.file('signing/signature.xml','<Signature xmlns="http://www.w3.org/2000/09/xmldsig#"/>');
  });
  const s=await openPresentation(bytes,{format:'pptx'});
  expect((await s.export(s.document)).bytes).toEqual(bytes);
  await expect(s.export(edited(s.document))).rejects.toThrow(/signed/);
});
it('retains ODP embedded and external media references without fetching',async()=>{
  const bytes=await fixture('odp',async zip=>{
    zip.file('Pictures/image one.png',new Uint8Array([1,2,3]));
    zip.file('Object 1/content.xml','<embedded/>');
    zip.file('content.xml',(await zip.file('content.xml').async('string')).replace('</draw:page>',[
      '<draw:frame><draw:image xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="./Pictures/image%20one.png"/></draw:frame>',
      '<draw:frame><draw:object xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="./Object%201/"/></draw:frame>',
      '<draw:frame><draw:image xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="https://example.invalid/image.png"/></draw:frame>',
      '</draw:page>'
    ].join('')).replace('EditableA','EditableA<text:a xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="relative.html">Link</text:a>'));
  });
  const s=await openPresentation(bytes,{format:'odp'});
  expect(s.document.relationships.some(r=>r.target==='Pictures/image one.png' && r.mode==='internal')).toBe(true);
  expect(s.document.relationships.some(r=>r.target==='Object 1' && r.mode==='internal')).toBe(true);
  expect(s.document.relationships.some(r=>r.target==='https://example.invalid/image.png' && r.mode==='external')).toBe(true);
  expect(s.document.relationships.some(r=>r.target==='relative.html' && r.mode==='external')).toBe(true);
  expect(s.document.slides[0].objects.filter(o=>o.assetId)).toHaveLength(3);
  await assertUntouched(bytes,(await s.export(edited(s.document))).bytes,['content.xml']);
});
it('rejects missing and unsafe ODP embedded references',async()=>{
  for(const href of ['Pictures/missing.png','../../escape.png','%2e%2e/escape.png']){
    const bytes=await fixture('odp',async zip=>zip.file('content.xml',(await zip.file('content.xml').async('string')).replace('</draw:page>','<draw:frame><draw:image xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="'+href+'"/></draw:frame></draw:page>')));
    await expect(openPresentation(bytes,{format:'odp'})).rejects.toThrow();
  }
});
it('links PPTX picture objects to native image relationships and assets',async()=>{
  const bytes=await fixture('pptx',async zip=>{
    zip.file('ppt/media/test.png',new Uint8Array([1,2,3]));
    const p='ppt/slides/_rels/slide1.xml.rels';
    zip.file(p,(await zip.file(p).async('string')).replace('</Relationships>','<Relationship Id="imageTest" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/test.png"/></Relationships>'));
    const slide='ppt/slides/slide1.xml';zip.file(slide,(await zip.file(slide).async('string')).replace('</p:spTree>','<p:pic><p:blipFill><a:blip r:embed="imageTest"/></p:blipFill></p:pic></p:spTree>'));
  });
  const s=await openPresentation(bytes,{format:'pptx'}),picture=s.document.slides[0].objects.find(o=>o.assetId);
  const asset=s.document.assets.find(a=>a.id===picture.assetId),rel=s.document.relationships.find(r=>r.id===asset.relationshipId);
  expect(rel.target).toBe('ppt/media/test.png');
});
it('rejects partial models even when omitted fields equal document defaults',async()=>{
  const s=await openPresentation(await fixture('pptx'),{format:'pptx'}),next=structuredClone(s.document);
  delete next.metadata;
  await expect(s.export(next)).rejects.toThrow();
});
it('exposes signed-source read-only capabilities and frozen edit declarations',async()=>{
  const bytes=await fixture('pptx',zip=>zip.file('_xmlsignatures/sig.xml','<signature/>'));
  const s=await openPresentation(bytes,{format:'pptx'});
  expect(s.capabilities.readOnly).toBe(true);expect(s.capabilities.edits).toEqual([]);
  expect(Object.isFrozen(s.capabilities)).toBe(true);expect(Object.isFrozen(s.capabilities.edits)).toBe(true);
  expect(s.diagnostics.some(d=>d.code==='PARTIAL_CANONICAL_VIEW')).toBe(true);
});
it('honors cancellation occurring during the final signature scan',async()=>{
  const abort=new AbortController();let typeCount=0;
  const xml={parse(text){if(text.includes('<Types') && ++typeCount===2)abort.abort();return new DOMParser().parseFromString(text,'application/xml');},serialize(doc){return new XMLSerializer().serializeToString(doc);}};
  await expect(openPresentation(await fixture('pptx'),{format:'pptx',xml,signal:abort.signal})).rejects.toThrow();
  expect(typeCount).toBe(2);
});

it.each([false, true])('patches PPTX direct formatting and text (missing rPr: %s)', async missing => {
  const bytes = await fixture('pptx', async zip => {
    if (missing) zip.file('ppt/slides/slide1.xml', (await zip.file('ppt/slides/slide1.xml').async('string')).replace(/<a:rPr\b[^>]*>[\s\S]*?<\/a:rPr>/g, ''));
  });
  const session = await openPresentation(bytes, { format: 'pptx' });
  expect(session.capabilities.edits).toContain('existing-run-format');
  const editor = createEditor({ document: session.document, validateDocument, plugins: [documentPlugin] });
  const first = runs(session.document)[0], second = runs(session.document)[1];
  editor.transact([
    { type: 'document.setRunFormat', payload: { runId: first.id, format: { bold: false, italic: true, fontSize: 18.25 } } },
    { type: 'document.setRunText', payload: { runId: first.id, text: 'Formatted' } },
    { type: 'document.setRunFormat', payload: { runId: second.id, format: { bold: true, fontSize: null } } },
  ]);
  const output = await session.export(editor.getSnapshot().document);
  await assertUntouched(bytes, output.bytes, output.dirtyParts);
  const reopened = await openPresentation(output.bytes, { format: 'pptx' });
  expect(runs(reopened.document)[0]).toMatchObject({ text: 'Formatted', style: { b: '0', i: '1', sz: '1825' } });
  expect(runs(reopened.document)[1].style.sz).toBeUndefined();
  if (!missing) expect(runs(reopened.document)[0].extensions).toEqual(first.extensions);
  const before = await JSZip.loadAsync(bytes), after = await JSZip.loadAsync(output.bytes);
  const parse = value => new DOMParser().parseFromString(value, 'application/xml');
  const ns = 'http://schemas.openxmlformats.org/drawingml/2006/main';
  const original = parse(await before.file('ppt/slides/slide1.xml').async('string'));
  const updated = parse(await after.file('ppt/slides/slide1.xml').async('string'));
  const properties = updated.getElementsByTagNameNS(ns, 'rPr')[0];
  if (!missing) expect(properties.innerHTML).toBe(original.getElementsByTagNameNS(ns, 'rPr')[0].innerHTML);
  expect(properties.nextElementSibling.localName).toBe('t');
  editor.undo();
  expect((await session.export(editor.getSnapshot().document)).bytes).toEqual(bytes);
  editor.redo(); expect((await session.export(editor.getSnapshot().document)).dirtyParts).toEqual(output.dirtyParts);
  session.dispose(); reopened.dispose(); editor.dispose();
});

it('rejects unsupported formatting even without the command API', async () => {
  const session = await openPresentation(await fixture('pptx'), { format: 'pptx' });
  for (const style of [{ b: true }, { b: 'yes' }, { sz: '99' }, { sz: '400001' }, { sz: '2400.5' }, { sz: 'NaN' }, { color: 'invalid' }]) {
    const d = structuredClone(session.document); Object.assign(runs(d)[0].style, style);
    await expect(session.export(d)).rejects.toThrow();
  }
  const signed = await openPresentation(await fixture('pptx', zip => zip.file('_xmlsignatures/test.xml', '<signature/>')), { format: 'pptx' });
  const d = structuredClone(signed.document); runs(d)[0].style.b = '0';
  await expect(signed.export(d)).rejects.toThrow('signed');
  const odp = await openPresentation(await fixture('odp'), { format: 'odp' });
  expect(odp.capabilities.edits).toContain('existing-run-format');
  const od = structuredClone(odp.document); runs(od)[0].style.b = '1';
  await expect(odp.export(od)).rejects.toThrow();
  session.dispose(); signed.dispose(); odp.dispose();
});

it('formats one ODP run without modifying shared styles and restores the imported baseline', async () => {
  const bytes = await fixture('odp', async zip => {
    let text = await zip.file('content.xml').async('string');
    text = text.replace('</office:automatic-styles>', '<style:style style:name="Shared" style:family="text"><style:text-properties fo:font-weight="bold" fo:font-size="20pt"/></style:style></office:automatic-styles>');
    text = text.replace('EditableA', '<text:span text:style-name="Shared">EditableA</text:span>').replace('EditableB', '<text:span text:style-name="Shared">EditableB</text:span>');
    zip.file('content.xml', text);
  });
  const session = await openPresentation(bytes, { format: 'odp' });
  expect(session.capabilities.edits).toContain('existing-run-format');
  expect(runs(session.document)[0].extensions.odpAppearance).toMatchObject({ bold: true, fontSize: 20 });
  const editor = createEditor({ document: session.document, validateDocument, plugins: [documentPlugin] });
  const runId = runs(session.document)[0].id;
  editor.transact([
    { type: 'document.setRunFormat', payload: { runId, format: { bold: false, italic: true, fontSize: 18.25 } } },
    { type: 'document.setRunText', payload: { runId, text: 'Changed  text\tline\nend' } },
  ]);
  const output = await session.export(editor.getSnapshot().document);
  expect(output.dirtyParts).toEqual(['content.xml']);
  await assertUntouched(bytes, output.bytes, output.dirtyParts);
  const reopened = await openPresentation(output.bytes, { format: 'odp' });
  const rr = runs(reopened.document);
  expect(rr.filter(r => r.text !== 'EditableB').map(r => r.text).join('')).toBe('Changed  text\tline\nend');
  expect(rr[0].extensions.odpAppearance).toMatchObject({ bold: false, italic: true, fontSize: 18.25 });
  expect(rr.find(r => r.text === 'EditableB').extensions.odpAppearance).toMatchObject({ bold: true, fontSize: 20 });
  const before = await JSZip.loadAsync(bytes), after = await JSZip.loadAsync(output.bytes);
  const original = new DOMParser().parseFromString(await before.file('content.xml').async('string'), 'application/xml');
  const updated = new DOMParser().parseFromString(await after.file('content.xml').async('string'), 'application/xml');
  const ns = 'urn:oasis:names:tc:opendocument:xmlns:style:1.0';
  const find = doc => [...doc.getElementsByTagNameNS(ns, 'style')].find(n => n.getAttributeNS(ns, 'name') === 'Shared');
  expect(new XMLSerializer().serializeToString(find(updated))).toBe(new XMLSerializer().serializeToString(find(original)));
  editor.undo(); expect((await session.export(editor.getSnapshot().document)).bytes).toEqual(bytes);
  editor.dispatch('document.setRunFormat', { runId, format: { bold: false } });
  editor.dispatch('document.setRunFormat', { runId, format: { bold: null } });
  expect((await session.export(editor.getSnapshot().document)).bytes).toEqual(bytes);
  session.dispose(); reopened.dispose(); editor.dispose();
});

it.each(['content.xml', 'styles.xml'])('writes ODP formatting in %s with stable mapped targets and unique style names', async part => {
  const bytes = await fixture('odp', async zip => {
    const text = await zip.file('content.xml').async('string');
    if (part === 'styles.xml') {
      const frame = /<draw:frame\b[\s\S]*?<\/draw:frame>/.exec(text)[0];
      zip.file(part, (await zip.file(part).async('string')).replace('</style:master-page>', frame + '</style:master-page>').replace(/<style:master-page([^>]+)\/>/, `<style:master-page$1>${frame}</style:master-page>`));
    }
    let xml = await zip.file(part).async('string');
    xml = xml.replace('</office:automatic-styles>', '<style:style style:name="StagecraftRun1" style:family="text"><style:text-properties fo:font-weight="normal"/></style:style></office:automatic-styles>');
    // Namespace prefixes are arbitrary; the writer must use namespace identity.
    xml = xml.replace(/(<\/?)text:/g, '$1t:').replaceAll(' text:', ' t:').replaceAll('xmlns:text=', 'xmlns:t=');
    zip.file(part, xml);
  });
  const s = await openPresentation(bytes, { format: 'odp' });
  const owner = part === 'content.xml' ? s.document.slides[0] : s.document.masters[0];
  const run = owner.objects[0].text.paragraphs[0].runs[0];
  const e = createEditor({ document: s.document, plugins: [documentPlugin] });
  e.dispatch('document.setRunFormat', { runId: run.id, format: { bold: true } });
  const output = await s.export(e.getSnapshot().document);
  expect(output.dirtyParts).toEqual([part]); await assertUntouched(bytes, output.bytes, [part]);
  const zip = await JSZip.loadAsync(output.bytes), xml = await zip.file(part).async('string');
  expect(xml).toContain('StagecraftRun2');
  const reopened = await openPresentation(output.bytes, { format: 'odp' });
  const updated = (part === 'content.xml' ? reopened.document.slides[0] : reopened.document.masters[0]).objects[0].text.paragraphs[0].runs[0];
  expect(updated.extensions.odpAppearance.bold).toBe(true);
  expect((await reopened.export(reopened.document)).bytes).toEqual(output.bytes);
  s.dispose(); e.dispose(); reopened.dispose();
});
it('rejects malformed ODP overrides and signed formatting; keeps preview metadata immutable', async () => {
  const s = await openPresentation(await fixture('odp'), { format: 'odp' });
  for (const overrides of [null, [], { color: '#fff' }, { bold: 'true' }, { italic: null }, { fontSize: 0 }, { fontSize: 4001 }, { fontSize: 1.234 }]) {
    const d = structuredClone(s.document); runs(d)[0].style.overrides = overrides;
    await expect(s.export(d)).rejects.toThrow();
  }
  const d = structuredClone(s.document); runs(d)[0].extensions.odpAppearance.bold = false;
  await expect(s.export(d)).rejects.toThrow();
  const signed = await openPresentation(await fixture('odp', zip => zip.file('META-INF/documentsignatures.xml', '<signature/>')), { format: 'odp' });
  const changed = structuredClone(signed.document); runs(changed)[0].style.overrides.bold = true;
  await expect(signed.export(changed)).rejects.toThrow('signed');
  s.dispose(); signed.dispose();
});
