import { describe, expect, it } from 'vitest';
import { autofitHintEligibility } from './resizeGeometry.js';

const native = () => ({
  id: 'box',
  source: { format: 'pptx', part: 'ppt/slides/slide1.xml', path: [0] },
  geometry: { x: 0, y: 0, width: 100, height: 100 },
  bodyLayout: { autofit: 'shrink' },
  text: { paragraphs: [{ runs: [{ text: 'Native text' }] }] },
});
const authored = () => {
  const object = native();
  delete object.source;
  object.extensions = { stagecraftAuthored: true };
  return object;
};

describe('autofitHintEligibility', () => {
  it('allows authored objects without a retained original', () => {
    expect(autofitHintEligibility(authored(), undefined)).toBeNull();
  });

  it('leaves untouched native objects to PowerPoint', () => {
    const object = native();
    expect(autofitHintEligibility(object, structuredClone(object))).toBe('unchanged-native');
    expect(autofitHintEligibility(object, undefined)).toBe('unchanged-native');
  });

  it.each(['text', 'geometry', 'bodyLayout'])('allows a native object whose %s changed', field => {
    const object = native(), original = structuredClone(object);
    if (field === 'text') object.text.paragraphs[0].runs[0].text = 'Edited';
    if (field === 'geometry') object.geometry.width = 200;
    if (field === 'bodyLayout') object.bodyLayout.anchor = 'bottom';
    expect(autofitHintEligibility(object, original)).toBeNull();
  });

  it('uses JSON equality rather than object identity or key order', () => {
    const object = native(), original = structuredClone(object);
    object.bodyLayout = { autofit: 'shrink' };
    original.bodyLayout = { autofit: 'shrink' };
    expect(autofitHintEligibility(object, original)).toBe('unchanged-native');
  });

  it('does not treat fill-only native edits as autofit candidates', () => {
    const object = native(), original = structuredClone(object);
    object.fill = '#ffffff';
    expect(autofitHintEligibility(object, original)).toBe('unchanged-native');
  });

  it('treats run-style edits inside the canonical text object as text changes', () => {
    const object = native(), original = structuredClone(object);
    object.text.paragraphs[0].runs[0].style = { bold: true };
    expect(autofitHintEligibility(object, original)).toBeNull();
  });
});
