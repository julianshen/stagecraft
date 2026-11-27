import { describe, it, expect } from 'vitest';
import {
  createDocument,
  documentPlugin,
  isParagraphFormatValue,
  migrateLegacyDeck,
  presentationPlugin,
  toLegacyDeck,
  validateAuthoredObject
} from './index.js';

const documentCommand = name => documentPlugin.commands.find(command => command.id === `document.${name}`);
const presentationCommand = name => presentationPlugin.commands.find(command => command.id === `presentation.${name}`);
const errorCode = code => expect.objectContaining({ code });
const authoredRun = (id, text, style = {}) => ({ id, text, editable: true, style, extensions: { stagecraftAuthored: true } });
const authoredText = (id = 'p') => ({ paragraphs: [{ id, runs: [authoredRun(`${id}-r`, 'x')] }] });
const authoredTextObject = (paragraphs, id = 'text') => ({
  id,
  type: 'text',
  geometry: { x: 0, y: 0, width: 10, height: 10 },
  extensions: { stagecraftAuthored: true },
  text: { paragraphs }
});
const textDocument = () => createDocument({ slides: [{ id: 's', objects: [
  authoredTextObject([{ id: 'p', runs: [authoredRun('r', 'ABCD')] }]),
  { id: 'shape', type: 'shape', shape: 'rect', fill: '#123456', geometry: { x: 0, y: 0, width: 10, height: 10 }, extensions: { stagecraftAuthored: true } }
] }] });
const rangePayload = (objectId = 'text') => ({ objectId, range: {
  start: { paragraphId: 'p', runId: 'r', offset: 1 },
  end: { paragraphId: 'p', runId: 'r', offset: 3 }
}, format: { bold: true } });

describe('legacy migration and projection boundaries', () => {
  it('accepts sections without slide lists and keeps the first duplicate pool entry', () => {
    const { document } = migrateLegacyDeck({
      sections: [{ id: 'ordered', slides: ['s'] }, { id: 'empty' }],
      slides: [{ id: 's', title: 'First', elements: [] }, { id: 's', title: 'Second', elements: [] }]
    });
    expect(document.slides).toHaveLength(1);
    expect(document.slides[0].name).toBe('First');
  });

  it('does not invent geometry or text for incomplete legacy elements', () => {
    const { document } = migrateLegacyDeck({ slides: [{ id: 's', elements: [
      { id: 'copy', type: 'text', content: 42 },
      { id: 'partial', type: 'rect', x: 0, y: 0, w: 10 }
    ] }] });
    const [text, shape] = document.slides[0].objects;
    expect(text.geometry).toBeUndefined();
    expect(text.text.paragraphs[0].runs[0]).toMatchObject({ text: '', editable: false });
    expect(shape.geometry).toBeUndefined();
  });

  it('retains legacy viewport metadata while projecting canonical dimensions', () => {
    const { document } = migrateLegacyDeck({ size: { w: 960, h: 540, custom: 'keep' }, slides: [{ id: 's', elements: [] }] });
    document.slides[0].name = 'Edited';
    expect(toLegacyDeck(document).deck.size).toEqual({ w: 1920, h: 540, custom: 'keep' });
  });

  it('projects canonical shape kinds, rotation, textless text, and flattening diagnostics', () => {
    const document = createDocument({ slides: [{ id: 's', objects: [
      {
        id: 'box', type: 'shape', shape: 'ellipse',
        geometry: { x: 9525, y: 19050, width: 28575, height: 38100, rotation: 15 },
        source: { format: 'pptx', part: 'ppt/slides/slide1.xml', path: [0] }
      },
      { id: 'empty', type: 'text', geometry: { x: 0, y: 0, width: 9525, height: 9525 } }
    ] }] });
    const { deck, diagnostics } = toLegacyDeck(document);
    expect(deck.slides[0].elements).toEqual([
      { id: 'box', type: 'ellipse', x: 1, y: 2, w: 3, h: 4, rot: 15 },
      { id: 'empty', type: 'text', x: 0, y: 0, w: 1, h: 1, content: '' }
    ]);
    expect(diagnostics).toContainEqual(errorCode('FLATTENED_OBJECT'));
    expect(diagnostics.filter(item => item.code === 'FLATTENED_OBJECT')).toHaveLength(1);
  });
});

