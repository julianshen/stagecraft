import React, { useLayoutEffect, useRef, useState } from 'react';
import { Stage, Layer, Group, Rect, Ellipse } from 'react-konva/lib/ReactKonvaCore';
import 'konva/lib/shapes/Rect';
import 'konva/lib/shapes/Ellipse';
import { EMU_PER_POINT, viewTransform, moveFromCss, movable, primitive, validGeometry, nodeGeometry } from './geometry.js';

function shapeAttrs(object) {
  const geometry = nodeGeometry(object.geometry);
  return primitive(object) && object.shape === 'ellipse'
    ? { ...geometry, offsetX: 0, offsetY: 0, radiusX: geometry.width / 2, radiusY: geometry.height / 2 } : geometry;
}

/** Experimental local adapter. Host owns snapshots, authorization and all commands. */
export function CanonicalKonvaStage(props) {
  const { snapshot, slideId, selection, viewport, zoom = 1, onSelectionChange } = props;
  const slide = snapshot.document.slides.find(s => s.id === slideId);
  const view = viewTransform(snapshot.document.size, viewport, zoom);
  const latest = useRef();
  latest.current = { ...props, slide, view };
  const gesture = useRef(null);
  const region = useRef(null);
  const stage = useRef(null);
  const nodes = useRef(new Map());
  const [error, setError] = useState('');
  function report(cause) {
    setError(String(cause?.code ?? 'MOVE_FAILED'));
    try { latest.current.onError?.(cause); } catch { /* Host reporting must not prevent node restoration. */ }
  }
  function eligible(p, object) {
    if (p.readOnly !== false || !p.view || typeof p.onMove !== 'function' || !movable(object, p.snapshot.document.extensions)) return false;
    try { return p.canMove?.(object) === true; } catch (cause) { report(cause); return false; }
  }
  function restore(id) {
    const object = latest.current.slide?.objects.find(o => o.id === id);
    const node = nodes.current.get(id);
    if (node && validGeometry(object?.geometry)) {
      node.setAttrs(shapeAttrs(object));
      node.getLayer()?.batchDraw();
    }
  }
  function cancel() {
    const g = gesture.current;
    gesture.current = null;
    if (g) {
      try { stage.current?.getContent()?.releasePointerCapture?.(g.pointerId); } catch {}
      restore(g.objectId);
    }
  }
  function gestureValid(g) {
    const p = latest.current;
    const object = p.slide?.objects.find(o => o.id === g.objectId);
    return p.ownerKey === g.ownerKey && p.policyKey === g.policyKey && p.slideId === g.slideId
      && p.snapshot.revision === g.revision && object === g.object
      && p.selection?.slideId === g.slideId && p.selection?.objectId === g.objectId
      && p.view?.scale === g.view.scale && p.view?.x === g.view.x && p.view?.y === g.view.y
      && p.viewport?.width === g.viewport.width && p.viewport?.height === g.viewport.height
      && p.readOnly === false && typeof p.onMove === 'function' && movable(object, p.snapshot.document.extensions);
  }
  function current(g) {
    if (!gestureValid(g)) return false;
    const p = latest.current;
    const object = p.slide?.objects.find(o => o.id === g.objectId);
    const rect = stage.current?.getContent()?.getBoundingClientRect();
    return !!rect && rect.width === g.rect.width && rect.height === g.rect.height
      && rect.left === g.rect.left && rect.top === g.rect.top && !!object && eligible(p, object);
  }
  function commit(object, geometry, revision) {
    if (geometry.x === object.geometry.x && geometry.y === object.geometry.y) return;
    try {
      latest.current.onMove({ slideId: latest.current.slideId, objectId: object.id, geometry, expectedRevision: revision });
      setError('');
    } catch (cause) {
      report(cause);
    } finally { restore(object.id); }
  }
  function start(event, object) {
    event.cancelBubble = true;
    if (event.evt.button !== 0 || event.evt.isPrimary === false) return;
    cancel();
    setError('');
    onSelectionChange?.({ slideId, objectId: object.id });
    region.current?.focus({ preventScroll: true });
    const p = latest.current;
    if (!p.viewport || !eligible(p, object)) return;
    const content = stage.current?.getContent();
    const rect = content?.getBoundingClientRect();
    if (!rect?.width || !rect?.height) return;
    try { content.setPointerCapture?.(event.evt.pointerId); } catch {}
    gesture.current = { rect, cssX: rect.width / p.viewport.width, cssY: rect.height / p.viewport.height, object, objectId: object.id, slideId, ownerKey: p.ownerKey, policyKey: p.policyKey,
      revision: p.snapshot.revision, view: { ...p.view }, viewport: { ...p.viewport },
      pointerId: event.evt.pointerId, x: event.evt.clientX, y: event.evt.clientY };
  }
  // Revalidate both on commit and on renders. Effects alone cannot guard a late pointerup.
  useLayoutEffect(() => { if (gesture.current && !current(gesture.current)) cancel(); });
  useLayoutEffect(() => {
    function move(event) {
      const g = gesture.current;
      if (!g || event.pointerId !== g.pointerId) return;
      if ((event.buttons & 1) === 0 || !gestureValid(g)) { cancel(); return; }
      const node = nodes.current.get(g.objectId);
      const base = nodeGeometry(g.object.geometry);
      node?.position({ x: base.x + (event.clientX - g.x) / g.cssX / g.view.scale, y: base.y + (event.clientY - g.y) / g.cssY / g.view.scale });
      node?.getLayer()?.batchDraw();
    }
    function end(event) {
      const g = gesture.current;
      if (!g || event.pointerId !== g.pointerId) return;
      const valid = current(g);
      cancel();
      if (valid) commit(g.object, moveFromCss(g.object.geometry, { x: (event.clientX - g.x) / g.cssX, y: (event.clientY - g.y) / g.cssY }, g.view), g.revision);
    }
    function cancelPointer(event) { if (gesture.current?.pointerId === event.pointerId) cancel(); }
    function key(event) { if (event.key === 'Escape') cancel(); }
    function checkRect() {
      const g = gesture.current;
      if (!g) return;
      const rect = stage.current?.getContent()?.getBoundingClientRect();
      if (!rect || rect.width !== g.rect.width || rect.height !== g.rect.height || rect.left !== g.rect.left || rect.top !== g.rect.top) cancel();
    }
    const content = stage.current?.getContent();
    const ro = typeof ResizeObserver === 'function' && content ? new ResizeObserver(checkRect) : null;
    ro?.observe(content);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', cancelPointer);
    window.addEventListener('blur', cancel);
    window.addEventListener('keydown', key);
    window.addEventListener('scroll', checkRect, { capture: true, passive: true });
    const element = region.current;
    element?.addEventListener('lostpointercapture', cancelPointer);
    return () => {
      cancel();
      ro?.disconnect();
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', cancelPointer);
      window.removeEventListener('blur', cancel);
      window.removeEventListener('keydown', key);
      window.removeEventListener('scroll', checkRect, { capture: true });
      element?.removeEventListener('lostpointercapture', cancelPointer);
    };
  }, []);
  useLayoutEffect(() => {
    if (selection?.objectId && selection.slideId === slideId && (!slide || !slide.objects.some(o => o.id === selection.objectId))) {
      onSelectionChange?.({ slideId: slide?.id ?? null, objectId: null });
    }
  }, [slide, slideId, selection?.slideId, selection?.objectId, onSelectionChange]);
  function keyboard(event) {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"])')) return;
    const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    const p = latest.current;
    const object = p.slide?.objects.find(o => o.id === p.selection?.objectId);
    if (!delta || p.selection?.slideId !== p.slideId || !object || !eligible(p, object)) return;
    event.preventDefault(); cancel(); setError('');
    commit(object, { x: object.geometry.x + delta[0] * EMU_PER_POINT, y: object.geometry.y + delta[1] * EMU_PER_POINT }, p.snapshot.revision);
  }
  return <section ref={region} role="region" aria-label="Canonical slide canvas" tabIndex={0} onKeyDown={keyboard} style={{ position: 'relative' }}>
    <p role="status">Primitive scene only. Unsupported objects are placeholders.</p>
    {error && <p role="alert" style={{ position: 'absolute', top: 8, right: 8, margin: 0, pointerEvents: 'none' }}>{error}</p>}
    {!view || !slide ? <p>Canvas unavailable</p> : <Stage ref={stage} width={viewport.width} height={viewport.height}
      onPointerDown={event => { if (event.target === event.target.getStage() && event.evt.button === 0 && event.evt.isPrimary !== false) { cancel(); setError(''); onSelectionChange?.({ slideId, objectId: null }); } }}>
      <Layer><Group x={view.x} y={view.y} scaleX={view.scale} scaleY={view.scale}>
        {slide.objects.filter(o => validGeometry(o.geometry)).map(object => {
          const supported = primitive(object);
          const Shape = supported && object.shape === 'ellipse' ? Ellipse : Rect;
          const attrs = shapeAttrs(object);
          return <Shape key={object.id} ref={node => { if (node) nodes.current.set(object.id, node); else nodes.current.delete(object.id); }}
            {...attrs} fill={supported ? object.fill : '#eeeeee'} stroke={selection?.slideId === slideId && selection?.objectId === object.id ? '#0066ff' : '#777777'}
            strokeWidth={1 / view.scale} onPointerDown={event => start(event, object)} />;
        })}
      </Group></Layer>
    </Stage>}
    <ul aria-label="Slide objects">{slide?.objects.map(object => <li key={object.id}>
      <button type="button" aria-label={`Select ${object.id}`} aria-pressed={selection?.slideId === slideId && selection?.objectId === object.id}
        onClick={() => { cancel(); setError(''); onSelectionChange?.({ slideId, objectId: object.id }); }}>{object.id}{primitive(object) ? '' : ' (placeholder)'}</button>
    </li>)}</ul>
  </section>;
}
