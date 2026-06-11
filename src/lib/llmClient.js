// LLM client — reads settings from localStorage 'stagecraft.ai'
// Supports Anthropic and OpenAI-compatible APIs

import { flattenDeck } from './deckOrder.js';

/**
 * A classified LLM failure. `reason` is machine-readable so each UI surface can
 * map it to its own copy (or use `describeLLMError`'s defaults):
 *   'unconfigured' — no API key has been set up
 *   'auth'         — the provider rejected the key
 *   'rate-limit'   — the provider is throttling
 *   'network'      — the request to our own /api/llm proxy never completed
 *   'provider'     — any other upstream failure
 */
export class LLMError extends Error {
  constructor(reason, message) {
    super(message);
    this.name = 'LLMError';
    this.reason = reason;
  }
}

const LLM_ERROR_MESSAGES = {
  unconfigured: 'No API key configured — add one in Settings.',
  auth: 'The provider rejected your API key — check it in Settings.',
  'rate-limit': 'The provider is rate-limiting requests — try again in a moment.',
  network: 'Couldn’t reach the Stagecraft server — is the dev server running?',
  provider: 'The AI provider returned an error — try again.',
};

/** User-facing message for any error thrown by an LLM call. */
export function describeLLMError(err) {
  return LLM_ERROR_MESSAGES[err?.reason] || 'Something went wrong talking to the AI — try again.';
}

function getAISettings() {
  try {
    const raw = localStorage.getItem('stagecraft.ai');
    if (raw) return JSON.parse(raw);
  } catch {
    // Corrupt or missing settings — fall back to empty defaults
  }
  return {};
}

/**
 * Core call — sends messages to the configured provider.
 * @param {Array<{role:string,content:string}>} messages
 * @param {Object} options — overrides from caller
 * @returns {Promise<string>} — assistant text
 */
