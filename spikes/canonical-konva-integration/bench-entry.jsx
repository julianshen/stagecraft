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

function makeSceneObjects(count) {
  const objects = [];
  if (count === 16) {
    // 16-object representative scene: 8 shapes (rect/ellipse) + 8 multi-run/multi-paragraph text boxes
    for (let i = 0; i < 8; i++) {
      objects.push({
        id: `s${i}`,
        type: 'shape',
        shape: i % 2 === 0 ? 'rect' : 'ellipse',
        fill: i % 2 === 0 ? '#2563eb' : '#16a34a',
        geometry: {
          x: (32 + (i % 4) * 380) * PT,
          y: (32 + Math.floor(i / 4) * 420) * PT,
          width: 320 * PT,
          height: 160 * PT,
          rotation: i === 3 ? 12 : 0,
        },
        extensions: { stagecraftAuthored: true },
      });
    }
    for (let i = 0; i < 8; i++) {
      objects.push({
        id: `t${i}`,
        type: 'text',
        geometry: {
          x: (32 + (i % 4) * 380) * PT,
          y: (220 + Math.floor(i / 4) * 420) * PT,
          width: 340 * PT,
          height: 170 * PT,
          rotation: 0,
        },
        bodyLayout: { anchor: i % 2 === 0 ? 'top' : 'middle', wrap: 'square' },
        extensions: { stagecraftAuthored: true },
        text: {
          paragraphs: [
            {
              id: `p${i}-1`,
              style: { alignment: i % 2 === 0 ? 'left' : 'center', lineSpacing: 115 },
              runs: [
                { id: `r${i}-1`, text: `Heading ${i + 1}: `, editable: true, style: { typeface: 'Arial', sz: '2000', b: '1', color: '#0f172a' }, extensions: { stagecraftAuthored: true } },
                { id: `r${i}-2`, text: 'Quarterly metrics & canonical layout', editable: true, style: { typeface: 'Arial', sz: '1600', i: '1', color: '#334155' }, extensions: { stagecraftAuthored: true } },
              ],
            },
            {
              id: `p${i}-2`,
              style: { alignment: 'left', spaceBefore: 6 },
              runs: [
                { id: `r${i}-3`, text: 'Multi-run OfficeView text with mixed sizes, weights, and wrapping across lines for K2c benchmark fidelity.', editable: true, style: { typeface: 'Arial', sz: '1400', color: '#475569' }, extensions: { stagecraftAuthored: true } },
              ],
            },
          ],
        },
      });
    }
    return objects;
  }

  // 256-object stress scene (mix of shapes and multi-run text boxes)
  for (let i = 0; i < count; i++) {
    const col = i % 16;
    const row = Math.floor(i / 16);
    if (i % 4 === 0) {
      objects.push({
        id: `t${i}`,
        type: 'text',
        geometry: { x: (16 + col * 98) * PT, y: (16 + row * 54) * PT, width: 90 * PT, height: 46 * PT, rotation: 0 },
        extensions: { stagecraftAuthored: true },
        text: {
          paragraphs: [{
            id: `p${i}`,
            runs: [
              { id: `r${i}a`, text: `N${i} `, editable: true, style: { typeface: 'Arial', sz: '1200', b: '1', color: '#0f172a' }, extensions: { stagecraftAuthored: true } },
              { id: `r${i}b`, text: 'text', editable: true, style: { typeface: 'Arial', sz: '1200', color: '#475569' }, extensions: { stagecraftAuthored: true } },
            ],
          }],
        },
      });
    } else {
      objects.push({
        id: `s${i}`,
        type: 'shape',
        shape: i % 2 === 0 ? 'rect' : 'ellipse',
        fill: i % 3 === 0 ? '#2563eb' : '#0ea5e9',
        geometry: { x: (16 + col * 98) * PT, y: (16 + row * 54) * PT, width: 88 * PT, height: 44 * PT, rotation: 0 },
        extensions: { stagecraftAuthored: true },
      });
    }
  }
  return objects;
}

