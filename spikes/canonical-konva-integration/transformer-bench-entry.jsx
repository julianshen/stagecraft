import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import Konva from 'konva/lib/Core.js';
import { createDocument } from '@stagecraft/core/document';
import { buildCanonicalScene } from '@stagecraft/renderer/canonical';
import KonvaStage from '../../packages/react/src/konva/KonvaStage.jsx';

const PT = 12700;
const ZOOM_1600 = (1600 / 960) * 100;

const stats = values => {
  const s = [...values].sort((a, b) => a - b);
  return {
    median: Number(s[Math.floor(s.length / 2)].toFixed(3)),
    p95: Number(s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)].toFixed(3)),
    max: Number(s[s.length - 1].toFixed(3)),
  };
};

const timed = fn => {
  const start = performance.now();
  const out = fn();
  return { ms: performance.now() - start, out };
};

const nextFrame = () => new Promise(resolve => requestAnimationFrame(ts => resolve(ts)));

function make256Objects() {
  const objects = [];
  for (let i = 0; i < 256; i++) {
    const col = i % 16;
    const row = Math.floor(i / 16);
    if (i % 4 === 0) {
      objects.push({
        id: `o${i}`,
        type: 'shape',
        shape: i % 8 === 0 ? 'rect' : 'ellipse',
        fill: '#2563eb',
        geometry: {
          x: (20 + col * 96) * PT,
          y: (20 + row * 54) * PT,
          width: 82 * PT,
          height: 40 * PT,
          rotation: 0,
        },
        extensions: { stagecraftAuthored: true },
      });
    } else {
      objects.push({
        id: `o${i}`,
        type: 'text',
        geometry: {
          x: (20 + col * 96) * PT,
          y: (20 + row * 54) * PT,
          width: 88 * PT,
          height: 44 * PT,
          rotation: 0,
        },
        bodyLayout: { anchor: 'top', wrap: 'square' },
        extensions: { stagecraftAuthored: true },
        text: {
          paragraphs: [{
            id: `p${i}`,
            style: { alignment: 'left' },
            runs: [{
              id: `r${i}`,
              text: `Cell ${i}`,
              editable: true,
              style: { typeface: 'Arial', sz: '1200', color: '#0f172a' },
              extensions: { stagecraftAuthored: true },
            }],
          }],
        },
      });
    }
  }
  return objects;
}

window.__runKonvaTransformerBench = async () => {
  const objects = make256Objects();
  const doc = createDocument({
    id: 'bench-k4-256',
    size: { width: 1600 * PT, height: 900 * PT },
    layouts: [{ id: 'l1', masterId: 'm1' }],
    masters: [{ id: 'm1', themeId: 'theme-1' }],
    themes: [{
      id: 'theme-1',
      extensions: {
        pptxFontScheme: {
          minor: { latin: 'Arial', eastAsian: 'Arial', complexScript: 'Arial' },
          major: { latin: 'Arial', eastAsian: 'Arial', complexScript: 'Arial' },
        },
      },
    }],
    slides: [{
      id: 's1',
      layoutId: 'l1',
      extensions: { stagecraftAuthored: true },
      background: { type: 'solid', color: '#ffffff' },
      objects,
    }],
  });

  const built = buildCanonicalScene(doc, 's1');
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  let commitCalls = 0;

  try {
    flushSync(() => {
      root.render(
        <KonvaStage
          scene={built.scene}
          revision={0}
          ownerKey={{}}
          policyKey={{}}
          selectionId={objects[0].id}
          zoom={ZOOM_1600}
          readOnly={false}
          canMove={() => true}
          canRotate={() => true}
          onSelect={() => {}}
          onMove={() => { commitCalls += 1; return true; }}
        />,
      );
    });

    const stage = Konva.stages.at(-1);
    const tr = stage.findOne('Transformer');
    if (!tr || tr.nodes().length !== 1) throw new Error('Transformer not attached');

    for (let i = 0; i < 10; i++) {
      stage.draw();
      await nextFrame();
    }

    const canvas = stage.getContent().querySelector('canvas');
    const rect = canvas.getBoundingClientRect();

    // 1. Transformer-attached node drag (80 frames)
    const firstNode = stage.findOne(`.${objects[0].id}`);
    const nodePos = firstNode.getAbsolutePosition();
    const dragHandlerMs = [];
    const dragPaintMs = [];
    const dragHitTestMs = [];
    const dragRafIntervalMs = [];

    canvas.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true, cancelable: true, clientX: rect.left + nodePos.x, clientY: rect.top + nodePos.y, button: 0, buttons: 1,
    }));
    for (let i = 1; i <= 80; i++) {
      const t0 = performance.now();
      dragHandlerMs.push(timed(() => {
        window.dispatchEvent(new MouseEvent('mousemove', {
          bubbles: true, cancelable: true, clientX: rect.left + nodePos.x + i * 0.5, clientY: rect.top + nodePos.y + i * 0.25, buttons: 1,
        }));
      }).ms);
      dragPaintMs.push(timed(() => stage.draw()).ms);
      dragHitTestMs.push(timed(() => stage.getIntersection({ x: nodePos.x + i * 0.5, y: nodePos.y + i * 0.25 })).ms);
      await nextFrame();
      dragRafIntervalMs.push(performance.now() - t0);
    }
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0, buttons: 0 }));
    await nextFrame();

    // 2. Transformer-attached corner resize (80 frames)
    const br = tr.findOne('.bottom-right');
    const brPos = br.getAbsolutePosition();
    const resizeHandlerMs = [];
    const resizePaintMs = [];
    const resizeHitTestMs = [];
    const resizeRafIntervalMs = [];

    canvas.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true, cancelable: true, clientX: rect.left + brPos.x, clientY: rect.top + brPos.y, button: 0, buttons: 1,
    }));
    for (let i = 1; i <= 80; i++) {
      const t0 = performance.now();
      resizeHandlerMs.push(timed(() => {
        window.dispatchEvent(new MouseEvent('mousemove', {
          bubbles: true, cancelable: true, clientX: rect.left + brPos.x + i * 0.5, clientY: rect.top + brPos.y + i * 0.25, buttons: 1,
        }));
      }).ms);
      resizePaintMs.push(timed(() => stage.draw()).ms);
      resizeHitTestMs.push(timed(() => stage.getIntersection({ x: brPos.x + i * 0.5, y: brPos.y + i * 0.25 })).ms);
      await nextFrame();
      resizeRafIntervalMs.push(performance.now() - t0);
    }
    const wasTransforming = tr.isTransforming();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0, buttons: 0 }));
    if (commitCalls !== 0) throw new Error(`Expected 0 commits on Escape cancel, got ${commitCalls}`);

    return {
      count: 256,
      dpr: window.devicePixelRatio,
      viewportCss: [stage.width(), stage.height()],
      samples: { warmup: 10, drag: 80, resize: 80 },
      transformerAttachedNodes: tr.nodes().length,
      wasTransforming,
      drag: {
        handlerMs: stats(dragHandlerMs),
        paintMs: stats(dragPaintMs),
        hitTestMs: stats(dragHitTestMs),
        rafIntervalMs: stats(dragRafIntervalMs),
      },
      resize: {
        handlerMs: stats(resizeHandlerMs),
        paintMs: stats(resizePaintMs),
        hitTestMs: stats(resizeHitTestMs),
        rafIntervalMs: stats(resizeRafIntervalMs),
      },
    };
  } finally {
    flushSync(() => root.unmount());
    host.remove();
  }
};
