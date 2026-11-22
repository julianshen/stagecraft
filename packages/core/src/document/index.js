import { cloneJson } from '../editor/index.js';
import { flattenDeck } from '../lib/deckOrder.js';
import { jsonEqual } from '../lib/jsonEqual.js';
import { validateChart, chartSchema } from './chart.js';
export { validateChart, chartSchema } from './chart.js';
export class DocumentError extends Error {
  constructor(code, message = code) { super(message); this.name = 'DocumentError'; this.code = code; }
}
const fail = (code, message) => { throw new DocumentError(code, message); };
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const copy = value => {
  try {
    return cloneJson(value);
  }
  catch {
    fail('INVALID_JSON');
  }
};
const packagePath = value => nonempty(value) && !/[\\\x00-\x1f\x7f?#:]/.test(value) && !value.startsWith('/') && value.split('/').every(p => p && p !== '.' && p !== '..');
const requireRecord = value => {
  if (!record(value))
    fail('INVALID_SCHEMA');
};
const requireArray = value => {
  if (!Array.isArray(value))
    fail('INVALID_SCHEMA');
};
const collections = ['themes', 'masters', 'layouts', 'assets', 'relationships', 'slides'];
// XML-valid text that a native package may legitimately carry: tab, LF and CR are allowed;
// every other C0 control and DEL is not. Used by the *global* schema so imported names and
// notes are never narrowed to authoring limits.
const xmlValidText = s => typeof s === 'string' && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(s);
/**
 * Global, preservation-safe slide properties. Deliberately permissive: native packages keep
 * whatever name/notes text they already carry (only XML-invalid characters are rejected), and an
 * unknown `background.type` from a future reader is preserved rather than failing the document.
 * Authoring limits live in `validateAuthoredSlideProperties` instead.
 */
function validateSlideProperties(slide) {
  if (slide.name !== undefined && !xmlValidText(slide.name))
    fail('INVALID_SLIDE_PROPERTY');
  if (slide.notes !== undefined && !xmlValidText(slide.notes))
    fail('INVALID_SLIDE_PROPERTY');
  if (slide.background !== undefined) {
    const b = slide.background;
    if (!record(b) || !nonempty(b.type))
      fail('INVALID_SLIDE_PROPERTY');
    if (b.type === 'solid' && (typeof b.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(b.color)))
      fail('INVALID_SLIDE_PROPERTY');
  }
}
/** Strict limits for host-authored input only (setSlideProperties / authored slides). */
function validateAuthoredSlideProperties(value) {
  if (value.name !== undefined && (typeof value.name !== 'string' || value.name !== value.name.trim() || value.name.length > 256 || !xmlValidText(value.name)))
    fail('INVALID_SLIDE_PROPERTY');
  if (value.notes !== undefined && (typeof value.notes !== 'string' || value.notes.length > 20000 || !xmlValidText(value.notes)))
    fail('INVALID_SLIDE_PROPERTY');
  if (value.background !== undefined) {
    const b = value.background;
    if (!record(b) || Object.keys(b).some(key => !['type', 'color'].includes(key)) || b.type !== 'solid' || typeof b.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(b.color))
      fail('INVALID_SLIDE_PROPERTY');
  }
}
/** Validate known structure; unknown JSON fields are intentionally opaque. */
export function validateDocument(document) {
  const d = copy(document);
  requireRecord(d);
  if (d.schemaVersion !== 1)
    fail('UNSUPPORTED_SCHEMA_VERSION');
  if (d.units !== 'emu')
    fail('INVALID_UNITS');
  requireRecord(d.size);
  if (![d.size.width, d.size.height].every(n => Number.isFinite(n) && n > 0))
    fail('INVALID_SIZE');
  requireRecord(d.metadata);
  requireRecord(d.extensions);
  const ids = new Set();
  const identify = node => {
    requireRecord(node);
    if (!nonempty(node.id))
      fail('INVALID_ID');
    if (ids.has(node.id))
      fail('DUPLICATE_ID', `Duplicate id: ${node.id}`);
    ids.add(node.id);
    if (node.extensions !== undefined)
      requireRecord(node.extensions);
    if (node.source !== undefined) {
      const s = node.source;
      requireRecord(s);
      if (!['pptx', 'odp'].includes(s.format) || !packagePath(s.part) || !Array.isArray(s.path) || !s.path.every(n => Number.isSafeInteger(n) && n >= 0) || (s.kind !== undefined && !nonempty(s.kind)))
        fail('INVALID_SOURCE');
    }
  };
  identify(d);
  const sets = {};
  for (const key of collections) {
    requireArray(d[key]);
    sets[key] = new Set(d[key].map(node => { identify(node); return node.id; }));
  }
  const ref = (node, key, target) => {
    if (node[key] !== undefined && !sets[target].has(node[key]))
      fail('INVALID_REFERENCE', `${node.id}.${key}`);
  };
  const text = value => {
    requireRecord(value);
    requireArray(value.paragraphs);
    for (const paragraph of value.paragraphs) {
      identify(paragraph);
      requireArray(paragraph.runs);
      if (paragraph.style !== undefined) requireRecord(paragraph.style);
      for (const run of paragraph.runs) {
        identify(run);
        if (typeof run.text !== 'string' || (run.editable !== undefined && typeof run.editable !== 'boolean')) fail('INVALID_RUN');
        if (run.style !== undefined) requireRecord(run.style);
      }
    }
  };
  const objects = nodes => {
    requireArray(nodes);
    for (const node of nodes) {
      identify(node);
      if (!nonempty(node.type))
        fail('INVALID_OBJECT_TYPE');
      ref(node, 'assetId', 'assets');
      if (node.geometry !== undefined) {
        const g = node.geometry;
        requireRecord(g);
        if (![g.x, g.y, g.width, g.height].every(Number.isFinite) || g.width < 0 || g.height < 0 || (g.rotation !== undefined && !Number.isFinite(g.rotation)))
          fail('INVALID_GEOMETRY');
      }
      if (node.text !== undefined) text(node.text);
      if (node.image !== undefined) {
        requireRecord(node.image);
        ref(node.image, 'assetId', 'assets');
      }
      if (node.table !== undefined) {
        requireRecord(node.table);
        // Validate known identities without applying portable authoring limits to native tables.
        if (node.table.columns !== undefined) {
          requireArray(node.table.columns);
          node.table.columns.forEach(identify);
        }
        if (node.table.rows !== undefined) {
          requireArray(node.table.rows);
          for (const row of node.table.rows) {
            identify(row);
            if (row.cells !== undefined) {
              requireArray(row.cells);
              for (const cell of row.cells) {
                identify(cell);
                if (cell.text !== undefined) text(cell.text);
              }
            }
          }
        }
      }
      if (node.chart !== undefined)
        requireRecord(node.chart);
      if (node.children !== undefined)
        objects(node.children);
    }
  };
  for (const slide of d.slides) {
    validateSlideProperties(slide);
    ref(slide, 'layoutId', 'layouts');
    objects(slide.objects);
  }
  for (const layout of d.layouts) {
    ref(layout, 'masterId', 'masters');
    if (layout.objects !== undefined)
      objects(layout.objects);
  }
  for (const master of d.masters) {
    ref(master, 'themeId', 'themes');
    if (master.objects !== undefined)
      objects(master.objects);
  }
  for (const asset of d.assets) {
    ref(asset, 'relationshipId', 'relationships');
    if (asset.extensions?.stagecraftAuthored !== undefined) {
      if (asset.extensions.stagecraftAuthored !== true || !['image/png', 'image/jpeg'].includes(asset.extensions.contentType))
        fail('INVALID_ASSET');
      if (Object.keys(asset.extensions).some(key => !['stagecraftAuthored', 'contentType'].includes(key)))
        fail('INVALID_ASSET');
    }
  }
  for (const rel of d.relationships) {
    if (!packagePath(rel.ownerPart) || !nonempty(rel.target) || !nonempty(rel.type) || !['internal', 'external'].includes(rel.mode) || (rel.mode === 'internal' && !packagePath(rel.target)))
      fail('INVALID_RELATIONSHIP');
  }
  return true;
}
export function createDocument(options = {}) {
  requireRecord(options);
  const document = {
    schemaVersion: 1,
    id: 'document',
    units: 'emu',
    size: {
      width: 18288000,
      height: 10287000
    },
    metadata: {},
    themes: [],
    masters: [],
    layouts: [],
    assets: [],
    relationships: [],
    slides: [],
    extensions: {},
    ...copy(options)
  };
  validateDocument(document);
  return document;
}
const EMU = 9525;
const diagnostic = (code, message, objectId) => ({
  code,
  message,
  ...(objectId ? { objectId } : {})
});
const baseView = d => { const value = copy(d); delete value.extensions.legacy; return value; };
const simpleShapes = new Set(['rect', 'ellipse', 'circle', 'line']);
/** Legacy semantic layout data remains opaque, never a claim of source fidelity. */
export function migrateLegacyDeck(input) {
  const deck = copy(input);
  requireRecord(deck);
  requireArray(deck.slides);
  const diagnostics = [diagnostic('LEGACY_PRESERVED', 'Original legacy payload is retained; semantic layouts are not converted to source document objects.')];
  const d = createDocument({
    id: 'legacy-document',
    metadata: typeof deck.title === 'string' ? { title: deck.title } : {},
    size: {
      width: 1920 * EMU,
      height: (deck.size?.h ?? 1080) * EMU
    }
  });
  let slides = deck.slides;
  if (deck.sections !== undefined) {
    requireArray(deck.sections);
    for (const section of deck.sections) {
      requireRecord(section);
      if (section.slides !== undefined) requireArray(section.slides);
    }
    const byId = new Map();
    for (const slide of deck.slides) {
      requireRecord(slide);
      if (!byId.has(slide.id)) byId.set(slide.id, slide);
    }
    // Resolve order with the legacy helper, but retain original slide fields, not its section annotations.
    slides = flattenDeck(deck).map(slide => byId.get(slide.id));
  }
  d.slides = slides.map((slide, i) => {
    requireRecord(slide);
    const id = `legacy-slide-${i}`;
    if (slide.elements !== undefined)
      requireArray(slide.elements);
    const objects = (slide.elements ?? []).map((element, j) => {
      requireRecord(element);
      const objectId = `${id}-object-${j}`;
      const supported = element.type === 'text' || simpleShapes.has(element.type);
      const object = {
        id: objectId,
        type: element.type === 'text' ? 'text' : supported ? 'shape' : 'opaque',
        extensions: { legacy: copy(element) }
      };
      if ([element.x, element.y, element.w, element.h].every(Number.isFinite))
        object.geometry = {
          x: element.x * EMU,
          y: element.y * EMU,
          width: element.w * EMU,
          height: element.h * EMU,
          ...(element.rot !== undefined ? { rotation: element.rot } : {})
        };
      if (element.type === 'text')
        object.text = { paragraphs: [
            {
              id: `${objectId}-paragraph`,
              runs: [
                {
                  id: `${objectId}-run`,
                  text: typeof element.content === 'string' ? element.content : '',
                  editable: typeof element.content === 'string'
                }
              ]
            }
          ] };
      if (simpleShapes.has(element.type))
        object.shape = element.type;
      if (!supported)
        diagnostics.push(diagnostic('OPAQUE_LEGACY_OBJECT', 'Unsupported legacy object retained without conversion.', objectId));
      return object;
    });
    return {
      id,
      ...(typeof slide.title === 'string' ? { name: slide.title } : {}),
      objects,
      extensions: { legacy: copy(slide) }
    };
  });
  d.extensions.legacy = {
    deck,
    baseline: baseView(d)
  };
  validateDocument(d);
  return {
    document: d,
    diagnostics
  };
}
export function toLegacyDeck(document) {
  validateDocument(document);
  const d = copy(document), diagnostics = [];
  const original = d.extensions.legacy;
  if (record(original) && record(original.deck) && jsonEqual(original.baseline, baseView(d)))
    return {
      deck: copy(original.deck),
      diagnostics: [diagnostic('LEGACY_PASSTHROUGH', 'Unchanged legacy payload restored; this does not establish source fidelity.')]
    };
  const deck = record(original?.deck) ? copy(original.deck) : {};
  const scale = 1920 / d.size.width;
  if (!Number.isFinite(scale) || scale <= 0)
    fail('UNREPRESENTABLE_PROJECTION');
  const scaled = value => {
    const result = value * scale;
    if (!Number.isFinite(result) || (value !== 0 && result === 0))
      fail('UNREPRESENTABLE_PROJECTION');
    return result;
  };
  deck.size = {
    ...(record(deck.size) ? deck.size : {}),
    w: 1920,
    h: scaled(d.size.height)
  };
  delete deck.title;
  if (typeof d.metadata.title === 'string')
    deck.title = d.metadata.title;
  if (d.size.width !== 1920 * EMU)
    diagnostics.push(diagnostic('LEGACY_VIEWPORT_SCALED', 'Canonical dimensions and geometry were scaled to the legacy 1920 px viewport.'));
  const project = object => {
    if (!['text', 'shape'].includes(object.type)) {
      diagnostics.push(diagnostic('UNSUPPORTED_OBJECT', 'Object omitted from legacy projection.', object.id));
      return [];
    }
    const el = record(object.extensions?.legacy) ? copy(object.extensions.legacy) : {
      id: object.id,
      type: object.type === 'text' ? 'text' : object.shape ?? 'rect'
    };
    el.type = object.type === 'text' ? 'text' : object.shape ?? 'rect';
    for (const key of ['x', 'y', 'w', 'h', 'rot'])
      delete el[key];
    if (!object.geometry)
      diagnostics.push(diagnostic('MISSING_GEOMETRY', 'Object has no canonical geometry; legacy placement is unspecified.', object.id));
    if (object.geometry)
      Object.assign(el, {
        x: scaled(object.geometry.x),
        y: scaled(object.geometry.y),
        w: scaled(object.geometry.width),
        h: scaled(object.geometry.height),
        ...(object.geometry.rotation !== undefined ? { rot: object.geometry.rotation } : {})
      });
    if (object.type === 'shape' && !simpleShapes.has(el.type)) {
      diagnostics.push(diagnostic('UNSUPPORTED_OBJECT', 'Unsupported shape omitted from legacy projection.', object.id));
      return [];
    }
    if (object.type === 'text')
      el.content = (object.text?.paragraphs ?? []).map(p => p.runs.map(r => r.text).join('')).join('\n');
    if (object.children?.length || object.source || object.assetId || object.text?.paragraphs.some(p => p.style || p.runs.some(r => r.style)))
      diagnostics.push(diagnostic('FLATTENED_OBJECT', 'Legacy projection omits canonical formatting, children, asset references or source provenance.', object.id));
    return [el];
  };
  deck.slides = d.slides.map(slide => {
    const projected = copy(slide.extensions?.legacy ?? { layout: 'blank' });
    delete projected.title;
    if (slide.name !== undefined)
      projected.title = slide.name;
    projected.id = slide.extensions?.legacy?.id ?? slide.id;
    projected.elements = slide.objects.flatMap(project);
    return projected;
  });
  // Rebuild section membership when canonical order/membership changes.
  const oldIds = original?.baseline?.slides?.map(s => s.id);
  if (!oldIds || !jsonEqual(oldIds, d.slides.map(s => s.id)))
    deck.sections = [
      {
        id: 'canonical-section',
        name: 'Slides',
        slides: deck.slides.map(s => s.id)
      }
    ];
  diagnostics.push(diagnostic('LEGACY_PROJECTION', 'Canonical data is projected to legacy elements; inheritance and unsupported properties are not represented.'));
  return {
    deck,
    diagnostics
  };
}
const validRunTextPayload = payload => record(payload) && nonempty(payload.runId) && typeof payload.text === 'string' && Object.keys(payload).every(key => key === 'runId' || key === 'text');
function updateRun(document, payload, update) {
  validateDocument(document);
  const d = copy(document);
  let found = false;
  const visit = (nodes, blocked = false) => {
    for (const object of nodes) {
      const unsupported = blocked || !['text', 'shape', 'group'].includes(object.type);
      for (const p of object.text?.paragraphs ?? [])
        for (const run of p.runs)
          if (run.id === payload.runId) {
            if (run.editable === false || unsupported || !['text', 'shape'].includes(object.type))
              fail('UNSUPPORTED_EDIT');
            update(run);
            found = true;
          }
      visit(object.children ?? [], unsupported);
    }
  };
  for (const owner of [...d.slides, ...d.layouts, ...d.masters])
    visit(owner.objects ?? []);
  if (!found)
    fail('UNKNOWN_RUN');
  return d;
}
const formatKeys = { bold: 'b', italic: 'i', fontSize: 'sz', fontFamily: 'typeface', color: 'color' };
const RUN_FORMAT_KEYS = Object.keys(formatKeys);
/** XML 1.0 character validity: rejects lone surrogates, U+FFFE/U+FFFF and disallowed controls. */
const xmlValidChars = value => {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index++;
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) return false;
    if (code === 0xfffe || code === 0xffff || code === 0x7f) return false;
    if (code < 0x20 && code !== 9 && code !== 10 && code !== 13) return false;
  }
  return true;
};
/** Validate one non-null semantic formatting value; null/reset is a caller policy. */
export function isRunFormatValue(key, value) {
  if (key === 'fontFamily')
    return typeof value === 'string' && value.length >= 1 && value.length <= 64 && value === value.trim()
      && xmlValidChars(value) && !/[\u0000-\u001f\u007f]/.test(value);
  if (key === 'color')
    return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
  return (key === 'bold' || key === 'italic' || key === 'fontSize') && (key === 'fontSize'
    ? typeof value === 'number' && value >= 1 && value <= 4000 && Math.abs(value * 100 - Math.round(value * 100)) < 1e-8
    : typeof value === 'boolean');
}
const validRunFormatPayload = payload => record(payload) && nonempty(payload.runId)
  && Object.keys(payload).every(key => key === 'runId' || key === 'format')
  && record(payload.format) && Object.keys(payload.format).length > 0
  && Object.entries(payload.format).every(([key, value]) => value === null ? RUN_FORMAT_KEYS.includes(key) : isRunFormatValue(key, value));
