// "Start with AI": topic → outline → slides → a new deck. Pure orchestration
// over the LLM client, with the model calls injectable so it is unit-testable.
// Every generated slide goes through the same schema gate as Co-pilot edits
// (sanitizeSlidePatch), so the model can never persist a field nothing renders.

import { callLLM, generateSlide, parseJsonReply, LLMError } from './llmClient.js';
import { SLIDE_LAYOUTS, sanitizeSlidePatch } from './deckUtils.js';
import { newId } from './slideFactories.js';

export const MAX_OUTLINE_SLIDES = 15;

// The layouts an outline may use: every template layout. `blank` is excluded —
// it has no template content, so a generated blank slide would render empty.
const OUTLINE_LAYOUTS = [...SLIDE_LAYOUTS].filter((l) => l !== 'blank');

const text = (v) => (typeof v === 'string' ? v.trim() : '');

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
 * Generate every outline slide in order (sequentially, so progress is real and
 * a failure stops early) and assemble a one-section deck. Rethrows the first
 * failure. `onProgress(done, total)` fires after each slide.
 */
export async function buildDeck(outline, { generate = generateSlide, onProgress } = {}) {
  const slides = [];
  for (const item of outline.slides) {
    const raw = await generate(
      `${item.title} — ${item.brief || item.title}. Use the "${item.layout}" layout.`,
      { deckTitle: outline.title },
    );
    const safe = sanitizeSlidePatch(raw, item.layout);
    slides.push({ layout: item.layout, title: item.title, ...safe, id: newId('ai') });
    onProgress?.(slides.length, outline.slides.length);
  }
  return {
    title: outline.title,
    theme: 'indigo',
    sections: [{ id: newId('sec'), name: 'Section 1', slides: slides.map((s) => s.id) }],
    slides,
  };
}
