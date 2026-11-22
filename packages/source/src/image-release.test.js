import { expect, it, vi } from 'vitest';
import { writePptx } from '../../pptx/src/index.js';
import { openPresentation } from './index.js';
import { createEditor } from '@stagecraft/core';
import { documentPlugin, presentationPlugin, validateDocument } from '@stagecraft/core/document';

const PNG_1PX = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), c => c.charCodeAt(0));
const packageBytes = () => writePptx({ sections: [{ id: 'sec', slides: ['s'] }], slides: [{ id: 's', layout: 'blank', elements: [] }] });

it('releases an uncommitted registration and restores the image-count quota', async () => {
  const s = await openPresentation(await packageBytes(), { format: 'pptx' });
  try {
    const first = s.registerImage({ bytes: PNG_1PX, contentType: 'image/png' });
    expect(s.getImage(first.assetId)).not.toBeNull();
    expect(first.release()).toBe(true);
    expect(s.getImage(first.assetId)).toBeNull();
    expect(s.images).not.toContain(first.assetId);
    // Filling the session to the image-count limit and releasing one restores the quota.
    const fillers = [];
    for (let i = 0; i < 64; i++) fillers.push(s.registerImage({ bytes: PNG_1PX, contentType: 'image/png' }));
    expect(() => s.registerImage({ bytes: PNG_1PX, contentType: 'image/png' })).toThrow(/count limit/);
    expect(fillers[0].release()).toBe(true);
    expect(() => s.registerImage({ bytes: PNG_1PX, contentType: 'image/png' })).not.toThrow();
  } finally { s.dispose(); }
});

it('releases an uncommitted registration and restores the total-byte quota', async () => {
  const s = await openPresentation(await packageBytes(), { format: 'pptx' });
  try {
    // maxTotalBytes is 32 MiB with a 5 MiB per-image ceiling: six fill it to 30 MiB.
    const big = new Uint8Array(5 * 1024 * 1024);
    big.set(PNG_1PX);
    const handles = [];
    for (let i = 0; i < 6; i++) handles.push(s.registerImage({ bytes: big, contentType: 'image/png' }));
    expect(() => s.registerImage({ bytes: big, contentType: 'image/png' })).toThrow(/total byte limit/);
    expect(handles[0].release()).toBe(true);
    expect(() => s.registerImage({ bytes: big, contentType: 'image/png' })).not.toThrow();
  } finally { s.dispose(); }
});

it('issues monotonic unique asset ids so release cannot collide with a later registration', async () => {
  // Freeze Date.now so the pre-fix size+millisecond id scheme collides deterministically.
  const clock = vi.spyOn(Date, 'now').mockReturnValue(1700000000000);
  const s = await openPresentation(await packageBytes(), { format: 'pptx' });
  try {
    const a = s.registerImage({ bytes: PNG_1PX, contentType: 'image/png' });
    const b = s.registerImage({ bytes: PNG_1PX, contentType: 'image/png' });
    expect(b.assetId).not.toBe(a.assetId);
    a.release();
    const c = s.registerImage({ bytes: PNG_1PX, contentType: 'image/png' });
    expect(c.assetId).not.toBe(a.assetId);
    expect(c.assetId).not.toBe(b.assetId);
    // The surviving registrations stay addressable with their own bytes.
    expect(s.getImage(b.assetId)).not.toBeNull();
    expect(s.getImage(c.assetId)).not.toBeNull();
  } finally { clock.mockRestore(); s.dispose(); }
});

it('preserves committed and undo-reachable assets and refuses their release', async () => {
  const s = await openPresentation(await packageBytes(), { format: 'pptx' });
  const editor = createEditor({ document: s.document, validateDocument, plugins: [documentPlugin, presentationPlugin] });
  try {
    const handle = s.registerImage({ bytes: PNG_1PX, contentType: 'image/png' });
    const object = { id: 'img', type: 'image', geometry: { x: 12700, y: 12700, width: 100000, height: 100000 }, extensions: { stagecraftAuthored: true }, image: { assetId: handle.assetId } };
    editor.dispatch('presentation.addImage', { slideId: s.document.slides[0].id, object, asset: { id: handle.assetId, contentType: 'image/png' } });
    handle.commit();
    // Even after undo removes the live reference, the redo history still needs the bytes.
    editor.undo();
    expect(handle.release()).toBe(false);
    expect(s.getImage(handle.assetId)).not.toBeNull();
    editor.redo();
    const exported = await s.export(editor.getSnapshot().document);
    expect(exported.dirtyParts.length).toBeGreaterThan(0);
  } finally { editor.dispose(); s.dispose(); }
});

it('treats release as idempotent and refuses committing a released registration', async () => {
  const s = await openPresentation(await packageBytes(), { format: 'pptx' });
  try {
    const handle = s.registerImage({ bytes: PNG_1PX, contentType: 'image/png' });
    expect(handle.release()).toBe(true);
    expect(handle.release()).toBe(false);
    expect(() => handle.commit()).toThrow(/released/);
    // No negative quota: the session accepts further registrations afterwards.
    expect(() => s.registerImage({ bytes: PNG_1PX, contentType: 'image/png' })).not.toThrow();
  } finally { s.dispose(); }
});

it('refuses release on a disposed session like every other session call', async () => {
  const s = await openPresentation(await packageBytes(), { format: 'pptx' });
  const handle = s.registerImage({ bytes: PNG_1PX, contentType: 'image/png' });
  s.dispose();
  expect(() => handle.release()).toThrow(/disposed/);
});