async function measureWorkload(count) {
  const container = document.getElementById('root');
  const objects = makeSceneObjects(count);
  const doc = createDocument({
    id: `bench-${count}`,
    size: { width: 1600 * PT, height: 900 * PT },
    layouts: [{ id: 'l1', masterId: 'm1' }],
    masters: [{ id: 'm1', themeId: 'theme-1' }],
    themes: [{ id: 'theme-1', extensions: { pptxFontScheme: { minor: { latin: 'Arial', eastAsian: 'Arial', complexScript: 'Arial' }, major: { latin: 'Arial', eastAsian: 'Arial', complexScript: 'Arial' } } } }],
    slides: [{
      id: 'slide-1',
      layoutId: 'l1',
      extensions: { stagecraftAuthored: true },
      background: { type: 'solid', color: '#ffffff' },
      objects,
    }],
  });

  const ownerKey = {};
  const policyKey = {};
  let root = null;
  let commitCalls = 0;

  const coldSceneBuild = [];
  const coldReactMountAndStageAlloc = [];
  const coldExplicitDraw = [];
  const coldMountAndDraw = [];
  const coldTotal = [];

  for (let i = 0; i < 20; i++) {
    const built = timed(() => buildCanonicalScene(doc, 'slide-1'));
    if (built.out.status !== 'ready') throw new Error(`Scene failed: ${built.out.reason}`);
    const scene = built.out.scene;

    const commit = timed(() => {
      root = createRoot(container);
      flushSync(() => {
        root.render(
          <KonvaStage
            scene={scene}
            revision={0}
            ownerKey={ownerKey}
            policyKey={policyKey}
            selectionId={objects[0].id}
            zoom={ZOOM_1600}
            readOnly={false}
            canMove={() => true}
            onSelect={() => {}}
            onMove={() => { commitCalls += 1; }}
          />,
        );
      });
    });
    const draw = timed(() => {
      Konva.stages.at(-1).draw();
    });

    coldSceneBuild.push(built.ms);
    coldReactMountAndStageAlloc.push(commit.ms);
    coldExplicitDraw.push(draw.ms);
    coldMountAndDraw.push(commit.ms + draw.ms);
    coldTotal.push(built.ms + commit.ms + draw.ms);

    if (i < 19) {
      flushSync(() => root.unmount());
      root = null;
    }
  }

  // Also measure cold slide-switch on the ALREADY-MOUNTED Stage (16-obj fresh scene)
  const coldSlideSwitch = [];
  {
    const stage = Konva.stages.at(-1);
    for (let i = 0; i < 20; i++) {
      const altDoc = createDocument({
        id: `bench-switch-${count}-${i}`,
        size: { width: 1600 * PT, height: 900 * PT },
        layouts: [{ id: 'l1', masterId: 'm1' }],
        masters: [{ id: 'm1', themeId: 'theme-1' }],
        themes: [{ id: 'theme-1', extensions: { pptxFontScheme: { minor: { latin: 'Arial', eastAsian: 'Arial', complexScript: 'Arial' }, major: { latin: 'Arial', eastAsian: 'Arial', complexScript: 'Arial' } } } }],
        slides: [{
          id: `slide-switch-${i}`,
          layoutId: 'l1',
          extensions: { stagecraftAuthored: true },
          background: { type: 'solid', color: '#ffffff' },
          objects: makeSceneObjects(count),
        }],
      });
      const built = timed(() => buildCanonicalScene(altDoc, `slide-switch-${i}`));
      const sw = timed(() => {
        flushSync(() => {
          root.render(
            <KonvaStage
              scene={built.out.scene}
              revision={i + 1}
              ownerKey={ownerKey}
              policyKey={policyKey}
              selectionId={objects[0].id}
              zoom={ZOOM_1600}
              readOnly={false}
              canMove={() => true}
              onSelect={() => {}}
              onMove={() => { commitCalls += 1; }}
            />,
          );
        });
        stage.draw();
      });
      coldSlideSwitch.push(built.ms + sw.ms);
    }
  }

  try {
    const stage = Konva.stages.at(-1);
    const layer = stage.getLayers()[0];

    // 10 warmups
    for (let i = 0; i < 10; i++) {
      layer.draw();
      await nextFrame();
    }

    // 80 warm repaint samples (synchronous layer.draw + real rAF scheduling interval)
    const warmSyncDraw = [];
    const warmRafInterval = [];
    for (let i = 0; i < 80; i++) {
      warmSyncDraw.push(timed(() => layer.draw()).ms);
      const t0 = performance.now();
      layer.batchDraw();
      await nextFrame();
      warmRafInterval.push(performance.now() - t0);
    }

    // 80 drag/gesture frames with real rAF + batchDraw + hit testing
    const canvas = stage.getContent().querySelector('canvas');
    const rect = canvas.getBoundingClientRect();
    const firstNode = stage.findOne(`.${objects[0].id}`);
    const startCenter = firstNode.position();

    const dragHandlerMs = [];
    const dragRafIntervalMs = [];
    const hitMs = [];

    const startClientX = rect.left + startCenter.x;
    const startClientY = rect.top + startCenter.y;
    flushSync(() => {
      canvas.dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true, cancelable: true, clientX: startClientX, clientY: startClientY, button: 0, buttons: 1,
      }));
    });

    for (let i = 1; i <= 80; i++) {
      const t0 = performance.now();
      const handler = timed(() => {
        window.dispatchEvent(new MouseEvent('mousemove', {
          bubbles: true, cancelable: true, clientX: startClientX + i * 0.5, clientY: startClientY + i * 0.25, buttons: 1,
        }));
      });
      dragHandlerMs.push(handler.ms);
      hitMs.push(timed(() => stage.getIntersection({ x: startCenter.x + i * 0.5, y: startCenter.y + i * 0.25 })).ms);
      await nextFrame();
      dragRafIntervalMs.push(performance.now() - t0);
    }

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    if (commitCalls !== 0) throw new Error(`Expected 0 commits on Escape cancel, got ${commitCalls}`);

    // Stage, scene, hit, and cache memory accounting
    const layers = stage.getLayers().map((l, idx) => {
      const sc = l.getCanvas();
      const hc = l.getHitCanvas();
      return {
        index: idx,
        sceneCanvas: [sc.width, sc.height],
        hitCanvas: [hc.width, hc.height],
        sceneBytes: 4 * sc.width * sc.height,
        hitBytes: 4 * hc.width * hc.height,
      };
    });
    const bufferHit = stage.bufferHitCanvas
      ? [stage.bufferHitCanvas.width, stage.bufferHitCanvas.height]
      : [0, 0];
    const bufferHitBytes = 4 * bufferHit[0] * bufferHit[1];
    const cachedNodeCanvases = stage.find(n => n.isCached?.()).length;
    const totalBackingBytes = layers.reduce((acc, l) => acc + l.sceneBytes + l.hitBytes, 0) + bufferHitBytes;

    return {
      count,
      dpr: window.devicePixelRatio,
      viewportCss: [stage.width(), stage.height()],
      samples: { cold: 20, warmup: 10, warm: 80, drag: 80 },
      coldSceneBuildMs: stats(coldSceneBuild),
      coldReactMountAndStageAllocMs: stats(coldReactMountAndStageAlloc),
      coldExplicitDrawMs: stats(coldExplicitDraw),
      coldMountAndDrawMs: stats(coldMountAndDraw),
      coldTotalMs: stats(coldTotal),
      coldSlideSwitchMs: stats(coldSlideSwitch),
      warmSyncDrawMs: stats(warmSyncDraw),
      warmRafIntervalMs: stats(warmRafInterval),
      dragHandlerMs: stats(dragHandlerMs),
      dragRafIntervalMs: stats(dragRafIntervalMs),
      hitTestMs: stats(hitMs),
      memory: {
        layerCount: layers.length,
        layers,
        bufferHitCanvas: bufferHit,
        bufferHitBytes,
        cachedNodeCanvases,
        totalBackingBytes,
        totalBackingMB: Number((totalBackingBytes / (1024 * 1024)).toFixed(2)),
        jsHeapUsedMB: performance.memory?.usedJSHeapSize
          ? Number((performance.memory.usedJSHeapSize / (1024 * 1024)).toFixed(2))
          : null,
      },
    };
  } finally {
    if (root) flushSync(() => root.unmount());
  }
}

window.__runKonvaBench = async () => ({
  userAgent: navigator.userAgent,
  devicePixelRatio: window.devicePixelRatio,
  workloads: [
    await measureWorkload(16),
    await measureWorkload(256),
  ],
});
