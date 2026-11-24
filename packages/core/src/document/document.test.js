import { describe, it, expect } from 'vitest';
import { createDocument, validateDocument, DocumentError, migrateLegacyDeck, toLegacyDeck, documentPlugin } from './index.js';
import { createEditor } from '../editor/index.js';

it('preserves opaque legacy elements when canonical object keys are reordered', () => {
  const deck = {
    title: 'Original', sections: [{ id: 'sec', slides: ['s'] }],
    slides: [{ id: 's', layout: 'blank', elements: [{ id: 'image', type: 'image', src: 'data:image/png;base64,AA==', x: 0, y: 0, w: 10, h: 10 }] }],
  };
  const { document } = migrateLegacyDeck(deck);
  const reorderKeys = value => Array.isArray(value) ? value.map(reorderKeys)
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reorderKeys(item)])) : value;
  const reordered = reorderKeys(document);
  // Keep the original retained baseline to compare against differently ordered live data.
  reordered.extensions.legacy = document.extensions.legacy;
  const result = toLegacyDeck(reordered);
  expect(result.deck).toEqual(deck);
  expect(result.diagnostics.map(item => item.code)).toEqual(['LEGACY_PASSTHROUGH']);
});
const fixture = () => createDocument({ slides: [
    {
      id: 's',
      objects: [
        {
          id: 't',
          type: 'text',
          text: { paragraphs: [
              {
                id: 'p',
                runs: [
                  {
                    id: 'r',
                    text: 'Hello',
                    style: { bold: true },
                    source: {
                      format: 'pptx',
                      part: 'ppt/slides/slide1.xml',
                      path: [0, 2]
                    }
                  }
                ]
              }
            ] }
        }
      ]
    }
  ] });
