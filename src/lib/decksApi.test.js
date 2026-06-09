import { describe, it, expect, vi } from 'vitest';
import { listDecks, createDeck, openDeck, renameDeck, deleteDeck, themeTint, initials, relativeTime } from './decksApi.js';

const resolving = (value) => vi.fn().mockResolvedValue({ ok: true, json: async () => value });
const failing = (status = 500) => vi.fn().mockResolvedValue({ ok: false, status, json: async () => ({ error: 'boom' }) });

describe('decksApi requests', () => {
  it('listDecks GETs /api/decks', async () => {
    const fetchFn = resolving([{ id: 'a' }]);
    const r = await listDecks(fetchFn);
    expect(fetchFn).toHaveBeenCalledWith('/api/decks');
    expect(r).toEqual([{ id: 'a' }]);
  });

  it('createDeck POSTs the name', async () => {
    const fetchFn = resolving({ id: 'new', name: 'Hi' });
    const r = await createDeck('Hi', null, fetchFn);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('/api/decks');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ name: 'Hi' });
    expect(r.id).toBe('new');
  });

  it('createDeck sends an empty body when no name or deck is given', async () => {
    const fetchFn = resolving({ id: 'new' });
    await createDeck(undefined, null, fetchFn);
    expect(JSON.parse(fetchFn.mock.calls[0][1].body)).toEqual({});
  });

  it('createDeck seeds the deck content when given one (templates)', async () => {
    const fetchFn = resolving({ id: 'new', name: 'Atlas' });
    const seed = { title: 'Atlas', theme: 'slate', sections: [], slides: [] };
    await createDeck('Atlas', seed, fetchFn);
    expect(JSON.parse(fetchFn.mock.calls[0][1].body)).toEqual({ name: 'Atlas', deck: seed });
  });

  it('openDeck activates the deck by id (encoded) and returns it', async () => {
    const fetchFn = resolving({ deck: { theme: 'amber' }, rev: 3 });
    const r = await openDeck('d 1', fetchFn);
    expect(fetchFn).toHaveBeenCalledWith('/api/decks/d%201/activate', { method: 'POST' });
    expect(r.rev).toBe(3);
  });

  it('renameDeck PUTs the new name to the deck', async () => {
    const fetchFn = resolving({ id: 'd1', name: 'New' });
    const r = await renameDeck('d1', 'New', fetchFn);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('/api/decks/d1');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toEqual({ name: 'New' });
    expect(r.name).toBe('New');
  });

  it('deleteDeck DELETEs the deck by id (encoded)', async () => {
    const fetchFn = resolving({ ok: true });
    await deleteDeck('d 1', fetchFn);
    expect(fetchFn).toHaveBeenCalledWith('/api/decks/d%201', { method: 'DELETE' });
  });

  it('rejects on a non-ok HTTP response instead of parsing an error body as data', async () => {
    await expect(listDecks(failing(500))).rejects.toThrow();
    await expect(createDeck('x', null, failing(500))).rejects.toThrow();
    await expect(openDeck('x', failing(404))).rejects.toThrow();
    await expect(renameDeck('x', 'y', failing(404))).rejects.toThrow();
    await expect(deleteDeck('x', failing(404))).rejects.toThrow();
  });
});

describe('decksApi view-model helpers', () => {
  it('themeTint maps known themes and falls back to indigo', () => {
    expect(themeTint('emerald')).toMatch(/^oklch/);
    expect(themeTint('emerald')).not.toBe(themeTint('coral'));
    expect(themeTint('nonsense')).toBe(themeTint('indigo'));
    expect(themeTint(undefined)).toBe(themeTint('indigo'));
  });

  it('initials builds up to three uppercase letters', () => {
    expect(initials('Meet Stagecraft')).toBe('MS');
    expect(initials('2026 GTM Plan')).toBe('2GP');
    expect(initials('April Board Deck Extra')).toBe('ABD'); // capped at 3
    expect(initials('   ')).toBe('??');
  });

  it('initials tolerates non-string input', () => {
    expect(initials(2026)).toBe('2');   // coerced, no throw
    expect(initials(null)).toBe('??');
  });

  it('relativeTime buckets durations from a fixed now', () => {
    const now = 1_000_000_000_000;
    expect(relativeTime(now, now)).toBe('just now');
    expect(relativeTime(now - 30_000, now)).toBe('just now');
    expect(relativeTime(now - 5 * 60_000, now)).toBe('5m');
    expect(relativeTime(now - 3 * 3_600_000, now)).toBe('3h');
    expect(relativeTime(now - 2 * 86_400_000, now)).toBe('2d');
    expect(relativeTime(now - 2 * 7 * 86_400_000, now)).toBe('2w');
    expect(relativeTime(now - 60 * 86_400_000, now)).toBe('2mo');
  });

  it('relativeTime returns a dash for non-finite input', () => {
    expect(relativeTime(NaN, 1000)).toBe('—');
    expect(relativeTime('oops', 1000)).toBe('—');
  });
});
