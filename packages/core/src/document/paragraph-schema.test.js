import { expect, it } from 'vitest';
import { createDocument, documentPlugin, presentationPlugin, validateAuthoredObject, validateDocument } from './index.js';
import { createEditor } from '../editor/index.js';

const style = {
  alignment: 'right', spaceBefore: 10, spaceAfter: 12, lineSpacing: 150,
  level: 2, indentStart: 12700, indentEnd: 25400, firstLineIndent: -12700,
  bullet: { type: 'char', char: '•' },
};
const object = () => ({
  id: 'text', type: 'text', geometry: { x: 0, y: 0, width: 10000, height: 10000 },
  extensions: { stagecraftAuthored: true },
  text: { paragraphs: [{ id: 'p', style: { ...style }, runs: [{
    id: 'r', text: 'Hello', editable: true, style: {}, extensions: { stagecraftAuthored: true },
  }] }] },
});

it('advertises null resets for every paragraph patch field while keeping stored styles strict', () => {
  const editor = createEditor({ document: createDocument({ slides: [{ id: 's', objects: [object()] }] }), validateDocument, plugins: [documentPlugin, presentationPlugin] });
  try {
    const exposed = editor.getCommands();
    const patch = exposed.find(c => c.id === 'document.setParagraphFormat').inputSchema.properties.format;
    const stored = exposed.find(c => c.id === 'presentation.addObject').inputSchema.properties.object.properties.text.properties.paragraphs.items.properties.style;
    const command = documentPlugin.commands.find(c => c.id === 'document.setParagraphFormat');
    expect(Object.keys(patch.properties).sort()).toEqual(Object.keys(style).sort());
    expect(patch.additionalProperties).toBe(false);
    expect(command.validate({ paragraphId: 'p', format: {} })).toBe(false);
    expect(command.validate({ paragraphId: 'p', format: { unknown: null } })).toBe(false);
    for (const key of Object.keys(style)) {
      // The patch accepts exactly the stored value schema or JSON null, including bullet unions.
      expect(patch.properties[key]).toEqual({ anyOf: [stored.properties[key], { type: 'null' }] });
      expect(command.validate({ paragraphId: 'p', format: { [key]: style[key] } })).toBe(true);
      expect(command.validate({ paragraphId: 'p', format: { [key]: null } })).toBe(true);
      expect(command.validate({ paragraphId: 'p', format: { [key]: 'null' } })).toBe(false);
      const invalidStored = object();
      invalidStored.text.paragraphs[0].style[key] = null;
      expect(() => validateAuthoredObject(invalidStored)).toThrow();
      editor.dispatch(command.id, { paragraphId: 'p', format: { [key]: null } });
      expect(editor.getSnapshot().document.slides[0].objects[0].text.paragraphs[0].style[key]).toBeUndefined();
    }
    expect(patch.minProperties).toBe(1);
    expect(editor.getSnapshot().document.slides[0].objects[0].text.paragraphs[0].style).toEqual({});
  } finally { editor.dispose(); }
});