describe('canonical document', () => {
  it('creates isolated defaults', () => { const a = createDocument(); a.metadata.x = 1; expect(createDocument().metadata).toEqual({}); expect(validateDocument(a)).toBe(true); });
  it.each([
    d => d.schemaVersion = 2, d => d.units = 'px', d => d.size.width = 0, d => d.slides[0].layoutId = 'missing',
    d => d.slides[0].objects[0].id = 'p', d => d.slides[0].objects[0].geometry = {
      x: 0,
      y: 0,
      width: -1,
      height: 1
    },
    d => d.slides[0].objects[0].text.paragraphs[0].runs[0].source.part = '../bad',
    d => d.slides[0].objects[0].text.paragraphs[0].runs[0].source.path = [-1], d => d.metadata.x = NaN,
    d => d.slides.push(d.slides[0]), d => d.extensions.loop = d,
  ])('rejects invalid canonical data', change => { const d = fixture(); change(d); expect(() => validateDocument(d)).toThrow(DocumentError); });
  it('preserves payloads, deterministic migration and no-op projection', () => {
    const deck = {
      id: 'd',
      size: {
        w: 1920,
        h: 1440
      },
      unknown: { yes: true },
      sections: [
        {
          id: 'sec',
          slides: ['s']
        }
      ],
      slides: [
        {
          id: 's',
          layout: 'cover',
          title: 'Title',
          elements: [
            {
              id: 'e',
              type: 'text',
              x: 1,
              y: 2,
              w: 3,
              h: 4,
              content: 'Hi',
              custom: 5
            }
          ]
        }
      ]
    };
    const a = migrateLegacyDeck(deck);
    expect(a).toEqual(migrateLegacyDeck(deck));
    expect(a.document.size.height).toBe(1440 * 9525);
    expect(a.document.slides[0].objects[0].geometry.x).toBe(9525);
    expect(toLegacyDeck(a.document).deck).toEqual(deck);
    expect(a.diagnostics.length).toBeGreaterThan(0);
  });
  it('migrates legacy notes and solid backgrounds, then projects canonical edits back', () => {
    const deck = { title: 'Original', sections: [{ id: 'sec', slides: ['s'] }], slides: [{ id: 's', layout: 'blank', title: 'Slide', notes: 'Speaker note', bgColor: '#112233', elements: [] }] };
    const { document } = migrateLegacyDeck(deck);
    expect(document.slides[0].notes).toBe('Speaker note');
    expect(document.slides[0].background).toEqual({ type: 'solid', color: '#112233' });
    const changed = structuredClone(document);
    changed.slides[0].notes = 'Updated note';
    changed.slides[0].background = { type: 'solid', color: '#445566' };
    const projected = toLegacyDeck(changed).deck.slides[0];
    expect(projected.notes).toBe('Updated note');
    expect(projected.bgColor).toBe('#445566');
  });
  it('expands legacy shorthand background hex during migration', () => {
    const { document } = migrateLegacyDeck({ slides: [{ id: 's', layout: 'blank', bgColor: '#AbC', elements: [] }] });
    expect(document.slides[0].background).toEqual({ type: 'solid', color: '#AAbbCC' });
  });
  it('projects authored canonical notes/background and migrates them back', () => {
    const document = createDocument({ slides: [{ id: 's', objects: [], notes: 'Authored note', background: { type: 'solid', color: '#778899' } }] });
    const legacy = toLegacyDeck(document).deck;
    expect(legacy.slides[0]).toMatchObject({ notes: 'Authored note', bgColor: '#778899' });
    const migrated = migrateLegacyDeck(legacy).document.slides[0];
    expect(migrated.notes).toBe('Authored note');
    expect(migrated.background).toEqual({ type: 'solid', color: '#778899' });
  });
  it('clears retained legacy properties and diagnoses unsupported canonical backgrounds', () => {
    const deck = { sections: [{ id: 'sec', slides: ['s'] }], slides: [{ id: 's', layout: 'blank', notes: 'Old note', bgColor: '#112233', elements: [] }] };
    const { document } = migrateLegacyDeck(deck);
    const cleared = structuredClone(document);
    delete cleared.slides[0].notes;
    delete cleared.slides[0].background;
    const projected = toLegacyDeck(cleared).deck.slides[0];
    expect(projected).not.toHaveProperty('notes');
    expect(projected).not.toHaveProperty('bgColor');
    const unsupported = structuredClone(document);
    unsupported.slides[0].background = { type: 'theme' };
    const result = toLegacyDeck(unsupported);
    expect(result.deck.slides[0]).not.toHaveProperty('bgColor');
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'UNSUPPORTED_SLIDE_BACKGROUND', objectId: 'legacy-slide-0' }));
  });
  it('supports pure text command, validation and history', () => {
    const d = fixture();
    const e = createEditor({
      document: d,
      plugins: [documentPlugin],
      validateDocument
    });
    e.dispatch('document.setRunText', {
      runId: 'r',
      text: 'New'
    });
    expect(e.getSnapshot().document.slides[0].objects[0].text.paragraphs[0].runs[0].text).toBe('New');
    e.undo();
    expect(e.getSnapshot().document).toEqual(d);
    e.redo();
    expect(() => e.dispatch('document.setRunText', {
      runId: 'absent',
      text: 'X'
    })).toThrow();
    expect(() => e.dispatch('document.setRunText', {
      runId: 'r',
      text: 3
    })).toThrow();
    expect(d.slides[0].objects[0].text.paragraphs[0].runs[0].text).toBe('Hello');
  });
  it('rejects noneditable runs', () => {
    const d = fixture();
    d.slides[0].objects[0].text.paragraphs[0].runs[0].editable = false;
    expect(() => documentPlugin.commands[0].apply(d, {
      runId: 'r',
      text: 'X'
    })).toThrow();
  });
  it('reports unsupported projection and scales geometry', () => {
    const d = createDocument({ slides: [
        {
          id: 's',
          objects: [
            {
              id: 'x',
              type: 'plugin.chart'
            },
            {
              id: 'rect',
              type: 'shape',
              geometry: {
                x: 9525,
                y: 0,
                width: 95250,
                height: 0
              }
            }
          ]
        }
      ] });
    const { deck, diagnostics } = toLegacyDeck(d);
    expect(deck.slides[0].elements[0].x).toBe(1);
    expect(diagnostics.some(x => x.code === 'UNSUPPORTED_OBJECT')).toBe(true);
  });
});
describe('canonical references and projection edits', () => {
  it('validates collection-specific inheritance and asset references', () => {
    const d = createDocument({
      themes: [
        { id: 'theme' }
      ],
      masters: [
        {
          id: 'master',
          themeId: 'theme'
        }
      ],
      layouts: [
        {
          id: 'layout',
          masterId: 'master'
        }
      ],
      relationships: [
        {
          id: 'rel',
          ownerPart: 'ppt/slides/slide1.xml',
          target: 'ppt/media/image1.png',
          type: 'image',
          mode: 'internal'
        }
      ],
      assets: [
        {
          id: 'asset',
          relationshipId: 'rel'
        }
      ],
      slides: [
        {
          id: 'slide',
          layoutId: 'layout',
          objects: [
            {
              id: 'image',
              type: 'opaque',
              assetId: 'asset'
            }
          ]
        }
      ]
    });
    expect(validateDocument(d)).toBe(true);
    d.slides[0].layoutId = 'master';
    expect(() => validateDocument(d)).toThrowError(expect.objectContaining({ code: 'INVALID_REFERENCE' }));
  });
  it('preserves text run details and maps edits into retained legacy objects', () => {
    const original = {
      slides: [
        {
          id: 's',
          title: 'Semantic title',
          elements: [
            {
              id: 't',
              type: 'text',
              x: 0,
              y: 0,
              w: 20,
              h: 10,
              content: 'old',
              color: '#123456'
            }
          ]
        }
      ],
      sections: [
        {
          id: 'a',
          slides: ['s']
        }
      ]
    };
    const { document } = migrateLegacyDeck(original);
    const run = document.slides[0].objects[0].text.paragraphs[0].runs[0];
    const changed = documentPlugin.commands[0].apply(document, {
      runId: run.id,
      text: 'new'
    });
    const projected = toLegacyDeck(changed);
    expect(projected.deck.slides[0].elements[0]).toEqual({
      ...original.slides[0].elements[0],
      content: 'new'
    });
    expect(projected.deck.sections).toEqual(original.sections);
    expect(projected.deck.slides[0].title).toBe('Semantic title');
  });
  it('rejects edits to text embedded inside opaque plugin content', () => {
    const d = fixture();
    d.slides[0].objects = [
      {
        id: 'opaque',
        type: 'opaque',
        children: d.slides[0].objects
      }
    ];
    expect(() => documentPlugin.commands[0].apply(d, {
      runId: 'r',
      text: 'new'
    })).toThrowError(expect.objectContaining({ code: 'UNSUPPORTED_EDIT' }));
  });
  it('does not invoke accessors during validation', () => {
    const d = fixture();
    let invoked = false;
    Object.defineProperty(d.metadata, 'bad', {
      enumerable: true,
      get() { invoked = true; return 1; }
    });
    expect(() => validateDocument(d)).toThrow(DocumentError);
    expect(invoked).toBe(false);
  });
});
describe('canonical projection interoperability', () => {
  it('projects native documents to a visible blank legacy slide with scaled viewport', () => {
    const d = createDocument({
      metadata: { title: 'Deck title' },
      size: {
        width: 960 * 9525,
        height: 540 * 9525
      },
      slides: [
        {
          id: 'slide',
          name: 'Slide title',
          objects: [
            {
              id: 'box',
              type: 'shape',
              geometry: {
                x: 10 * 9525,
                y: 20 * 9525,
                width: 100 * 9525,
                height: 50 * 9525
              }
            }
          ]
        }
      ]
    });
    const { deck } = toLegacyDeck(d);
    expect(deck.title).toBe('Deck title');
    expect(deck.size).toEqual({
      w: 1920,
      h: 1080
    });
    expect(deck.slides[0]).toMatchObject({
      layout: 'blank',
      title: 'Slide title',
      elements: [
        {
          x: 20,
          y: 40,
          w: 200,
          h: 100
        }
      ]
    });
  });
  it('advertises and enforces the run-text payload schema', () => {
    const command = documentPlugin.commands[0];
    expect(command.inputSchema).toEqual({
      type: 'object',
      properties: {
        runId: {
          type: 'string',
          minLength: 1
        },
        text: { type: 'string' }
      },
      required: ['runId', 'text'],
      additionalProperties: false
    });
    expect(createEditor({
      document: fixture(),
      plugins: [documentPlugin],
      validateDocument
    }).getCommands()[0].inputSchema).toEqual(command.inputSchema);
    expect(command.validate({
      runId: 'r',
      text: 'ok',
      extra: true
    })).toBe(false);
    expect(() => command.apply(fixture(), {
      runId: 'r',
      text: 'ok',
      extra: true
    })).toThrow();
  });
  it('permits decoded package entry names and requires normalized internal targets', () => {
    const d = fixture();
    d.slides[0].objects[0].text.paragraphs[0].runs[0].source.part = 'Pictures/50% complete.png';
    expect(validateDocument(d)).toBe(true);
    d.relationships = [
      {
        id: 'rel',
        ownerPart: '[package]',
        target: 'Pictures/50% complete.png',
        type: 'image',
        mode: 'internal'
      }
    ];
    expect(validateDocument(d)).toBe(true);
    for (const target of ['../Pictures/image.png', '/Pictures/image.png', 'https://example.com/image.png', 'Pictures\\image.png']) {
      d.relationships[0].target = target;
      expect(() => validateDocument(d)).toThrow(DocumentError);
    }
  });
});
it('does not resurrect removed rotation or geometry from retained legacy data', () => {
  const { document } = migrateLegacyDeck({ slides: [
      {
        id: 's',
        elements: [
          {
            id: 't',
            type: 'text',
            content: 'Text',
            x: 0,
            y: 0,
            w: 10,
            h: 20,
            rot: 45
          }
        ]
      }
    ] });
  delete document.slides[0].objects[0].geometry.rotation;
  expect(toLegacyDeck(document).deck.slides[0].elements[0]).not.toHaveProperty('rot');
  delete document.slides[0].objects[0].geometry;
  const { deck, diagnostics } = toLegacyDeck(document);
  expect(deck.slides[0].elements[0]).not.toHaveProperty('x');
  expect(diagnostics.some(d => d.code === 'MISSING_GEOMETRY')).toBe(true);
});
it('rejects projection overflow and underflow rather than emitting invalid dimensions', () => {
  for (const size of [
    {
      width: Number.MIN_VALUE,
      height: 1
    },
    {
      width: 1,
      height: Number.MAX_VALUE
    },
    {
      width: Number.MAX_VALUE,
      height: Number.MIN_VALUE
    }
  ]) {
    const d = createDocument({ size });
    expect(() => toLegacyDeck(d)).toThrowError(expect.objectContaining({ code: 'UNREPRESENTABLE_PROJECTION' }));
  }
  const d = createDocument({ slides: [
      {
        id: 's',
        objects: [
          {
            id: 'r',
            type: 'shape',
            geometry: {
              x: Number.MAX_VALUE,
              y: 0,
              width: Number.MIN_VALUE,
              height: 1
            }
          }
        ]
      }
    ] });
  expect(() => toLegacyDeck(d)).toThrowError(expect.objectContaining({ code: 'UNREPRESENTABLE_PROJECTION' }));
});
it('uses canonical shape kinds after migration and reports unsupported changed kinds', () => {
  const { document } = migrateLegacyDeck({ slides: [
      {
        id: 's',
        elements: [
          {
            id: 'r',
            type: 'rect',
            x: 0,
            y: 0,
            w: 10,
            h: 20
          }
        ]
      }
    ] });
  document.slides[0].objects[0].shape = 'ellipse';
  expect(toLegacyDeck(document).deck.slides[0].elements[0].type).toBe('ellipse');
  document.slides[0].objects[0].shape = 'plugin.star';
  const { deck, diagnostics } = toLegacyDeck(document);
  expect(deck.slides[0].elements).toEqual([]);
  expect(diagnostics.some(d => d.code === 'UNSUPPORTED_OBJECT')).toBe(true);
});
it('treats canonical slide and document titles as authoritative after migration', () => {
  const { document } = migrateLegacyDeck({
    title: 'Old deck',
    slides: [
      {
        id: 's',
        title: 'Old slide',
        elements: [
          {
            id: 't',
            type: 'text',
            content: 'Old text',
            x: 0,
            y: 0,
            w: 10,
            h: 20
          }
        ]
      }
    ]
  });
  expect(document.metadata.title).toBe('Old deck');
  expect(document.slides[0].name).toBe('Old slide');
  document.slides[0].name = 'New slide';
  expect(toLegacyDeck(document).deck.slides[0].title).toBe('New slide');
  delete document.metadata.title;
  delete document.slides[0].name;
  document.slides[0].objects[0].text.paragraphs[0].runs[0].text = 'New text';
  const { deck } = toLegacyDeck(document);
  expect(deck).not.toHaveProperty('title');
  expect(deck.slides[0]).not.toHaveProperty('title');
});

