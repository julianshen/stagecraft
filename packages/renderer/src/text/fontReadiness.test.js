import { describe, expect, it } from 'vitest';
import {
  FONT_AVAILABILITY_PROBE,
  createFontAvailability,
  fontFamiliesFor,
  waitForCanonicalFonts,
} from '../index.js';

function fakeFonts({ check = true, loaded = [] } = {}) {
  const listeners = new Map();
  return {
    check: () => check,
    load: async () => loaded,
    ready: Promise.resolve(),
    status: 'loaded',
    addEventListener(type, fn) {
      const list = listeners.get(type) ?? new Set();
      list.add(fn);
      listeners.set(type, list);
    },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
    emit(type) { for (const fn of listeners.get(type) ?? []) fn({ type }); },
  };
}

function fakeCanvas(widthFor, calls) {
  return {
    getContext() {
      return {
        font: '',
        measureText(text) {
          calls.push({ font: this.font, text });
          return { width: widthFor(this.font, text) };
        },
      };
    },
  };
}

describe('font face availability probe', () => {
  it('does not trust fonts.check when the measured face matches both fallbacks', () => {
    const calls = [];
    const fonts = fakeFonts({ check: true });
    const availability = createFontAvailability({
      fonts,
      canvas: fakeCanvas(font => font.includes('Calibri') ? 140 : 100, calls),
    });

    expect(availability.isAvailable('normal 16px "Calibri"', 'Hello')).toBe(true);
    expect(fonts.check('normal 16px "Missing"', 'Hello')).toBe(true);
    expect(availability.isAvailable('normal 16px "Missing"', 'Hello')).toBe(false);
  });

  it('treats a face as available when it differs from either of two fallbacks', () => {
    const calls = [];
    const availability = createFontAvailability({
      fonts: fakeFonts(),
      canvas: fakeCanvas(font => font.includes('monospace') ? 100 : font.includes('serif') ? 120 : 100, calls),
    });
    expect(availability.isAvailable('normal 16px "Mock"', 'Hello')).toBe(true);
  });

  it('measures the run text plus a fixed metric-sensitive sample', () => {
    const calls = [];
    const availability = createFontAvailability({
      fonts: fakeFonts(),
      canvas: fakeCanvas(font => font.includes('Calibri') ? 140 : 100, calls),
    });
    availability.isAvailable('italic bold 16px "Calibri"', 'Hi ');
    const target = calls.find(call => call.font.includes('Calibri'));
    expect(target.text).toContain('Hi');
    expect(target.text).toContain(FONT_AVAILABILITY_PROBE);
  });

  it('memoizes per family/style and invalidates on loadingdone', () => {
    const calls = [];
    const fonts = fakeFonts();
    const availability = createFontAvailability({
      fonts,
      canvas: fakeCanvas(font => font.includes('Calibri') ? 140 : 100, calls),
    });
    availability.isAvailable('normal 16px "Calibri"', 'one');
    const first = calls.length;
    availability.isAvailable('normal 16px "Calibri"', 'two');
    expect(calls).toHaveLength(first);
    fonts.emit('loadingdone');
    availability.isAvailable('normal 16px "Calibri"', 'two');
    expect(calls.length).toBeGreaterThan(first);
  });

  it('refuses canonical font readiness when the real face is unavailable', async () => {
    const fonts = fakeFonts({ check: true });
    const canvas = fakeCanvas(() => 100, []);
    const scene = { nodes: [{ paint: { text: { body: { paragraphs: [{ runs: [{ text: 'Hi', fontSizePt: 18, fontFamily: 'Missing' }] }] } } } }] };
    const result = await waitForCanonicalFonts(scene, { fonts, canvas });
    expect(result).toEqual({ status: 'skipped', reason: 'fonts-unavailable' });
  });
});

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
