import { expect, it } from 'vitest';
import JSZip from 'jszip';
import { writePptx } from '../../pptx/src/index.js';
import { writeOdp } from '../../odp/src/index.js';
import { openPresentation } from './index.js';
import { createEditor } from '@stagecraft/core/editor';
import { documentPlugin, presentationPlugin, validateDocument } from '@stagecraft/core/document';

// FU-CR: a CRLF split across adjacent runs must render ONE native break. The writers coalesce the
// split pair within a paragraph (a trailing CR is dropped when the next non-empty run starts with
// LF); empty runs are skipped by the lookahead, and a CR/LF pair across two paragraphs is NOT
// coalesced (that pairing is canonical content, not a writer artifact). Assertions read the raw
// serialized XML — post-parse textContent would hide the very normalization under test.

const run = (id, text) => ({ id, text, editable: true, style: {}, extensions: { stagecraftAuthored: true } });

async function exportedXml(format, runs, paragraphs) {
  const write = format === 'pptx' ? writePptx : writeOdp;
  const object = {
    id: 'crlf', type: 'text', geometry: { x: 12700, y: 25400, width: 1270000, height: 635000 },
    extensions: { stagecraftAuthored: true },
    text: { paragraphs: paragraphs ?? [{ id: 'crlf-p', runs }] },
  };
  const bytes = await write({ title: 'Deck', sections: [{ id: 'sec', name: 'Section', slides: ['s'] }], slides: [{ id: 's', layout: 'blank', elements: [] }] });
  const source = await openPresentation(bytes, { format });
  const editor = createEditor({ document: source.document, validateDocument, plugins: [documentPlugin, presentationPlugin] });
  try {
    editor.dispatch('presentation.addObject', { slideId: source.document.slides[0].id, object });
    const result = await source.export(editor.getSnapshot().document);
    const zip = await JSZip.loadAsync(result.bytes);
    return { xml: await zip.file(format === 'pptx' ? 'ppt/slides/slide1.xml' : 'content.xml').async('string'), bytes: result.bytes };
  } finally { editor.dispose(); source.dispose(); }
}

/** Break-representation count (pre-fold: every CR or LF is one rendered break) and the folded
 * display text, measured on the raw serialized XML. */