it('applies direct format patches atomically through history and clears overrides', () => {
  const document = fixture(), editor = createEditor({ document, validateDocument, plugins: [documentPlugin] });
  editor.dispatch('document.setRunFormat', { runId: 'r', format: { bold: false, italic: true, fontSize: 24.25 } });
  const run = () => editor.getSnapshot().document.slides[0].objects[0].text.paragraphs[0].runs[0];
  expect(run().style).toEqual({ bold: true, b: '0', i: '1', sz: '2425' });
  editor.dispatch('document.setRunFormat', { runId: 'r', format: { bold: null, italic: null, fontSize: null } });
  expect(run().style).toEqual({ bold: true });
  editor.undo(); expect(run().style.sz).toBe('2425');
  editor.undo(); expect(editor.getSnapshot().document).toEqual(document);
});
it('rejects invalid formatting, unsupported and unknown runs without changing state', () => {
  const editor = createEditor({ document: fixture(), validateDocument, plugins: [documentPlugin] });
  for (const format of [{}, { bold: 1 }, { fontSize: 0 }, { fontSize: 4001 }, { fontSize: 2.345 }, { underline: true }]) {
    expect(() => editor.dispatch('document.setRunFormat', { runId: 'r', format })).toThrow();
    expect(editor.getSnapshot().revision).toBe(0);
  }
  expect(() => editor.dispatch('document.setRunFormat', { runId: 'missing', format: { bold: true } })).toThrow();
  for (const change of [r => r.editable = false, r => delete r.source]) {
    const d = fixture(); change(d.slides[0].objects[0].text.paragraphs[0].runs[0]);
    const other = createEditor({ document: d, plugins: [documentPlugin] });
    expect(() => other.dispatch('document.setRunFormat', { runId: 'r', format: { bold: true } })).toThrow();
    other.dispose();
  }
  editor.dispose();
});
it('stores ODP run-local overrides and clears them back to the imported baseline', () => {
  const d = fixture(), run = d.slides[0].objects[0].text.paragraphs[0].runs[0];
  run.source.format = 'odp'; run.source.part = 'content.xml'; run.style = { attributes: { 'text:style-name': 'Shared' }, overrides: {} };
  const e = createEditor({ document: d, plugins: [documentPlugin] });
  e.dispatch('document.setRunFormat', { runId: run.id, format: { bold: false, italic: true, fontSize: 18.25 } });
  const get = () => e.getSnapshot().document.slides[0].objects[0].text.paragraphs[0].runs[0];
  expect(get().style).toEqual({ attributes: { 'text:style-name': 'Shared' }, overrides: { bold: false, italic: true, fontSize: 18.25 } });
  e.dispatch('document.setRunFormat', { runId: run.id, format: { bold: null, italic: null, fontSize: null } });
  expect(get()).toEqual(run); e.dispose();
});
