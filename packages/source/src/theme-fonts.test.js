import { createEditor } from '@stagecraft/core/editor';
import { documentPlugin, validateDocument } from '@stagecraft/core/document';
import JSZip from 'jszip';
import { createTextFixture } from '../../../scripts/text-authoring-fixtures.mjs';
import { openPresentation } from './index.js';

it('exposes linked theme font slots without resolving aliases or changing source bytes', async () => {
  const { bytes } = await createTextFixture('pptx');
  const zip = await JSZip.loadAsync(bytes);
  const part = Object.keys(zip.files).find(n => /^ppt\/theme\/theme\d+\.xml$/.test(n));
  zip.file(part, (await zip.file(part).async('string')).replace(/<a:fontScheme[\s\S]*?<\/a:fontScheme>/, '<a:fontScheme name="Fixture"><a:majorFont><a:latin typeface="Georgia"/><a:ea typeface="Yu Gothic"/><a:cs typeface="Arial"/></a:majorFont><a:minorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/><a:font script="Arab" typeface="Tahoma"/></a:minorFont></a:fontScheme>'));
  const input = await zip.generateAsync({ type: 'uint8array' });
  const source = await openPresentation(input, { format: 'pptx' });
  try {
    const d = source.document, layout = d.layouts.find(x => x.id === d.slides[0].layoutId);
    const master = d.masters.find(x => x.id === layout.masterId);
    expect(d.themes.find(x => x.id === master.themeId).extensions.pptxFontScheme).toEqual({
      major: { latin: 'Georgia', eastAsian: 'Yu Gothic', complexScript: 'Arial', supplemental: {} },
      minor: { latin: 'Arial', eastAsian: '', complexScript: '', supplemental: { Arab: 'Tahoma' } },
    });
    expect((await source.export(d)).bytes).toEqual(input);
    const editor = createEditor({ document: d, validateDocument, plugins: [documentPlugin] });
    try {
      const run = d.slides[0].objects.flatMap(o => o.text?.paragraphs.flatMap(p => p.runs) ?? []).find(r => r.editable);
      editor.dispatch('document.setRunText', { runId: run.id, text: 'Theme stays untouched' });
      const exported = await JSZip.loadAsync((await source.export(editor.getSnapshot().document)).bytes);
      expect(await exported.file(part).async('uint8array')).toEqual(await zip.file(part).async('uint8array'));
    } finally { editor.dispose(); }
  } finally { source.dispose(); }
});
it('exposes major font references and rejects unprojected native metrics for measurement', async () => {
  const { bytes } = await createTextFixture('pptx');
  const zip = await JSZip.loadAsync(bytes), part = 'ppt/slides/slide1.xml';
  const doc = new DOMParser().parseFromString(await zip.file(part).async('string'), 'application/xml');
  const a = 'http://schemas.openxmlformats.org/drawingml/2006/main', p = 'http://schemas.openxmlformats.org/presentationml/2006/main';
  const shapes = [...doc.getElementsByTagNameNS(p, 'sp')];
  const style = doc.createElementNS(p, 'p:style'), ref = doc.createElementNS(a, 'a:fontRef'); ref.setAttribute('idx', 'major'); style.appendChild(ref); shapes[0].appendChild(style);
  shapes[1].getElementsByTagNameNS(a, 'bodyPr')[0].setAttribute('vert', 'vert');
  zip.file(part, new XMLSerializer().serializeToString(doc));
  const source = await openPresentation(await zip.generateAsync({ type: 'uint8array' }), { format: 'pptx' });
  try {
    const objects = source.document.slides[0].objects.filter(o => o.text);
    expect(objects[0].extensions.pptxTextMetrics).toEqual({ fontRef: 'major', supported: true });
    expect(objects[1].extensions.pptxTextMetrics.supported).toBe(false);
  } finally { source.dispose(); }
});
it('flags custom master font defaults instead of silently measuring them as minor theme fonts', async () => {
  const { bytes } = await createTextFixture('pptx'); const zip = await JSZip.loadAsync(bytes);
  const part='ppt/slideMasters/slideMaster1.xml';
  zip.file(part,(await zip.file(part).async('string')).replace(/(<p:otherStyle>[\s\S]*?<a:latin typeface=")[^"]*/, '$1Courier New'));
  const source=await openPresentation(await zip.generateAsync({type:'uint8array'}),{format:'pptx'});
  try { expect(source.document.masters[0].extensions.pptxTextDefaultsSupported).toBe(false); }
  finally {source.dispose();}
});
it('skips inherited language and kerning defaults the adapter cannot reproduce', async () => {
  const { bytes } = await createTextFixture('pptx');
  for (const [before, after] of [['lang="en-US"','lang="ja-JP"'], ['kern="1200"','kern="4000"']]) {
    const zip=await JSZip.loadAsync(bytes),part='ppt/slideMasters/slideMaster1.xml';
    zip.file(part,(await zip.file(part).async('string')).replace(/<p:otherStyle>[\s\S]*?<\/p:otherStyle>/,s=>s.replace(before,after)));
    const source=await openPresentation(await zip.generateAsync({type:'uint8array'}),{format:'pptx'});
    try {expect(source.document.masters[0].extensions.pptxTextDefaultsSupported).toBe(false);}finally{source.dispose();}
  }
});