export async function callLLM(messages, options = {}) {
  const settings = getAISettings();
  const provider  = options.provider  || settings.provider  || 'anthropic';
  const model     = options.model     || settings.model      || 'claude-sonnet-4';
  const apiKey    = options.apiKey    || settings.apiKey     || '';
  const maxTokens = options.maxTokens || settings.maxTokens  || 2048;
  const temp      = options.temperature ?? settings.temperature ?? 0.6;

  const body = { provider, model, apiKey, messages, maxTokens, temperature: temp };
  if (options.system != null) body.system = options.system;

  // Route through our own Vite middleware so we never expose keys in the browser
  let res;
  try {
    res = await fetch('/api/llm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new LLMError('network', `Couldn’t reach /api/llm: ${err?.message || err}`);
  }

  if (!res.ok) {
    // The proxy answers errors as JSON { error, reason? } — reason marks
    // "unconfigured" (vs a provider-rejected key, which is also a 401).
    const data = await res.json().catch(() => null);
    const reason = data?.reason === 'unconfigured' ? 'unconfigured'
      : res.status === 401 || res.status === 403 ? 'auth'
      : res.status === 429 ? 'rate-limit'
      : 'provider';
    throw new LLMError(reason, data?.error || `LLM request failed (${res.status})`);
  }

  const data = await res.json();

  // Normalise Anthropic vs OpenAI response shapes
  if (data.content && Array.isArray(data.content)) {
    // Anthropic shape: { content: [{ type:'text', text:'...' }] }
    return data.content.map(b => b.text || '').join('');
  }
  if (data.choices && Array.isArray(data.choices)) {
    // OpenAI shape: { choices: [{ message: { content: '...' } }] }
    return data.choices[0]?.message?.content || '';
  }
  // Fallback: raw string or error text
  return String(data.text || data.message || data || '');
}

// Parse a model reply as JSON, tolerating surrounding whitespace and accidental
// ```json code fences (which models often emit with leading newlines).
function parseJsonReply(text) {
  const clean = String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  return JSON.parse(clean);
}

/**
 * Generate a new slide from a prompt.
 * Returns a slide object (JSON parsed from the LLM reply).
 */
export async function generateSlide(prompt, context = {}) {
  const systemMsg = `You are a slide-generation assistant for a presentation app called Stagecraft.
Given a user prompt, output a single JSON slide object (no markdown, no explanation).
Valid layouts: cover, agenda, divider, kpi, chart, split, table, text, roadmap, risks, list, thanks.
Respond with ONLY valid JSON — no markdown code fences.
Context deck title: ${context.deckTitle || 'Untitled'}`;

  const messages = [
    { role: 'user', content: `Generate a slide for: ${prompt}` },
  ];

  const text = await callLLM(messages, {
    system: systemMsg,
    maxTokens: 1024,
    temperature: 0.7,
  });

  try {
    const slide = parseJsonReply(text);
    // Only accept a plain object — an array/string/number would break consumers.
    if (slide && typeof slide === 'object' && !Array.isArray(slide)) return slide;
  } catch {
    // fall through to the text-slide fallback
  }
  return { id: `ai-${Date.now()}`, layout: 'text', title: prompt, body: text };
}

/**
 * Edit the current slide per an instruction. Returns a partial-slide *patch*
 * (the fields to change) for `applySlidePatch`, or `null` if the model didn't
 * return usable JSON. Never includes an `id` — the slide's id is immutable.
 */
export async function editSlide(slide, instruction) {
  const system = `You edit a single slide for a presentation app called Stagecraft.
Given the current slide JSON and an instruction, respond with ONLY a JSON object
containing the fields to change (a partial "patch") — no markdown, no prose, no
code fences. Keep the same "layout" unless the instruction clearly calls for a
different one. Valid layouts: cover, agenda, divider, kpi, chart, split, table,
text, roadmap, risks, list, thanks. Do not include an "id".`;

  const messages = [
    { role: 'user', content: `Current slide:\n${JSON.stringify(slide)}\n\nInstruction: ${instruction}\n\nPatch (JSON only):` },
  ];

  const text = await callLLM(messages, { system, maxTokens: 1024, temperature: 0.4 });
  try {
    const patch = parseJsonReply(text);
    if (patch && typeof patch === 'object' && !Array.isArray(patch)) {
      delete patch.id; // id is immutable (applySlidePatch also enforces this)
      return patch;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Ask the model to reorder a deck's slides for the best narrative flow.
 * Sends a compact outline (id + title + layout + section, in current order) and
 * expects a JSON array of slide ids. Returns the proposed id array (string
 * entries only), or `null` if the reply isn't a usable array — callers feed it
 * to `applySlideOrder`, which tolerates dropped/duplicate/omitted ids.
 */
export async function suggestSlideOrder(deck) {
  const outline = flattenDeck(deck).map((s) => ({ id: s.id, title: s.title || s.subtitle || '', layout: s.layout, section: s.sectionName }));
  const system = `You reorder the slides of a presentation for the best narrative flow.
Given a deck outline (an array of slides, each with id, title, layout, section),
respond with ONLY a JSON array of the slide ids in the new recommended order —
every id exactly once, no markdown, no prose, no code fences.
The ids are filled back into the existing sections in the order you give, each
section keeping its current number of slides — so order them as one continuous
narrative; a slide's section follows from its position, you don't assign it.`;

  const messages = [
    { role: 'user', content: `Deck title: ${deck?.title || 'Untitled'}\nOutline:\n${JSON.stringify(outline)}\n\nNew order (JSON array of ids):` },
  ];

  const text = await callLLM(messages, { system, maxTokens: 1024, temperature: 0.3 });
  try {
    const order = parseJsonReply(text);
    if (Array.isArray(order)) {
      const ids = order.filter((x) => typeof x === 'string');
      return ids.length ? ids : null;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Rewrite text according to an instruction.
 */
export async function rewriteText(text, instruction) {
  const messages = [
    {
      role: 'user',
      content: `Rewrite the following presentation text according to this instruction: "${instruction}"\n\nOriginal:\n${text}\n\nRewritten (respond with only the rewritten text, no preamble):`,
    },
  ];
  return callLLM(messages, { maxTokens: 512, temperature: 0.5 });
}

/**
 * Suggest improvements for a slide object.
 * Returns a plain string of suggestions.
 */
export async function suggestImprovements(slide) {
  const messages = [
    {
      role: 'user',
      content: `Review this presentation slide and suggest 2–3 concise improvements (clarity, data, visual hierarchy).\n\nSlide data:\n${JSON.stringify(slide, null, 2)}\n\nSuggestions:`,
    },
  ];
  return callLLM(messages, { maxTokens: 512, temperature: 0.6 });
}