function setRunText(document, payload) {
  if (!validRunTextPayload(payload)) fail('INVALID_PAYLOAD');
  return updateRun(document, payload, run => { run.text = payload.text; });
}
const PARAGRAPH_FORMAT_KEYS = ['alignment', 'spaceBefore', 'spaceAfter', 'lineSpacing', 'level', 'indentStart', 'indentEnd', 'firstLineIndent', 'bullet'];
const BULLET_FORMATS = ['arabicPeriod', 'arabicParenR', 'lowerAlphaPeriod', 'upperAlphaPeriod', 'lowerRomanPeriod', 'upperRomanPeriod'];
const ALIGNMENTS = ['left', 'center', 'right', 'justify'];
const BODY_LAYOUT_KEYS = ['autofit', 'wrap', 'anchor', 'insets'];
/** Validate one non-null paragraph-format value (units are fixed by the shared contract). */
export function isParagraphFormatValue(key, value) {
  switch (key) {
    case 'alignment': return ALIGNMENTS.includes(value);
    case 'spaceBefore': case 'spaceAfter':
      return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1000 && Math.abs(value * 100 - Math.round(value * 100)) < 1e-8;
    case 'lineSpacing': return Number.isInteger(value) && value >= 50 && value <= 500;
    case 'level': return Number.isInteger(value) && value >= 0 && value <= 8;
    case 'indentStart': case 'indentEnd': case 'firstLineIndent':
      return Number.isSafeInteger(value) && Math.abs(value) <= 10000000;
    case 'bullet': {
      if (!record(value) || typeof value.type !== 'string') return false;
      const keys = Object.keys(value);
      if (value.type === 'none') return keys.length === 1;
      if (value.type === 'char') {
        if (keys.length !== 2 || !keys.includes('char') || typeof value.char !== 'string' || !value.char || !xmlValidChars(value.char)) return false;
        const graphemes = typeof Intl !== 'undefined' && Intl.Segmenter
          ? [...new Intl.Segmenter().segment(value.char)].length
          : [...value.char].length; // one grapheme cluster: 'ab' and combination marks are invalid
        return graphemes === 1;
      }
      if (value.type === 'number') return keys.length === 2 && keys.includes('format') && BULLET_FORMATS.includes(value.format);
      return false;
    }
    default: return false;
  }
}
const validParagraphFormatPayload = payload => record(payload) && nonempty(payload.paragraphId)
  && Object.keys(payload).every(key => key === 'paragraphId' || key === 'format')
  && record(payload.format) && Object.keys(payload.format).length > 0
  && Object.keys(payload.format).every(key => PARAGRAPH_FORMAT_KEYS.includes(key))
  && Object.entries(payload.format).every(([key, value]) => value === null || isParagraphFormatValue(key, value));
