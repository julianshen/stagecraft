// LLM client — reads settings from localStorage 'stagecraft.ai'
// Supports Anthropic and OpenAI-compatible APIs
//
// NOTE: this module must stay Node-import-safe (no browser globals at module
// scope) — the server proxy (src/server/api.js) imports LOCAL_DEFAULT_BASE
// from here and is itself loaded at Vite config time.

import { flattenDeck } from './deckOrder.js';

/**
 * A classified LLM failure — `reason` keys into LLM_ERROR_MESSAGES below.
 * Reasons are minted by the /api/llm proxy (see api.js), except 'network'.
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
  // network = our own /api/llm proxy was unreachable, not a provider failure
  network: 'Couldn’t reach the Stagecraft server — is the dev server running?',
  provider: 'The AI provider returned an error — try again.',
};

/** User-facing message for any error thrown by an LLM call. */
export function describeLLMError(err) {
  // Provider failures include deterministic 4xxs (bad model id, oversized
  // request) where "try again" can never help — surface the provider's detail.
  if (err?.reason === 'provider' && err.message) return `The AI provider returned an error: ${err.message}`;
  return LLM_ERROR_MESSAGES[err?.reason] || 'Something went wrong talking to the AI — try again.';
}

// Where the keyless "Local" provider (Ollama / LM Studio) points by default —
// displayed by the Settings Base URL field and applied by the /api/llm proxy
// when a local request arrives without a baseUrl. Single-sourced here so what
// the user sees and where the request goes can't drift apart.
export const LOCAL_DEFAULT_BASE = 'http://localhost:11434/v1';

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
  // A saved key belongs to the keyed providers — never ship it as a bearer
  // token to a Local endpoint the user believes is keyless (the Settings UI
  // hides the key field there). An explicit options.apiKey is deliberate.
  const apiKey    = options.apiKey    || (provider === 'local' ? '' : settings.apiKey) || '';
  const maxTokens = options.maxTokens || settings.maxTokens  || 2048;
  const temp      = options.temperature ?? settings.temperature ?? 0.6;

  const body = { provider, model, apiKey, messages, maxTokens, temperature: temp };
  if (options.system != null) body.system = options.system;
  // top_p is optional tuning — only sent when actually configured (0 is a
  // real value, so nullish checks, never truthiness). 1 ≡ full nucleus ≡
  // unset: normalized here (not just in the Settings slider) so a stored or
  // passed `1` can't displace temperature under the proxy's exclusivity rule.
  const topP = options.topP ?? settings.topP;
  if (topP != null && topP !== 1) body.topP = topP;
  // A stored baseUrl belongs only to the endpoint-configurable providers — a
  // leftover Local URL must never hijack an OpenAI/Anthropic request (it would
  // send the bearer key to the stale host and defeat the proxy's key guard).
  // An explicit options.baseUrl is a deliberate override and always wins.
  const configurable = provider === 'local' || provider === 'custom';
  const baseUrl = options.baseUrl || (configurable ? settings.baseUrl : '');
  if (baseUrl) body.baseUrl = baseUrl;

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
    // The proxy answers errors as JSON { error, reason } — it owns the
    // classification. A response without even an `error` field didn't come
    // from the proxy at all (e.g. a static server's HTML 404 when the dev
    // middleware isn't running) — that's a network problem, not a provider one.
    const data = await res.json().catch(() => null);
    const reason = data?.reason || (data?.error != null ? 'provider' : 'network');
    throw new LLMError(reason, data?.error || `LLM request failed (${res.status})`);
  }

  // Tolerate a 2xx whose body is literal `null` or not JSON at all — the
  // shape-normalisation below must never throw on a "successful" response.
  const data = (await res.json().catch(() => ({}))) || {};

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
text, roadmap, risks, list, thanks. Do not include an "id".

To add or change free-form overlay graphics, set "elements": an array of objects
placed in a 1920x1080 canvas (origin top-left). Each element needs "type" plus
numeric "x","y","w","h". Types: "text" (with "content", optional "fontSize",
"bold","italic","underline","align","fontFamily","fill" hex), "line", and shapes
"shape","rounded","circle","triangle","diamond","pentagon","hexagon","star",
"arrow" (with a "fill" hex). Setting "elements" REPLACES the whole overlay, so
include EVERY existing element you want to keep — including any existing "image"
elements, copied verbatim. Omit "elements" to leave the overlay unchanged. Don't
create NEW "image" elements (you can't produce their data), but never drop an
existing one. Fills must be hex (e.g. "#1a1a2e").`;
  // The shape-type list above mirrors the SHAPES registry (lib/shapes.js); a new
  // shape there should be added here too so the Co-pilot can author it.

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
