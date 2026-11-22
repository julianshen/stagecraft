import React, { useState, useSyncExternalStore } from 'react';
import { render, fireEvent, cleanup, act } from '@testing-library/react';
import { afterEach, it, expect, vi } from 'vitest';
import { cdp } from '@vitest/browser/context';
import { createEditor } from '../../packages/core/src/editor/index.js';
import { createDocument, documentPlugin, presentationPlugin } from '../../packages/core/src/document/index.js';
import { CanonicalKonvaStage } from './CanonicalKonvaStage.jsx';
afterEach(cleanup);
export function fixture(authorize) {
  return createEditor({ document: createDocument({ size: { width: 1270000, height: 635000 }, slides: [{ id: 's', objects: [
    { id: 'r', type: 'shape', shape: 'rect', fill: '#123456', geometry: { x: 127000, y: 127000, width: 254000, height: 127000 }, extensions: { editableGeometry: true } },
    { id: 'opaque', type: 'opaque', geometry: { x: 508000, y: 127000, width: 254000, height: 127000 } },
  ] }] }), plugins: [documentPlugin, presentationPlugin], authorize });
}
const ownerKey = {}, policyKey = {};
function Host({ editor, onMove, sourceCapabilities = { geometry: true }, ...props }) {
  const snapshot = useSyncExternalStore(editor.subscribe, editor.getSnapshot);
  const [selection, onSelectionChange] = useState({ slideId: 's', objectId: null });
  return <CanonicalKonvaStage snapshot={snapshot} slideId="s" selection={selection} onSelectionChange={onSelectionChange}
    ownerKey={ownerKey} policyKey={policyKey} viewport={{ width: 400, height: 200 }} canMove={() => sourceCapabilities.geometry && editor.getCommands().some(command => command.id === 'presentation.setGeometry')}
    onMove={request => { onMove?.(request); const { expectedRevision, ...payload } = request; const object = snapshot.document.slides.find(s => s.id === payload.slideId).objects.find(o => o.id === payload.objectId); return editor.dispatch('presentation.setGeometry', { ...payload, geometry: { ...object.geometry, ...payload.geometry } }, { expectedRevision, origin: 'konva-spike' }); }} {...props} />;
}
it('defaults to read-only but permits DOM selection with no history', () => {
  const editor = fixture(); const ui = render(<Host editor={editor} />);
  fireEvent.click(ui.getByRole('button', { name: 'Select r' }));
  fireEvent.keyDown(ui.getByRole('region', { name: 'Canonical slide canvas' }), { key: 'ArrowRight' });
  expect(editor.getSnapshot().revision).toBe(0);
  expect(ui.getByRole('button', { name: 'Select r' }).getAttribute('aria-pressed')).toBe('true');
  expect(ui.getByText(/opaque.*placeholder/)).toBeTruthy();
});
it('moves through the real core once, preserves focus and undoes exactly', () => {
  const editor = fixture(); const before = editor.getSnapshot().document; const moves = vi.fn();
  const ui = render(<Host editor={editor} readOnly={false} onMove={moves} />);
  const button = ui.getByRole('button', { name: 'Select r' }); button.focus(); fireEvent.click(button);
  fireEvent.keyDown(button, { key: 'ArrowRight' });
  expect(moves).toHaveBeenCalledTimes(1);
  expect(editor.getSnapshot().document.slides[0].objects[0].geometry.x).toBe(139700);
  expect(editor.getSnapshot().revision).toBe(1);
  expect(document.activeElement).toBe(button);
  editor.undo(); expect(editor.getSnapshot().document).toEqual(before);
});
it('reports real authorization denial and leaves document/history untouched', () => {
  const editor = fixture(() => false); const onError = vi.fn();
  const ui = render(<Host editor={editor} readOnly={false} onError={onError} />);
  fireEvent.click(ui.getByRole('button', { name: 'Select r' }));
  fireEvent.keyDown(ui.getByRole('region'), { key: 'ArrowRight' });
  expect(editor.getSnapshot().revision).toBe(0); expect(editor.getSnapshot().canUndo).toBe(false);
  expect(onError).toHaveBeenCalledTimes(1); expect(ui.getByRole('alert').textContent).toContain('UNAUTHORIZED');
});
function pointer(ui, type, x, y, target, extra = {}) {
  const canvas = ui.container.querySelector('canvas');
  const rect = canvas.getBoundingClientRect();
  fireEvent(target ?? (type === 'pointerdown' ? canvas : window), new PointerEvent(type, {
    bubbles: true, pointerId: 1, isPrimary: true, pointerType: 'mouse', button: 0, buttons: type === 'pointerup' ? 0 : 1,
    clientX: rect.left + x, clientY: rect.top + y, ...extra,
  }));
}
it('previews pointer movement, commits once and preserves all non-position geometry', () => {
  const editor = fixture(); const initial = editor.getSnapshot().document;
  // Rotation is outside the emitted x/y patch.
  const doc = structuredClone(initial); doc.slides[0].objects[0].geometry.rotation = 90;
  const native = createEditor({ document: doc, plugins: [documentPlugin, presentationPlugin] });
  const moves = vi.fn(); const ui = render(<Host editor={native} readOnly={false} onMove={moves} />);
  pointer(ui, 'pointerdown', 80, 60); pointer(ui, 'pointermove', 120, 80);
  expect(native.getSnapshot().revision).toBe(0);
  pointer(ui, 'pointerup', 120, 80);
  expect(moves).toHaveBeenCalledTimes(1);
  expect(moves.mock.calls[0][0].geometry).toEqual({ x: 254000, y: 190500 });
  expect(native.getSnapshot().document.slides[0].objects[0].geometry).toEqual({ ...doc.slides[0].objects[0].geometry, x: 254000, y: 190500 });
  native.undo(); expect(native.getSnapshot().document).toEqual(doc);
});
it.each(['Escape', 'blur', 'pointercancel', 'lostpointercapture'])('cancels %s without a command', cancelEvent => {
  const editor = fixture(); const moves = vi.fn(); const ui = render(<Host editor={editor} readOnly={false} onMove={moves} />);
  pointer(ui, 'pointerdown', 60, 60); pointer(ui, 'pointermove', 100, 80);
  if (cancelEvent === 'Escape') fireEvent.keyDown(window, { key: 'Escape' });
  else fireEvent(cancelEvent === 'lostpointercapture' ? ui.container.querySelector('.konvajs-content') : window, new PointerEvent(cancelEvent, { bubbles: true, pointerId: 1 }));
  pointer(ui, 'pointerup', 100, 80);
  expect(moves).not.toHaveBeenCalled(); expect(editor.getSnapshot().revision).toBe(0);
});
it.each([0.5, 1, 2])('moves by the same points at zoom %s', zoom => {
  const source = fixture().getSnapshot().document; const doc = structuredClone(source); doc.slides[0].objects[0].geometry.x = 508000; doc.slides[0].objects[0].geometry.y = 254000;
  const editor = createEditor({ document: doc, plugins: [documentPlugin, presentationPlugin] }); const ui = render(<Host editor={editor} readOnly={false} zoom={zoom} />);
  const x = (400 - 400 * zoom) / 2 + 200 * zoom, y = (200 - 200 * zoom) / 2 + 100 * zoom;
  pointer(ui, 'pointerdown', x, y); pointer(ui, 'pointermove', x + 20 * zoom, y + 10 * zoom); pointer(ui, 'pointerup', x + 20 * zoom, y + 10 * zoom);
  expect(editor.getSnapshot().document.slides[0].objects[0].geometry.x).toBe(571500);
});
it('fails closed on unknown geometry fields instead of dropping them', () => {
  const doc = structuredClone(fixture().getSnapshot().document); doc.slides[0].objects[0].geometry.nativeMarker = 'keep';
  const editor = createEditor({ document: doc, plugins: [documentPlugin, presentationPlugin] });
  const ui = render(<Host editor={editor} readOnly={false} />);
  fireEvent.click(ui.getByRole('button', { name: 'Select r' })); fireEvent.keyDown(ui.getByRole('region'), { key: 'ArrowRight' });
  expect(ui.getByRole('alert').textContent).toBe('INVALID_PAYLOAD');
  expect(editor.getSnapshot().document).toEqual(doc); expect(editor.getSnapshot().revision).toBe(0);
});
it.each(['readOnly', 'owner', 'policy', 'viewport', 'capability', 'slide'])('cancels when %s changes', change => {
  const editor = fixture(); const moves = vi.fn(); const ui = render(<Host editor={editor} readOnly={false} onMove={moves} />);
  pointer(ui, 'pointerdown', 60, 60); pointer(ui, 'pointermove', 100, 80);
  const props = { readOnly: { readOnly: true }, owner: { ownerKey: {} }, policy: { policyKey: {} },
    viewport: { viewport: { width: 420, height: 200 } }, capability: { canMove: () => false }, slide: { slideId: null } }[change];
  ui.rerender(<Host editor={editor} readOnly={false} onMove={moves} {...props} />);
  // Unavailable slide has no canvas; send the late event directly.
  fireEvent(window, new PointerEvent('pointerup', { pointerId: 1, clientX: 100, clientY: 80 }));
  expect(moves).not.toHaveBeenCalled(); expect(editor.getSnapshot().revision).toBe(0);
});
it('rejects stale pointer completion after a real competing transaction', () => {
  const editor = fixture(); const moves = vi.fn(); const ui = render(<Host editor={editor} readOnly={false} onMove={moves} />);
  pointer(ui, 'pointerdown', 60, 60); pointer(ui, 'pointermove', 100, 80);
  editor.dispatch('presentation.setGeometry', { slideId: 's', objectId: 'r', geometry: { x: 381000, y: 127000, width: 254000, height: 127000 } });
  pointer(ui, 'pointerup', 100, 80);
  expect(editor.getSnapshot().revision).toBe(1); expect(editor.getSnapshot().document.slides[0].objects[0].geometry.x).toBe(381000);
});
it('does not commit a return-to-origin gesture', () => {
  const editor = fixture(); const moves = vi.fn(); const ui = render(<Host editor={editor} readOnly={false} onMove={moves} />);
  pointer(ui, 'pointerdown', 60, 60); pointer(ui, 'pointermove', 100, 80); pointer(ui, 'pointerup', 60, 60);
  expect(moves).not.toHaveBeenCalled(); expect(editor.getSnapshot().revision).toBe(0);
});
const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
function pixel(ui, x, y) {
  const canvas = ui.container.querySelector('canvas');
  const scale = canvas.width / parseFloat(canvas.style.width);
  return [...canvas.getContext('2d').getImageData(x * scale, y * scale, 1, 1).data];
}
it.each(['rect', 'ellipse'])('restores actual %s node pixels after cancellation', async shape => {
  const doc = structuredClone(fixture().getSnapshot().document); doc.slides[0].objects[0].shape = shape;
  const editor = createEditor({ document: doc, plugins: [documentPlugin, presentationPlugin] });
  const ui = render(<Host editor={editor} readOnly={false} />); await frame();
  expect(pixel(ui, 80, 60)).toEqual([18, 52, 86, 255]);
  pointer(ui, 'pointerdown', 80, 60); pointer(ui, 'pointermove', 120, 80); await frame();
  expect(pixel(ui, 130, 80)).toEqual([18, 52, 86, 255]);
  fireEvent.keyDown(window, { key: 'Escape' }); await frame();
  expect(pixel(ui, 80, 60)).toEqual([18, 52, 86, 255]);
  expect(pixel(ui, 130, 80)[3]).toBe(0);
  expect(editor.getSnapshot().revision).toBe(0);
});
it('isolates two editors and does not dispose the surviving editor on unmount', () => {
  const one = fixture(), two = fixture(); const first = render(<Host editor={one} readOnly={false} />), second = render(<Host editor={two} readOnly={false} />);
  fireEvent.click(first.container.querySelector('button'));
  fireEvent.keyDown(first.container.querySelector('section'), { key: 'ArrowRight' });
  expect(one.getSnapshot().revision).toBe(1); expect(two.getSnapshot().revision).toBe(0);
  first.unmount();
  fireEvent.click(second.container.querySelector('button'));
  fireEvent.keyDown(second.container.querySelector('section'), { key: 'ArrowRight' });
  expect(two.getSnapshot().revision).toBe(1); one.undo(); expect(one.getSnapshot().canRedo).toBe(true);
});
it('inverts an outer CSS scale during pointer movement', () => {
  const editor = fixture(); const ui = render(<div style={{ transform: 'scale(0.5)', transformOrigin: 'top left' }}><Host editor={editor} readOnly={false} /></div>);
  pointer(ui, 'pointerdown', 40, 30); pointer(ui, 'pointermove', 60, 40); pointer(ui, 'pointerup', 60, 40);
  expect(editor.getSnapshot().document.slides[0].objects[0].geometry.x).toBe(254000);
});
it('clears a missing selection target without modifying the document', () => {
  const editor = fixture(), changed = vi.fn();
  render(<CanonicalKonvaStage snapshot={editor.getSnapshot()} slideId="s" selection={{ slideId: 's', objectId: 'missing' }} onSelectionChange={changed} viewport={{ width: 400, height: 200 }} />);
  expect(changed).toHaveBeenCalledWith({ slideId: 's', objectId: null }); expect(editor.getSnapshot().revision).toBe(0);
});
it.each(['delete', 'replace', 'unmount', 'select'])('cancels after target %s', action => {
  const editor = fixture(); const moves = vi.fn(); const ui = render(<Host editor={editor} readOnly={false} onMove={moves} />);
  pointer(ui, 'pointerdown', 60, 60); pointer(ui, 'pointermove', 100, 80);
  if (action === 'delete') act(() => editor.dispatch('presentation.removeObject', { slideId: 's', objectId: 'r' }));
  if (action === 'replace') ui.rerender(<Host editor={fixture()} readOnly={false} onMove={moves} ownerKey={{}} />);
  if (action === 'unmount') ui.unmount();
  if (action === 'select') fireEvent.click(ui.getByRole('button', { name: 'Select opaque' }));
  fireEvent(window, new PointerEvent('pointerup', { pointerId: 1, clientX: 100, clientY: 80 }));
  expect(moves).not.toHaveBeenCalled();
});
it('does not move unsupported placeholders or rotated ODP shapes', () => {
  const doc = structuredClone(fixture().getSnapshot().document); doc.extensions.sourceFormat = 'odp'; doc.slides[0].objects[0].geometry.rotation = 90;
  const editor = createEditor({ document: doc, plugins: [documentPlugin, presentationPlugin] });
  const ui = render(<Host editor={editor} readOnly={false} />);
  pointer(ui, 'pointerdown', 80, 60); pointer(ui, 'pointermove', 100, 80); pointer(ui, 'pointerup', 100, 80);
  fireEvent.click(ui.getByRole('button', { name: 'Select opaque' })); fireEvent.keyDown(ui.getByRole('region'), { key: 'ArrowRight' });
  expect(editor.getSnapshot().revision).toBe(0);
});
it('ignores text input shortcuts and clears selection on blank canvas', () => {
  const editor = fixture(); const ui = render(<Host editor={editor} readOnly={false} />);
  fireEvent.click(ui.getByRole('button', { name: 'Select r' }));
  const input = document.createElement('input'); ui.getByRole('region').appendChild(input);
  fireEvent.keyDown(input, { key: 'ArrowRight' }); expect(editor.getSnapshot().revision).toBe(0); input.remove();
  pointer(ui, 'pointerdown', 390, 190);
  expect(ui.getByRole('button', { name: 'Select r' }).getAttribute('aria-pressed')).toBe('false');
});
it('restores pixels after a denied pointer move without retrying', async () => {
  const editor = fixture(() => false), errors = vi.fn(); const ui = render(<Host editor={editor} readOnly={false} onError={errors} />);
  pointer(ui, 'pointerdown', 80, 60); pointer(ui, 'pointermove', 120, 80); pointer(ui, 'pointerup', 120, 80); await frame();
  expect(pixel(ui, 80, 60)).toEqual([18, 52, 86, 255]); expect(pixel(ui, 130, 80)[3]).toBe(0);
  expect(errors).toHaveBeenCalledTimes(1); expect(editor.getSnapshot().revision).toBe(0);
});
it('ignores non-primary pointers and unrelated pointer cancellation', () => {
  const editor = fixture(); const ui = render(<Host editor={editor} readOnly={false} />);
  const canvas = ui.container.querySelector('canvas'), r = canvas.getBoundingClientRect();
  fireEvent(canvas, new PointerEvent('pointerdown', { bubbles: true, pointerId: 2, isPrimary: false, button: 0, clientX: r.left + 80, clientY: r.top + 60 }));
  fireEvent(window, new PointerEvent('pointerup', { pointerId: 2, clientX: r.left + 120, clientY: r.top + 80 }));
  expect(editor.getSnapshot().revision).toBe(0);
  pointer(ui, 'pointerdown', 80, 60); pointer(ui, 'pointermove', 120, 80);
  fireEvent(window, new PointerEvent('pointercancel', { pointerId: 99 }));
  pointer(ui, 'pointerup', 120, 80);
  expect(editor.getSnapshot().revision).toBe(1);
});
it('cancels and restores a preview when host policy throws', async () => {
  const editor = fixture(); let throws = false; const error = new Error('policy unavailable'), onError = vi.fn();
  const ui = render(<Host editor={editor} readOnly={false} onError={onError} canMove={() => { if (throws) throw error; return true; }} />);
  pointer(ui, 'pointerdown', 80, 60); pointer(ui, 'pointermove', 120, 80); throws = true;
  pointer(ui, 'pointerup', 120, 80); await frame();
  expect(editor.getSnapshot().revision).toBe(0); expect(onError).toHaveBeenCalledWith(error);
  expect(pixel(ui, 80, 60)).toEqual([18, 52, 86, 255]); expect(pixel(ui, 130, 80)[3]).toBe(0);
});
it.each(['', 'plaintext-only'])('ignores contenteditable=%s targets', value => {
  const editor = fixture(); const ui = render(<Host editor={editor} readOnly={false} />);
  fireEvent.click(ui.getByRole('button', { name: 'Select r' }));
  const input = document.createElement('div'); input.setAttribute('contenteditable', value); ui.getByRole('region').appendChild(input);
  fireEvent.keyDown(input, { key: 'ArrowRight' }); expect(editor.getSnapshot().revision).toBe(0); input.remove();
});
it.each(['command', 'source'])('host eligibility cancels %s capability loss', kind => {
  const editor = fixture(), sourceCapabilities = { geometry: true }, moves = vi.fn();
  const ui = render(<Host editor={editor} sourceCapabilities={sourceCapabilities} readOnly={false} onMove={moves} />);
  pointer(ui, 'pointerdown', 80, 60); pointer(ui, 'pointermove', 120, 80);
  if (kind === 'command') editor.unregisterPlugin('canonical-presentation'); else sourceCapabilities.geometry = false;
  pointer(ui, 'pointerup', 120, 80);
  expect(moves).not.toHaveBeenCalled(); expect(editor.getSnapshot().revision).toBe(0);
});
it('cancels and restores when pointermove reports buttons=0 (lost pointerup)', async () => {
  const editor = fixture(); const moves = vi.fn();
  const ui = render(<Host editor={editor} readOnly={false} onMove={moves} />);
  pointer(ui, 'pointerdown', 80, 60);
  pointer(ui, 'pointermove', 120, 80);
  await frame();
  expect(pixel(ui, 130, 80)).toEqual([18, 52, 86, 255]);
  pointer(ui, 'pointermove', 120, 80, window, { buttons: 0 });
  pointer(ui, 'pointerup', 120, 80);
  await frame();
  expect(moves).not.toHaveBeenCalled();
  expect(editor.getSnapshot().revision).toBe(0);
  expect(pixel(ui, 80, 60)).toEqual([18, 52, 86, 255]);
  expect(pixel(ui, 130, 80)[3]).toBe(0);
});
it('cancels cleanly without throwing when viewport becomes null mid-drag', () => {
  const editor = fixture(); const moves = vi.fn();
  const ui = render(<Host editor={editor} readOnly={false} onMove={moves} />);
  pointer(ui, 'pointerdown', 80, 60);
  pointer(ui, 'pointermove', 120, 80);
  ui.rerender(<Host editor={editor} readOnly={false} onMove={moves} viewport={null} />);
  expect(ui.getByText('Canvas unavailable')).toBeTruthy();
  window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, button: 0, isPrimary: true }));
  expect(moves).not.toHaveBeenCalled();
  expect(editor.getSnapshot().revision).toBe(0);
});
it('ignores non-primary blank-stage pointerdown and modified arrow keys, but allows Shift+Arrow', () => {
  const editor = fixture(); const ui = render(<Host editor={editor} readOnly={false} />);
  fireEvent.click(ui.getByRole('button', { name: 'Select r' }));
  for (const mod of ['altKey', 'ctrlKey', 'metaKey']) {
    fireEvent.keyDown(ui.getByRole('region'), { key: 'ArrowRight', [mod]: true });
  }
  expect(editor.getSnapshot().revision).toBe(0);
  fireEvent.keyDown(ui.getByRole('region'), { key: 'ArrowRight', shiftKey: true });
  expect(editor.getSnapshot().revision).toBe(1);
  pointer(ui, 'pointerdown', 80, 60);
  pointer(ui, 'pointermove', 120, 80);
  pointer(ui, 'pointerdown', 10, 10, undefined, { button: 2, isPrimary: false });
  pointer(ui, 'pointerup', 120, 80);
  expect(editor.getSnapshot().revision).toBe(2);
});
it('clears error alert on host selection change, keeps alert outside canvas, and validates cross-slide selection', () => {
  const editor = fixture(() => false);
  const HostControlled = ({ selection }) => {
    const snapshot = useSyncExternalStore(editor.subscribe, editor.getSnapshot);
    return <CanonicalKonvaStage snapshot={snapshot} slideId="s" selection={selection} onSelectionChange={() => {}}
      ownerKey={ownerKey} policyKey={policyKey} viewport={{ width: 400, height: 200 }} readOnly={false}
      canMove={() => true} onMove={req => editor.dispatch('presentation.setGeometry', { ...req, geometry: { x: req.geometry.x, y: req.geometry.y, width: 254000, height: 127000 } })} />;
  };
  const ui = render(<HostControlled selection={{ slideId: 's', objectId: 'r' }} />);
  const canvasRect = ui.container.querySelector('.konvajs-content').getBoundingClientRect();
  fireEvent.keyDown(ui.getByRole('region'), { key: 'ArrowRight' });
  const alert = ui.getByRole('alert');
  expect(alert).toBeTruthy();
  const alertRect = alert.getBoundingClientRect();
  expect(ui.container.querySelector('.konvajs-content').getBoundingClientRect().top).toBe(canvasRect.top);
  expect(alertRect.bottom <= canvasRect.top || alertRect.top >= canvasRect.bottom).toBe(true);
  ui.rerender(<HostControlled selection={{ slideId: 's', objectId: 'opaque' }} />);
  expect(ui.queryByRole('alert')).toBeNull();

  const onSelectionChange = vi.fn();
  const doc2 = createDocument({ size: { width: 1270000, height: 635000 }, slides: [
    { id: 's', objects: [{ id: 'r', type: 'shape', shape: 'rect', fill: '#123456', geometry: { x: 127000, y: 127000, width: 254000, height: 127000 } }] },
    { id: 'other', objects: [{ id: 'x', type: 'shape', shape: 'rect', fill: '#123456', geometry: { x: 127000, y: 127000, width: 254000, height: 127000 } }] },
  ] });
  const editor2 = createEditor({ document: doc2, plugins: [documentPlugin, presentationPlugin] });
  const ui2 = render(<CanonicalKonvaStage snapshot={editor2.getSnapshot()} slideId="s" selection={{ slideId: 'other', objectId: 'x' }}
    ownerKey={ownerKey} policyKey={policyKey} viewport={{ width: 400, height: 200 }} onSelectionChange={onSelectionChange} />);
  expect(onSelectionChange).not.toHaveBeenCalled();
  ui2.rerender(<CanonicalKonvaStage snapshot={editor2.getSnapshot()} slideId="s" selection={{ slideId: 'other', objectId: 'missing' }}
    ownerKey={ownerKey} policyKey={policyKey} viewport={{ width: 400, height: 200 }} onSelectionChange={onSelectionChange} />);
  expect(onSelectionChange).toHaveBeenCalledWith({ slideId: 'other', objectId: null });
  onSelectionChange.mockClear();
  ui2.rerender(<CanonicalKonvaStage snapshot={editor2.getSnapshot()} slideId="s" selection={{ slideId: 'gone', objectId: 'x' }}
    ownerKey={ownerKey} policyKey={policyKey} viewport={{ width: 400, height: 200 }} onSelectionChange={onSelectionChange} />);
  expect(onSelectionChange).toHaveBeenCalledWith({ slideId: 's', objectId: null });
});
it('ignores bubbling lostpointercapture from child canvas during drag', () => {
  const editor = fixture(); const moves = vi.fn(); const ui = render(<Host editor={editor} readOnly={false} onMove={moves} />);
  pointer(ui, 'pointerdown', 80, 60); pointer(ui, 'pointermove', 120, 80);
  fireEvent(ui.container.querySelector('canvas'), new PointerEvent('lostpointercapture', { bubbles: true, pointerId: 1 }));
  pointer(ui, 'pointerup', 120, 80);
  expect(moves).toHaveBeenCalledTimes(1); expect(editor.getSnapshot().revision).toBe(1);
});
it('observes content resize even when Stage mounts after initial null viewport', async () => {
  const editor = fixture(); const moves = vi.fn();
  const ui = render(<Host editor={editor} readOnly={false} onMove={moves} viewport={null} />);
  ui.rerender(<Host editor={editor} readOnly={false} onMove={moves} viewport={{ width: 400, height: 200 }} />);
  await frame();
  const content = ui.container.querySelector('.konvajs-content');
  pointer(ui, 'pointerdown', 80, 60); pointer(ui, 'pointermove', 120, 80); await frame();
  expect(pixel(ui, 130, 80)).toEqual([18, 52, 86, 255]);
  content.style.width = '300px';
  await frame(); await frame();
  expect(pixel(ui, 80, 60)).toEqual([18, 52, 86, 255]);
  expect(pixel(ui, 130, 80)[3]).toBe(0);
  pointer(ui, 'pointerup', 120, 80);
  expect(moves).not.toHaveBeenCalled(); expect(editor.getSnapshot().revision).toBe(0);
});
it('cancels and restores pixels on non-scroll/non-resize layout shift mid-drag', async () => {
  const editor = fixture(); const moves = vi.fn();
  const ui = render(<Host editor={editor} readOnly={false} onMove={moves} />); await frame();
  pointer(ui, 'pointerdown', 80, 60); pointer(ui, 'pointermove', 120, 80); await frame();
  expect(pixel(ui, 130, 80)).toEqual([18, 52, 86, 255]);
  const banner = document.createElement('div'); banner.style.height = '40px'; ui.container.prepend(banner);
  await frame(); await frame();
  expect(pixel(ui, 80, 60)).toEqual([18, 52, 86, 255]);
  expect(pixel(ui, 130, 80)[3]).toBe(0);
  pointer(ui, 'pointerup', 120, 80);
  expect(moves).not.toHaveBeenCalled(); expect(editor.getSnapshot().revision).toBe(0);
});
it('captures pointer via real CDP mouse and touch input and releases after drag', async () => {
  const editor = fixture(); const ui = render(<Host editor={editor} readOnly={false} />);
  const content = ui.container.querySelector('.konvajs-content');
  const rect = content.getBoundingClientRect();
  let capturedDuringMouse = false, capturedDuringTouch = false;
  let capturedIdMouse = null, capturedIdTouch = null;
  const onGot = e => {
    if (e.pointerType === 'mouse') { capturedIdMouse = e.pointerId; capturedDuringMouse = content.hasPointerCapture(e.pointerId); }
    if (e.pointerType === 'touch') { capturedIdTouch = e.pointerId; capturedDuringTouch = content.hasPointerCapture(e.pointerId); }
  };
  content.addEventListener('gotpointercapture', onGot);
  const session = cdp();
  // Real mouse drag
  await session.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.left + 80, y: rect.top + 60, button: 'left', buttons: 1, clickCount: 1 });
  await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rect.left + 120, y: rect.top + 80, button: 'left', buttons: 1 });
  await session.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.left + 120, y: rect.top + 80, button: 'left', buttons: 0 });
  expect(capturedDuringMouse).toBe(true);
  expect(content.hasPointerCapture(capturedIdMouse)).toBe(false);
  expect(editor.getSnapshot().revision).toBe(1);
  // Real touch drag (shape is now at +40, +20 -> 120, 80)
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: rect.left + 120, y: rect.top + 80, id: 0 }] });
  await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: rect.left + 140, y: rect.top + 90, id: 0 }] });
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  expect(capturedDuringTouch).toBe(true);
  expect(content.hasPointerCapture(capturedIdTouch)).toBe(false);
  expect(editor.getSnapshot().revision).toBe(2);
});
it('commits once per host rerender without extra ref-triggered renders', () => {
  const editor = fixture();
  const commits = [];
  const ui = render(
    <React.Profiler id="stage" onRender={(_id, phase) => commits.push(phase)}>
      <Host editor={editor} readOnly={false} />
    </React.Profiler>
  );
  const afterMount = commits.length;
  ui.rerender(
    <React.Profiler id="stage" onRender={(_id, phase) => commits.push(phase)}>
      <Host editor={editor} readOnly={false} zoom={2} />
    </React.Profiler>
  );
  expect(commits.length - afterMount).toBe(1);
});
it('does not re-evaluate canMove on every pointermove', () => {
  const editor = fixture();
  const canMove = vi.fn(() => true);
  const ui = render(<Host editor={editor} readOnly={false} canMove={canMove} />);
  pointer(ui, 'pointerdown', 80, 60);
  const callsAfterStart = canMove.mock.calls.length;
  pointer(ui, 'pointermove', 90, 65);
  pointer(ui, 'pointermove', 100, 70);
  pointer(ui, 'pointermove', 110, 75);
  expect(canMove.mock.calls.length).toBe(callsAfterStart);
  pointer(ui, 'pointerup', 110, 75);
  expect(editor.getSnapshot().revision).toBe(1);
});