describe('document command validation boundaries', () => {
  it('validates unknown paragraph keys and falls back to code points without Intl.Segmenter', () => {
    expect(isParagraphFormatValue('unknown', true)).toBe(false);
    const descriptor = Object.getOwnPropertyDescriptor(Intl, 'Segmenter');
    Object.defineProperty(Intl, 'Segmenter', { ...descriptor, value: undefined });
    try {
      expect(isParagraphFormatValue('bullet', { type: 'char', char: 'e\u0301' })).toBe(false);
      expect(isParagraphFormatValue('bullet', { type: 'char', char: '😀' })).toBe(true);
    } finally {
      Object.defineProperty(Intl, 'Segmenter', descriptor);
    }
  });

  it('searches sparse native table rows and cells without inventing paragraphs', () => {
    const document = createDocument({ slides: [{ id: 's', objects: [{
      id: 'table', type: 'table', table: { rows: [{ id: 'row' }, { id: 'row2', cells: [{ id: 'cell' }] }] }
    }] }] });
    expect(() => documentCommand('setParagraphFormat').apply(document, {
      paragraphId: 'missing', format: { alignment: 'left' }
    })).toThrowError(errorCode('UNKNOWN_PARAGRAPH'));
  });

  it.each([
    ['setParagraphFormat', null],
    ['setTextBodyLayout', { objectId: 'text', layout: {} }],
    ['setRunRangeFormat', { ...rangePayload(), objectId: '' }],
    ['setRunRangeFormat', { ...rangePayload(), extra: true }],
    ['setRunRangeFormat', null],
    ['setRunFormat', { runId: 'r', format: {} }]
  ])('revalidates malformed %s payloads at the apply boundary', (name, payload) => {
    expect(() => documentCommand(name).apply(textDocument(), payload)).toThrowError(errorCode('INVALID_PAYLOAD'));
  });

  it.each([
    ['missing', 'UNKNOWN_OBJECT'],
    ['shape', 'UNSUPPORTED_EDIT']
  ])('rejects text-body layout for %s targets', (objectId, code) => {
    expect(() => documentCommand('setTextBodyLayout').apply(textDocument(), {
      objectId, layout: { wrap: 'square' }
    })).toThrowError(errorCode(code));
  });

  it('rejects text-body layout for an unknown document source format', () => {
    const document = createDocument({ extensions: { sourceFormat: 'future' }, slides: [{ id: 's', objects: [authoredTextObject([{ id: 'p', runs: [authoredRun('r', 'x')] }])] }] });
    expect(() => documentCommand('setTextBodyLayout').apply(document, {
      objectId: 'text', layout: { wrap: 'square' }
    })).toThrowError(errorCode('UNSUPPORTED_EDIT'));
  });
});

