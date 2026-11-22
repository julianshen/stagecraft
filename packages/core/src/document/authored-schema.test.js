import { describe, expect, it } from 'vitest';
import {
  createDocument,
  documentPlugin,
  presentationPlugin,
  validateAuthoredObject,
  validateDocument,
} from './index.js';
import { createEditor } from '../editor/index.js';

const baseDoc = () => createDocument({ id: 'deck-1', slides: [{ id: 's1', objects: [] }] });
const geometry = { x: 100, y: 200, width: 3000, height: 1500 };
const makeText = (pId, rId) => ({
  paragraphs: [{ id: pId, runs: [{ id: rId, text: 'Hello', editable: true, style: {}, extensions: { stagecraftAuthored: true } }] }],
});
const validBodyLayout = {
  autofit: 'resize',
  wrap: 'square',
  anchor: 'middle',
  insets: { left: 12700, top: 0, right: 10000000, bottom: 25400 },
};

const addObjectCommand = () => presentationPlugin.commands.find(c => c.id === 'presentation.addObject');

/** Minimal JSON Schema evaluator covering the keywords used by presentation.addObject's inputSchema. */
function matchesJsonSchema(value, schema) {
  if (schema.const !== undefined && value !== schema.const) return false;
  if (schema.enum !== undefined && !schema.enum.includes(value)) return false;
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    const matchesType = types.some((t) => {
      if (t === 'null') return value === null;
      if (t === 'array') return Array.isArray(value);
      if (t === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
      if (t === 'integer') return typeof value === 'number' && Number.isInteger(value);
      if (t === 'number') return typeof value === 'number' && Number.isFinite(value);
      return typeof value === t;
    });
    if (!matchesType) return false;
  }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) return false;
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) return false;
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) return false;
    if (schema.maximum !== undefined && value > schema.maximum) return false;
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) return false;
    if (schema.items !== undefined && !value.every(item => matchesJsonSchema(item, schema.items))) return false;
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const keys = Object.keys(value);
    if (schema.minProperties !== undefined && keys.length < schema.minProperties) return false;
    if (schema.required !== undefined && schema.required.some(k => !Object.hasOwn(value, k))) return false;
    const props = schema.properties ?? {};
    for (const [k, propSchema] of Object.entries(props)) {
      if (Object.hasOwn(value, k) && !matchesJsonSchema(value[k], propSchema)) return false;
    }
    if (schema.additionalProperties === false) {
      if (keys.some(k => !Object.hasOwn(props, k))) return false;
    }
  }
  if (schema.oneOf !== undefined && schema.oneOf.filter(s => matchesJsonSchema(value, s)).length !== 1) return false;
  if (schema.anyOf !== undefined && !schema.anyOf.some(s => matchesJsonSchema(value, s))) return false;
  if (schema.not !== undefined && matchesJsonSchema(value, schema.not)) return false;
  return true;
}

