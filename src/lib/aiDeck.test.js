import { describe, it, expect, vi } from 'vitest';
import { parseOutline, draftOutline, buildDeck, MAX_OUTLINE_SLIDES } from './aiDeck.js';
import { describeLLMError } from './llmClient.js';

const outlineJson = {
  title: 'Q3 Review',
  slides: [
    { layout: 'cover', title: 'Q3 Review', brief: 'Opening' },
    { layout: 'kpi', title: 'Numbers', brief: 'Revenue, churn, NPS' },
    { layout: 'thanks', title: 'Thanks', brief: 'Close' },
  ],
};

describe('parseOutline', () => {
  it('accepts a well-formed outline (fenced or bare JSON)', () => {
    expect(parseOutline(JSON.stringify(outlineJson))).toEqual(outlineJson);
    expect(parseOutline('```json\n' + JSON.stringify(outlineJson) + '\n```').title).toBe('Q3 Review');
  });

  it('drops items with an unknown or blank layout and items without a title', () => {
    const o = parseOutline(JSON.stringify({ title: 'T', slides: [
      ...outlineJson.slides,
      { layout: 'hologram', title: 'X' },
      { layout: 'blank', title: 'Y' },
      { layout: 'text', title: '   ' },
      { layout: 'text' },
    ] }));
    expect(o.slides.map((s) => s.title)).toEqual(['Q3 Review', 'Numbers', 'Thanks']);
  });

  it('trims titles and briefs, and defaults a missing brief', () => {
    const o = parseOutline(JSON.stringify({ title: '  T  ', slides: [
      { layout: 'cover', title: '  A  ' }, { layout: 'text', title: 'B', brief: ' b ' }, { layout: 'thanks', title: 'C' },
    ] }));
    expect(o.title).toBe('T');
    expect(o.slides[0]).toEqual({ layout: 'cover', title: 'A', brief: '' });
    expect(o.slides[1].brief).toBe('b');
  });

  it('caps the outline at the maximum slide count', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ layout: 'text', title: `S${i}` }));
    expect(parseOutline(JSON.stringify({ title: 'T', slides: many })).slides).toHaveLength(MAX_OUTLINE_SLIDES);
  });

  it('rejects unusable replies with a classified, readable error', () => {
    for (const bad of ['not json', JSON.stringify({ title: 'T', slides: [] }), JSON.stringify([1, 2]), 'null']) {
      let err;
      try { parseOutline(bad); } catch (e) { err = e; }
      expect(err?.reason).toBe('outline');
      expect(describeLLMError(err)).toMatch(/usable outline/);
    }
    expect(() => parseOutline(JSON.stringify({ slides: outlineJson.slides }))).not.toThrow(); // title falls back
  });

  it('falls back to a generic deck title', () => {
    expect(parseOutline(JSON.stringify({ slides: outlineJson.slides })).title).toBe('AI deck');
  });
});

describe('draftOutline', () => {
  it('asks the model for JSON about the topic and parses the reply', async () => {
    const call = vi.fn(async () => JSON.stringify(outlineJson));
    const o = await draftOutline('our Q3 results', { call });
    expect(o.slides).toHaveLength(3);
    const [messages, opts] = call.mock.calls[0];
    expect(messages[0].content).toContain('our Q3 results');
    expect(opts.system).toMatch(/JSON/);
    expect(opts.system).toContain('kpi'); // the real layout list is in the prompt
  });

  it('rejects an empty topic without calling the model', async () => {
    const call = vi.fn();
    await expect(draftOutline('   ', { call })).rejects.toThrow(/topic/i);
    expect(call).not.toHaveBeenCalled();
  });
});

describe('buildDeck', () => {
  const outline = parseOutline(JSON.stringify(outlineJson));

  it('generates one slide per outline item, in order, reporting progress', async () => {
    const generate = vi.fn(async (prompt) => ({ title: 'ignored?', subtitle: `for ${prompt.slice(0, 5)}` }));
    const onProgress = vi.fn();
    const deck = await buildDeck(outline, { generate, onProgress });
    expect(generate).toHaveBeenCalledTimes(3);
    expect(generate.mock.calls[1][0]).toContain('Numbers');
    expect(generate.mock.calls[1][0]).toContain('kpi');
    expect(generate.mock.calls[1][1]).toEqual({ deckTitle: 'Q3 Review' });
    expect(onProgress.mock.calls.map((c) => c[0])).toEqual([1, 2, 3]);
    expect(deck.title).toBe('Q3 Review');
    expect(deck.slides.map((s) => s.layout)).toEqual(['cover', 'kpi', 'thanks']);
    expect(deck.sections).toHaveLength(1);
    expect(deck.sections[0].slides).toEqual(deck.slides.map((s) => s.id));
    expect(new Set(deck.slides.map((s) => s.id)).size).toBe(3);
  });

  it('keeps only schema-valid fields from the model and never trusts its id', async () => {
    const generate = vi.fn(async () => ({ id: 'evil', speakerNotes: 'x', __proto__: { polluted: true }, kpis: 'nope', subtitle: 'ok' }));
    const deck = await buildDeck(outline, { generate });
    const s = deck.slides[1];
    expect(s.id).not.toBe('evil');
    expect(s).not.toHaveProperty('speakerNotes');
    expect(s.kpis).not.toBe('nope'); // the invalid value is dropped (the template's kpis remain)
    expect(s.subtitle).toBe('ok');
    expect(s.title).toBe('Numbers');
  });

  it('keeps the reviewed outline title and layout over the model reply (incl. the unparseable-reply fallback)', async () => {
    const generate = vi.fn(async (prompt) => ({ layout: 'text', title: prompt, body: 'raw reply' }));
    const deck = await buildDeck(outline, { generate });
    expect(deck.slides.map((s) => [s.layout, s.title])).toEqual([
      ['cover', 'Q3 Review'], ['kpi', 'Numbers'], ['thanks', 'Thanks'],
    ]);
  });

  it('starts each slide from its layout template, so a rejected field keeps the template default', async () => {
    const generate = vi.fn(async () => ({ kpis: 'not an array' }));
    const deck = await buildDeck(outline, { generate });
    expect(Array.isArray(deck.slides[1].kpis)).toBe(true);
    expect(deck.slides[1].kpis.length).toBeGreaterThan(0);
  });

  it('falls back to the outline layout when the model switches to an invalid one', async () => {
    const generate = vi.fn(async () => ({ layout: 'hologram' }));
    const deck = await buildDeck(outline, { generate });
    expect(deck.slides.map((s) => s.layout)).toEqual(['cover', 'kpi', 'thanks']);
  });

  it('stops at a failure and hands back the slides already generated', async () => {
    const generate = vi.fn().mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('rate limited'));
    let err;
    try { await buildDeck(outline, { generate }); } catch (e) { err = e; }
    expect(err.message).toBe('rate limited');
    expect(err.partial.map((s) => s.title)).toEqual(['Q3 Review']);
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it('resumes after the slides already generated', async () => {
    const generate = vi.fn(async () => ({}));
    const onProgress = vi.fn();
    const first = { id: 'kept', layout: 'cover', title: 'Q3 Review' };
    const deck = await buildDeck(outline, { generate, onProgress, done: [first] });
    expect(generate).toHaveBeenCalledTimes(2);
    expect(generate.mock.calls[0][0]).toContain('Numbers');
    expect(deck.slides[0]).toBe(first);
    expect(onProgress.mock.calls.map((c) => c[0])).toEqual([2, 3]);
  });
});
