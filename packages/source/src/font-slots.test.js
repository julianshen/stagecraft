import JSZip from 'jszip';
import { createTextFixture } from '../../../scripts/text-authoring-fixtures.mjs';
import { openPresentation } from './index.js';
import { NS } from './xml.js';
import { createEditor } from '@stagecraft/core/editor';
import { documentPlugin, presentationPlugin, validateDocument } from '@stagecraft/core/document';
import { odpFormattingWriter, odpAppearanceReader, reservedOdpStyleNames } from './odp-format.js';
const parse = xml => new DOMParser().parseFromString(xml, 'application/xml');
const elements = (doc, ns, name) => [...doc.getElementsByTagNameNS(NS[ns], name)];
const firstRun = d => d.slides[0].objects.flatMap(o => o.text?.paragraphs.flatMap(p => p.runs) ?? []).find(r => r.text.startsWith('Text'));
it('reads and edits PPTX slots independently while preserving aliases, symbol and ancillary metadata', async () => {
  const { bytes } = await createTextFixture('pptx'); const zip = await JSZip.loadAsync(bytes), part = 'ppt/slides/slide1.xml';
  zip.file(part, (await zip.file(part).async('string')).replace('</a:rPr>', '<a:ea typeface="+mj-ea" pitchFamily="34"/><a:cs typeface="+mn-cs"/><a:sym typeface="Wingdings" charset="02"/></a:rPr>'));
  const input = await zip.generateAsync({ type: 'uint8array' }), source = await openPresentation(input, { format: 'pptx' });
  const e = createEditor({ document: source.document, validateDocument, plugins: [documentPlugin] });
  try {
    const run = firstRun(source.document);
    expect(run.style).toMatchObject({ typeface: 'Arial', eastAsian: '+mj-ea', complexScript: '+mn-cs' });
    expect(run.extensions.pptxAppearance.eastAsian).toBeUndefined();
    expect((await source.export(e.getSnapshot().document)).bytes).toEqual(input);
    e.dispatch('document.setRunFormat', { runId: run.id, format: { eastAsian: 'Yu Gothic' } });
    const output = await source.export(e.getSnapshot().document), out = await JSZip.loadAsync(output.bytes), doc = parse(await out.file(part).async('string'));
    expect(elements(doc, 'a', 'ea')[0].getAttribute('typeface')).toBe('Yu Gothic');
    expect(elements(doc, 'a', 'ea')[0].getAttribute('pitchFamily')).toBe('34');
    expect(elements(doc, 'a', 'cs')[0].getAttribute('typeface')).toBe('+mn-cs');
    expect(elements(doc, 'a', 'sym')[0].getAttribute('charset')).toBe('02');
    const reopened = await openPresentation(output.bytes, { format: 'pptx' });
    expect(firstRun(reopened.document).extensions.pptxAppearance.eastAsian).toBe('Yu Gothic'); reopened.dispose();
    e.dispatch('document.setRunFormat', { runId: run.id, format: { eastAsian: null } });
    const reset = parse(await (await JSZip.loadAsync((await source.export(e.getSnapshot().document)).bytes)).file(part).async('string'));
    expect(elements(reset, 'a', 'ea')).toHaveLength(0); expect(elements(reset, 'a', 'cs')).toHaveLength(1);
    e.undo(); e.undo(); expect((await source.export(e.getSnapshot().document)).bytes).toEqual(input);
  } finally { e.dispose(); source.dispose(); }
});
it.each(['pptx', 'odp'])('writes authored %s script slots and only emits explicitly set slots', async format => {
  const { bytes } = await createTextFixture(format), source = await openPresentation(bytes, { format });
  const e = createEditor({ document: source.document, validateDocument, plugins: [documentPlugin, presentationPlugin] });
  try {
    const authored = { stagecraftAuthored: true };
    e.dispatch('presentation.addObject', { slideId: source.document.slides[0].id, object: { id: 'new', type: 'text', geometry: { x: 0, y: 0, width: 1270000, height: 1270000 }, extensions: authored, text: { paragraphs: [{ id: 'p', runs: [
      { id: 'r1', text: '漢', style: { typeface: 'Arial', eastAsian: 'Yu Gothic', complexScript: 'Arial' }, editable: true, extensions: authored },
      { id: 'r2', text: 'Latin', style: { typeface: 'Arial' }, editable: true, extensions: authored },
    ] }] } } });
    const output = await source.export(e.getSnapshot().document), reopened = await openPresentation(output.bytes, { format });
    const run = reopened.document.slides[0].objects.flatMap(o => o.text?.paragraphs.flatMap(p => p.runs) ?? []).find(r => r.text === '漢');
    expect(format === 'pptx' ? run.style : run.extensions.odpAppearance).toMatchObject({ eastAsian: 'Yu Gothic', complexScript: 'Arial' });
    if (format === 'pptx') {
      const doc = parse(await (await JSZip.loadAsync(output.bytes)).file('ppt/slides/slide1.xml').async('string'));
      const latin = elements(doc, 'a', 'r').find(n => n.textContent === 'Latin');
      expect(elements(latin, 'a', 'ea')).toHaveLength(0); expect(elements(latin, 'a', 'cs')).toHaveLength(0);
      const props = elements(doc, 'a', 'r').find(n => n.textContent === '漢').firstElementChild;
      expect([...props.children].map(n => n.localName)).toEqual(['latin', 'ea', 'cs']);
      expect(props.hasAttribute('eastAsian')).toBe(false);
    }
    reopened.dispose();
  } finally { e.dispose(); source.dispose(); }
});
const odpDoc = body => parse(`<office:document-content xmlns:office="${NS.office}" xmlns:style="${NS.style}" xmlns:text="${NS.text}" xmlns:svg="${NS.svg}" xmlns:fo="${NS.fo}">${body}</office:document-content>`);
it('emits valid ODP Latin and script font references, reuses declarations and avoids collisions', () => {
  const doc = odpDoc('<office:font-face-decls><style:font-face style:name="StagecraftFont1" svg:font-family="Other"/><style:font-face style:name="Existing" svg:font-family="Arial"/></office:font-face-decls><office:automatic-styles><style:style style:name="Old" style:family="text"><style:text-properties style:font-name-asian="StagecraftFont2"/></style:style></office:automatic-styles><office:body/>');
  const write = odpFormattingWriter(doc, reservedOdpStyleNames(doc));
  write({ fontFamily: 'Arial', eastAsian: 'Yu Gothic', complexScript: 'Arial' }); write({ eastAsian: 'Yu Gothic' });
  const props = elements(doc, 'style', 'text-properties').slice(1);
  expect(props[0].getAttributeNS(NS.style, 'font-name')).toBe('Existing'); // old Latin writer writes undeclared "Arial"
  expect(props[0].getAttributeNS(NS.fo, 'font-family')).toBe('Arial');
  expect(props[0].getAttributeNS(NS.style, 'font-name-complex')).toBe('Existing');
  const ref = props[0].getAttributeNS(NS.style, 'font-name-asian');
  expect(ref).toBe('StagecraftFont3'); expect(props[1].getAttributeNS(NS.style, 'font-name-asian')).toBe(ref);
  expect(elements(doc, 'style', 'font-face')).toHaveLength(3);
});
it('resolves ODP script references separately from family names and suppresses ambiguous references', () => {
  const doc = odpDoc('<office:font-face-decls><style:font-face style:name="EA" svg:font-family="Yu Gothic"/><style:font-face style:name="Dup" svg:font-family="A"/><style:font-face style:name="Dup" svg:font-family="B"/></office:font-face-decls><office:automatic-styles><style:style style:name="S" style:family="text"><style:text-properties style:font-name-asian="EA" style:font-name-complex="Dup"/></style:style></office:automatic-styles><office:body><text:p><text:span text:style-name="S">X</text:span></text:p></office:body>');
  const result = odpAppearanceReader(doc, odpDoc(''))(elements(doc, 'text', 'span')[0].firstChild, 'content.xml');
  expect(result).toMatchObject({ eastAsian: 'Yu Gothic', fontReferences: { eastAsian: 'EA', complexScript: 'Dup' } });
  expect(result.complexScript).toBeUndefined();
});
it('applies native ODP script overrides and resets only the targeted override to the imported value', async () => {
  const { bytes } = await createTextFixture('odp'), source = await openPresentation(bytes, { format: 'odp' });
  const e = createEditor({ document: source.document, validateDocument, plugins: [documentPlugin] });
  try {
    const run = firstRun(source.document);
    e.dispatch('document.setRunFormat', { runId: run.id, format: { eastAsian: 'Yu Gothic', complexScript: 'Arial', fontFamily: 'Georgia' } });
    const edited = await source.export(e.getSnapshot().document), reopened = await openPresentation(edited.bytes, { format: 'odp' });
    expect(firstRun(reopened.document).extensions.odpAppearance).toMatchObject({ fontFamily: 'Georgia', eastAsian: 'Yu Gothic', complexScript: 'Arial' }); reopened.dispose();
    e.dispatch('document.setRunFormat', { runId: run.id, format: { eastAsian: null } });
    expect(firstRun(e.getSnapshot().document).style.overrides).toEqual({ complexScript: 'Arial', fontFamily: 'Georgia' });
    const reset = await openPresentation((await source.export(e.getSnapshot().document)).bytes, { format: 'odp' });
    expect(firstRun(reset.document).extensions.odpAppearance.eastAsian).toBeUndefined();
    expect(firstRun(reset.document).extensions.odpAppearance.complexScript).toBe('Arial'); reset.dispose();
    e.undo(); e.undo(); expect((await source.export(e.getSnapshot().document)).bytes).toEqual(bytes);
  } finally { e.dispose(); source.dispose(); }
});
it('keeps inherited ODP references scoped to their declaring part and clears them for direct-family overrides', () => {
  const common = odpDoc('<office:font-face-decls><style:font-face style:name="EA" svg:font-family="Common"/></office:font-face-decls><office:styles><style:style style:name="Base" style:family="text"><style:text-properties style:font-name-asian="EA"/></style:style></office:styles>');
  const content = odpDoc('<office:font-face-decls><style:font-face style:name="EA" svg:font-family="Local"/></office:font-face-decls><office:automatic-styles><style:style style:name="Inherited" style:family="text" style:parent-style-name="Base"/><style:style style:name="Direct" style:family="text"><style:text-properties style:font-family-asian="DirectFamily"/></style:style></office:automatic-styles><office:body><text:p><text:span text:style-name="Inherited">I<text:span text:style-name="Direct">D</text:span></text:span></text:p></office:body>');
  const spans = elements(content, 'text', 'span'), read = odpAppearanceReader(content, common);
  expect(read(spans[0].firstChild, 'content.xml')).toMatchObject({ eastAsian: 'Common', fontReferences: { eastAsian: 'EA' } });
  const direct = read(spans[1].firstChild, 'content.xml');
  expect(direct.eastAsian).toBe('DirectFamily'); expect(direct.fontReferences?.eastAsian).toBeUndefined();
});
it('avoids duplicate or metadata-bearing ODP declarations and inserts declarations in document order', () => {
  const doc = odpDoc('<office:font-face-decls><style:font-face style:name="Dup" svg:font-family="Arial"/><style:font-face style:name="Dup" svg:font-family="Arial"/><style:font-face style:name="Special" svg:font-family="Arial" style:font-charset="x-symbol"/></office:font-face-decls><office:body/>');
  odpFormattingWriter(doc, reservedOdpStyleNames(doc))({ eastAsian: 'Arial' });
  const ref = elements(doc, 'style', 'text-properties')[0].getAttributeNS(NS.style, 'font-name-asian');
  expect(ref).toBe('StagecraftFont1');
  const empty = odpDoc('<office:styles/><office:body/>'); odpFormattingWriter(empty, [])({ fontFamily: 'Arial' });
  expect([...empty.documentElement.children].map(n => n.localName)).toEqual(['font-face-decls', 'styles', 'automatic-styles', 'body']);
  const ambiguous = odpDoc('<office:font-face-decls/><office:font-face-decls/>');
  expect(() => odpFormattingWriter(ambiguous, [])({ eastAsian: 'Arial' })).toThrow('Ambiguous');
});
it.each(['', '<a:ea typeface=""/>', '<a:ea typeface="+mj-ea"/><a:ea typeface="Other"/>'])('handles absent, empty or ambiguous PPTX script slots conservatively: %s', async slot => {
  const { bytes } = await createTextFixture('pptx'), zip = await JSZip.loadAsync(bytes), part = 'ppt/slides/slide1.xml';
  zip.file(part, (await zip.file(part).async('string')).replace('</a:rPr>', `${slot}</a:rPr>`));
  const input = await zip.generateAsync({ type: 'uint8array' }), source = await openPresentation(input, { format: 'pptx' });
  const e = createEditor({ document: source.document, validateDocument, plugins: [documentPlugin] });
  try {
    const run = firstRun(source.document);
    expect((await source.export(e.getSnapshot().document)).bytes).toEqual(input);
    expect(run.style.eastAsian).toBe(slot.includes('Other') ? '+mj-ea' : slot ? null : undefined);
    e.dispatch('document.setRunFormat', { runId: run.id, format: { eastAsian: 'Yu Gothic' } });
    if (slot.includes('Other')) {
      await expect(source.export(e.getSnapshot().document)).rejects.toThrow('Ambiguous direct font');
      e.dispatch('document.setRunFormat', { runId: run.id, format: { eastAsian: null } });
      await expect(source.export(e.getSnapshot().document)).rejects.toThrow('Ambiguous direct font');
    }
    else {
      const output = await source.export(e.getSnapshot().document), reopened = await openPresentation(output.bytes, { format: 'pptx' });
      expect(firstRun(reopened.document).style.eastAsian).toBe('Yu Gothic'); reopened.dispose();
    }
  } finally { e.dispose(); source.dispose(); }
});
