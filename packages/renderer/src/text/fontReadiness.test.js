import { describe, expect, it } from 'vitest';
import { fontFamiliesFor } from '../index.js';

describe('fontFamiliesFor', () => {
  const theme = {
    fonts: {
      major: { latin: 'Calibri', eastAsian: 'Yu Gothic', complexScript: 'Tahoma', supplemental: {} },
      minor: { latin: 'Arial', eastAsian: 'Noto Sans JP', complexScript: 'Amiri', supplemental: {} },
    },
  };

  it('preserves comma-containing family names without splitting and includes fallbacks', () => {
    const families = fontFamiliesFor([{
      body: {
        paragraphs: [{
          runs: [{ text: 'Hello', fontSizePt: 18, fontFamily: 'Foo, Bar' }],
        }],
      },
      theme,
    }]);

    expect(families.has('Foo, Bar')).toBe(true);
    expect(families.has('Foo')).toBe(false);
    expect(families.has('Bar')).toBe(false);
    expect(families.has('Inter')).toBe(true);
  });

  it('resolves EA, CS, theme aliases, and metric-compatible substitutes', () => {
    const families = fontFamiliesFor([{
      body: {
        paragraphs: [{
          runs: [{
            text: 'A漢ع',
            fontSizePt: 18,
            fontFamily: '+mj-lt',
            fontFamilyEastAsia: '+mn-ea',
            fontFamilyComplexScript: 'Cairo',
          }],
        }],
      },
      theme,
    }]);

    expect(families.has('Calibri')).toBe(true);
    expect(families.has('Carlito')).toBe(true);
    expect(families.has('Noto Sans JP')).toBe(true);
    expect(families.has('Cairo')).toBe(true);
    expect(families.has('Inter')).toBe(true);
  });
});
