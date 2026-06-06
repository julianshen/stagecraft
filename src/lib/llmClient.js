// LLM client — reads settings from localStorage 'stagecraft.ai'
// Supports Anthropic and OpenAI-compatible APIs

function getAISettings() {
  try {
    const raw = localStorage.getItem('stagecraft.ai');
    if (raw) return JSON.parse(raw);
  } catch {}
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
  if (options.system) body.system = options.system;

  // Route through our own Vite middleware so we never expose keys in the browser
  const res = await fetch('/api/llm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText);
    throw new Error(`LLM request failed (${res.status}): ${err}`);
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
    // Strip any accidental code fences
    const clean = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    return JSON.parse(clean);
  } catch {
    // Fallback to a plain text slide
    return { id: `ai-${Date.now()}`, layout: 'text', title: prompt, body: text };
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
