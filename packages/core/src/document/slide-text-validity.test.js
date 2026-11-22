import { expect, it } from 'vitest';
import { createEditor } from '../editor/index.js';
import { presentationPlugin, validateDocument } from './index.js';
import { writePptx } from '@stagecraft/pptx';
import { writeOdp } from '@stagecraft/odp';
import { openPresentation } from '@stagecraft/source';

it.each(['pptx', 'odp'])('rejects invalid %s slide metadata atomically and exports valid Unicode', async format => {
  const source = await openPresentation(await (format === 'pptx' ? writePptx : writeOdp)({
    sections: [{ id: 'sec', slides: ['s'] }], slides: [{ id: 's', layout: 'blank', elements: [] }],
  }), { format });
  const editor = createEditor({ document: source.document, validateDocument, plugins: [presentationPlugin] });
  const command = presentationPlugin.commands.find(c => c.id === 'presentation.setSlideProperties');
  try {
    const before = editor.getSnapshot(), slideId = source.document.slides[0].id;
    for (const key of ['name', 'notes']) for (const text of ['\ud800', '\udfff', '\ufffe', '\uffff', '\0', '\u007f']) {
      const properties = { [key]: `Before${text}After` };
      expect(command.validate({ slideId, properties })).toBe(false);
      expect(() => editor.dispatch(command.id, { slideId, properties })).toThrow();
      expect(editor.getSnapshot()).toBe(before);
      expect(editor.getSnapshot().canUndo).toBe(false);
      const stored = structuredClone(source.document);
      stored.slides[0][key] = properties[key];
      expect(() => validateDocument(stored)).toThrow('INVALID_SLIDE_PROPERTY');
    }
    const properties = { name: 'Valid title 😀', notes: 'First\tline\nNext 😀\u{10ffff}' };
    expect(command.validate({ slideId, properties })).toBe(true);
    editor.dispatch(command.id, { slideId, properties });
    expect(editor.getSnapshot().document.slides[0]).toMatchObject(properties);
    const output = await source.export(editor.getSnapshot().document);
    const reopened = await openPresentation(output.bytes, { format });
    try { expect(reopened.document.slides[0]).toMatchObject(properties); }
    finally { reopened.dispose(); }
    editor.undo();
    expect((await source.export(editor.getSnapshot().document)).bytes).toEqual((await source.export(source.document)).bytes);
  } finally { editor.dispose(); source.dispose(); }
});
