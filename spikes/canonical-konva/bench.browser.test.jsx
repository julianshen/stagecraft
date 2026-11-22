import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import Konva from 'konva/lib/Core';
import { it, expect } from 'vitest';
import { CanonicalKonvaStage } from './CanonicalKonvaStage.jsx';
import { createDocument } from '../../packages/core/src/document/index.js';
const stats = values => { const s = [...values].sort((a,b) => a-b); return { median: s[Math.floor(s.length / 2)], p95: s[Math.floor(s.length * .95)] }; };
const timed = fn => { const start = performance.now(); fn(); return performance.now() - start; };
const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
it.each([16, 256])('measures %s primitive objects, not Office fidelity', async count => {
  const container = document.createElement('div'); document.body.appendChild(container);
  const objects = Array.from({ length: count }, (_, i) => ({ id: `r${i}`, type: 'shape', shape: i % 2 ? 'ellipse' : 'rect', fill: '#336699',
    geometry: { x: (20 + (i % 16) * 95) * 12700, y: (20 + Math.floor(i / 16) * 50) * 12700, width: 60 * 12700, height: 30 * 12700 }, extensions: { editableGeometry: true } }));
  const snapshot = { document: createDocument({ size: { width: 1600 * 12700, height: 900 * 12700 }, slides: [{ id: 's', objects }] }), revision: 0 };
  const ownerKey = {}, policyKey = {}; let root; let commitCalls = 0;
  const paint = () => <CanonicalKonvaStage snapshot={snapshot} slideId="s" selection={{ slideId: 's', objectId: 'r0' }}
    ownerKey={ownerKey} policyKey={policyKey} viewport={{ width: 1600, height: 900 }} readOnly={false} canMove={() => true} onSelectionChange={() => {}} onMove={() => { commitCalls++; }} />;
  try {
    const cold = [];
    for (let i = 0; i < 20; i++) {
      cold.push(timed(() => { root = createRoot(container); flushSync(() => root.render(paint())); Konva.stages.at(-1).draw(); }));
      if (i < 19) flushSync(() => root.unmount());
    }
    const stage = Konva.stages.at(-1), layer = stage.getLayers()[0];
    for (let i = 0; i < 10; i++) layer.draw();
    const warm = Array.from({ length: 80 }, () => timed(() => layer.draw()));
    const content = stage.getContent(), rect = content.getBoundingClientRect();
    const pointer = (type, x, y, target) => target.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 7, pointerType: 'mouse', button: 0, isPrimary: true, buttons: 1, clientX: rect.left + x, clientY: rect.top + y }));
    flushSync(() => pointer('pointerdown', 40, 30, content));
    const node = layer.getChildren()[0].getChildren()[0];
    const before = node.position();
    const drag = [], hit = [];
    for (let i = 0; i < 80; i++) {
      await frame();
      drag.push(timed(() => { pointer('pointermove', 40 + i / 4, 30 + i / 8, window); layer.draw(); }));
      hit.push(timed(() => stage.getIntersection({ x: 40 + i / 4, y: 30 + i / 8 })));
    }
    expect(node.x()).toBeCloseTo(before.x + 79 / 4);
    expect(node.y()).toBeCloseTo(before.y + 79 / 8);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(node.position()).toEqual(before);
    expect(commitCalls).toBe(0);
    const scene = layer.getCanvas(), hitCanvas = layer.getHitCanvas();
    expect(stage.getLayers()).toHaveLength(1);
    console.log('CANONICAL_KONVA_PERF ' + JSON.stringify({ count, dpr: devicePixelRatio, userAgent: navigator.userAgent,
      viewport: [1600, 900], layers: 1, samples: { cold: 20, warmup: 10, warm: 80, drag: 80 },
      coldMountDrawMs: stats(cold), warmSceneAndHitDrawMs: stats(warm), pointerAndDrawMs: stats(drag), hitMs: stats(hit),
      backing: { scene: [scene.width, scene.height], hit: [hitCanvas.width, hitCanvas.height] },
      layerBackingBytes: 4 * (scene.width * scene.height + hitCanvas.width * hitCanvas.height),
      stageBufferBytes: 4 * stage.bufferHitCanvas.width * stage.bufferHitCanvas.height,
      timingScope: 'synchronous CPU draw submission; hit readback reported separately; excludes compositor presentation'  }));
  } finally { if (root) flushSync(() => root.unmount()); container.remove(); }
}, 30000);
