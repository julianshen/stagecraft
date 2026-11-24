import { useEffect, useRef } from 'react';
import { Stage, Layer, Rect, Shape } from 'react-konva/es/ReactKonvaCore';
import 'konva/lib/Core';
import 'konva/lib/shapes/Rect';
import { createCanonicalPaintEnvironment, paintCanonicalNode } from '@stagecraft/renderer/canonical';

const EMU_PER_PX = 9525;

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
  onSelect,
  onMove,
  onRequestTextEdit,
  onError,
}) {
  const gestureRef = useRef(null);
  const envRef = useRef(null);
  const stageRef = useRef(null);

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

  const scale = zoom / 100;
  const stageWidth = Math.max(1, Math.round(scene.width * scale));
  const stageHeight = Math.max(1, Math.round(scene.height * scale));

  function cancelGesture() {
    const g = gestureRef.current;
    if (!g) return;
    gestureRef.current = null;
    try {
      g.konvaNode?.stopDrag?.();
      g.konvaNode?.position({ x: g.startCenterX, y: g.startCenterY });
      g.konvaNode?.scale({ x: 1, y: 1 });
      g.konvaNode?.getLayer()?.batchDraw?.();
    } catch { /* node may be unmounted */ }
  }

  useEffect(() => {
    cancelGesture();
    return cancelGesture;
  }, [ownerKey, policyKey, revision, scene.slideId, selectionId, readOnly, zoom, stageWidth, stageHeight]);

  useEffect(() => {
    const onBlur = () => cancelGesture();
    window.addEventListener('blur', onBlur);
    return () => window.removeEventListener('blur', onBlur);
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
                draggable={movable}
                onMouseDown={e => {
                  if (e.evt?.button !== undefined && e.evt.button !== 0) return;
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
                  if ((e.evt?.button !== undefined && e.evt.button !== 0) || !isMovable(node)) {
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
                  if (
                    !g
                    || g.id !== node.id
                    || g.ownerKey !== ownerKey
                    || g.policyKey !== policyKey
                    || g.slideId !== scene.slideId
                    || g.revision !== revision
                    || !isMovable(node)
                  ) {
                    e.target.position({ x: centerX, y: centerY });
                    e.target.scale({ x: 1, y: 1 });
                    e.target.getLayer()?.batchDraw();
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
                    e.target.getLayer()?.batchDraw();
                    onError?.(new Error('Invalid geometry coordinates.'));
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
                    committed = result?.ok !== false;
                  } catch (err) {
                    onError?.(err);
                  }
                  if (!committed) {
                    e.target.position({ x: g.startCenterX, y: g.startCenterY });
                    e.target.getLayer()?.batchDraw();
                  }
                }}
                sceneFunc={(ctx, shape) => {
                  paintCanonicalNode(ctx._context, node, getEnv());
                  ctx.fillStrokeShape(shape);
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
  );
}