const validBodyLayoutPayload = payload => record(payload) && nonempty(payload.objectId)
  && Object.keys(payload).every(key => key === 'objectId' || key === 'layout')
  && record(payload.layout) && Object.keys(payload.layout).length > 0
  && Object.keys(payload.layout).every(key => BODY_LAYOUT_KEYS.includes(key))
  && Object.entries(payload.layout).every(([key, value]) => {
    if (value === null) return true;
    if (key === 'autofit') return ['none', 'shrink', 'resize'].includes(value);
    if (key === 'wrap') return ['square', 'none'].includes(value);
    if (key === 'anchor') return ['top', 'middle', 'bottom'].includes(value);
    return record(value) && Object.keys(value).length > 0
      && Object.keys(value).every(side => ['left', 'top', 'right', 'bottom'].includes(side))
      && Object.values(value).every(inset => inset === null || (Number.isSafeInteger(inset) && inset >= 0 && inset <= 10000000));
  });
/** Walk every object in the document (slides, layouts, masters, nested children). */
function eachObject(d, visit) {
  const walk = nodes => {
    for (const object of nodes ?? []) {
      visit(object);
      if (object.children !== undefined) walk(object.children);
    }
  };
  for (const owner of [...d.slides, ...d.layouts, ...d.masters]) walk(owner.objects);
}
const findObject = (d, objectId) => {
  let found = null;
  eachObject(d, object => { if (!found && object.id === objectId) found = object; });
  return found;
};
const findParagraph = (d, paragraphId) => {
  let found = null;
  eachObject(d, object => {
    if (found) return;
    for (const paragraph of object.text?.paragraphs ?? [])
      if (paragraph.id === paragraphId) { found = { paragraph, object, cell: null }; return; }
    for (const row of object.table?.rows ?? [])
      for (const cell of row.cells ?? [])
        for (const paragraph of cell.text?.paragraphs ?? [])
          if (paragraph.id === paragraphId) { found = { paragraph, object, cell }; return; }
  });
  return found;
};
/** Raw PPTX pPr attribute each semantic paragraph key replaces (never stored twice). */
const PARAGRAPH_RAW_KEYS = { alignment: 'algn', level: 'lvl', indentStart: 'marL', indentEnd: 'marR', firstLineIndent: 'indent' };
const paragraphEditable = (paragraph, object) => {
  const authored = paragraph.extensions?.stagecraftAuthored === true || object.extensions?.stagecraftAuthored === true;
  if (authored) return 'authored';
  // ODP paragraph formatting is style-based; reject rather than rewrite shared styles.
  if (paragraph.source?.format === 'pptx') return 'pptx';
  fail('UNSUPPORTED_EDIT');
};
function setParagraphFormat(document, payload) {
  if (!validParagraphFormatPayload(payload)) fail('INVALID_PAYLOAD');
  validateDocument(document);
  const d = copy(document);
  const target = findParagraph(d, payload.paragraphId);
  if (!target) fail('UNKNOWN_PARAGRAPH');
  const { paragraph, object, cell } = target;
  if (cell) {
    // Table-cell paragraphs are only representable when the table itself is authored.
    if (object.extensions?.stagecraftAuthored !== true) fail('UNSUPPORTED_EDIT');
  } else paragraphEditable(paragraph, object);
  paragraph.style ??= {};
  for (const [key, value] of Object.entries(payload.format)) {
    if (value === null) {
      delete paragraph.style[key];
      if (PARAGRAPH_RAW_KEYS[key]) delete paragraph.style[PARAGRAPH_RAW_KEYS[key]];
      continue;
    }
    paragraph.style[key] = copy(value);
    if (PARAGRAPH_RAW_KEYS[key]) delete paragraph.style[PARAGRAPH_RAW_KEYS[key]];
  }
  return d;
}
function setTextBodyLayout(document, payload) {
  if (!validBodyLayoutPayload(payload)) fail('INVALID_PAYLOAD');
  validateDocument(document);
  const d = copy(document);
  const object = findObject(d, payload.objectId);
  if (!object) fail('UNKNOWN_OBJECT');
  if (object.text === undefined) fail('UNSUPPORTED_EDIT');
  // Effective target format: the object's own source, else the document's package format. An
  // authored object inside an ODP deck must be gated exactly like a native one.
  const format = object.source?.format ?? d.extensions?.sourceFormat;
  if (format === 'odp') {
    // ODP text layout is style-based: only autofit (auto-grow) is representable.
    for (const [key, value] of Object.entries(payload.layout)) {
      if (key === 'autofit' && (value === null || value === 'none' || value === 'resize')) continue;
      fail('UNSUPPORTED_EDIT');
    }
  } else if (format !== 'pptx' && format !== undefined) fail('UNSUPPORTED_EDIT');
  const layout = { ...(object.bodyLayout ?? {}) };
  for (const [key, value] of Object.entries(payload.layout)) {
    if (value === null) { delete layout[key]; continue; }
    if (key === 'insets') {
      const insets = { ...(layout.insets ?? {}) };
      for (const [side, inset] of Object.entries(value)) {
        if (inset === null) delete insets[side];
        else insets[side] = inset;
      }
      if (Object.keys(insets).length) layout.insets = insets; else delete layout.insets;
      continue;
    }
    layout[key] = copy(value);
  }
  if (Object.keys(layout).length) object.bodyLayout = layout; else delete object.bodyLayout;
  return d;
}
const collectIds = d => {
  const ids = new Set();
  const add = value => { if (typeof value === 'string') ids.add(value); };
  add(d.id);
  // Schema-aware: paragraph/run ids live under object.text and table cells, not at a fixed key.
  const text = value => {
    for (const paragraph of value?.paragraphs ?? []) {
      add(paragraph.id);
      for (const run of paragraph.runs ?? []) add(run.id);
    }
  };
  const object = value => {
    if (!value || typeof value !== 'object') return;
    add(value.id);
    text(value.text);
    for (const column of value.table?.columns ?? []) add(column.id);
    for (const row of value.table?.rows ?? []) {
      add(row.id);
      for (const cell of row.cells ?? []) { add(cell.id); text(cell.text); }
    }
    for (const child of value.children ?? []) object(child);
  };
  for (const slide of d.slides ?? []) { add(slide.id); for (const item of slide.objects ?? []) object(item); }
  for (const owner of [...(d.layouts ?? []), ...(d.masters ?? [])]) { add(owner.id); for (const item of owner.objects ?? []) object(item); }
  for (const collection of [d.themes, d.assets, d.relationships]) for (const item of collection ?? []) add(item?.id);
  return ids;
};
const codePoints = text => [...text];
/** Stable split id: the original run keeps its id, the tail takes the first free `base~n`. */
const splitId = (base, ids) => {
  for (let index = 1; ; index++) {
    const candidate = `${base}~${index}`;
    if (!ids.has(candidate)) { ids.add(candidate); return candidate; }
  }
};
const validRangePayload = payload => {
  if (!record(payload) || !nonempty(payload.objectId)) return false;
  if (!Object.keys(payload).every(key => key === 'objectId' || key === 'range' || key === 'format')) return false;
  if (!record(payload.format) || !Object.keys(payload.format).length) return false;
  if (!Object.keys(payload.format).every(key => RUN_FORMAT_KEYS.includes(key))) return false;
  if (!Object.entries(payload.format).every(([key, value]) => value === null || isRunFormatValue(key, value))) return false;
  const edge = point => record(point) && nonempty(point.paragraphId) && nonempty(point.runId)
    && Number.isSafeInteger(point.offset) && point.offset >= 0 && Object.keys(point).every(key => ['paragraphId', 'runId', 'offset'].includes(key));
  return record(payload.range) && Object.keys(payload.range).every(key => key === 'start' || key === 'end') && edge(payload.range.start) && edge(payload.range.end);
};
/** Offset (code points) at which run `runIndex` starts inside its paragraph. */
const runStart = (paragraph, runIndex) => paragraph.runs.slice(0, runIndex).reduce((total, run) => total + codePoints(run.text).length, 0);
/** Split the run containing paragraph-relative `offset`. */
function splitParagraphAt(paragraph, offset, ids) {
  let start = 0;
  for (let index = 0; index < paragraph.runs.length; index++) {
    const run = paragraph.runs[index], length = codePoints(run.text).length;
    if (offset === start) return;
    if (offset < start + length) {
      const points = codePoints(run.text);
      // Both segments must own their style/extensions: a shared reference would leak the range
      // formatting into the unselected segment.
      const segment = (text, id) => ({ ...run, id, text, ...(run.style ? { style: copy(run.style) } : {}), ...(run.extensions ? { extensions: copy(run.extensions) } : {}) });
      paragraph.runs.splice(index, 1, segment(points.slice(0, offset - start).join(''), run.id), segment(points.slice(offset - start).join(''), splitId(run.id, ids)));
      return;
    }
    start += length;
  }
}
function applyRunFormat(run, format) {
  run.style ??= {};
  for (const [key, value] of Object.entries(format)) {
    if (value === null) delete run.style[formatKeys[key]];
    else if (key === 'fontFamily') run.style.typeface = value;
    else if (key === 'color') run.style.color = value.toLowerCase();
    else run.style[formatKeys[key]] = key === 'fontSize' ? String(Math.round(value * 100)) : value ? '1' : '0';
  }
}
function setRunRangeFormat(document, payload) {
  if (!validRangePayload(payload)) fail('INVALID_PAYLOAD');
  validateDocument(document);
  const d = copy(document);
  const object = findObject(d, payload.objectId);
  if (!object) fail('UNKNOWN_OBJECT');
  if (!Array.isArray(object.text?.paragraphs)) fail('UNSUPPORTED_EDIT');
  // Native runs map 1:1 to XML nodes, so splitting them is not preservable in this tranche.
  if (object.extensions?.stagecraftAuthored !== true) fail('UNSUPPORTED_EDIT');
  const paragraphs = object.text.paragraphs;
  // Offsets are relative to the named run; resolve each edge to a run index + paragraph offset.
  const resolvePoint = point => {
    const paragraphIndex = paragraphs.findIndex(p => p.id === point.paragraphId);
    if (paragraphIndex < 0) fail('UNKNOWN_PARAGRAPH');
    const paragraph = paragraphs[paragraphIndex];
    const runIndex = paragraph.runs.findIndex(run => run.id === point.runId);
    if (runIndex < 0) fail('UNKNOWN_RUN');
    if (point.offset > codePoints(paragraph.runs[runIndex].text).length) fail('INVALID_RANGE');
    return { paragraphIndex, offset: runStart(paragraph, runIndex) + point.offset };
  };
  const start = resolvePoint(payload.range.start);
  const end = resolvePoint(payload.range.end);
  if (start.paragraphIndex > end.paragraphIndex) fail('INVALID_RANGE');
  if (start.paragraphIndex === end.paragraphIndex && start.offset > end.offset) fail('INVALID_RANGE');
  // Empty range: no split, no history entry.
  if (start.paragraphIndex === end.paragraphIndex && start.offset === end.offset) return d;
  // A selection that already carries the requested formatting (or only null resets for absent
  // keys) must not split runs or create a history entry.
  const wouldChange = () => {
    for (let index = start.paragraphIndex; index <= end.paragraphIndex; index++) {
      const paragraph = paragraphs[index];
      const total = paragraph.runs.reduce((sum, run) => sum + codePoints(run.text).length, 0);
      const startOffset = index === start.paragraphIndex ? start.offset : 0;
      const endOffset = index === end.paragraphIndex ? end.offset : total;
      let position = 0;
      for (const run of paragraph.runs) {
        const length = codePoints(run.text).length, from = position, to = position + length;
        position = to;
        // A partial overlap still needs a split, so test intersection — not containment.
        if (Math.min(to, endOffset) <= Math.max(from, startOffset)) continue;
        for (const [key, value] of Object.entries(payload.format)) {
          const current = run.style?.[formatKeys[key]] ?? null;
          const next = value === null ? null : key === 'fontFamily' ? value : key === 'color' ? value.toLowerCase() : key === 'fontSize' ? String(Math.round(value * 100)) : value ? '1' : '0';
          if ((current ?? null) !== (next ?? null)) return true;
        }
      }
    }
    return false;
  };
  if (!wouldChange()) return d;
  const ids = collectIds(d);
  for (let index = start.paragraphIndex; index <= end.paragraphIndex; index++) {
    const paragraph = paragraphs[index];
    const total = paragraph.runs.reduce((sum, run) => sum + codePoints(run.text).length, 0);
    const startOffset = index === start.paragraphIndex ? start.offset : 0;
    const endOffset = index === end.paragraphIndex ? end.offset : total;
    splitParagraphAt(paragraph, endOffset, ids);
    splitParagraphAt(paragraph, startOffset, ids);
    let position = 0;
    for (const run of paragraph.runs) {
      const from = position, to = from + codePoints(run.text).length;
      position = to;
      if (from >= startOffset && to <= endOffset && to > from) applyRunFormat(run, payload.format);
    }
  }
  return d;
}
function setRunFormat(document, payload) {
  if (!validRunFormatPayload(payload)) fail('INVALID_PAYLOAD');
  return updateRun(document, payload, run => {
    if (run.extensions?.stagecraftAuthored !== true && !['pptx', 'odp'].includes(run.source?.format)) fail('UNSUPPORTED_EDIT');
    run.style ??= {};
    if (run.extensions?.stagecraftAuthored !== true && run.source?.format === 'odp') {
      run.style.overrides ??= {};
      for (const [key, value] of Object.entries(payload.format)) {
        if (value === null) delete run.style.overrides[key];
        else run.style.overrides[key] = value;
      }
      return;
    }
    for (const [key, value] of Object.entries(payload.format)) {
      if (value === null) delete run.style[formatKeys[key]];
      else if (key === 'fontFamily') run.style.typeface = value;
      else if (key === 'color') run.style.color = value.toLowerCase();
      else run.style[formatKeys[key]] = key === 'fontSize' ? String(Math.round(value * 100)) : value ? '1' : '0';
    }
  });
}
const idSchema = { type: 'string', minLength: 1 };
const paragraphStyleSchema = {
  type: 'object', additionalProperties: false, properties: {
    alignment: { enum: ['left', 'center', 'right', 'justify'] },
    spaceBefore: { type: 'number', minimum: 0, maximum: 1000 },
    spaceAfter: { type: 'number', minimum: 0, maximum: 1000 },
    lineSpacing: { type: 'integer', minimum: 50, maximum: 500 },
    level: { type: 'integer', minimum: 0, maximum: 8 },
    indentStart: { type: 'integer' }, indentEnd: { type: 'integer' }, firstLineIndent: { type: 'integer' },
    bullet: { oneOf: [
      { type: 'object', additionalProperties: false, required: ['type'], properties: { type: { const: 'none' } } },
      { type: 'object', additionalProperties: false, required: ['type', 'char'], properties: { type: { const: 'char' }, char: { type: 'string', minLength: 1 } } },
      { type: 'object', additionalProperties: false, required: ['type', 'format'], properties: { type: { const: 'number' }, format: { enum: ['arabicPeriod', 'arabicParenR', 'lowerAlphaPeriod', 'upperAlphaPeriod', 'lowerRomanPeriod', 'upperRomanPeriod'] } } }
    ] }
  }
};
export const documentPlugin = Object.freeze({
  id: 'canonical-document',
  version: '1',
  commands: [
    {
      id: 'document.setRunText',
      description: 'Replace one editable canonical text run.',
      inputSchema: {
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
      },
      validate: validRunTextPayload,
      apply: setRunText
    },
    {
      id: 'document.setParagraphFormat',
      description: 'Set alignment, spacing, indents, level and bullets on one paragraph. Null resets.',
      inputSchema: { type: 'object', properties: { paragraphId: idSchema, format: paragraphStyleSchema }, required: ['paragraphId', 'format'], additionalProperties: false },
      validate: validParagraphFormatPayload,
      apply: setParagraphFormat
    },
    {
      id: 'document.setTextBodyLayout',
      description: 'Set autofit, wrap, anchor and insets on one text body. Null resets.',
      inputSchema: { type: 'object', properties: { objectId: idSchema, layout: { type: 'object', additionalProperties: false, minProperties: 1, properties: {
        autofit: { enum: ['none', 'shrink', 'resize', null] }, wrap: { enum: ['square', 'none', null] }, anchor: { enum: ['top', 'middle', 'bottom', null] },
        insets: { type: ['object', 'null'], additionalProperties: false, properties: { left: { type: ['integer', 'null'] }, top: { type: ['integer', 'null'] }, right: { type: ['integer', 'null'] }, bottom: { type: ['integer', 'null'] } } }
      } } }, required: ['objectId', 'layout'], additionalProperties: false },
      validate: validBodyLayoutPayload,
      apply: setTextBodyLayout
    },
    {
      id: 'document.setRunRangeFormat',
      description: 'Apply run formatting across a code-point range, splitting authored runs. Authored objects only.',
      inputSchema: { type: 'object', properties: {
        objectId: idSchema,
        range: { type: 'object', additionalProperties: false, required: ['start', 'end'], properties: {
          start: { type: 'object', additionalProperties: false, required: ['paragraphId', 'runId', 'offset'], properties: { paragraphId: idSchema, runId: idSchema, offset: { type: 'integer', minimum: 0 } } },
          end: { type: 'object', additionalProperties: false, required: ['paragraphId', 'runId', 'offset'], properties: { paragraphId: idSchema, runId: idSchema, offset: { type: 'integer', minimum: 0 } } }
        } },
        format: { type: 'object', minProperties: 1, additionalProperties: false, properties: {
          bold: { type: ['boolean', 'null'] }, italic: { type: ['boolean', 'null'] },
          fontSize: { type: ['number', 'null'], minimum: 1, maximum: 4000 },
          fontFamily: { type: ['string', 'null'], minLength: 1, maxLength: 64 },
          color: { type: ['string', 'null'], pattern: '^#[0-9a-fA-F]{6}$' }
        } }
      }, required: ['objectId', 'range', 'format'], additionalProperties: false },
      validate: validRangePayload,
      apply: setRunRangeFormat
    },
    {
      id: 'document.setRunFormat',
      description: 'Set bold, italic, font size, font family and color on an editable run. Null clears PPTX direct formatting or restores the imported ODP property.',
      inputSchema: { type: 'object', properties: {
        runId: { type: 'string', minLength: 1 },
        format: { type: 'object', minProperties: 1, additionalProperties: false, properties: {
          bold: { type: ['boolean', 'null'] }, italic: { type: ['boolean', 'null'] },
          fontSize: { type: ['number', 'null'], minimum: 1, maximum: 4000, multipleOf: 0.01 },
          fontFamily: { type: ['string', 'null'], minLength: 1, maxLength: 64 },
          color: { type: ['string', 'null'], pattern: '^#[0-9a-fA-F]{6}$' }
        } }
      }, required: ['runId', 'format'], additionalProperties: false },
      validate: validRunFormatPayload,
      apply: setRunFormat
    }
  ]
});

