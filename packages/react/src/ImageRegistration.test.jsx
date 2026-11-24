import { act, fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { createEditor } from '@stagecraft/core';
import { createDocument, documentPlugin, presentationPlugin, validateDocument } from '@stagecraft/core/document';
import { writePptx } from '../../pptx/src/index.js';
import { openPresentation } from '@stagecraft/source';
import { EditorProvider } from './EditorProvider.jsx';
import { PresentationEditor } from './PresentationEditor.jsx';

const PNG_1PX = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), c => c.charCodeAt(0));
// createDocument supplies assets/layouts/masters/relationships; a hand-built partial document
// makes the addImage apply throw (d.assets undefined), which reads as a denied dispatch.
const canonicalDoc = () => createDocument({ slides: [{ id: 's1', objects: [] }] });
const CAPABILITIES = { readOnly: false, edits: ['object-image', 'object-structure', 'slide-structure'] };

async function fireImageInput() {
  fireEvent.click(screen.getByRole('tab', { name: 'Insert' }));
  const input = document.querySelector('input[type="file"][accept="image/png,image/jpeg"]');
  const file = new File([PNG_1PX], 'chart.png', { type: 'image/png' });
  file.arrayBuffer = async () => PNG_1PX.buffer;
  await act(async () => { fireEvent.change(input, { target: { files: [file] } }); });
}

function mount(editor, source) {
  return render(<EditorProvider editor={editor}><PresentationEditor source={source} /></EditorProvider>);
}

it('releases the registration when the addImage dispatch is denied', async () => {
  const handle = { assetId: 'asset-img-1', contentType: 'image/png', commit: vi.fn(), release: vi.fn(() => true) };
  const source = { capabilities: CAPABILITIES, registerImage: vi.fn(() => handle), getImage: vi.fn(), export: vi.fn() };
  const editor = createEditor({ document: canonicalDoc(), plugins: [documentPlugin, presentationPlugin], authorize: () => false });
  mount(editor, source);
  await fireImageInput();
  expect(source.registerImage).toHaveBeenCalledTimes(1);
  expect(handle.release).toHaveBeenCalledTimes(1);
  expect(handle.commit).not.toHaveBeenCalled();
  expect(editor.getSnapshot().revision).toBe(0);
});

it('keeps committed bytes and never releases them when the insert succeeds', async () => {
  const handle = { assetId: 'asset-img-1', contentType: 'image/png', commit: vi.fn(), release: vi.fn(() => true) };
  const source = { capabilities: CAPABILITIES, registerImage: vi.fn(() => handle), getImage: vi.fn(), export: vi.fn() };
  const editor = createEditor({ document: canonicalDoc(), plugins: [documentPlugin, presentationPlugin] });
  mount(editor, source);
  await fireImageInput();
  expect(handle.commit).toHaveBeenCalledTimes(1);
  expect(handle.release).not.toHaveBeenCalled();
  expect(editor.getSnapshot().document.slides[0].objects.some(o => o.type === 'image')).toBe(true);
});

it('never rolls back committed bytes when a post-commit callback throws', async () => {
  const handle = { assetId: 'asset-img-1', contentType: 'image/png', commit: vi.fn(() => { throw Error('commit bookkeeping failed'); }), release: vi.fn(() => true) };
  const source = { capabilities: CAPABILITIES, registerImage: vi.fn(() => handle), getImage: vi.fn(), export: vi.fn() };
  const editor = createEditor({ document: canonicalDoc(), plugins: [documentPlugin, presentationPlugin] });
  mount(editor, source);
  await fireImageInput();
  expect(handle.commit).toHaveBeenCalledTimes(1);
  expect(handle.release).not.toHaveBeenCalled();
  expect(editor.getSnapshot().document.slides[0].objects.some(o => o.type === 'image')).toBe(true);
  expect(screen.getByRole('alert')).toHaveTextContent('IMAGE_COMMIT_FAILED');
});

it('reports the original denial, not a rollback failure, when the source cannot release', async () => {
  const handle = { assetId: 'asset-img-1', contentType: 'image/png', commit: vi.fn(), release: vi.fn(() => { throw Error('session is dead'); }) };
  const source = { capabilities: CAPABILITIES, registerImage: vi.fn(() => handle), getImage: vi.fn(), export: vi.fn() };
  const editor = createEditor({ document: canonicalDoc(), plugins: [documentPlugin, presentationPlugin], authorize: () => false });
  mount(editor, source);
  await fireImageInput();
  expect(handle.release).toHaveBeenCalledTimes(1);
  expect(editor.getSnapshot().revision).toBe(0);
  expect(screen.getByRole('alert')).toHaveTextContent('UNAUTHORIZED');
  expect(screen.getByRole('alert')).toHaveTextContent('IMAGE_RELEASE_FAILED');
});

it('leaves no quota leak on a real source session after a denied insert', async () => {
  const original = await writePptx({ sections: [{ id: 'sec', slides: ['s'] }], slides: [{ id: 's', layout: 'blank', elements: [] }] });
  const session = await openPresentation(original, { format: 'pptx' });
  const editor = createEditor({ document: session.document, validateDocument, plugins: [documentPlugin, presentationPlugin], authorize: () => false });
  try {
    mount(editor, session);
    await fireImageInput();
    expect(session.images).toHaveLength(0);
    expect(await session.export(session.document).then(r => [...r.bytes])).toEqual([...new Uint8Array(original)]);
  } finally { editor.dispose(); session.dispose(); }
});
