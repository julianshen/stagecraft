import { describe, it, expect } from 'vitest';
import { normalizeElement, normalizeSlide, normalizeDeck } from './normalizeDeck.js';

describe('normalizeElement', () => {
  it('moves a legacy text element\'s ink from `fill` to `color`', () => {
    const el = { id: 't', type: 'text', content: 'Hi', fill: '#112233', x: 0, y: 0, w: 1, h: 1 };
    expect(normalizeElement(el)).toEqual({ id: 't', type: 'text', content: 'Hi', color: '#112233', x: 0, y: 0, w: 1, h: 1 });
  });

  it('leaves an already-migrated text element alone (same object)', () => {
    const el = { id: 't', type: 'text', content: 'Hi', color: '#112233' };
    expect(normalizeElement(el)).toBe(el);
  });

  it('does not move `fill` when `color` is already set (fill is then the box fill)', () => {
    const el = { id: 't', type: 'text', content: 'Hi', color: '#000000', fill: '#ffffff' };
    expect(normalizeElement(el)).toBe(el);
  });

  it('leaves shapes, images and non-objects alone', () => {
    const rect = { id: 'r', type: 'rect', fill: '#4f46e5' };
    expect(normalizeElement(rect)).toBe(rect);
    expect(normalizeElement(null)).toBe(null);
    expect(normalizeElement('x')).toBe('x');
  });
});

describe('normalizeSlide', () => {
  it('returns the same slide when nothing needs migrating', () => {
    const slide = { id: 's', layout: 'blank', elements: [{ id: 'r', type: 'rect', fill: '#000000' }] };
    expect(normalizeSlide(slide)).toBe(slide);
    const bare = { id: 's', layout: 'cover' };
    expect(normalizeSlide(bare)).toBe(bare);
  });

  it('migrates its text elements into a new slide', () => {
    const slide = { id: 's', layout: 'blank', elements: [{ id: 'r', type: 'rect', fill: '#000000' }, { id: 't', type: 'text', content: 'x', fill: '#ff0000' }] };
    const out = normalizeSlide(slide);
    expect(out).not.toBe(slide);
    expect(out.elements[0]).toBe(slide.elements[0]);
    expect(out.elements[1]).toEqual({ id: 't', type: 'text', content: 'x', color: '#ff0000' });
    expect(slide.elements[1].fill).toBe('#ff0000'); // input not mutated
  });

  it('tolerates a malformed slide or elements list', () => {
    expect(normalizeSlide(null)).toBe(null);
    const odd = { id: 's', elements: 'nope' };
    expect(normalizeSlide(odd)).toBe(odd);
  });
});

describe('normalizeDeck', () => {
  it('returns the same deck when nothing needs migrating', () => {
    const deck = { title: 'D', sections: [], slides: [{ id: 's', layout: 'cover' }] };
    expect(normalizeDeck(deck)).toBe(deck);
  });

  it('migrates every slide that needs it, keeping the rest', () => {
    const keep = { id: 'a', layout: 'cover' };
    const legacy = { id: 'b', layout: 'blank', elements: [{ id: 't', type: 'text', content: 'x', fill: '#ff0000' }] };
    const deck = { title: 'D', sections: [], slides: [keep, legacy] };
    const out = normalizeDeck(deck);
    expect(out).not.toBe(deck);
    expect(out.slides[0]).toBe(keep);
    expect(out.slides[1].elements[0].color).toBe('#ff0000');
    expect(out.title).toBe('D');
  });

  it('tolerates a missing deck or slides list', () => {
    expect(normalizeDeck(null)).toBe(null);
    const d = { title: 'x' };
    expect(normalizeDeck(d)).toBe(d);
  });
});