const exact = (value, required, optional = []) => {
  requireRecord(value);
  if (required.some(key => !Object.hasOwn(value, key)) || Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) fail('INVALID_AUTHORED_SCHEMA');
};
const authoredExtensions = value => {
  exact(value, ['stagecraftAuthored']);
  if (value.stagecraftAuthored !== true) fail('INVALID_AUTHORED_SCHEMA');
};
const authoredGeometry = value => {
  exact(value, ['x', 'y', 'width', 'height'], ['rotation']);
  if (![value.x, value.y, value.width, value.height].every(Number.isSafeInteger) || value.width <= 0 || value.height <= 0 || (value.rotation !== undefined && !Number.isFinite(value.rotation))) fail('INVALID_GEOMETRY');
};
const authoredIdentity = (value, ids) => {
  if (!nonempty(value.id)) fail('INVALID_ID');
  if (ids.has(value.id)) fail('DUPLICATE_ID');
  ids.add(value.id);
};
const authoredText = (value, ids) => {
  exact(value, ['paragraphs']);
  requireArray(value.paragraphs);
  if (!value.paragraphs.length || value.paragraphs.length > 200)
    fail('INVALID_AUTHORED_SCHEMA');
  for (const paragraph of value.paragraphs) {
    exact(paragraph, ['id', 'runs'], ['style']);
    authoredIdentity(paragraph, ids);
    if (paragraph.style !== undefined) {
      exact(paragraph.style, [], PARAGRAPH_FORMAT_KEYS);
      for (const [key, value] of Object.entries(paragraph.style))
        if (!isParagraphFormatValue(key, value)) fail('INVALID_AUTHORED_SCHEMA');
    }
    requireArray(paragraph.runs);
    if (!paragraph.runs.length || paragraph.runs.length > 200)
      fail('INVALID_AUTHORED_SCHEMA');
    for (const run of paragraph.runs) {
      exact(run, ['id', 'text', 'editable', 'style', 'extensions']);
      authoredIdentity(run, ids);
      authoredExtensions(run.extensions);
      if (typeof run.text !== 'string' || run.editable !== true || run.text.length > 4000)
        fail('INVALID_AUTHORED_SCHEMA');
      exact(run.style, [], ['b', 'i', 'sz', 'typeface', 'color']);
      for (const [key, v] of Object.entries(run.style)) {
        const valid = key === 'sz' ? typeof v === 'string' && /^[1-9][0-9]*$/.test(v) && Number(v) >= 100 && Number(v) <= 400000
          : key === 'typeface' ? isRunFormatValue('fontFamily', v)
          : key === 'color' ? isRunFormatValue('color', v)
          : v === '0' || v === '1';
        if (!valid)
          fail('INVALID_AUTHORED_SCHEMA');
      }
    }
  }
};
const authoredTable = (value, ids) => {
  exact(value, ['columns', 'rows']);
  requireArray(value.columns);
  requireArray(value.rows);
  if (!value.columns.length || value.columns.length > 20 || !value.rows.length || value.rows.length > 50)
    fail('INVALID_AUTHORED_SCHEMA');
  for (const column of value.columns) {
    exact(column, ['id', 'width']);
    authoredIdentity(column, ids);
    if (!Number.isSafeInteger(column.width) || column.width <= 0)
      fail('INVALID_GEOMETRY');
  }
  for (const row of value.rows) {
    exact(row, ['id', 'cells']);
    authoredIdentity(row, ids);
    requireArray(row.cells);
    if (row.cells.length !== value.columns.length)
      fail('INVALID_AUTHORED_SCHEMA');
    for (const cell of row.cells) {
      exact(cell, ['id', 'text']);
      authoredIdentity(cell, ids);
      authoredText(cell.text, ids);
    }
  }
};
const authoredImage = value => {
  exact(value, ['assetId'], ['alt']);
  if (!nonempty(value.assetId))
    fail('INVALID_AUTHORED_SCHEMA');
  if (value.alt !== undefined && (typeof value.alt !== 'string' || value.alt.length > 512 || /[\u0000-\u001f\u007f]/.test(value.alt)))
    fail('INVALID_AUTHORED_SCHEMA');
};
const AUTHORED_KEYS = {
  text: [['id', 'type', 'geometry', 'extensions', 'text'], ['bodyLayout']],
  shape: [['id', 'type', 'geometry', 'extensions', 'shape', 'fill'], ['text', 'bodyLayout']],
  table: [['id', 'type', 'geometry', 'extensions', 'table'], []],
  image: [['id', 'type', 'geometry', 'extensions', 'image'], []],
  chart: [['id', 'type', 'geometry', 'extensions', 'chart'], []]
};
/** Charts have no rotation model in either native writer; reject it rather than drop it. */
/** Strict authored body-layout record; mirrors the setTextBodyLayout payload rules. */
function validateAuthoredBodyLayout(value) {
  requireRecord(value);
  if (!Object.keys(value).length || Object.keys(value).some(key => !['autofit', 'wrap', 'anchor', 'insets'].includes(key)))
    fail('INVALID_AUTHORED_SCHEMA');
  if (value.autofit !== undefined && !['none', 'shrink', 'resize'].includes(value.autofit)) fail('INVALID_AUTHORED_SCHEMA');
  if (value.wrap !== undefined && !['square', 'none'].includes(value.wrap)) fail('INVALID_AUTHORED_SCHEMA');
  if (value.anchor !== undefined && !['top', 'middle', 'bottom'].includes(value.anchor)) fail('INVALID_AUTHORED_SCHEMA');
  if (value.insets !== undefined) {
    requireRecord(value.insets);
    if (!Object.keys(value.insets).length) fail('INVALID_AUTHORED_SCHEMA');
    for (const [side, inset] of Object.entries(value.insets)) {
      if (!['left', 'top', 'right', 'bottom'].includes(side) || !Number.isSafeInteger(inset) || inset < 0 || inset > 10000000) fail('INVALID_AUTHORED_SCHEMA');
    }
  }
}
const chartGeometry = value => {
  if (value.rotation !== undefined && value.rotation !== 0)
    fail('UNSUPPORTED_ROTATION');
};
function authoredObject(value, ids) {
  requireRecord(value);
  const keys = AUTHORED_KEYS[value?.type];
  if (!keys)
    fail('INVALID_AUTHORED_SCHEMA');
  exact(value, keys[0], keys[1]);
  authoredIdentity(value, ids);
  authoredExtensions(value.extensions);
  authoredGeometry(value.geometry);
  if (value.bodyLayout !== undefined) validateAuthoredBodyLayout(value.bodyLayout);
  if (value.type === 'shape') {
    if (!['rect', 'ellipse'].includes(value.shape) || !/^#[0-9a-f]{6}$/i.test(value.fill))
      fail('INVALID_AUTHORED_SCHEMA');
    if (value.text !== undefined)
      authoredText(value.text, ids);
  }
  else if (value.type === 'text')
    authoredText(value.text, ids);
  else if (value.type === 'table')
    authoredTable(value.table, ids);
  else if (value.type === 'chart') {
    chartGeometry(value.geometry);
    validateChart(value.chart);
  }
  else
    authoredImage(value.image);
}
/** Strict portable authoring schema, including local identity uniqueness. */
export function validateAuthoredObject(object) {
  authoredObject(copy(object), new Set()); return true;
}
/** Strict authored slide schema; accepts only portable authored objects. */
export function validateAuthoredSlide(slide) {
  const value = copy(slide), ids = new Set();
  exact(value, ['id', 'objects', 'extensions'], ['name', 'background', 'notes']);
  authoredIdentity(value, ids); authoredExtensions(value.extensions); requireArray(value.objects);
  validateAuthoredSlideProperties(value);
  for (const object of value.objects) authoredObject(object, ids);
  return true;
}
const indexSchema = { type: 'integer', minimum: 0 };
const geometrySchema = { type: 'object', additionalProperties: false, required: ['x', 'y', 'width', 'height'], properties: {
  x: { type: 'integer' }, y: { type: 'integer' }, width: { type: 'integer', minimum: 1 }, height: { type: 'integer', minimum: 1 }, rotation: { type: 'number' }
} };
const authoredExtensionsSchema = { type: 'object', required: ['stagecraftAuthored'], additionalProperties: false, properties: { stagecraftAuthored: { const: true } } };
const authoredRunSchema = {
  type: 'object', additionalProperties: false, required: ['id', 'text', 'editable', 'style', 'extensions'], properties: {
    id: idSchema, text: { type: 'string', maxLength: 4000 }, editable: { const: true }, extensions: authoredExtensionsSchema,
    style: { type: 'object', additionalProperties: false, properties: {
      b: { enum: ['0', '1'] }, i: { enum: ['0', '1'] }, sz: { type: 'string', pattern: '^[1-9][0-9]*$' },
      typeface: { type: 'string', minLength: 1, maxLength: 64 },
      color: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' }
    } }
  }
};
const authoredParagraphSchema = {
  type: 'object', additionalProperties: false, required: ['id', 'runs'], properties: {
    id: idSchema, style: paragraphStyleSchema,
    runs: { type: 'array', minItems: 1, maxItems: 200, items: authoredRunSchema }
  }
};
const authoredTextSchema = { type: 'object', additionalProperties: false, required: ['paragraphs'], properties: {
  paragraphs: { type: 'array', minItems: 1, maxItems: 200, items: authoredParagraphSchema }
} };
const authoredTableCellSchema = {
  type: 'object', additionalProperties: false, required: ['id', 'text'], properties: { id: idSchema, text: authoredTextSchema }
};
const authoredTableSchema = {
  type: 'object', additionalProperties: false, required: ['columns', 'rows'], properties: {
    columns: { type: 'array', minItems: 1, maxItems: 20, items: {
      type: 'object', additionalProperties: false, required: ['id', 'width'], properties: { id: idSchema, width: { type: 'integer', minimum: 1 } }
    } },
    rows: { type: 'array', minItems: 1, maxItems: 50, items: {
      type: 'object', additionalProperties: false, required: ['id', 'cells'], properties: { id: idSchema, cells: { type: 'array', minItems: 1, maxItems: 20, items: authoredTableCellSchema } }
    } }
  }
};
const authoredImageSchema = {
  type: 'object', additionalProperties: false, required: ['assetId'], properties: { assetId: idSchema, alt: { type: 'string', maxLength: 512 } }
};
const authoredObjectSchema = {
  type: 'object', additionalProperties: false, required: ['id', 'type', 'geometry', 'extensions'],
  properties: {
    id: idSchema, type: { enum: ['text', 'shape', 'table', 'image', 'chart'] }, geometry: geometrySchema, extensions: authoredExtensionsSchema,
    shape: { enum: ['rect', 'ellipse'] }, fill: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' },
    text: authoredTextSchema, table: authoredTableSchema, image: authoredImageSchema, chart: chartSchema
  },
  oneOf: [
    { required: ['text'], properties: { type: { const: 'text' } }, not: { anyOf: [{ required: ['shape'] }, { required: ['fill'] }, { required: ['table'] }, { required: ['image'] }, { required: ['chart'] }] } },
    { required: ['shape', 'fill'], properties: { type: { const: 'shape' } }, not: { anyOf: [{ required: ['table'] }, { required: ['image'] }, { required: ['chart'] }] } },
    { required: ['table'], properties: { type: { const: 'table' } }, not: { anyOf: [{ required: ['text'] }, { required: ['shape'] }, { required: ['fill'] }, { required: ['image'] }, { required: ['chart'] }] } },
    { required: ['image'], properties: { type: { const: 'image' } }, not: { anyOf: [{ required: ['text'] }, { required: ['shape'] }, { required: ['fill'] }, { required: ['table'] }, { required: ['chart'] }] } },
    { required: ['chart'], properties: { type: { const: 'chart' } }, not: { anyOf: [{ required: ['text'] }, { required: ['shape'] }, { required: ['fill'] }, { required: ['table'] }, { required: ['image'] }] } }
  ]
};
const backgroundSchema = { type: 'object', additionalProperties: false, required: ['type', 'color'], properties: {
  type: { const: 'solid' }, color: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' }
} };
const slidePropertiesSchema = {
  type: 'object', additionalProperties: false, minProperties: 1, properties: {
    name: { type: 'string', maxLength: 256 }, notes: { type: ['string', 'null'], maxLength: 20000 },
    background: { anyOf: [backgroundSchema, { type: 'null' }] }
  }
};
/** Shared by `presentation.setSlideProperties` and its payload validation. */
function normalizeSlideProperties(properties) {
  const out = {};
  if (Object.hasOwn(properties, 'name'))
    out.name = typeof properties.name === 'string' ? properties.name.trim() : properties.name;
  if (Object.hasOwn(properties, 'background')) {
    const b = properties.background;
    out.background = b === null ? null : { type: b?.type, color: typeof b?.color === 'string' ? b.color.toLowerCase() : b?.color };
  }
  if (Object.hasOwn(properties, 'notes'))
    out.notes = properties.notes;
  return out;
}
const assetDescriptorSchema = {
  type: 'object', additionalProperties: false, required: ['id', 'contentType'],
  properties: { id: idSchema, contentType: { enum: ['image/png', 'image/jpeg'] } }
};
const validSlideProperties = properties => {
  try {
    const value = copy(properties);
    exact(value, [], ['name', 'background', 'notes']);
    if (!Object.keys(value).length) return false;
    // Validate exactly what the command will store, so payload acceptance and application can never disagree.
    const normalized = normalizeSlideProperties(value);
    if (normalized.name !== undefined && normalized.name !== '') {
      if (typeof normalized.name !== 'string' || normalized.name.length > 256 || !xmlValidText(normalized.name)) return false;
    }
    if (normalized.background !== undefined && normalized.background !== null) {
      const b = normalized.background;
      if (!record(b) || Object.keys(b).some(key => !['type', 'color'].includes(key)) || b.type !== 'solid' || typeof b.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(b.color)) return false;
    }
    if (normalized.notes !== undefined && normalized.notes !== null && normalized.notes !== '') {
      if (typeof normalized.notes !== 'string' || normalized.notes.length > 20000 || !xmlValidText(normalized.notes)) return false;
    }
    return true;
  } catch { return false; }
};
function presentationCommand(name, properties, required, mutate) {
  const validate = payload => {
    try {
      const p = copy(payload); exact(p, required, Object.keys(properties).filter(key => !required.includes(key)));
      for (const key of ['slideId', 'objectId']) if (Object.hasOwn(p, key) && !nonempty(p[key])) return false;
      if (Object.hasOwn(p, 'index') && (!Number.isSafeInteger(p.index) || p.index < 0)) return false;
      if (Object.hasOwn(p, 'object')) validateAuthoredObject(p.object);
      if (Object.hasOwn(p, 'geometry')) authoredGeometry(p.geometry);
      if (Object.hasOwn(p, 'fill') && (typeof p.fill !== 'string' || !/^#[0-9a-f]{6}$/i.test(p.fill))) return false;
      if (Object.hasOwn(p, 'text')) authoredText(p.text, new Set());
      if (Object.hasOwn(p, 'chart')) validateChart(p.chart);
      if (Object.hasOwn(p, 'properties') && !validSlideProperties(p.properties)) return false;
      if (Object.hasOwn(p, 'cellId') && !nonempty(p.cellId)) return false;
      if (Object.hasOwn(p, 'asset')) {
        exact(p.asset, ['id', 'contentType']);
        if (!nonempty(p.asset.id) || !['image/png', 'image/jpeg'].includes(p.asset.contentType)) return false;
      }
      return true;
    } catch { return false; }
  };
  return {
    id: `presentation.${name}`, description: `Presentation ${name}.`,
    inputSchema: { type: 'object', properties, required, additionalProperties: false }, validate,
    apply(document, payload) {
      if (!validate(payload)) fail('INVALID_PAYLOAD');
      validateDocument(document);
      const next = copy(document); mutate(next, copy(payload)); validateDocument(next); return next;
    }
  };
}
const slideFor = (d, p) => {
  const slide = d.slides.find(s => s.id === p.slideId); if (!slide) fail('UNKNOWN_SLIDE'); return slide;
};
const objectFor = (d, p) => {
  const object = slideFor(d, p).objects.find(o => o.id === p.objectId); if (!object) fail('UNKNOWN_OBJECT'); return object;
};
const move = (items, id, index) => {
  if (index >= items.length) fail('INVALID_INDEX');
  const from = items.findIndex(item => item.id === id);
  if (from < 0) fail('UNKNOWN_ENTITY');
  items.splice(index, 0, items.splice(from, 1)[0]);
};
const targetProperties = { slideId: idSchema, objectId: idSchema };
export const presentationPlugin = Object.freeze({
  id: 'canonical-presentation', version: '1', commands: [
    presentationCommand('addSlide', { slideId: idSchema, index: indexSchema }, ['slideId'], (d, p) => {
      const index = p.index ?? d.slides.length; if (index > d.slides.length) fail('INVALID_INDEX');
      d.slides.splice(index, 0, { id: p.slideId, objects: [], extensions: { stagecraftAuthored: true } });
    }),
    presentationCommand('removeSlide', { slideId: idSchema }, ['slideId'], (d, p) => { slideFor(d, p); d.slides.splice(d.slides.findIndex(s => s.id === p.slideId), 1); }),
    presentationCommand('moveSlide', { slideId: idSchema, index: indexSchema }, ['slideId', 'index'], (d, p) => move(d.slides, p.slideId, p.index)),
    presentationCommand('addObject', { slideId: idSchema, object: authoredObjectSchema }, ['slideId', 'object'], (d, p) => { slideFor(d, p).objects.push(p.object); }),
    presentationCommand('removeObject', targetProperties, ['slideId', 'objectId'], (d, p) => { objectFor(d, p); const objects = slideFor(d, p).objects; objects.splice(objects.findIndex(o => o.id === p.objectId), 1); }),
    presentationCommand('moveObject', { ...targetProperties, index: indexSchema }, ['slideId', 'objectId', 'index'], (d, p) => move(slideFor(d, p).objects, p.objectId, p.index)),
    presentationCommand('setGeometry', { ...targetProperties, geometry: geometrySchema }, ['slideId', 'objectId', 'geometry'], (d, p) => {
      const object = objectFor(d, p);
      if (object.extensions?.stagecraftAuthored !== true && object.extensions?.editableGeometry !== true) fail('UNSUPPORTED_EDIT');
      // ODF draw:transform rotation angles are radians about the origin (ODF 1.4 schema), so a
      // faithful ODP write needs placement compensation that is not proved native-correct yet.
      // Reject before any mutation rather than emit a wrong transform.
      if (p.geometry.rotation !== undefined && p.geometry.rotation !== 0 && (object.source?.format === 'odp' || d.extensions?.sourceFormat === 'odp')) fail('UNSUPPORTED_ROTATION');
      object.geometry = { ...object.geometry, ...p.geometry };
      if (object.type === 'chart') chartGeometry(object.geometry);
      if (object.extensions?.stagecraftAuthored === true) validateAuthoredObject(object);
    }),
    presentationCommand('setPaint', { ...targetProperties, fill: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' } }, ['slideId', 'objectId', 'fill'], (d, p) => {
      const object = objectFor(d, p);
      const authoredShape = object.extensions?.stagecraftAuthored === true && object.type === 'shape';
      const nativeShape = object.extensions?.stagecraftAuthored !== true && object.extensions?.editableFill === true
        && object.type === 'shape' && ['rect', 'ellipse'].includes(object.shape);
      if (!authoredShape && !nativeShape) fail('UNSUPPORTED_EDIT');
      object.fill = p.fill;
      if (authoredShape) validateAuthoredObject(object);
    }),
    presentationCommand('setText', { ...targetProperties, text: authoredTextSchema }, ['slideId', 'objectId', 'text'], (d, p) => {
      const object = objectFor(d, p);
      if (object.extensions?.stagecraftAuthored !== true) fail('UNSUPPORTED_EDIT');
      if (object.type !== 'text' && object.type !== 'shape') fail('UNSUPPORTED_EDIT');
      object.text = p.text;
      validateAuthoredObject(object);
    }),
    presentationCommand('setTableCell', { ...targetProperties, cellId: idSchema, text: authoredTextSchema }, ['slideId', 'objectId', 'cellId', 'text'], (d, p) => {
      const object = objectFor(d, p);
      if (object.extensions?.stagecraftAuthored !== true || object.type !== 'table' || !Array.isArray(object.table?.rows)) fail('UNSUPPORTED_EDIT');
      const cell = object.table.rows.flatMap(row => row.cells).find(c => c.id === p.cellId);
      if (!cell) fail('UNKNOWN_CELL');
      cell.text = p.text;
      validateAuthoredObject(object);
    }),
    presentationCommand('setChart', { ...targetProperties, chart: chartSchema }, ['slideId', 'objectId', 'chart'], (d, p) => {
      const object = objectFor(d, p);
      // Native charts stay read-only data (safely previewed); only authored charts are replaceable.
      if (object.extensions?.stagecraftAuthored !== true || object.type !== 'chart') fail('UNSUPPORTED_EDIT');
      object.chart = p.chart;
      validateAuthoredObject(object);
    }),
    presentationCommand('setSlideProperties', { slideId: idSchema, properties: slidePropertiesSchema }, ['slideId', 'properties'], (d, p) => {
      const slide = slideFor(d, p);
      const properties = normalizeSlideProperties(p.properties);
      if (properties.name !== undefined) {
        if (!properties.name) delete slide.name;
        else slide.name = properties.name;
      }
      if (properties.background !== undefined) {
        if (properties.background === null) delete slide.background;
        else slide.background = { type: 'solid', color: properties.background.color };
      }
      if (properties.notes !== undefined) {
        if (properties.notes === null || properties.notes === '') delete slide.notes;
        else slide.notes = properties.notes;
      }
    }),
    presentationCommand('addImage', { slideId: idSchema, object: authoredObjectSchema, asset: assetDescriptorSchema }, ['slideId', 'object', 'asset'], (d, p) => {
      if (p.object.type !== 'image' || p.object.image.assetId !== p.asset.id) fail('INVALID_PAYLOAD');
      slideFor(d, p).objects.push(p.object);
      d.assets.push({ id: p.asset.id, extensions: { stagecraftAuthored: true, contentType: p.asset.contentType } });
    })
  ]
});