describe('presentation.addObject authored-object bodyLayout schema', () => {
  it('accepts bodyLayout on text and shape objects in both inputSchema and validateAuthoredObject', () => {
    const editor = createEditor({ document: baseDoc(), validateDocument, plugins: [documentPlugin, presentationPlugin] });
    try {
      const textObj = {
        id: 't1',
        type: 'text',
        geometry,
        extensions: { stagecraftAuthored: true },
        text: makeText('p1', 'r1'),
        bodyLayout: validBodyLayout,
      };
      const shapeObj = {
        id: 'sh1',
        type: 'shape',
        geometry,
        extensions: { stagecraftAuthored: true },
        shape: 'rect',
        fill: '#112233',
        text: makeText('p2', 'r2'),
        bodyLayout: { autofit: 'shrink', anchor: 'top' },
      };

      expect(validateAuthoredObject(textObj)).toBe(true);
      expect(validateAuthoredObject(shapeObj)).toBe(true);

      const command = addObjectCommand();
      const exposed = editor.getCommands().find(c => c.id === 'presentation.addObject');
      expect(matchesJsonSchema({ slideId: 's1', object: textObj }, exposed.inputSchema)).toBe(true);
      expect(matchesJsonSchema({ slideId: 's1', object: shapeObj }, exposed.inputSchema)).toBe(true);
      expect(command.validate({ slideId: 's1', object: textObj })).toBe(true);
      expect(command.validate({ slideId: 's1', object: shapeObj })).toBe(true);

      editor.dispatch('presentation.addObject', { slideId: 's1', object: textObj });
      editor.dispatch('presentation.addObject', { slideId: 's1', object: shapeObj });

      const objects = editor.getSnapshot().document.slides[0].objects;
      expect(objects).toHaveLength(2);
      expect(objects[0].bodyLayout).toEqual(validBodyLayout);
      expect(objects[1].bodyLayout).toEqual({ autofit: 'shrink', anchor: 'top' });
    } finally {
      editor.dispose();
    }
  });

  it('rejects null resets, empty records, out-of-range insets, and unknown keys in bodyLayout', () => {
    const command = addObjectCommand();
    const invalidLayouts = [
      {},
      { autofit: null },
      { wrap: null },
      { anchor: null },
      { insets: null },
      { insets: {} },
      { insets: { left: -1 } },
      { insets: { left: 10000001 } },
      { insets: { left: 12.5 } },
      { insets: { left: null } },
      { insets: { unknown: 10 } },
      { unknown: 'x' },
      { autofit: 'other' },
      { wrap: 'tight' },
      { anchor: 'center' },
    ];

    for (const bodyLayout of invalidLayouts) {
      const obj = {
        id: 't-bad',
        type: 'text',
        geometry,
        extensions: { stagecraftAuthored: true },
        text: makeText('p1', 'r1'),
        bodyLayout,
      };
      expect(() => validateAuthoredObject(obj)).toThrow();
      expect(command.validate({ slideId: 's1', object: obj })).toBe(false);
      expect(matchesJsonSchema({ slideId: 's1', object: obj }, command.inputSchema)).toBe(false);
    }
  });

  it('rejects bodyLayout on valid canonical table, image, and chart objects', () => {
    const command = addObjectCommand();
    const variants = [
      {
        id: 'tbl1',
        type: 'table',
        geometry: { x: 0, y: 0, width: 900, height: 400 },
        extensions: { stagecraftAuthored: true },
        table: {
          columns: [{ id: 'tbl1-c1', width: 450 }, { id: 'tbl1-c2', width: 450 }],
          rows: [{
            id: 'tbl1-r1',
            cells: [
              { id: 'tbl1-r1c1', text: makeText('tbl1-p1', 'tbl1-r1-1') },
              { id: 'tbl1-r1c2', text: makeText('tbl1-p2', 'tbl1-r1-2') },
            ],
          }],
        },
      },
      {
        id: 'img1',
        type: 'image',
        geometry: { x: 0, y: 0, width: 100, height: 100 },
        extensions: { stagecraftAuthored: true },
        image: { assetId: 'asset-1' },
      },
      {
        id: 'cht1',
        type: 'chart',
        geometry: { x: 0, y: 0, width: 5000000, height: 3000000 },
        extensions: { stagecraftAuthored: true },
        chart: { kind: 'bar', categories: ['Q1', 'Q2'], series: [{ name: 'Revenue', values: [10, 20] }] },
      },
    ];

    for (const baseline of variants) {
      expect(validateAuthoredObject(baseline)).toBe(true);
      expect(command.validate({ slideId: 's1', object: baseline })).toBe(true);
      expect(matchesJsonSchema({ slideId: 's1', object: baseline }, command.inputSchema)).toBe(true);

      const withBodyLayout = { ...baseline, bodyLayout: { autofit: 'none' } };
      expect(() => validateAuthoredObject(withBodyLayout)).toThrow();
      expect(command.validate({ slideId: 's1', object: withBodyLayout })).toBe(false);
      expect(matchesJsonSchema({ slideId: 's1', object: withBodyLayout }, command.inputSchema)).toBe(false);
    }
  });
});
