import { describe, it, expect } from 'vitest';
import { createEditor } from '../editor/index.js';
import { createDocument, validateDocument, documentPlugin, presentationPlugin, migrateLegacyDeck, toLegacyDeck } from './index.js';

const table = id => ({
  id, type: 'table', geometry: { x: 0, y: 0, width: 100, height: 100 }, extensions: { stagecraftAuthored: true },
  table: {
    columns: [{ id: `${id}-column`, width: 100 }],
    rows: [{ id: `${id}-row`, cells: [{ id: `${id}-cell`, text: { paragraphs: [{
      id: `${id}-paragraph`, runs: [{ id: `${id}-run`, text: 'Text', editable: true, style: {}, extensions: { stagecraftAuthored: true } }],
    }] } }] }],
  },
});
const cell = object => object.table.rows[0].cells[0];
const nodes = object => [object.table.columns[0], object.table.rows[0], cell(object), cell(object).text.paragraphs[0], cell(object).text.paragraphs[0].runs[0]];

describe('global table identities', () => {
  it.each([0, 1, 2, 3, 4])('rejects collisions in table entity %i atomically', index => {
    const editor = createEditor({ document: createDocument({ slides: [{ id: 's', objects: [table('first')] }] }), plugins: [presentationPlugin, documentPlugin] });
    const next = table('second');
    nodes(next)[index].id = nodes(table('first'))[index].id;
    const before = editor.getSnapshot();
    expect(() => editor.dispatch('presentation.addObject', { slideId: 's', object: next })).toThrowError(expect.objectContaining({ code: 'DUPLICATE_ID' }));
    expect(editor.getSnapshot()).toBe(before);
  });

  it('rejects a table paragraph colliding with an entity outside the table', () => {
    const object = table('table');
    cell(object).text.paragraphs[0].id = 'document';
    expect(() => createDocument({ slides: [{ id: 's', objects: [object] }] })).toThrowError(expect.objectContaining({ code: 'DUPLICATE_ID' }));
  });

  it('keeps opaque table properties and native values outside authoring limits', () => {
    const object = table('native');
    delete object.extensions;
    object.table.columns[0].width = 0;
    object.table.unknown = { id: 'document', arbitrary: true };
    const paragraph = cell(object).text.paragraphs[0];
    paragraph.style = { opaqueNativeProperty: 'preserved' };
    paragraph.runs[0].text = 'x'.repeat(25000);
    paragraph.runs[0].editable = false;
    const doc = createDocument({ slides: [{ id: 's', objects: [object] }] });
    expect(validateDocument(doc)).toBe(true);
    expect(doc.slides[0].objects[0]).toEqual(object);
    expect(validateDocument(createDocument({ slides: [{ id: 's', objects: [{ id: 'opaque', type: 'opaque', table: { unknown: { id: 'document' } } }] }] }))).toBe(true);
  });
});

describe('legacy section migration', () => {
  const slides = ['a', 'b', 'unused'].map(id => ({ id, title: id, layout: 'blank', sectionName: 'opaque-original-field' }));
  it('uses section order and omits unreferenced slides from the canonical view', () => {
    const deck = { slides, sections: [{ id: 'section', name: 'Section', slides: ['b', 'missing', 'a'] }] };
    const { document } = migrateLegacyDeck(deck);
    expect(document.slides.map(slide => slide.name)).toEqual(['b', 'a']);
    expect(document.slides[0].extensions.legacy).toEqual(slides[1]);
    expect(toLegacyDeck(document).deck).toEqual(deck);
  });
  it('keeps the existing pool fallback only when sections are absent', () => {
    expect(migrateLegacyDeck({ slides }).document.slides.map(slide => slide.name)).toEqual(['a', 'b', 'unused']);
    expect(migrateLegacyDeck({ slides, sections: [] }).document.slides).toEqual([]);
  });
});

it('advertises every accepted direct run typography property in its command schema', () => {
  const editor = createEditor({ document: createDocument(), plugins: [documentPlugin] });
  const command = editor.getCommands().find(command => command.id === 'document.setRunFormat');
  const properties = command.inputSchema.properties.format.properties;
  expect(properties.fontFamily).toEqual({ type: ['string', 'null'], minLength: 1, maxLength: 64 });
  expect(properties.color).toEqual({ type: ['string', 'null'], pattern: '^#[0-9a-fA-F]{6}$' });
  expect(documentPlugin.commands.find(command => command.id === 'document.setRunFormat').validate({ runId: 'r', format: { fontFamily: 'Arial', color: '#abcdef' } })).toBe(true);
});
