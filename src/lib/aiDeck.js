// "Start with AI": topic → outline → slides → a new deck. Pure orchestration
// over the LLM client, with the model calls injectable so it is unit-testable.
// Every generated slide goes through the same schema gate as Co-pilot edits
// (sanitizeSlidePatch), so the model can never persist a field nothing renders.

import { callLLM, generateSlide, parseJsonReply, LLMError } from './llmClient.js';
import { SLIDE_LAYOUTS, sanitizeSlidePatch } from './deckUtils.js';
import { newId, createComponentSlide } from './slideFactories.js';
import { CHART_TYPES } from './chartSpec.js';

export const MAX_OUTLINE_SLIDES = 15;

// The layouts an outline may use: every template layout. `blank` is excluded —
// it has no template content, so a generated blank slide would render empty.
const OUTLINE_LAYOUTS = [...SLIDE_LAYOUTS].filter((l) => l !== 'blank');

const text = (v) => (typeof v === 'string' ? v.trim() : '');

// Non-blank: a non-empty string, a number, or a collection/record holding one.
const hasContent = (v) => {
  if (typeof v === 'string') return v.trim() !== '';
  if (typeof v === 'number') return true;
  if (Array.isArray(v)) return v.some(hasContent);
  return v !== null && typeof v === 'object' && Object.values(v).some(hasContent);
};
// A collection with at least one entry filling a key the renderer reads.
const someEntry = (...keys) => (v) => Array.isArray(v) && v.some((e) => keys.some((k) => hasContent(e?.[k])));
// A real data point: chartData coerces anything else (and pads missing values)
// to 0, which would plot a fabricated all-zero chart.
const isNumeric = (x) => (typeof x === 'number' && Number.isFinite(x))
  || (typeof x === 'string' && x.trim() !== '' && Number.isFinite(Number(x)));
// A chart with at least one plotted (in-range) numeric value. Its shape —
// non-empty categories + series — is already gated by sanitizeSlidePatch.
const hasChartData = (c) => c.series.some((s) => s.values.slice(0, c.categories.length).some(isNumeric));

// What each layout actually renders beyond its title, checked down to the keys
// the renderer reads. A generated slide must fill one of these, or the deck
// would keep the template's placeholders (a globally valid `subtitle` is
// invisible on a kpi slide; `{ metric, value }` kpis render as blank cards).
// Cover, divider and thanks are complete with just a title.
const LAYOUT_CONTENT = {
  agenda: { items: someEntry('t', 'd') },
  kpi: { kpis: someEntry('label', 'val') },
  chart: { chart: (v) => v !== undefined && hasChartData(v) },
  split: { body: hasContent, stats: someEntry('lbl', 'val') },
  table: { rows: hasContent },
  text: { body: hasContent },
  roadmap: { lanes: (v) => Array.isArray(v) && v.some((lane) => someEntry('lbl')(lane?.items)) },
  risks: { items: someEntry('t', 'd') },
  list: { items: hasContent },
};
// The JSON shape of each layout's fields, sent with the slide prompt so the
// model fills the keys the renderer reads (LAYOUT_CONTENT checks them).
const LAYOUT_FIELDS = {
  cover: '"subtitle": string',
  agenda: '"items": [{"n": "01", "t": string, "d": string}]',
  divider: '"chapter": "01"',
  kpi: '"kpis": [{"label": string, "val": string, "delta": string, "target": string, "good": boolean}], "note": string',
  chart: `"chartType": ${CHART_TYPES.map((t) => `"${t}"`).join('|')}, "sub": string, "chart": {"categories": [string], "series": [{"name": string, "values": [number]}]}`,
  split: '"body": string, "stats": [{"lbl": string, "val": string}]',
  table: '"columns": [string], "rows": [[string]]',
  text: '"body": string',
  roadmap: '"months": [string], "lanes": [{"name": string, "items": [{"lbl": string, "t": start month index, "d": duration in months, "state": "done"|"inflight"|"planned"}]}]',
  risks: '"items": [{"sev": "high"|"med"|"low", "t": string, "d": string}]',
  list: '"items": [string]',
  thanks: '"subtitle": string',
};
const usable = (safe, layout) => {
  const spec = LAYOUT_CONTENT[layout];
  return !spec || Object.entries(spec).some(([key, ok]) => ok(safe[key]));
};

