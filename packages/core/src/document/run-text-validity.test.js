import { expect, it } from 'vitest';
import { createDocument, documentPlugin, presentationPlugin, validateDocument } from './index.js';
import { createEditor } from '../editor/index.js';

function fixture(format) {
  const run = { id: 'r', text: 'Original', editable: true, style: {} };
  if (format === 'authored') run.extensions = { stagecraftAuthored: true };
  else run.source = { format, part: format === 'pptx' ? 'ppt/slides/slide1.xml' : 'content.xml', path: [0] };
  return createDocument({ slides: [{ id: 's', objects: [{ id: 't', type: 'text', text: { paragraphs: [{ id: 'p', runs: [run] }] } }] }] });
}
const invalid = ['\0', '\u000b', '\u001f', '\ud800', '\udfff', '\ufffe', '\uffff', 'a\ud800b'];

it.each(['authored', 'pptx', 'odp'])('rejects XML-invalid %s run text before committing or adding undo history', format => {
  const editor = createEditor({ document: fixture(format), validateDocument, plugins: [documentPlugin] });
  try {
    const command = documentPlugin.commands.find(c => c.id === 'document.setRunText');
    const before = editor.getSnapshot();
    for (const text of invalid) {
      expect(command.validate({ runId: 'r', text })).toBe(false);
      expect(() => editor.dispatch(command.id, { runId: 'r', text })).toThrow();
      expect(editor.getSnapshot()).toBe(before);
      expect(editor.getSnapshot().canUndo).toBe(false);
    }
  } finally { editor.dispose(); }
});

it.each(['authored', 'pptx', 'odp'])('preserves XML-valid %s whitespace, supplementary characters and boundaries', format => {
  const editor = createEditor({ document: fixture(format), validateDocument, plugins: [documentPlugin] });
  try {
    const text = '\tLine\nNext\r\u007f\ud7ff\ue000\ufffd😀\u{10ffff}';
    const command = documentPlugin.commands.find(c => c.id === 'document.setRunText');
    expect(command.validate({ runId: 'r', text })).toBe(true);
    editor.dispatch(command.id, { runId: 'r', text });
    expect(editor.getSnapshot().document.slides[0].objects[0].text.paragraphs[0].runs[0].text).toBe(text);
    editor.undo();
    expect(editor.getSnapshot().document).toEqual(fixture(format));
  } finally { editor.dispose(); }
});

const authoredText = text => ({ paragraphs: [{ id: 'new-p', runs: [{ id: 'new-r', text, editable: true, style: {}, extensions: { stagecraftAuthored: true } }] }] });
const authoredObject = (id, text) => ({ id, type: 'text', geometry: { x: 0, y: 0, width: 10000, height: 10000 }, extensions: { stagecraftAuthored: true }, text: authoredText(text) });

it.each(['addObject', 'setText', 'setTableCell'])('atomically rejects XML-invalid authored text in presentation.%s', method => {
  const target = method === 'setTableCell'
    ? { id: 't', type: 'table', geometry: { x: 0, y: 0, width: 10000, height: 10000 }, extensions: { stagecraftAuthored: true }, table: {
      columns: [{ id: 'col', width: 10000 }], rows: [{ id: 'row', cells: [{ id: 'cell', text: authoredText('Original') }] }],
    } }
    : authoredObject('t', 'Original');
  const editor = createEditor({ document: createDocument({ slides: [{ id: 's', objects: method === 'addObject' ? [] : [target] }] }), validateDocument, plugins: [presentationPlugin] });
  try {
    const payload = text => method === 'addObject' ? { slideId: 's', object: authoredObject('new-t', text) }
      : { slideId: 's', objectId: 't', ...(method === 'setTableCell' ? { cellId: 'cell' } : {}), text: authoredText(text) };
    const before = editor.getSnapshot();
    for (const text of invalid) {
      expect(() => editor.dispatch(`presentation.${method}`, payload(text))).toThrow();
      expect(editor.getSnapshot()).toBe(before);
      expect(editor.getSnapshot().canUndo).toBe(false);
    }
    expect(() => editor.dispatch(`presentation.${method}`, payload('Valid\ttext\n😀\u007f'))).not.toThrow();
  } finally { editor.dispose(); }
});

it('retains stricter DEL rejection for bullet characters and font-family metadata', () => {
  const paragraph = documentPlugin.commands.find(c => c.id === 'document.setParagraphFormat');
  const run = documentPlugin.commands.find(c => c.id === 'document.setRunFormat');
  expect(paragraph.validate({ paragraphId: 'p', format: { bullet: { type: 'char', char: '\u007f' } } })).toBe(false);
  expect(run.validate({ runId: 'r', format: { fontFamily: 'Font\u007f' } })).toBe(false);
});