function breakReport(xml, format) {
  if (format === 'pptx') {
    const parts = [...xml.matchAll(/<a:t[^>]*>([^<]*)<\/a:t>/g)].map(([, text]) => text).join('');
    return {
      count: (parts.match(/[\r\n]/g) ?? []).length,
      text: parts.replace(/\r\n/g, '\n').replace(/\r/g, '\n'),
      literalCr: (parts.match(/\r/g) ?? []).length,
    };
  }
  const paragraphs = [...xml.matchAll(/<text:p[^>]*>([\s\S]*?)<\/text:p>/g)]
    .map(([, inner]) => inner.replace(/<text:line-break\/>/g, '\n').replace(/<[^>]+>/g, ''));
  const raw = paragraphs.join('');
  return { count: (raw.match(/[\r\n]/g) ?? []).length, text: raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n'), literalCr: (raw.match(/\r/g) ?? []).length };
}

it.each(['pptx', 'odp'])('writes a split CRLF as one native break (%s)', async format => {
  const { xml, bytes } = await exportedXml(format, [run('r1', 'A\r'), run('r2', '\nB')]);
  const report = breakReport(xml, format);
  expect(report.count).toBe(1);
  expect(report.text).toBe('A\nB');
  expect(report.literalCr).toBe(0);
  if (format === 'pptx') {
    expect(xml.includes('&#13;')).toBe(false);
    const reopened = await openPresentation(bytes, { format });
    try {
      const runs = reopened.document.slides[0].objects.find(o => o.type === 'text').text.paragraphs[0].runs;
      expect(runs.map(r => r.text).join('')).toBe('A\nB');
      // The reopened document re-exports stably: no further drift.
      expect((await reopened.export(reopened.document)).bytes).toEqual(new Uint8Array(bytes));
    } finally { reopened.dispose(); }
  } else {
    expect((xml.match(/<text:line-break/g) ?? []).length).toBe(1);
  }
});

it.each(['pptx', 'odp'])('skips one empty run in the coalescing lookahead (%s)', async format => {
  const report = breakReport((await exportedXml(format, [run('r1', 'A\r'), run('r2', ''), run('r3', '\nB')])).xml, format);
  expect(report.count).toBe(1);
  expect(report.text).toBe('A\nB');
  if (format === 'odp') expect((report.text.match(/\n/g) ?? []).length).toBe(1);
});

it.each(['pptx', 'odp'])('skips multiple empty runs in the coalescing lookahead (%s)', async format => {
  const report = breakReport((await exportedXml(format, [run('r1', 'A\r'), run('r2', ''), run('r3', ''), run('r4', '\nB')])).xml, format);
  expect(report.count).toBe(1);
  expect(report.text).toBe('A\nB');
});

it.each(['pptx', 'odp'])('does not coalesce a CR/LF pair across paragraph boundaries (%s)', async format => {
  const { xml } = await exportedXml(format, null, [
    { id: 'p1', runs: [run('r1', 'A\r')] },
    { id: 'p2', runs: [run('r2', '\nB')] },
  ]);
  const report = breakReport(xml, format);
  // The pairing is canonical content: both newline representations stay in the file. The folded
  // display collapses the pair to one newline, exactly like the UI mapper.
  expect(report.count).toBe(2);
  if (format === 'pptx') expect(report.literalCr).toBe(1);
  if (format === 'odp') expect((xml.match(/<text:line-break/g) ?? []).length).toBe(2);
});

it.each(['pptx', 'odp'])('coalesces a split CRLF written through native run edits (%s)', async format => {
  // Seed an authored object, reopen it: the runs are now native (source-backed) and are edited
  // through document.setRunText — the native-edit path, not the authoring writers.
  const seed = await (format === 'pptx' ? writePptx : writeOdp)({ title: 'Deck', sections: [{ id: 'sec', name: 'Section', slides: ['s'] }], slides: [{ id: 's', layout: 'blank', elements: [] }] });
  const source = await openPresentation(seed, { format });
  const editor = createEditor({ document: source.document, validateDocument, plugins: [documentPlugin, presentationPlugin] });
  let native, nativeEditor, reopened;
  try {
    editor.dispatch('presentation.addObject', { slideId: source.document.slides[0].id, object: {
      id: 'crlf', type: 'text', geometry: { x: 12700, y: 25400, width: 1270000, height: 635000 },
      extensions: { stagecraftAuthored: true },
      text: { paragraphs: [{ id: 'crlf-p', runs: [run('r1', 'A'), run('r2', 'MID'), run('r3', 'B')] }] },
    } });
    const first = await source.export(editor.getSnapshot().document);
    native = await openPresentation(first.bytes, { format });
    nativeEditor = createEditor({ document: native.document, validateDocument, plugins: [documentPlugin, presentationPlugin] });
    const runs = native.document.slides[0].objects.find(o => o.type === 'text').text.paragraphs[0].runs;
    expect(runs.map(r => r.text)).toEqual(['A', 'MID', 'B']);
    nativeEditor.dispatch('document.setRunText', { runId: runs[0].id, text: 'A\r' });
    nativeEditor.dispatch('document.setRunText', { runId: runs[1].id, text: '' });
    nativeEditor.dispatch('document.setRunText', { runId: runs[2].id, text: '\nB' });
    const result = await native.export(nativeEditor.getSnapshot().document);
    const report = breakReport(await (await JSZip.loadAsync(result.bytes)).file(format === 'pptx' ? 'ppt/slides/slide1.xml' : 'content.xml').async('string'), format);
    // The post-edit paragraph runs are A\r, '' and \nB: one break, empty run skipped.
    expect(report.count).toBe(1);
    expect(report.text).toBe('A\nB');
    reopened = await openPresentation(result.bytes, { format });
    const reopenedRuns = reopened.document.slides[0].objects.find(o => o.type === 'text').text.paragraphs[0].runs;
    expect(reopenedRuns.map(r => r.text).join('').replace(/\r\n/g, '\n').replace(/\r/g, '\n')).toBe('A\nB');
  } finally {
    reopened?.dispose(); nativeEditor?.dispose(); native?.dispose(); editor.dispose(); source.dispose();
  }
});

// FU-CR fix4: a native CR can live in an UNCHANGED run (a source &#13; reference survives
// parsing). Editing only the run AFTER it must coalesce the untouched CR run too.
async function nativeCrFixture(format, { empty = false, nonwritable = false } = {}) {
  const write = format === 'pptx' ? writePptx : writeOdp;
  const styled = format === 'odp';
  const runs = [
    { ...run('r1', 'A'), ...(styled ? { style: { b: '1' } } : {}) },
    ...(empty ? [{ ...run('r2', 'MID'), ...(styled ? { style: { i: '1' } } : {}) }] : []),
    { ...(run(empty ? 'r3' : 'r2', 'B')), ...(styled ? { style: { i: '1' } } : {}) },
  ];
  const seed = await write({ title: 'Deck', sections: [{ id: 'sec', name: 'Section', slides: ['s'] }], slides: [{ id: 's', layout: 'blank', elements: [] }] });
  const source = await openPresentation(seed, { format });
  const editor = createEditor({ document: source.document, validateDocument, plugins: [documentPlugin, presentationPlugin] });
  let first;
  try {
    editor.dispatch('presentation.addObject', { slideId: source.document.slides[0].id, object: {
      id: 'crlf', type: 'text', geometry: { x: 12700, y: 25400, width: 1270000, height: 635000 },
      extensions: { stagecraftAuthored: true }, text: { paragraphs: [{ id: 'crlf-p', runs }] },
    } });
    first = (await source.export(editor.getSnapshot().document)).bytes;
  } finally { editor.dispose(); source.dispose(); }
  // Give the first native run a trailing CR through a character reference, which survives parsing.
  const zip = await JSZip.loadAsync(first);
  const part = format === 'pptx' ? 'ppt/slides/slide1.xml' : 'content.xml';
  let xml = await zip.file(part).async('string');
  xml = format === 'pptx'
    ? xml.replace('<a:t>A</a:t>', '<a:t>A&#13;</a:t>')
    : xml.replace('>A</text:span>', '>A&#13;</text:span>');
  if (empty) xml = format === 'pptx'
    ? xml.replace('<a:t>MID</a:t>', '<a:t></a:t>')
    : xml.replace('>MID</text:span>', '></text:span>');
  if (nonwritable) xml = format === 'pptx'
    ? xml.replace('<a:t>A&#13;</a:t>', '<a:rPr lang="en-US"/><a:t>A&#13;</a:t>')
    : xml.replace(/(<text:span[^>]*>)A&#13;(<\/text:span>)/, '<text:page-number>A&#13;</text:page-number>');
  zip.file(part, xml);
  return openPresentation(await zip.generateAsync({ type: 'uint8array' }), { format });
}

it.each(['pptx', 'odp'])('coalesces behind an untouched native CR run (%s)', async format => {
  const native = await nativeCrFixture(format);
  const nativeEditor = createEditor({ document: native.document, validateDocument, plugins: [documentPlugin, presentationPlugin] });
  let reopened;
  try {
    const runs = native.document.slides[0].objects.find(o => o.type === 'text').text.paragraphs[0].runs;
    expect(runs.map(r => r.text)).toEqual(['A\r', 'B']);
    nativeEditor.dispatch('document.setRunText', { runId: runs[1].id, text: '\nB' });
    const result = await native.export(nativeEditor.getSnapshot().document);
    const report = breakReport(await (await JSZip.loadAsync(result.bytes)).file(format === 'pptx' ? 'ppt/slides/slide1.xml' : 'content.xml').async('string'), format);
    expect(report.count).toBe(1);
    expect(report.text).toBe('A\nB');
    reopened = await openPresentation(result.bytes, { format });
    const reopenedRuns = reopened.document.slides[0].objects.find(o => o.type === 'text').text.paragraphs[0].runs;
    expect(reopenedRuns.map(r => r.text).join('').replace(/\r\n/g, '\n').replace(/\r/g, '\n')).toBe('A\nB');
  } finally { reopened?.dispose(); nativeEditor.dispose(); native.dispose(); }
});

it.each(['pptx', 'odp'])('skips an empty run behind an untouched native CR (%s)', async format => {
  const native = await nativeCrFixture(format, { empty: true });
  const nativeEditor = createEditor({ document: native.document, validateDocument, plugins: [documentPlugin, presentationPlugin] });
  try {
    const runs = native.document.slides[0].objects.find(o => o.type === 'text').text.paragraphs[0].runs;
    expect(runs.map(r => r.text)).toEqual(['A\r', '', 'B']);
    nativeEditor.dispatch('document.setRunText', { runId: runs[2].id, text: '\nB' });
    const result = await native.export(nativeEditor.getSnapshot().document);
    const report = breakReport(await (await JSZip.loadAsync(result.bytes)).file(format === 'pptx' ? 'ppt/slides/slide1.xml' : 'content.xml').async('string'), format);
    expect(report.count).toBe(1);
    expect(report.text).toBe('A\nB');
  } finally { nativeEditor.dispose(); native.dispose(); }
});

it('leaves an unwritable native CR run as-is instead of failing the export', async () => {
  // PPTX: a second rPr child makes the CR-bearing run ineligible for direct text editing.
  const native = await nativeCrFixture('pptx', { nonwritable: true });
  const nativeEditor = createEditor({ document: native.document, validateDocument, plugins: [documentPlugin, presentationPlugin] });
  try {
    const runs = native.document.slides[0].objects.find(o => o.type === 'text').text.paragraphs[0].runs;
    expect(runs.map(r => r.text)).toEqual(['A\r', 'B']);
    nativeEditor.dispatch('document.setRunText', { runId: runs[1].id, text: '\nB' });
    const result = await native.export(nativeEditor.getSnapshot().document);
    const report = breakReport(await (await JSZip.loadAsync(result.bytes)).file('ppt/slides/slide1.xml').async('string'), 'pptx');
    // Documented fallback: the unwritable CR run stays as-is (two break representations, folded
    // display one newline), and the export succeeds instead of failing.
    expect(report.count).toBe(2);
    expect(report.literalCr).toBe(1);
    expect(report.text).toBe('A\nB');
  } finally { nativeEditor.dispose(); native.dispose(); }
});

it.each(['pptx', 'odp'])('writes CRLF slide notes as single breaks (%s)', async format => {
  const write = format === 'pptx' ? writePptx : writeOdp;
  const bytes = await write({ title: 'Deck', sections: [{ id: 'sec', name: 'Section', slides: ['s'] }], slides: [{ id: 's', layout: 'blank', elements: [] }] });
  const source = await openPresentation(bytes, { format });
  const editor = createEditor({ document: source.document, validateDocument, plugins: [documentPlugin, presentationPlugin] });
  let reopened;
  try {
    editor.dispatch('presentation.setSlideProperties', { slideId: source.document.slides[0].id, properties: { notes: 'top\r\nbottom' } });
    const result = await source.export(editor.getSnapshot().document);
    reopened = await openPresentation(result.bytes, { format });
    expect(reopened.document.slides[0].notes).toBe('top\nbottom');
  } finally { editor.dispose(); reopened?.dispose(); source.dispose(); }
});
