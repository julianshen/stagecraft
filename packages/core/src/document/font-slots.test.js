import { createDocument, documentPlugin, validateDocument, validateAuthoredObject } from './index.js';
import { createEditor } from '../editor/index.js';
const authored = { stagecraftAuthored: true };
const fixture = () => createDocument({ slides: [{ id: 's', objects: [{ id: 'o', type: 'text', geometry: { x: 0, y: 0, width: 100, height: 100 }, extensions: authored, text: { paragraphs: [{ id: 'p', runs: [{ id: 'r', text: 'A漢😀بZ', editable: true, style: { typeface: 'Arial' }, extensions: authored }] }] } }] }] });
const runs = e => e.getSnapshot().document.slides[0].objects[0].text.paragraphs[0].runs;
it('sets and resets independent script slots with undo, redo and no-op preservation', () => {
  const e = createEditor({ document: fixture(), validateDocument, plugins: [documentPlugin] });
  try {
    e.dispatch('document.setRunFormat', { runId: 'r', format: { eastAsian: '+mj-ea', complexScript: 'Arial' } });
    expect(runs(e)[0].style).toEqual({ typeface: 'Arial', eastAsian: '+mj-ea', complexScript: 'Arial' });
    const set = e.getSnapshot();
    e.dispatch('document.setRunFormat', { runId: 'r', format: { eastAsian: '+mj-ea' } });
    expect(e.getSnapshot()).toBe(set);
    e.dispatch('document.setRunFormat', { runId: 'r', format: { eastAsian: null } });
    expect(runs(e)[0].style).toEqual({ typeface: 'Arial', complexScript: 'Arial' });
    e.undo(); expect(e.getSnapshot().document).toEqual(set.document);
    e.redo(); expect(runs(e)[0].style.eastAsian).toBeUndefined();
    expect(validateAuthoredObject(e.getSnapshot().document.slides[0].objects[0])).toBe(true);
  } finally { e.dispose(); }
});
it('splits a code-point range without leaking script styles and does not split an equal-value range', () => {
  const e = createEditor({ document: fixture(), validateDocument, plugins: [documentPlugin] });
  try {
    e.dispatch('document.setRunRangeFormat', { objectId: 'o', range: { start: { paragraphId: 'p', runId: 'r', offset: 1 }, end: { paragraphId: 'p', runId: 'r', offset: 4 } }, format: { eastAsian: 'CJK', complexScript: 'Arabic' } });
    expect(runs(e).map(r => [r.text, r.style.eastAsian, r.style.complexScript])).toEqual([['A', undefined, undefined], ['漢😀ب', 'CJK', 'Arabic'], ['Z', undefined, undefined]]);
    const before = e.getSnapshot(), middle = runs(e)[1];
    e.dispatch('document.setRunRangeFormat', { objectId: 'o', range: { start: { paragraphId: 'p', runId: middle.id, offset: 1 }, end: { paragraphId: 'p', runId: middle.id, offset: 2 } }, format: { eastAsian: 'CJK' } });
    expect(e.getSnapshot()).toBe(before);
  } finally { e.dispose(); }
});
it.each(['eastAsian', 'complexScript'])('rejects invalid %s atomically', key => {
  const e = createEditor({ document: fixture(), validateDocument, plugins: [documentPlugin] });
  try {
    for (const value of ['', ' x', 'x'.repeat(65), '\ud800', '\n', true, 3, {}]) {
      const before = e.getSnapshot();
      expect(() => e.dispatch('document.setRunFormat', { runId: 'r', format: { [key]: value } })).toThrow('INVALID_PAYLOAD');
      expect(e.getSnapshot()).toBe(before);
    }
  } finally { e.dispose(); }
});
it('guards font slots with the existing authorization and revision checks', () => {
  let allowed = false;
  const e = createEditor({ document: fixture(), validateDocument, plugins: [documentPlugin], authorize: () => allowed });
  try {
    const initial = e.getSnapshot(), payload = { runId: 'r', format: { eastAsian: 'CJK', complexScript: 'Arabic' } };
    expect(() => e.dispatch('document.setRunFormat', payload)).toThrow('UNAUTHORIZED');
    expect(e.getSnapshot()).toBe(initial);
    allowed = true;
    expect(() => e.dispatch('document.setRunFormat', payload, { expectedRevision: 99 })).toThrow('STALE_REVISION');
    expect(e.getSnapshot()).toBe(initial);
    e.dispatch('document.setRunFormat', payload, { expectedRevision: initial.revision });
    expect(runs(e)[0].style).toMatchObject({ eastAsian: 'CJK', complexScript: 'Arabic' });
  } finally { e.dispose(); }
});
it('advertises both script slots for run and range commands', () => {
  for (const id of ['document.setRunFormat', 'document.setRunRangeFormat']) {
    const command = documentPlugin.commands.find(c => c.id === id);
    for (const key of ['eastAsian', 'complexScript']) expect(command.inputSchema.properties.format.properties[key]).toEqual({ type: ['string', 'null'], minLength: 1, maxLength: 64 });
  }
});
