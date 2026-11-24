import { Component, useEffect, useRef } from 'react';
import { Stage, Layer, Rect, Shape } from 'react-konva/es/ReactKonvaCore';
import 'konva/lib/Core.js';
import 'konva/lib/DragAndDrop.js';
import 'konva/lib/shapes/Rect.js';
import { createCanonicalPaintEnvironment, paintCanonicalNode } from '@stagecraft/renderer/canonical';

const EMU_PER_PX = 9525;

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
  fontEpochBump = 0,
  cancelToken = 0,
  invalidateGestureRef,
  onSelect,
  onMove,
  onRequestTextEdit,
  onError,
}) {
  const gestureRef = useRef(null);
  const envRef = useRef(null);
  const stageRef = useRef(null);
  const sceneRef = useRef(scene);
  sceneRef.current = scene;
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
  }
  if (invalidateGestureRef) {
    invalidateGestureRef.current = invalidateGesture;
  }

  function cancelGesture({ restoreStart = true } = {}) {
    const g = gestureRef.current;
    if (!g) return;
    gestureRef.current = null;
    const node = g.konvaNode;
    if (!node || !node.getStage()) return;
    if (node.isDragging()) {
      node.stopDrag();
    }
    if (restoreStart) {
      node.position({ x: g.startCenterX, y: g.startCenterY });
    } else {
      const latest = sceneRef.current?.nodes.find(n => n.id === g.id);
      if (latest) {
        node.position({
          x: latest.frame.x + latest.frame.width / 2,
          y: latest.frame.y + latest.frame.height / 2,
        });
      }
    }
    node.scale({ x: 1, y: 1 });
    node.getLayer()?.batchDraw();
    if (g.stale) {
      try {
        onError?.(new Error('Move could not be applied.'));
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
      }
    };
    window.addEventListener('blur', onBlur);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('keydown', onKeyDown);
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

  const selectedNode = scene.nodes.find(n => n.id === selectionId) ?? null;

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
                    committed = result === true || (typeof result === 'object' && result !== null && result.ok === true);
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
        <Layer listening={false}>
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
        </Layer>
      </Stage>
    </GestureUnmountGuard>
  );
}
