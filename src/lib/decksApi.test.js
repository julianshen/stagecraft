import { describe, it, expect, vi } from 'vitest';
import { listDecks, createDeck, openDeck, themeTint, initials, relativeTime } from './decksApi.js';

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
    const r = await createDeck('Hi', fetchFn);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('/api/decks');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ name: 'Hi' });
    expect(r.id).toBe('new');
  });

  it('createDeck sends an empty body when no name is given', async () => {
    const fetchFn = resolving({ id: 'new' });
    await createDeck(undefined, fetchFn);
    expect(JSON.parse(fetchFn.mock.calls[0][1].body)).toEqual({});
  });

  it('openDeck activates the deck by id (encoded) and returns it', async () => {
    const fetchFn = resolving({ deck: { theme: 'amber' }, rev: 3 });
    const r = await openDeck('d 1', fetchFn);
    expect(fetchFn).toHaveBeenCalledWith('/api/decks/d%201/activate', { method: 'POST' });
    expect(r.rev).toBe(3);
  });

  it('rejects on a non-ok HTTP response instead of parsing an error body as data', async () => {
    await expect(listDecks(failing(500))).rejects.toThrow();
    await expect(createDeck('x', failing(500))).rejects.toThrow();
    await expect(openDeck('x', failing(404))).rejects.toThrow();
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
});
