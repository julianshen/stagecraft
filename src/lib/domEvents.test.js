import { describe, it, expect } from 'vitest';
import { isTextEntryTarget } from './domEvents.js';

// Minimal element stand-ins (the helper only reads tagName + isContentEditable).
const el = (tagName, isContentEditable = false) => ({ tagName, isContentEditable });

describe('isTextEntryTarget', () => {
  it.each(['INPUT', 'TEXTAREA', 'SELECT'])('is true for a <%s>', (tag) => {
    expect(isTextEntryTarget(el(tag))).toBe(true);
  });

  it('is true for a contentEditable element', () => {
    expect(isTextEntryTarget(el('DIV', true))).toBe(true);
  });

  it('is false for a non-editable element', () => {
    expect(isTextEntryTarget(el('DIV'))).toBe(false);
    expect(isTextEntryTarget(el('BUTTON'))).toBe(false);
  });

  it('is false for a null/undefined target', () => {
    expect(isTextEntryTarget(null)).toBe(false);
    expect(isTextEntryTarget(undefined)).toBe(false);
  });
});
