import { describe, it, expect, vi } from 'vitest';
import { ensureAssets, sceneAssets } from './assets.js';
import { touchImage } from './paint.js';
import { createPaintEnv } from './paint.js';
import { buildScene } from './scene.js';

const box = { x: 0, y: 0, w: 100, h: 100 };
const scene = (elements) => buildScene({ layout: 'blank', elements });
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};
const noFonts = { check: () => false, load: vi.fn(async () => []) };

describe('sceneAssets', () => {
  it('lists each image source and each text font once', () => {
    const sc = scene([
      { id: 'a', type: 'image', ...box, src: 'data:a' },
      { id: 'b', type: 'image', ...box, src: 'data:a' },
      { id: 'c', type: 'image', ...box },
      { id: 'd', type: 'text', ...box, content: 'x', color: '#000000', fontFamily: 'Calibri', bold: true },
      { id: 'e', type: 'text', ...box, content: 'y', color: '#000000', fontFamily: 'Calibri', bold: true, fontSize: 12 },
      { id: 'f', type: 'text', ...box, content: 'z', color: '#000000' },
    ]);
    const { images, fonts } = sceneAssets(sc);
    expect(images).toEqual(['data:a']);
    expect(fonts).toHaveLength(2); // Calibri bold, and the default sans (size doesn't matter for loading)
    expect(fonts[0]).toMatch(/^normal bold 16px "Calibri", "Carlito"/);
  });
});

describe('ensureAssets', () => {
  it('decodes each image once, into the env, and reports that something changed', async () => {
    const env = createPaintEnv();
    const loadImage = vi.fn(async (src) => ({ decoded: src }));
    const sc = scene([{ id: 'a', type: 'image', ...box, src: 'data:a' }]);
    expect(await ensureAssets(sc, env, { loadImage, fonts: noFonts })).toBe(true);
    expect(env.images.get('data:a')).toEqual({ decoded: 'data:a' });
    expect(await ensureAssets(sc, env, { loadImage, fonts: noFonts })).toBe(false); // already there
    expect(loadImage).toHaveBeenCalledTimes(1);
  });

  it('shares one decode between callers that ask at the same time', async () => {
    const env = createPaintEnv();
    const d = deferred();
    const loadImage = vi.fn(() => d.promise);
    const sc = scene([{ id: 'a', type: 'image', ...box, src: 'data:a' }]);
    const first = ensureAssets(sc, env, { loadImage, fonts: noFonts });
    const second = ensureAssets(sc, env, { loadImage, fonts: noFonts });
    d.resolve('img');
    expect(await Promise.all([first, second])).toEqual([true, true]);
    expect(loadImage).toHaveBeenCalledTimes(1);
  });

  it('remembers a failed decode (the placeholder stays) instead of retrying on every paint', async () => {
    const env = createPaintEnv();
    const loadImage = vi.fn(async () => { throw new Error('bad image'); });
    const sc = scene([{ id: 'a', type: 'image', ...box, src: 'data:bad' }]);
    expect(await ensureAssets(sc, env, { loadImage, fonts: noFonts })).toBe(false);
    expect(env.images.get('data:bad')).toBe(false);
    await ensureAssets(sc, env, { loadImage, fonts: noFonts });
    expect(loadImage).toHaveBeenCalledTimes(1);
  });

  it('keeps a bounded number of decoded images, dropping the least recently used (never closing one a canvas may still draw)', async () => {
    const env = createPaintEnv({ imageLimit: 2 });
    const closed = [];
    const loadImage = async (src) => ({ src, close: () => closed.push(src) });
    const show = (src) => ensureAssets(scene([{ id: src, type: 'image', ...box, src }]), env, { loadImage, fonts: noFonts });
    await show('data:a');
    await show('data:b');
    touchImage(env, 'data:a'); // painted again: now the most recently used
    await show('data:c');
    expect([...env.images.keys()]).toEqual(['data:a', 'data:c']);
    expect(closed).toEqual([]);
  });

  it('loads each font once, and bumps the font epoch when one arrives (stale layouts go)', async () => {
    const env = createPaintEnv();
    const fonts = { check: () => false, load: vi.fn(async () => [{ family: 'Calibri' }]) };
    const sc = scene([{ id: 't', type: 'text', ...box, content: 'x', color: '#000000', fontFamily: 'Calibri' }]);
    expect(await ensureAssets(sc, env, { fonts })).toBe(true);
    expect(env.fontEpoch).toBe(1);
    expect(await ensureAssets(sc, env, { fonts })).toBe(false);
    expect(fonts.load).toHaveBeenCalledTimes(1);
    expect(env.fontEpoch).toBe(1);
  });

  it('leaves the epoch alone when nothing new loaded (a system font, or no font API at all)', async () => {
    const env = createPaintEnv();
    const sc = scene([{ id: 't', type: 'text', ...box, content: 'x', color: '#000000' }]);
    expect(await ensureAssets(sc, env, { fonts: noFonts })).toBe(false);
    expect(await ensureAssets(sc, createPaintEnv(), { fonts: undefined })).toBe(false);
    expect(env.fontEpoch).toBe(0);
  });

  it('tells every caller waiting on a font when it arrives, and bumps the epoch once', async () => {
    const env = createPaintEnv();
    const d = deferred();
    const fonts = { check: () => false, load: vi.fn(() => d.promise) };
    const sc = scene([{ id: 't', type: 'text', ...box, content: 'x', color: '#000000', fontFamily: 'Calibri' }]);
    const first = ensureAssets(sc, env, { fonts });
    const second = ensureAssets(sc, env, { fonts }); // e.g. a second thumbnail, or a rebuilt scene
    d.resolve([{ family: 'Calibri' }]);
    expect(await Promise.all([first, second])).toEqual([true, true]);
    expect(fonts.load).toHaveBeenCalledTimes(1);
    expect(env.fontEpoch).toBe(1);
  });

  it('skips a font the browser already has (no load, no epoch bump, nothing to repaint)', async () => {
    const env = createPaintEnv();
    const fonts = { check: () => true, load: vi.fn(async () => [{ family: 'Inter' }]) };
    const sc = scene([{ id: 't', type: 'text', ...box, content: 'x', color: '#000000' }]);
    expect(await ensureAssets(sc, env, { fonts })).toBe(false);
    expect(fonts.load).not.toHaveBeenCalled();
    expect(env.fontEpoch).toBe(0);
  });

  it('treats a font that fails to load as loaded (the fallback is what gets measured)', async () => {
    const env = createPaintEnv();
    const fonts = { check: () => false, load: vi.fn(async () => { throw new Error('network'); }) };
    const sc = scene([{ id: 't', type: 'text', ...box, content: 'x', color: '#000000', fontFamily: 'Nope' }]);
    expect(await ensureAssets(sc, env, { fonts })).toBe(false);
    await ensureAssets(sc, env, { fonts });
    expect(fonts.load).toHaveBeenCalledTimes(1);
  });
});
