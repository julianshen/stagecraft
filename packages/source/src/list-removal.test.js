import { expect, it } from 'vitest';
import JSZip from 'jszip';
import { writeOdp } from '@stagecraft/odp';
import { writePptx } from '@stagecraft/pptx';
import { openPresentation } from './index.js';
import { all, NS } from './xml.js';
import { createEditor } from '@stagecraft/core/editor';
import { documentPlugin, presentationPlugin, validateDocument } from '@stagecraft/core/document';

const parse = text => new DOMParser().parseFromString(text, 'application/xml');

/** Explicitly authored text object (authoring.test.js pattern); stays in-session, never reopened before editing. */
const authoredText = () => ({
  id: 'authored', type: 'text', geometry: { x: 12700, y: 25400, width: 1270000, height: 254000 },
  extensions: { stagecraftAuthored: true },
  text: { paragraphs: [{ id: 'authored-p', runs: [{ id: 'authored-r', text: 'Levelled', editable: true, style: {}, extensions: { stagecraftAuthored: true } }] }] },
});

/** Open an empty deck, add the authored text object, give its paragraph a level-1 bullet; no reopen before editing. */
async function authoredList(format) {
  const bytes = await (format === 'pptx' ? writePptx : writeOdp)({ title: 'Deck', sections: [{ id: 'sec', name: 'Section', slides: ['s'] }], slides: [{ id: 's', layout: 'blank', elements: [] }] });
  const session = await openPresentation(bytes, { format });
  const editor = createEditor({ document: session.document, validateDocument, plugins: [documentPlugin, presentationPlugin] });
  try {
    editor.dispatch('presentation.addObject', { slideId: session.document.slides[0].id, object: authoredText() });
    editor.dispatch('document.setParagraphFormat', { paragraphId: 'authored-p', format: { bullet: { type: 'char', char: '•' }, level: 1 } });
    const paragraph = editor.getSnapshot().document.slides[0].objects[0].text.paragraphs[0];
    expect(paragraph.style).toMatchObject({ level: 1, bullet: { type: 'char', char: '•' } });
    return { session, editor, paragraphId: 'authored-p' };
  } catch (error) { editor.dispose(); session.dispose(); throw error; }
}

const contentXml = async bytes => parse(await (await JSZip.loadAsync(bytes)).file('content.xml').async('string'));

it.each([
  ['bullet: null', { bullet: null }],
  ['bullet: none', { bullet: { type: 'none' } }],
])('rejects %s leaving a non-list level on an authored ODP list paragraph atomically', async (_name, format) => {
  const { session, editor, paragraphId } = await authoredList('odp');
  try {
    const before = editor.getSnapshot();
    expect(() => editor.dispatch('document.setParagraphFormat', { paragraphId, format })).toThrow('UNSUPPORTED_EDIT');
    const after = editor.getSnapshot();
    expect(after.revision).toBe(before.revision);
    expect(after.canUndo).toBe(before.canUndo);
    expect(after.document).toEqual(before.document);
    // Paragraph level 1 nests two text:list elements (zero-based depth).
    const doc = await contentXml((await session.export(after.document)).bytes);
    expect(all(doc, 'text', 'list')).toHaveLength(2);
    expect(all(doc, 'text', 'list-level-style-bullet')[0].getAttributeNS(NS.text, 'bullet-char')).toBe('•');
  } finally { editor.dispose(); session.dispose(); }
});

it.each([
  ['bullet: null + level: null', { bullet: null, level: null }],
  ['bullet: null + level: 0', { bullet: null, level: 0 }],
  ['bullet: none + level: null', { bullet: { type: 'none' }, level: null }],
])('removes the bullet and clears the level in one command (%s) on an authored ODP list paragraph', async (_name, format) => {
  const { session, editor, paragraphId } = await authoredList('odp');
  try {
    editor.dispatch('document.setParagraphFormat', { paragraphId, format });
    expect(editor.getSnapshot().revision).toBe(3);
    const removedDoc = await contentXml((await session.export(editor.getSnapshot().document)).bytes);
    expect(all(removedDoc, 'text', 'list')).toHaveLength(0);
    const removed = await session.export(editor.getSnapshot().document);
    const reopened = await openPresentation(removed.bytes, { format: 'odp' });
    try {
      const style = reopened.document.slides[0].objects[0].text.paragraphs[0].style;
      expect(style.bullet).toBeUndefined();
      expect(style.level).toBeUndefined();
    } finally { reopened.dispose(); }
    editor.undo();
    const undoneDoc = await contentXml((await session.export(editor.getSnapshot().document)).bytes);
    expect(all(undoneDoc, 'text', 'list')).toHaveLength(2);
    expect(all(undoneDoc, 'text', 'list-level-style-bullet')[0].getAttributeNS(NS.text, 'bullet-char')).toBe('•');
  } finally { editor.dispose(); session.dispose(); }
});

it('preserves PPTX bullet-only removal while retaining the level', async () => {
  const { session, editor, paragraphId } = await authoredList('pptx');
  try {
    editor.dispatch('document.setParagraphFormat', { paragraphId, format: { bullet: null } });
    const result = await session.export(editor.getSnapshot().document);
    const reopened = await openPresentation(result.bytes, { format: 'pptx' });
    try {
      const style = reopened.document.slides[0].objects[0].text.paragraphs[0].style;
      expect(style.bullet).toBeUndefined();
      expect(style.level).toBe(1);
    } finally { reopened.dispose(); }
  } finally { editor.dispose(); session.dispose(); }
});
