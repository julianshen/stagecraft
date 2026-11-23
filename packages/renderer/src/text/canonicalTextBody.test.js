import { canonicalTextBody, themeForSlide } from './canonicalTextBody.js';
const pt = n => n * 12700;
const object = () => ({ id: 'text', geometry: { width: pt(210), height: pt(75) }, bodyLayout: { autofit: 'shrink', insets: { left: pt(12), right: pt(9), top: pt(6), bottom: pt(3) } }, text: { paragraphs: [{ id: 'p', runs: [{ text: 'Hello', style: { sz: '1800' } }] }] } });
const fonts = { minor: { latin: 'Arial', eastAsian: 'Yu Gothic', complexScript: 'Tahoma', supplemental: {} }, major: { latin: 'Georgia', supplemental: {} } };
it('maps canonical units, styles and layout without mutating or pre-shrinking', () => {
  const o = object(); o.bodyLayout.wrap = 'none'; o.bodyLayout.anchor = 'bottom';
  o.text.paragraphs[0].style = { alignment: 'right', spaceBefore: 2, spaceAfter: 3, lineSpacing: 150, indentStart: pt(5), indentEnd: pt(4), firstLineIndent: pt(-2) };
  o.text.paragraphs[0].runs[0].style = { sz: '1800', b: '1', i: '0', typeface: '+mj-lt', eastAsian: 'Yu Gothic', complexScript: 'Tahoma' };
  const before = structuredClone(o), result = canonicalTextBody(o, { fonts });
  expect(result).toMatchObject({ width: 280, height: 100, availableHeight: 88, body: { wrap: false, anchor: 'b', insetLeftEmu: pt(12), paragraphs: [{ align: 'right', marginLeftEmu: pt(5), indentEmu: pt(-2), lineSpacing: { kind: 'percent', value: 1.5 }, spaceBefore: { kind: 'points', value: 2 }, runs: [{ text: 'Hello', fontSizePt: 18, fontFamily: '+mj-lt', fontFamilyEastAsia: 'Yu Gothic', fontFamilyComplexScript: 'Tahoma', bold: true, italic: false }] }] } });
  expect(result.body.autofit).toBeUndefined(); expect(o).toEqual(before);
});
it('uses the inherited minor theme font and follows slide links rather than theme array order', () => {
  const d = { layouts: [{ id: 'l', masterId: 'm' }], masters: [{ id: 'm', themeId: 't' }], themes: [{ id: 'wrong' }, { id: 't', extensions: { pptxFontScheme: fonts } }] };
  const theme = themeForSlide(d, { layoutId: 'l' });
  expect(theme.fonts).toEqual(fonts);
  expect(canonicalTextBody(object(), theme).body.paragraphs[0].runs[0].fontFamily).toBe('+mn-lt');
  expect(themeForSlide(d, {})).toBeUndefined();
});
it('skips unknown inherited metrics, invalid frames and unsupported bullets', () => {
  expect(canonicalTextBody(object())).toBeNull();
  const o = object(); o.text.paragraphs[0].runs[0].style.typeface = 'Arial';
  expect(canonicalTextBody(o)).not.toBeNull();
  delete o.text.paragraphs[0].runs[0].style.sz; expect(canonicalTextBody(o)).toBeNull();
  o.text.paragraphs[0].runs[0].style.sz = '1800'; o.geometry.height = 0; expect(canonicalTextBody(o)).toBeNull();
  o.geometry.height = pt(75); o.text.paragraphs[0].style = { bullet: { type: 'number' } }; expect(canonicalTextBody(o)).toBeNull();
});
it('keeps empty paragraphs, normalizes CRLF across runs and uses DrawingML default insets', () => {
  const o = object(); delete o.bodyLayout.insets;
  o.text.paragraphs = [{ runs: [{ text: 'A\r', style: { sz: '1800' } }, { text: '', style: { sz: '1800' } }, { text: '\nB', style: { sz: '2400' } }] }, { runs: [{ text: '', style: { sz: '1800' } }] }];
  const r = canonicalTextBody(o, { fonts });
  expect(r.body.paragraphs[0].runs.map(r => r.text).join('')).toBe('A\nB');
  expect(r.body.paragraphs).toHaveLength(2);
  expect(r.body.insetLeftEmu).toBe(91440); expect(r.body.insetTopEmu).toBe(45720);
});
it('respects source metric eligibility, major inheritance and XML true booleans', () => {
  const o = object(); o.extensions = { pptxTextMetrics: { supported: true, fontRef: 'major' } };
  o.text.paragraphs[0].runs[0].style.b = 'true'; o.text.paragraphs[0].runs[0].style.i = 'true';
  const r = canonicalTextBody(o, { fonts }).body.paragraphs[0].runs[0];
  expect(r).toMatchObject({ fontFamily: '+mj-lt', fontFamilyEastAsia: '+mj-ea', fontFamilyComplexScript: '+mj-cs', bold: true, italic: true });
  o.extensions.pptxTextMetrics.supported = false; expect(canonicalTextBody(o, { fonts })).toBeNull();
});
it('does not treat a Latin-only face as resolved metrics for unknown script slots', () => {
  const o = object(), r = o.text.paragraphs[0].runs[0]; r.text = '漢字 مرحبا'; r.style.typeface = 'Arial';
  expect(canonicalTextBody(o)).toBeNull();
  expect(canonicalTextBody(o, { fonts }).body.paragraphs[0].runs[0]).toMatchObject({ fontFamily: 'Arial', fontFamilyEastAsia: '+mn-ea', fontFamilyComplexScript: '+mn-cs' });
  r.style.eastAsian = 'Yu Gothic'; r.style.complexScript = 'Tahoma'; expect(canonicalTextBody(o)).not.toBeNull();
});
it('uses the writer-selected layout on a newly authored slide and skips unresolved script themes', () => {
  const d = { layouts: [{ id: 'l', masterId: 'm' }], masters: [{ id: 'm', themeId: 't' }], themes: [{ id: 't', extensions: { pptxFontScheme: fonts } }] };
  expect(themeForSlide(d, { extensions: { stagecraftAuthored: true } }).fonts).toEqual(fonts);
  const o = object(); o.text.paragraphs[0].runs[0].style.typeface='Arial';o.text.paragraphs[0].runs[0].text='漢字';
  expect(canonicalTextBody(o,{fonts:{major:fonts.major}})).toBeNull();
  expect(canonicalTextBody(o,{fonts:{minor:{latin:'',supplemental:{}}}})).toBeNull();
  expect(canonicalTextBody(object(),{fonts,metricsSupported:false})).toBeNull();
});
it('resolves inheritance on a slide created by the real core addSlide command', async () => {
  const { createEditor } = await import('@stagecraft/core/editor');
  const { createDocument, documentPlugin, presentationPlugin, validateDocument } = await import('@stagecraft/core/document');
  const d = createDocument();
  d.layouts=[{id:'l',masterId:'m'}]; d.masters=[{id:'m',themeId:'t'}]; d.themes=[{id:'t',extensions:{pptxFontScheme:fonts}}];
  const editor=createEditor({document:d,validateDocument,plugins:[documentPlugin,presentationPlugin]});
  try {
    editor.dispatch('presentation.addSlide',{slideId:'new'});
    const snapshot=editor.getSnapshot().document,slide=snapshot.slides.find(s=>s.id==='new');
    expect(slide.layoutId).toBeUndefined();
    expect(canonicalTextBody(object(),themeForSlide(snapshot,slide)).body.paragraphs[0].runs[0].fontFamily).toBe('+mn-lt');
  } finally {editor.dispose();}
});