/**
 * Parse and validate the model's outline reply into
 * `{ title, slides: [{ layout, title, brief }] }`. Unknown layouts and untitled
 * items are dropped and the list is capped; throws when nothing usable is left.
 */
export function parseOutline(reply) {
  // An unusable reply is a classified LLM failure, so describeLLMError words it.
  const unusable = () => new LLMError('outline', 'unusable outline');
  let data;
  try {
    data = parseJsonReply(reply);
  } catch {
    throw unusable();
  }
  const items = Array.isArray(data?.slides) ? data.slides : [];
  const slides = items
    .filter((it) => it && OUTLINE_LAYOUTS.includes(it.layout) && text(it.title))
    .slice(0, MAX_OUTLINE_SLIDES)
    .map((it) => ({ layout: it.layout, title: text(it.title), brief: text(it.brief) }));
  if (!slides.length) throw unusable();
  return { title: text(data.title) || 'AI deck', slides };
}

/** Ask the model for a deck outline about `topic`. */
export async function draftOutline(topic, { call = callLLM } = {}) {
  const t = text(topic);
  if (!t) throw new Error('Describe the topic of the deck first.');
  const system = `You plan slide decks for a presentation app called Stagecraft.
Respond with ONLY a JSON object, no markdown: {"title": string, "slides": [{"layout": string, "title": string, "brief": string}]}.
Use ${MAX_OUTLINE_SLIDES} slides at most; start with a "cover" slide and end with "thanks".
Valid layouts: ${OUTLINE_LAYOUTS.join(', ')}.
"brief" is one sentence describing what the slide should say.`;
  const reply = await call([{ role: 'user', content: `Make a deck about: ${t}` }], {
    system, maxTokens: 2048, temperature: 0.7,
  });
  return parseOutline(reply);
}

/**
 * Generate the outline's slides in order (sequentially, so progress is real, a
 * failure stops early, and a rate-limited provider isn't hammered) and assemble
 * a one-section deck. Each slide starts from its layout's template defaults, the
 * model's schema-valid fields merge over them, and the reviewed outline's
 * layout + title always win. `done` resumes after slides already generated; on
 * failure the error carries them as `err.partial`. `onProgress(done, total)`
 * fires after each slide.
 */
export async function buildDeck(outline, { generate = generateSlide, onProgress, done = [] } = {}) {
  const slides = [...done];
  for (const item of outline.slides.slice(done.length)) {
    let raw;
    try {
      raw = await generate(
        `${item.title} — ${item.brief || item.title}. Use the "${item.layout}" layout with these fields: ${LAYOUT_FIELDS[item.layout]}.`,
        { deckTitle: outline.title },
        { strict: true }, // an unparseable reply fails rather than becoming a placeholder
      );
    } catch (err) {
      // An injected generate may reject with a primitive or frozen value; wrap
      // it so the partial slides always ride along.
      const e = err instanceof Error && Object.isExtensible(err) ? err : new Error(String(err?.message ?? err));
      e.partial = slides;
      throw e;
    }
    // Validate against the reviewed outline's layout: drop any layout the model
    // chose, or layout-specific fields would be checked against the wrong schema.
    const { layout: _ignored, ...fields } = raw && typeof raw === 'object' ? raw : {};
    const safe = sanitizeSlidePatch(fields, item.layout);
    // A reply with nothing this layout renders would only save template
    // placeholders — fail so a resume retries this slide.
    if (!usable(safe, item.layout)) {
      const e = new LLMError('slide', 'unusable slide');
      e.partial = slides;
      throw e;
    }
    slides.push({ ...createComponentSlide(item.layout), ...safe, layout: item.layout, title: item.title, id: newId('ai') });
    onProgress?.(slides.length, outline.slides.length);
  }
  return {
    title: outline.title,
    theme: 'indigo',
    sections: [{ id: newId('sec'), name: 'Section 1', slides: slides.map((s) => s.id) }],
    slides,
  };
}
