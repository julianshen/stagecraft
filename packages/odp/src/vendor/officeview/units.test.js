import { describe, it, expect } from 'vitest';
import { lengthEmu } from './units.js';

describe('OfficeView ODF unit adaptation', () => {
  it.each(['1in', '2.54cm', '25.4mm', '72pt', '6pc', '96px', '96', '1IN'])('converts %s to one inch', value => {
    expect(lengthEmu(value)).toBeCloseTo(914400);
  });
  it('preserves numeric EMU, signs and strict syntax', () => {
    expect(lengthEmu(914400)).toBe(914400);
    expect(lengthEmu('-.5in')).toBe(-457200);
    for (const value of [undefined, null, NaN, Infinity, '1.2.3in', '100%', 'oops', '1e3in']) expect(lengthEmu(value)).toBeUndefined();
  });
});
