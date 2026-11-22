import { expect, it } from 'vitest';
import { createDocument, documentPlugin, validateDocument } from './index.js';
import { createEditor } from '../editor/index.js';

const fixture = () => createDocument({ id: 'r~1', slides: [{ id: 's', objects: [{
  id: 'text', type: 'text', extensions: { stagecraftAuthored: true },
  bodyLayout: { autofit: 'resize', wrap: 'square', anchor: 'middle', insets: { left: 12700 } },
  text: { paragraphs: [{ id: 'p', runs: [{ id: 'r', text: 'abc', editable: true, style: {}, extensions: { stagecraftAuthored: true } }] }] },
}] }] });

it('advertises JSON null resets that the text-body command accepts, excluding the string null', () => {
  const editor = createEditor({ document: fixture(), validateDocument, plugins: [documentPlugin] });
  try {
    const command = documentPlugin.commands.find(c => c.id === 'document.setTextBodyLayout');
    const exposed = editor.getCommands().find(c => c.id === command.id);
    const properties = exposed.inputSchema.properties.layout.properties;
    for (const key of ['autofit', 'wrap', 'anchor']) {
      expect(properties[key].enum).toContain(null);
      expect(properties[key].enum).not.toContain('null');
    }
    expect(properties.insets.type).toEqual(['object', 'null']);
    for (const key of ['autofit', 'wrap', 'anchor', 'insets']) {
      expect(command.validate({ objectId: 'text', layout: { [key]: null } })).toBe(true);
      expect(command.validate({ objectId: 'text', layout: { [key]: 'null' } })).toBe(false);
      editor.dispatch(command.id, { objectId: 'text', layout: { [key]: null } });
      expect(editor.getSnapshot().document.slides[0].objects[0].bodyLayout?.[key]).toBeUndefined();
    }
    expect(editor.getSnapshot().document.slides[0].objects[0].bodyLayout).toBeUndefined();
  } finally { editor.dispose(); }
});

it('reserves the document identity when choosing split-run ids', () => {
  const original = fixture();
  const editor = createEditor({ document: original, validateDocument, plugins: [documentPlugin] });
  try {
    editor.dispatch('document.setRunRangeFormat', {
      objectId: 'text',
      range: { start: { paragraphId: 'p', runId: 'r', offset: 1 }, end: { paragraphId: 'p', runId: 'r', offset: 2 } },
      format: { bold: true },
    });
    const result = editor.getSnapshot().document;
    const runs = result.slides[0].objects[0].text.paragraphs[0].runs;
    // End boundary splits first, reserving ~2; the start boundary then takes ~3.
    expect(runs.map(r => r.id)).toEqual(['r', 'r~3', 'r~2']);
    expect(runs.map(r => r.text)).toEqual(['a', 'b', 'c']);
    expect(runs.map(r => r.style.b)).toEqual([undefined, '1', undefined]);
    expect(result.id).toBe('r~1');
    expect(validateDocument(result)).toBe(true);
    editor.undo();
    expect(editor.getSnapshot().document).toEqual(original);
  } finally { editor.dispose(); }
});
