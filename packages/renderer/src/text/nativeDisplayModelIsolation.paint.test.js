import { it, expect } from 'vitest';
import { measureShrinkFits } from './measureShrinkFits.js';
import { measureResizeFits } from './measureResizeFits.js';
import { canonicalTextBody } from './canonicalTextBody.js';

const pt = value => value * 12700;
function object(autofit) {
  return {
    id: 'box', type: 'text',
    geometry: { x: 0, y: 0, width: pt(210), height: pt(75) },
    bodyLayout: { autofit, anchor: 'bottom', insets: { top: pt(6), bottom: pt(3), left: pt(12), right: pt(9) } },
    text: { paragraphs: [{
      style: { lineSpacing: 150, spaceBefore: 7, spaceAfter: 11 },
      runs: [{ text: 'Long native PowerPoint text for fit measurement. '.repeat(5), style: { typeface: 'Arial', sz: '1800' } }],
    }] },
  };
}
function documentFor(value) { return { extensions: { sourceFormat: 'pptx' }, slides: [{ id: 's', objects: [value] }] }; }
function authoredEquivalent(value) {
  const copy = structuredClone(value);
  delete copy.source;
  copy.extensions = { stagecraftAuthored: true };
  return copy;
}
function nativeBaseline(value) {
  const original = structuredClone(value);
  original.text.paragraphs[0].runs[0].text = 'Original native text';
  return documentFor(original);
}

it.each(['shrink', 'resize'])('keeps export %s fit measurements on the existing canonical text model for PPTX bodies', async autofit => {
  await document.fonts.ready;
  const native = object(autofit);
  native.source = { format: 'pptx', part: 'ppt/slides/slide1.xml', path: [0] };
  native.extensions = { editableGeometry: true, pptxTextMetrics: { supported: true } };
  const authored = authoredEquivalent(native);
  const nativeDocument = documentFor(native);
  const baseline = nativeBaseline(native);

  if (autofit === 'shrink') {
    const nativeFit = measureShrinkFits(nativeDocument, { fonts: document.fonts, baseline }).fit;
    const authoredFit = measureShrinkFits(documentFor(authored), { fonts: document.fonts, baseline }).fit;
    expect(nativeFit).toEqual(authoredFit);
  } else {
    const nativeFit = measureResizeFits(nativeDocument, { fonts: document.fonts, baseline }).resize;
    const authoredFit = measureResizeFits(documentFor(authored), { fonts: document.fonts, baseline }).resize;
    expect(nativeFit).toEqual(authoredFit);
  }
  expect(canonicalTextBody(native).body.powerPoint).toBeUndefined();
});
