import { createEditor } from '../editor/index.js';
import { documentPlugin, presentationPlugin, validateDocument, validateAuthoredObject } from './index.js';
import { writePptx } from '@stagecraft/pptx';
import { writeOdp } from '@stagecraft/odp';
import { openPresentation } from '@stagecraft/source';

const range = (start, end) => ({ objectId: 'text', range: {
  start: { paragraphId: 'p', runId: 'r0', offset: start },
  end: { paragraphId: 'p', runId: 'r0', offset: end },
}, format: { bold: true } });

it.each(['pptx', 'odp'])('rejects run-limit overflow atomically while keeping %s exportable', async format => {
  const session = await openPresentation(await (format === 'pptx' ? writePptx : writeOdp)({ sections: [{ id: 'sec', slides: ['s'] }], slides: [{ id: 's', layout: 'blank', elements: [] }] }), { format });
  const editor = createEditor({ document: session.document, validateDocument, plugins: [documentPlugin, presentationPlugin] });
  try {
    const empty = editor.getSnapshot().document;
    editor.dispatch('presentation.addObject', { slideId: empty.slides[0].id, object: {
      id: 'text', type: 'text', geometry: { x: 0, y: 0, width: 914400, height: 914400 }, extensions: { stagecraftAuthored: true },
      text: { paragraphs: [{ id: 'p', runs: Array.from({ length: 200 }, (_, i) => ({ id: `r${i}`, text: 'abc', editable: true, style: {}, extensions: { stagecraftAuthored: true } })) }] },
    } });
    const before = editor.getSnapshot();
    expect(() => editor.dispatch('document.setRunRangeFormat', range(1, 2))).toThrow('INVALID_AUTHORED_SCHEMA');
    expect(editor.getSnapshot()).toBe(before);
    editor.undo();
    expect(editor.getSnapshot().document).toEqual(empty);
    editor.redo();
    expect(editor.getSnapshot().document).toEqual(before.document);
    await expect(session.export(editor.getSnapshot().document)).resolves.toHaveProperty('bytes');
    // A range aligned to existing run boundaries does not grow the paragraph.
    editor.dispatch('document.setRunRangeFormat', range(0, 3));
    const object = editor.getSnapshot().document.slides[0].objects[0];
    expect(object.text.paragraphs[0].runs).toHaveLength(200);
    expect(validateAuthoredObject(object)).toBe(true);
    await expect(session.export(editor.getSnapshot().document)).resolves.toHaveProperty('bytes');
    const formatted = editor.getSnapshot();
    editor.dispatch('document.setRunRangeFormat', range(1, 2));
    expect(editor.getSnapshot()).toBe(formatted); // interior no-op must not split
    editor.dispatch('document.setRunText', { runId: 'r0', text: 'x'.repeat(4000) });
    const full = editor.getSnapshot();
    expect(() => editor.dispatch('document.setRunText', { runId: 'r0', text: 'x'.repeat(4001) })).toThrow('INVALID_AUTHORED_SCHEMA');
    expect(editor.getSnapshot()).toBe(full);
    await expect(session.export(full.document)).resolves.toHaveProperty('bytes');
    editor.undo();
    expect(editor.getSnapshot().document).toEqual(formatted.document);
    const shorter = structuredClone(object.text);
    shorter.paragraphs[0].runs.length = 198;
    editor.dispatch('presentation.setText', { slideId: empty.slides[0].id, objectId: 'text', text: shorter });
    editor.dispatch('document.setRunRangeFormat', { ...range(1, 2), format: { bold: false } });
    expect(editor.getSnapshot().document.slides[0].objects[0].text.paragraphs[0].runs).toHaveLength(200);
    const output = await session.export(editor.getSnapshot().document);
    const native = await openPresentation(output.bytes, { format });
    const nativeEditor = createEditor({ document: native.document, validateDocument, plugins: [documentPlugin] });
    try {
      const run = native.document.slides[0].objects[0].text.paragraphs[0].runs.find(r => r.editable);
      nativeEditor.dispatch('document.setRunText', { runId: run.id, text: 'x'.repeat(4001) });
      await expect(native.export(nativeEditor.getSnapshot().document)).resolves.toHaveProperty('bytes');
    } finally { nativeEditor.dispose(); native.dispose(); }
  } finally { editor.dispose(); session.dispose(); }
});