describe('authored range editing boundaries', () => {
  it('splits runs without optional style or extensions and collects IDs from sparse tables', () => {
    const document = createDocument({ slides: [{ id: 's', objects: [
      { id: 'rich', type: 'text', extensions: { stagecraftAuthored: true }, text: { paragraphs: [{ id: 'p', runs: [{ id: 'r', text: 'ABCD', editable: true }] }] } },
      { id: 'native-table', type: 'table', table: { rows: [{ id: 'row' }, { id: 'row2', cells: [{ id: 'cell' }] }] } }
    ] }] });
    const next = documentCommand('setRunRangeFormat').apply(document, rangePayload('rich'));
    const runs = next.slides[0].objects[0].text.paragraphs[0].runs;
    expect(runs.map(run => run.text)).toEqual(['A', 'BC', 'D']);
    expect(runs[0]).not.toHaveProperty('style');
    expect(runs[2]).not.toHaveProperty('extensions');
    expect(runs[1].style).toEqual({ b: '1' });
  });

  it('rejects range formatting on an authored object without text', () => {
    expect(() => documentCommand('setRunRangeFormat').apply(textDocument(), rangePayload('shape')))
      .toThrowError(errorCode('UNSUPPORTED_EDIT'));
  });

  it('checks later paragraphs after an already-formatted selection and compares font sizes', () => {
    const document = createDocument({ slides: [{ id: 's', objects: [authoredTextObject([
      { id: 'p1', runs: [authoredRun('r1', 'ABCD', { b: '1', sz: '1250' })] },
      { id: 'p2', runs: [authoredRun('r2', 'WXYZ', { b: '1' })] }
    ])] }] });
    const next = documentCommand('setRunRangeFormat').apply(document, {
      objectId: 'text',
      range: { start: { paragraphId: 'p1', runId: 'r1', offset: 1 }, end: { paragraphId: 'p2', runId: 'r2', offset: 2 } },
      format: { bold: true, fontSize: 12.5 }
    });
    const [first, second] = next.slides[0].objects[0].text.paragraphs;
    expect(first.runs.map(run => [run.text, run.style.b, run.style.sz])).toEqual([['A', '1', '1250'], ['BCD', '1', '1250']]);
    expect(second.runs.map(run => [run.text, run.style.b, run.style.sz])).toEqual([['WX', '1', '1250'], ['YZ', '1', undefined]]);
  });

  it('formats whole middle paragraphs and treats null resets as changes', () => {
    const document = createDocument({ slides: [{ id: 's', objects: [authoredTextObject([
      { id: 'p1', runs: [authoredRun('r1', 'ABCD', { b: '1' })] },
      { id: 'p2', runs: [authoredRun('r2', 'WXYZ', { b: '1' })] }
    ])] }] });
    const next = documentCommand('setRunRangeFormat').apply(document, {
      objectId: 'text',
      range: { start: { paragraphId: 'p1', runId: 'r1', offset: 1 }, end: { paragraphId: 'p2', runId: 'r2', offset: 2 } },
      format: { bold: null }
    });
    const [first, second] = next.slides[0].objects[0].text.paragraphs;
    expect(first.runs.map(run => [run.text, run.style.b])).toEqual([['A', '1'], ['BCD', undefined]]);
    expect(second.runs.map(run => [run.text, run.style.b])).toEqual([['WX', undefined], ['YZ', '1']]);
  });
});

describe('authored payload validation boundaries', () => {
  it.each([0, 201])('rejects authored paragraphs containing %i runs', count => {
    const object = authoredTextObject([{ id: 'p', runs: Array.from({ length: count }, (_, index) => authoredRun(`r${index}`, 'x')) }]);
    expect(() => validateAuthoredObject(object)).toThrowError(errorCode('INVALID_AUTHORED_SCHEMA'));
  });

  it('rejects authored images with an empty asset reference', () => {
    const object = {
      id: 'image', type: 'image', geometry: { x: 0, y: 0, width: 1, height: 1 },
      extensions: { stagecraftAuthored: true }, image: { assetId: ' ' }
    };
    expect(() => validateAuthoredObject(object)).toThrowError(errorCode('INVALID_AUTHORED_SCHEMA'));
  });

  it('rejects non-string slide names before normalization can coerce them', () => {
    expect(presentationCommand('setSlideProperties').validate({ slideId: 's', properties: { name: 42 } })).toBe(false);
  });

  it('rejects an empty table cell ID even when the text payload is valid', () => {
    expect(presentationCommand('setTableCell').validate({ slideId: 's', objectId: 'table', cellId: '', text: authoredText() })).toBe(false);
  });

  it('revalidates forged presentation payloads at the apply boundary', () => {
    expect(() => presentationCommand('addSlide').apply(createDocument(), { slideId: 's', extra: true }))
      .toThrowError(errorCode('INVALID_PAYLOAD'));
  });

  it('rejects text replacement on authored non-text objects', () => {
    const document = createDocument({ slides: [{ id: 's', objects: [{
      id: 'chart', type: 'chart', extensions: { stagecraftAuthored: true },
      chart: { kind: 'bar', categories: ['A'], series: [{ name: 'S', values: [1] }] }
    }] }] });
    expect(() => presentationCommand('setText').apply(document, { slideId: 's', objectId: 'chart', text: authoredText() }))
      .toThrowError(errorCode('UNSUPPORTED_EDIT'));
  });

  it('rejects table-cell replacement on authored non-table objects', () => {
    expect(() => presentationCommand('setTableCell').apply(textDocument(), { slideId: 's', objectId: 'text', cellId: 'cell', text: authoredText() }))
      .toThrowError(errorCode('UNSUPPORTED_EDIT'));
  });
});
