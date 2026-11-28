import { Component, useEffect, useRef } from 'react';
import { Stage, Layer, Rect, Shape, Transformer } from 'react-konva/es/ReactKonvaCore';
import 'konva/lib/Core.js';
import 'konva/lib/DragAndDrop.js';
import 'konva/lib/shapes/Rect.js';
import 'konva/lib/shapes/Transformer.js';
import { createCanonicalPaintEnvironment, paintCanonicalNode } from '@stagecraft/renderer/canonical';
import {
  EMU_PER_PX,
  MIN_OBJECT_SIZE_PX,
  ROTATION_SNAPS_15,
  clampTransformBox,
  geometriesEqual,
  normalizeTransformGeometry,
} from './transformGeometry.js';

const frameBox = frame => ({
  centerX: frame.x + frame.width / 2,
  centerY: frame.y + frame.height / 2,
  width: frame.width,
  height: frame.height,
  rotation: frame.rotation,
});
const isCommitted = result => result === true || (typeof result === 'object' && result !== null && result.ok === true);

class GestureUnmountGuard extends Component {
  componentWillUnmount() {
    this.props.onUnmount?.();
  }
  render() {
    return this.props.children;
  }
}

export default function KonvaStage({
  scene,
  revision,
  ownerKey,
  policyKey,
  selectionId,
  zoom = 100,
  readOnly = false,
  canMove,
  canRotate,
  isTransformingRef,
  fontEpochBump = 0,
  cancelToken = 0,
  invalidateGestureRef,
  cancelGestureRef,
  onSelect,
  onMove,
  onRequestTextEdit,
  onError,
}) {
  const gestureRef = useRef(null);
  const envRef = useRef(null);
  const stageRef = useRef(null);
  const transformerRef = useRef(null);
  const shapeRefs = useRef(new Map());
  const sceneRef = useRef(scene);
  sceneRef.current = scene;

  function setTransforming(active) {
    if (isTransformingRef) isTransformingRef.current = active;
  }

  const shiftSnapsRef = useRef(false);
  function applyShiftSnaps(shiftKey) {
    const tr = transformerRef.current;
    if (!tr || shiftSnapsRef.current === shiftKey) return;
    shiftSnapsRef.current = shiftKey;
    tr.rotationSnaps(shiftKey ? ROTATION_SNAPS_15 : []);
    tr.rotationSnapTolerance(shiftKey ? 7.5 : 0);
  }
  const lastContextRef = useRef(null);
  const nextContext = [ownerKey, policyKey, revision, scene.slideId, readOnly, zoom];
  if (
    lastContextRef.current
    && lastContextRef.current.some((val, idx) => val !== nextContext[idx])
    && gestureRef.current
  ) {
    gestureRef.current.stale = true;
  }
  lastContextRef.current = nextContext;

  function getEnv() {
    if (!envRef.current || envRef.current.getStats().disposed) {
      envRef.current = createCanonicalPaintEnvironment();
    }
    return envRef.current;
  }

  useEffect(() => {
    getEnv();
    return () => {
      envRef.current?.dispose();
      envRef.current = null;
    };
  }, [ownerKey]);

  useEffect(() => {
    if (fontEpochBump > 0) {
      getEnv().invalidateFonts();
      stageRef.current?.batchDraw();
    }
  }, [fontEpochBump]);

  const paperWidth = 960 * zoom / 100;
  const scale = paperWidth / scene.width;
  const stageWidth = Math.max(1, Math.round(paperWidth));
  const stageHeight = Math.max(1, Math.round(scene.height * scale));

  function invalidateGesture() {
    gestureRef.current = null;
    setTransforming(false);
  }
  if (invalidateGestureRef) {
    invalidateGestureRef.current = invalidateGesture;
  }
  if (cancelGestureRef) {
    cancelGestureRef.current = () => cancelGesture({ restoreStart: false });
  }

  function restoreNodeBox(node, { centerX, centerY, width, height, rotation }) {
    if (width !== undefined && height !== undefined) {
      node.size({ width, height });
      node.offset({ x: width / 2, y: height / 2 });
    }
    node.position({ x: centerX, y: centerY });
    if (rotation !== undefined) {
      node.rotation(rotation);
    }
    node.scale({ x: 1, y: 1 });
  }

  /** Reset a node to a canonical box (when given) and repaint it together with the Transformer. */
  function resetNode(node, box) {
    if (box) restoreNodeBox(node, box);
    const tr = transformerRef.current;
    tr?.forceUpdate?.();
    node.getLayer()?.batchDraw();
    tr?.getLayer()?.batchDraw();
  }

  function cancelGesture({ restoreStart = true } = {}) {
    const g = gestureRef.current;
    if (!g) return;
    gestureRef.current = null;
    setTransforming(false);
    const tr = transformerRef.current;
    if (tr?.isTransforming?.()) {
      tr.stopTransform();
    }
    const node = g.konvaNode;
    if (!node || !node.getStage()) return;
    if (node.isDragging()) {
      node.stopDrag();
    }
    if (restoreStart) {
      resetNode(node, g.startBox ?? { centerX: g.startCenterX, centerY: g.startCenterY });
    } else {
      const latest = sceneRef.current?.nodes.find(n => n.id === g.id);
      resetNode(node, latest ? frameBox(latest.frame) : null);
    }
    if (g.stale) {
      try {
        onError?.(new Error(g.kind === 'transform' ? 'Transform could not be applied.' : 'Move could not be applied.'));
      } catch {
        return;
      }
    }
  }

  useEffect(() => {
    cancelGesture({ restoreStart: false });
    return () => cancelGesture({ restoreStart: false });
  }, [ownerKey, policyKey, revision, scene.slideId, readOnly, zoom, stageWidth, stageHeight]);

  useEffect(() => {
    cancelGesture({ restoreStart: true });
  }, [cancelToken]);

  useEffect(() => {
    if (gestureRef.current && selectionId !== gestureRef.current.id) {
      cancelGesture({ restoreStart: true });
    }
  }, [selectionId]);

  useEffect(() => {
    const onBlur = () => cancelGesture();
    const onKeyDown = event => {
      if (event.key === 'Escape') {
        cancelGesture();
        return;
      }
      if (event.key === 'Shift') {
        applyShiftSnaps(true);
      }
    };
    const onKeyUp = event => {
      if (event.key === 'Shift') {
        applyShiftSnaps(false);
      }
    };
    window.addEventListener('blur', onBlur);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  useEffect(() => {
    const content = stageRef.current?.content;
    if (!content) return undefined;
    const onCancel = () => cancelGesture();
    content.addEventListener('pointercancel', onCancel);
    content.addEventListener('lostpointercapture', onCancel);
    return () => {
      content.removeEventListener('pointercancel', onCancel);
      content.removeEventListener('lostpointercapture', onCancel);
    };
  }, []);

  function isMovable(node) {
    if (readOnly || typeof canMove !== 'function') return false;
    try {
      return Boolean(canMove(node));
    } catch (err) {
      onError?.(err);
      return false;
    }
  }

  function isRotatable(node) {
    if (!isMovable(node)) return false;
    if (typeof canRotate !== 'function') return true;
    try {
      return Boolean(canRotate(node));
    } catch (err) {
      onError?.(err);
      return false;
    }
  }

  const selectedNode = scene.nodes.find(n => n.id === selectionId) ?? null;
  const selectedMovable = selectedNode ? isMovable(selectedNode) : false;
  const selectedRotatable = selectedNode ? isRotatable(selectedNode) : false;

  useEffect(() => {
    const tr = transformerRef.current;
    if (!tr) return undefined;
    if (tr.isTransforming()) {
      tr.stopTransform();
    }
    const target = selectedMovable && selectedNode ? shapeRefs.current.get(selectedNode.id) : null;
    tr.nodes(target ? [target] : []);
    tr.getLayer()?.batchDraw();
    return () => {
      if (tr.isTransforming()) {
        tr.stopTransform();
      }
      tr.nodes([]);
    };
  }, [selectedMovable, selectedNode?.id, scene]);

  return (
    <GestureUnmountGuard onUnmount={invalidateGesture}>
      <Stage
        ref={stageRef}
        width={stageWidth}
        height={stageHeight}
        scaleX={scale}
        scaleY={scale}
      >
        <Layer>
          <Rect
            x={0}
            y={0}
            width={scene.width}
            height={scene.height}
            fill={scene.background}
            onClick={() => onSelect?.(null)}
            onTap={() => onSelect?.(null)}
          />
          {scene.nodes.map(node => {
            const centerX = node.frame.x + node.frame.width / 2;
            const centerY = node.frame.y + node.frame.height / 2;
            const movable = isMovable(node);
            return (
              <Shape
                key={node.id}
                ref={instance => {
                  if (instance) shapeRefs.current.set(node.id, instance);
                  else shapeRefs.current.delete(node.id);
                }}
                name={node.id}
                x={centerX}
                y={centerY}
                offsetX={node.frame.width / 2}
                offsetY={node.frame.height / 2}
                width={node.frame.width}
                height={node.frame.height}
                rotation={node.frame.rotation}
                fill="transparent"
                draggable={movable}
                onMouseDown={e => {
                  if (e.evt?.button !== undefined && e.evt.button !== 0) return;
                  e.cancelBubble = true;
                  onSelect?.(node.id);
                }}
                onTouchStart={e => {
                  if (e.evt?.touches && e.evt.touches.length > 1) return;
                  e.cancelBubble = true;
                  onSelect?.(node.id);
                }}
                onTap={e => {
                  e.cancelBubble = true;
                  onSelect?.(node.id);
                }}
                onDblClick={e => {
                  e.cancelBubble = true;
                  if (node.type === 'text' || node.textIds.length > 0) {
                    onRequestTextEdit?.(node.id);
                  }
                }}
                onDragStart={e => {
                  if (
                    (e.evt?.buttons !== undefined && (e.evt.buttons & 1) === 0)
                    || (e.evt?.touches && e.evt.touches.length > 1)
                    || !isMovable(node)
                  ) {
                    e.target.stopDrag();
                    e.target.position({ x: centerX, y: centerY });
                    return;
                  }
                  gestureRef.current = {
                    id: node.id,
                    slideId: scene.slideId,
                    ownerKey,
                    policyKey,
                    revision,
                    geometry: { ...node.geometry },
                    startCenterX: centerX,
                    startCenterY: centerY,
                    konvaNode: e.target,
                  };
                }}
                onDragEnd={e => {
                  const g = gestureRef.current;
                  gestureRef.current = null;
                  if (!e.target.getStage() || !g) {
                    return;
                  }
                  if (
                    g.stale
                    || g.id !== node.id
                    || g.id !== selectionId
                    || g.ownerKey !== ownerKey
                    || g.policyKey !== policyKey
                    || g.slideId !== scene.slideId
                    || g.revision !== revision
                    || !isMovable(node)
                  ) {
                    e.target.position({ x: centerX, y: centerY });
                    e.target.scale({ x: 1, y: 1 });
                    e.target.getLayer()?.batchDraw();
                    try {
                      onError?.(new Error('Move could not be applied.'));
                    } catch {
                      return;
                    }
                    return;
                  }
                  const dx = Math.round((e.target.x() - g.startCenterX) * EMU_PER_PX);
                  const dy = Math.round((e.target.y() - g.startCenterY) * EMU_PER_PX);
                  if (dx === 0 && dy === 0) {
                    e.target.position({ x: g.startCenterX, y: g.startCenterY });
                    e.target.getLayer()?.batchDraw();
                    return;
                  }
                  const nextX = g.geometry.x + dx;
                  const nextY = g.geometry.y + dy;
                  if (!Number.isSafeInteger(nextX) || !Number.isSafeInteger(nextY)) {
                    e.target.position({ x: g.startCenterX, y: g.startCenterY });
                    e.target.scale({ x: 1, y: 1 });
                    e.target.getLayer()?.batchDraw();
                    try {
                      onError?.(new Error('Invalid geometry coordinates.'));
                    } catch {
                      return;
                    }
                    return;
                  }
                  let committed = false;
                  try {
                    const result = onMove?.({
                      slideId: g.slideId,
                      objectId: g.id,
                      geometry: { ...g.geometry, x: nextX, y: nextY },
                      expectedRevision: g.revision,
                    });
                    committed = isCommitted(result);
                  } catch {
                    committed = false;
                  }
                  if (!committed) {
                    e.target.position({ x: g.startCenterX, y: g.startCenterY });
                    e.target.scale({ x: 1, y: 1 });
                    e.target.getLayer()?.batchDraw();
                    try {
                      onError?.(new Error('Move could not be applied.'));
                    } catch {
                      return;
                    }
                  }
                }}
                sceneFunc={ctx => {
                  paintCanonicalNode(ctx._context, node, getEnv());
                }}
                hitFunc={(ctx, shape) => {
                  ctx.beginPath();
                  if (node.hitShape === 'ellipse') {
                    ctx.ellipse(
                      node.frame.width / 2,
                      node.frame.height / 2,
                      node.frame.width / 2,
                      node.frame.height / 2,
                      0,
                      0,
                      Math.PI * 2,
                    );
                  } else {
                    ctx.rect(0, 0, node.frame.width, node.frame.height);
                  }
                  ctx.closePath();
                  ctx.fillStrokeShape(shape);
                }}
              />
            );
          })}
        </Layer>
        <Layer listening={selectedMovable}>
          {selectedNode && (
            <Rect
              x={selectedNode.frame.x + selectedNode.frame.width / 2}
              y={selectedNode.frame.y + selectedNode.frame.height / 2}
              offsetX={selectedNode.frame.width / 2}
              offsetY={selectedNode.frame.height / 2}
              width={selectedNode.frame.width}
              height={selectedNode.frame.height}
              rotation={selectedNode.frame.rotation}
              stroke="#2563eb"
              strokeWidth={2 / Math.max(0.25, scale)}
              listening={false}
            />
          )}
          <Transformer
            ref={transformerRef}
            flipEnabled={false}
            keepRatio={false}
            rotateEnabled={selectedRotatable}
            ignoreStroke
            borderStroke="#2563eb"
            anchorStroke="#2563eb"
            anchorFill="#ffffff"
            anchorSize={8}
            boundBoxFunc={(oldBox, newBox) => clampTransformBox(oldBox, newBox, MIN_OBJECT_SIZE_PX * scale)}
            onTransformStart={e => {
              const target = e.target;
              const node = selectedNode;
              if (
                !node
                || !selectedMovable
                || (e.evt?.buttons !== undefined && (e.evt.buttons & 1) === 0)
                || e.evt?.altKey
              ) {
                transformerRef.current?.stopTransform();
                if (node) restoreNodeBox(target, frameBox(node.frame));
                return;
              }
              applyShiftSnaps(Boolean(e.evt?.shiftKey));
              setTransforming(true);
              gestureRef.current = {
                kind: 'transform',
                id: node.id,
                slideId: scene.slideId,
                ownerKey,
                policyKey,
                revision,
                geometry: { ...node.geometry },
                startBox: frameBox(node.frame),
                konvaNode: target,
              };
            }}
            onTransform={e => {
              if (e.evt?.altKey) {
                cancelGesture({ restoreStart: true });
                return;
              }
              if (e.evt) {
                applyShiftSnaps(Boolean(e.evt.shiftKey));
              }
            }}
            onTransformEnd={e => {
              const g = gestureRef.current;
              gestureRef.current = null;
              setTransforming(false);
              const target = e.target;
              if (!target?.getStage?.() || !g || g.kind !== 'transform') {
                return;
              }
              const failTransform = (message = 'Transform could not be applied.') => {
                resetNode(target, g.startBox);
                try {
                  onError?.(new Error(message));
                } catch {
                  return;
                }
              };
              const current = sceneRef.current?.nodes.find(n => n.id === g.id);
              if (
                g.stale
                || !current
                || g.id !== selectionId
                || g.ownerKey !== ownerKey
                || g.policyKey !== policyKey
                || g.slideId !== scene.slideId
                || g.revision !== revision
                || !isMovable(current)
              ) {
                failTransform();
                return;
              }
              const normalized = normalizeTransformGeometry({
                centerX: target.x(),
                centerY: target.y(),
                widthPx: target.width(),
                heightPx: target.height(),
                scaleX: target.scaleX(),
                scaleY: target.scaleY(),
                rotation: target.rotation(),
                startGeometry: g.geometry,
              });
              if (!normalized) {
                failTransform('Invalid geometry coordinates.');
                return;
              }
              if (geometriesEqual(normalized, g.geometry)) {
                resetNode(target, g.startBox);
                return;
              }
              resetNode(target, {
                centerX: (normalized.x + normalized.width / 2) / EMU_PER_PX,
                centerY: (normalized.y + normalized.height / 2) / EMU_PER_PX,
                width: normalized.width / EMU_PER_PX,
                height: normalized.height / EMU_PER_PX,
                rotation: normalized.rotation ?? 0,
              });
              let committed = false;
              try {
                const result = onMove?.({
                  slideId: g.slideId,
                  objectId: g.id,
                  geometry: normalized,
                  expectedRevision: g.revision,
                });
                committed = isCommitted(result);
              } catch {
                committed = false;
              }
              if (!committed) {
                failTransform();
              }
            }}
          />
        </Layer>
      </Stage>
    </GestureUnmountGuard>
  );
}
