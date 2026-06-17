import { describe, it, expect } from 'vitest';
import { isTextEntryTarget, isTextEditingTarget } from './domEvents.js';

// Minimal element stand-ins (the helpers read tagName / isContentEditable / type).
const el = (tagName, isContentEditable = false) => ({ tagName, isContentEditable });
const input = (type) => ({ tagName: 'INPUT', type });

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

// isTextEditingTarget is narrower: it only matches contexts with their OWN
// native text undo/redo (so a global ⌘Z should defer). Unlike isTextEntryTarget
// it lets undo through on dropdowns / checkboxes / sliders.
describe('isTextEditingTarget', () => {
  it('is true for a <textarea> and contentEditable', () => {
    expect(isTextEditingTarget(el('TEXTAREA'))).toBe(true);
    expect(isTextEditingTarget(el('DIV', true))).toBe(true);
  });

  it.each(['text', 'search', 'email', 'url', 'tel', 'password', 'number'])(
    'is true for a text-like <input type=%s>', (type) => {
      expect(isTextEditingTarget(input(type))).toBe(true);
    });

  it('is true for an <input> with no explicit type (defaults to text)', () => {
    expect(isTextEditingTarget({ tagName: 'INPUT' })).toBe(true);
  });

  it.each(['checkbox', 'radio', 'range', 'button', 'file', 'color', 'submit', 'reset'])(
    'is false for a non-text <input type=%s>', (type) => {
      expect(isTextEditingTarget(input(type))).toBe(false);
    });

  it('is false for a <select> (no native text undo — global undo should win)', () => {
    expect(isTextEditingTarget(el('SELECT'))).toBe(false);
  });

  it('is false for a plain element and for null', () => {
    expect(isTextEditingTarget(el('DIV'))).toBe(false);
    expect(isTextEditingTarget(null)).toBe(false);
  });
});
