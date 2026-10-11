import { describe, it, expect, vi } from 'vitest';
import { parseOutline, draftOutline, buildDeck, MAX_OUTLINE_SLIDES } from './aiDeck.js';
import { describeLLMError } from './llmClient.js';
import { SLIDE_LAYOUTS } from './deckUtils.js';

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
  const KPIS = [{ label: 'Revenue', val: '$1M' }]; // what the outline's kpi slide renders

  it('generates one slide per outline item, in order, reporting progress', async () => {
    const generate = vi.fn(async (prompt) => ({ title: 'ignored?', subtitle: `for ${prompt.slice(0, 5)}`, kpis: KPIS }));
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
    const generate = vi.fn(async () => ({ id: 'evil', speakerNotes: 'x', __proto__: { polluted: true }, chart: { categories: ['a'], series: [{ values: [1] }] }, kpis: KPIS, subtitle: 'ok' }));
    const deck = await buildDeck(outline, { generate });
    const s = deck.slides[1];
    expect(s.id).not.toBe('evil');
    expect(s).not.toHaveProperty('speakerNotes');
    expect(s).not.toHaveProperty('chart'); // valid data, but not for a kpi slide
    expect(s.kpis).toEqual(KPIS);
    expect(s.subtitle).toBe('ok');
    expect(s.title).toBe('Numbers');
  });

  it('keeps the reviewed outline title and layout over the model reply (incl. the unparseable-reply fallback)', async () => {
    const generate = vi.fn(async (prompt) => ({ layout: 'text', title: prompt, body: 'raw reply', kpis: KPIS }));
    const deck = await buildDeck(outline, { generate });
    expect(deck.slides.map((s) => [s.layout, s.title])).toEqual([
      ['cover', 'Q3 Review'], ['kpi', 'Numbers'], ['thanks', 'Thanks'],
    ]);
  });

  it('validates the model fields against the outline layout, not a layout the model picked', async () => {
    // agenda items are objects; a list slide needs strings — they must not leak across
    const listOutline = { title: 'T', slides: [{ layout: 'list', title: 'Points', brief: '' }] };
    const agendaItems = vi.fn(async () => ({ layout: 'agenda', items: [{ n: '01', t: 'x', d: 'y' }], subtitle: 'ok' }));
    expect((await buildDeck(listOutline, { generate: agendaItems }).catch((e) => e)).reason).toBe('slide');
    const listItems = vi.fn(async () => ({ layout: 'agenda', items: ['x', 'y'] }));
    const deck = await buildDeck(listOutline, { generate: listItems });
    expect(deck.slides[0].layout).toBe('list');
    expect(deck.slides[0].items).toEqual(['x', 'y']);
  });

  it('tells the model the fields each slide\'s layout renders', async () => {
    const generate = vi.fn(async () => ({ subtitle: 'ok', kpis: KPIS }));
    await buildDeck(outline, { generate });
    expect(generate.mock.calls[1][0]).toMatch(/"kpis": \[\{"label"/); // the kpi slide
    expect(generate.mock.calls[0][0]).toContain('"subtitle"');          // the cover
  });

  it('has a field shape for every layout an outline may use', async () => {
    const layouts = [...SLIDE_LAYOUTS].filter((l) => l !== 'blank');
    const generate = vi.fn(async () => { throw new Error('stop'); });
    for (const layout of layouts) {
      await buildDeck({ title: 'T', slides: [{ layout, title: 'X', brief: '' }] }, { generate }).catch(() => {});
    }
    expect(generate).toHaveBeenCalledTimes(layouts.length);
    for (const [prompt] of generate.mock.calls) expect(prompt).not.toContain('undefined');
  });

  it('asks for strict slides by default, so an unusable reply fails instead of a placeholder', async () => {
    const generate = vi.fn(async () => ({ subtitle: 'x', kpis: KPIS }));
    await buildDeck(outline, { generate });
    expect(generate.mock.calls[0][2]).toEqual({ strict: true });
  });

  it('treats a reply with no usable content for the layout as a failure, resumable at that slide', async () => {
    // a valid object whose only content is invalid for kpi (kpis must be an array)
    const generate = vi.fn().mockResolvedValueOnce({ subtitle: 'ok' }).mockResolvedValueOnce({ kpis: 'nope', title: 'X' });
    const err = await buildDeck(outline, { generate }).catch((e) => e);
    expect(err.reason).toBe('slide');
    expect(err.partial).toHaveLength(1);
  });

  it('rejects a reply whose only content is a field the layout does not render', async () => {
    // subtitle is schema-valid anywhere, but a kpi slide only shows its kpis
    const generate = vi.fn().mockResolvedValueOnce({ subtitle: 'ok' }).mockResolvedValueOnce({ subtitle: 'Revenue grew' });
    const err = await buildDeck(outline, { generate }).catch((e) => e);
    expect(err.reason).toBe('slide');
    expect(err.partial).toHaveLength(1);
  });

  it('rejects empty layout content (an empty collection or blank entries)', async () => {
    for (const reply of [{ kpis: [] }, { kpis: [{ label: ' ', val: '' }] }]) {
      const generate = vi.fn().mockResolvedValueOnce({ subtitle: 'ok' }).mockResolvedValueOnce(reply);
      const err = await buildDeck(outline, { generate }).catch((e) => e);
      expect(err.reason).toBe('slide');
      expect(err.partial).toHaveLength(1); // the cover succeeded; it failed at the kpi slide
    }
  });

  it('rejects collection entries whose keys the layout does not render', async () => {
    const one = (layout) => ({ title: 'T', slides: [{ layout, title: layout, brief: '' }] });
    const cases = [
      ['kpi', { kpis: [{ metric: 'Revenue', value: '$1M' }] }],   // renderer reads label/val
      ['agenda', { items: [{ heading: 'Intro' }] }],              // reads t/d
      ['risks', { items: [{ risk: 'Churn' }] }],                  // reads t/d
      ['split', { stats: [{ name: 'NPS', score: 40 }] }],         // reads lbl/val
      ['roadmap', { lanes: [{ name: 'A', items: [{ title: 'x', t: 0, d: 2 }] }] }], // reads lbl
      // chartData pads missing values and coerces non-numbers to 0 — an all-zero fabricated chart
      ['chart', { chart: { categories: ['Q1'], series: [{ name: 'Revenue', values: [] }] } }],
      ['chart', { chart: { categories: ['Q1'], series: [{ name: 'Revenue', values: ['n/a', '', null] }] } }],
      ['chart', { chart: { categories: ['Q1'], series: [{ name: 'Revenue', values: ['n/a', 5] }] } }], // 5 is past the last category
    ];
    for (const [layout, reply] of cases) {
      const err = await buildDeck(one(layout), { generate: vi.fn(async () => reply) }).catch((e) => e);
      expect(err.reason, layout).toBe('slide');
    }
  });

  it('accepts layout content in the shape its renderer reads', async () => {
    const one = (layout) => ({ title: 'T', slides: [{ layout, title: layout, brief: '' }] });
    const cases = [
      ['kpi', { kpis: [{ label: 'Revenue', val: '$1M' }] }],
      ['agenda', { items: [{ n: '01', t: 'Intro' }] }],
      ['risks', { items: [{ sev: 'high', d: 'Churn' }] }],
      ['split', { stats: [{ lbl: 'NPS', val: 40 }] }],
      ['roadmap', { lanes: [{ name: 'A', items: [{ lbl: 'Ship', t: 0, d: 2 }] }] }],
      ['list', { items: ['a'] }],
      ['table', { columns: ['A'], rows: [['1']] }],
      ['text', { body: 'Hello' }],
      ['chart', { chart: { categories: ['Q1'], series: [{ name: 'Rev', values: [1] }] } }],
      ['chart', { chart: { categories: ['Q1', 'Q2'], series: [{ values: [null, '12.5'] }] } }], // numeric string
    ];
    for (const [layout, reply] of cases) {
      const deck = await buildDeck(one(layout), { generate: vi.fn(async () => reply) });
      expect(deck.slides[0].layout).toBe(layout);
    }
  });

  it('accepts a title-only cover, divider or thanks slide — the title is their content', async () => {
    const generate = vi.fn(async () => ({}));
    const titled = { title: 'T', slides: ['cover', 'divider', 'thanks'].map((layout) => ({ layout, title: layout, brief: '' })) };
    const deck = await buildDeck(titled, { generate });
    expect(deck.slides.map((s) => s.layout)).toEqual(['cover', 'divider', 'thanks']);
  });

  it('keeps partial slides even when generate rejects with a non-Error', async () => {
    const generate = vi.fn().mockResolvedValueOnce({ subtitle: 'ok' }).mockRejectedValueOnce('boom');
    let err;
    try { await buildDeck(outline, { generate }); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('boom');
    expect(err.partial).toHaveLength(1);
  });

  it('starts each slide from its layout template, so a rejected field keeps the template default', async () => {
    const generate = vi.fn(async () => ({ note: { not: 'text' }, kpis: KPIS, subtitle: 'ok' }));
    const deck = await buildDeck(outline, { generate });
    expect(deck.slides[1].note).toBe('edit values'); // the kpi template's note
  });

  it('falls back to the outline layout when the model switches to an invalid one', async () => {
    const generate = vi.fn(async () => ({ layout: 'hologram', subtitle: 'ok', kpis: KPIS }));
    const deck = await buildDeck(outline, { generate });
    expect(deck.slides.map((s) => s.layout)).toEqual(['cover', 'kpi', 'thanks']);
  });

  it('stops at a failure and hands back the slides already generated', async () => {
    const generate = vi.fn().mockResolvedValueOnce({ subtitle: 'ok' }).mockRejectedValueOnce(new Error('rate limited'));
    let err;
    try { await buildDeck(outline, { generate }); } catch (e) { err = e; }
    expect(err.message).toBe('rate limited');
    expect(err.partial.map((s) => s.title)).toEqual(['Q3 Review']);
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it('resumes after the slides already generated', async () => {
    const generate = vi.fn(async () => ({ subtitle: 'ok', kpis: KPIS }));
    const onProgress = vi.fn();
    const first = { id: 'kept', layout: 'cover', title: 'Q3 Review' };
    const deck = await buildDeck(outline, { generate, onProgress, done: [first] });
    expect(generate).toHaveBeenCalledTimes(2);
    expect(generate.mock.calls[0][0]).toContain('Numbers');
    expect(deck.slides[0]).toBe(first);
    expect(onProgress.mock.calls.map((c) => c[0])).toEqual([2, 3]);
  });
});
