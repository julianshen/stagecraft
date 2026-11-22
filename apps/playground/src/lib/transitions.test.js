import { describe, it, expect } from 'vitest';
import { transitionAnim } from './transitions.js';

describe('transitionAnim', () => {
  it('maps a playable transition to its CSS animation shorthand', () => {
    expect(transitionAnim({ type: 'fade', duration: 480 })).toBe('present-fade 480ms ease both');
    expect(transitionAnim({ type: 'slide', duration: 300 })).toBe('present-slide 300ms ease both');
    expect(transitionAnim({ type: 'morph', duration: 600 })).toBe('present-morph 600ms ease both');
  });

  it('returns "" for none / missing / malformed (an instant cut)', () => {
    expect(transitionAnim({ type: 'none', duration: 480 })).toBe(''); // 'none' is an instant cut
    expect(transitionAnim(undefined)).toBe('');
    expect(transitionAnim(null)).toBe('');
    expect(transitionAnim({ type: 'fade' })).toBe('');               // no duration
    expect(transitionAnim({ type: 'fade', duration: 0 })).toBe('');  // non-positive
    expect(transitionAnim({ type: 'fade', duration: -5 })).toBe('');
    expect(transitionAnim({ type: 'warp', duration: 480 })).toBe(''); // unknown type
  });
});
