import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, act } from '@testing-library/react';
import { createEditor } from '@stagecraft/core/editor';
import { createDocument, documentPlugin, presentationPlugin, validateDocument } from '@stagecraft/core/document';
import { nativeObjectAppearanceInput, nativeSlideAppearanceInput } from '@stagecraft/core/lib/nativeAppearance.js';
import { EditorProvider } from '../EditorProvider.jsx';
import { PresentationEditor } from '../PresentationEditor.jsx';

const PT = 12700;
const PX = 9525;

function makeDoc(objects, { slides } = {}) {
  return createDocument({
    slides: slides ?? [{
      id: 's1',
      objects,
      extensions: { stagecraftAuthored: true },
    }],
  });
}

function makeRect(id, xPt = 100, yPt = 100, wPt = 200, hPt = 100, rotation = 0) {
  return {
    id,
    type: 'shape',
    shape: 'rect',
    fill: '#2563eb',
    geometry: { x: xPt * PT, y: yPt * PT, width: wPt * PT, height: hPt * PT, rotation },
    extensions: { stagecraftAuthored: true },
  };
}

function makeEditor(objects, opts) {
  return createEditor({
    document: makeDoc(objects, opts),
    validateDocument,
    plugins: [documentPlugin, presentationPlugin],
  });
}

function makeNativeTextDoc({ autofit = 'none', fit } = {}) {
  const source = { format: 'pptx', part: 'ppt/slides/slide1.xml', path: [0] };
  const resolved = {
    color: '#112233',
    fontFamily: 'Arial',
    fontFamilyEastAsia: 'Arial',
    fontFamilyComplexScript: 'Arial',
    fontSizePt: 18,
    bold: false,
    italic: false,
  };
  const object = {
    id: 'n1',
    type: 'text',
    source,
    geometry: { x: 100 * PT, y: 100 * PT, width: 200 * PT, height: 100 * PT, rotation: 0 },
    extensions: { editableGeometry: true, pptxTextMetrics: { supported: true } },
    ...(autofit !== 'none' ? { bodyLayout: { autofit, ...(fit ? { fit } : {}), anchor: 'top', wrap: 'square' } } : {}),
    text: {
      paragraphs: [{
        id: 'p1',
        source,
        style: {},
        extensions: { pptxEndRunAppearance: { ...resolved } },
        runs: [{
          id: 'r1',
          text: 'Native text sample for resize',
          editable: true,
          source,
          style: { sz: '1800', typeface: 'Arial' },
          extensions: { pptxAppearance: { script: 'Latn', resolved: { ...resolved } } },
        }],
      }],
    },
  };
  object.extensions.stagecraftNativeAppearance = {
    version: 1,
    sourceFormat: 'pptx',
    appearanceResolved: true,
    input: '',
    fill: { kind: 'none' },
    stroke: { kind: 'none' },
    text: {
      paragraphs: [{
        id: 'p1',
        runIds: ['r1'],
        alignment: 'left',
        spaceBeforePt: 0,
        spaceAfterPt: 0,
        lineSpacingPct: 100,
        indentStartEmu: 0,
        indentEndEmu: 0,
        firstLineIndentEmu: 0,
        endRun: { ...resolved },
      }],
    },
  };
  const doc = createDocument({
    slides: [{
      id: 's1',
      source,
      objects: [object],
      extensions: {
        stagecraftSlideAppearance: {
          version: 1,
          appearanceResolved: true,
          input: '',
          background: { kind: 'solid', color: '#FFFFFF' },
          inheritedArtworkCount: 0,
        },
      },
    }],
  });
  const docObject = doc.slides[0].objects[0];
  docObject.extensions.stagecraftNativeAppearance.input = nativeObjectAppearanceInput(docObject, {
    theme: undefined, colorMap: undefined, document: doc, slide: doc.slides[0],
  });
  doc.slides[0].extensions.stagecraftSlideAppearance.input = nativeSlideAppearanceInput(doc.slides[0], doc);
  return doc;
}

function selectObject(container, id) {
  const button = container.querySelector(`button[aria-label="Select object ${id}"]`);
  expect(button).toBeTruthy();
  act(() => {
    button.click();
  });
}

async function waitForKonvaCanvas(container) {
  await waitFor(() => {
    const canvas = container.querySelector('.stagecraft-konva-paper canvas');
    expect(canvas).toBeTruthy();
  });
  return container.querySelector('.stagecraft-konva-paper canvas');
}

function getStageForContainer(Konva, container) {
  const content = container.querySelector('.konvajs-content');
  return Konva.stages.find(s => s.content === content) ?? null;
}

async function dragAnchor(canvas, transformer, anchorName, dx, dy, { shiftKey = false, altKey = false } = {}) {
  const stage = transformer.getStage();
  let anchor;
  let pos;
  await waitFor(() => {
    anchor = transformer.findOne(`.${anchorName}`);
    if (!anchor) throw new Error(`Anchor ${anchorName} not found`);
    pos = anchor.getAbsolutePosition();
    const hit = stage.getIntersection(pos);
    if (hit !== anchor) throw new Error(`Hit=${hit?.className}:${hit?.name()} expected=${anchorName} at ${pos.x},${pos.y}`);
  }, { timeout: 5000 });
  const rect = canvas.getBoundingClientRect();
  const startX = rect.left + pos.x;
  const startY = rect.top + pos.y;
  act(() => {
    canvas.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true, cancelable: true, button: 0, buttons: 1, clientX: startX, clientY: startY, shiftKey, altKey,
    }));
  });
  act(() => {
    window.dispatchEvent(new MouseEvent('mousemove', {
      bubbles: true, cancelable: true, buttons: 1, clientX: startX + dx, clientY: startY + dy, shiftKey, altKey,
    }));
  });
  act(() => {
    window.dispatchEvent(new MouseEvent('mouseup', {
      bubbles: true, cancelable: true, button: 0, buttons: 0, clientX: startX + dx, clientY: startY + dy, shiftKey, altKey,
    }));
  });
}

function cornerSlidePoints(geometry) {
  const cx = geometry.x + geometry.width / 2;
  const cy = geometry.y + geometry.height / 2;
  const rad = ((geometry.rotation ?? 0) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const hw = geometry.width / 2;
  const hh = geometry.height / 2;
  const rotate = (lx, ly) => ({ x: cx + lx * cos - ly * sin, y: cy + lx * sin + ly * cos });
  return {
    tl: rotate(-hw, -hh),
    tr: rotate(hw, -hh),
    br: rotate(hw, hh),
    bl: rotate(-hw, hh),
  };
}

describe('KONVA-4 Transformer resize, rotate, and cancellation', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('attaches Transformer only for one eligible selected object and hides on readOnly or null selection', async () => {
    const editor = makeEditor([makeRect('r1', 100, 100, 200, 100)]);
    const { container, rerender } = render(
      <EditorProvider editor={editor}>
        <PresentationEditor surface="konva" />
      </EditorProvider>,
    );
    await waitForKonvaCanvas(container);
    const { default: Konva } = await import('konva/lib/Core.js');
    const stage = getStageForContainer(Konva, container);
    expect(stage.getLayers().length).toBe(2);

    let tr = stage.findOne('Transformer');
    expect(tr).toBeTruthy();
    expect(tr.nodes()).toEqual([]);

    selectObject(container, 'r1');
    await waitFor(() => {
      tr = stage.findOne('Transformer');
      expect(tr.nodes().length).toBe(1);
      expect(tr.nodes()[0].name()).toBe('r1');
    });

    rerender(
      <EditorProvider editor={editor}>
        <PresentationEditor surface="konva" readOnly />
      </EditorProvider>,
    );
    await waitFor(() => {
      expect(stage.findOne('Transformer').nodes()).toEqual([]);
    });

    rerender(
      <EditorProvider editor={editor}>
        <PresentationEditor surface="konva" />
      </EditorProvider>,
    );
    // Click background rect on canvas to clear selection
    const bgRect = stage.findOne('Rect');
    act(() => {
      bgRect.fire('click', { evt: new MouseEvent('click') });
    });
    await waitFor(() => {
      expect(stage.findOne('Transformer').nodes()).toEqual([]);
    });
  });

  it('resizes unrotated object from corner and edge handles, preserves opposite anchor, clamps >= 1pt, and supports undo/redo', async () => {
    const editor = makeEditor([makeRect('r1', 100, 100, 200, 100)]);
    const { container } = render(
      <EditorProvider editor={editor}>
        <PresentationEditor surface="konva" />
      </EditorProvider>,
    );
    const canvas = await waitForKonvaCanvas(container);
    const { default: Konva } = await import('konva/lib/Core.js');
    const stage = getStageForContainer(Konva, container);

    selectObject(container, 'r1');
    await waitFor(() => expect(stage.findOne('Transformer').nodes().length).toBe(1));
    const tr = stage.findOne('Transformer');
    const startGeom = structuredClone(editor.getSnapshot().document.slides[0].objects[0].geometry);

    // Bottom-right drag (+40px, +20px) keeps top-left fixed
    await dragAnchor(canvas, tr, 'bottom-right', 40, 20);
    await waitFor(() => {
      expect(editor.getSnapshot().revision).toBe(1);
    });
    const afterCorner = editor.getSnapshot().document.slides[0].objects[0].geometry;
    expect(afterCorner.x).toBe(startGeom.x);
    expect(afterCorner.y).toBe(startGeom.y);
    expect(afterCorner.width).toBeGreaterThan(startGeom.width);
    expect(afterCorner.height).toBeGreaterThan(startGeom.height);
    expect(stage.findOne('.r1').scaleX()).toBe(1);
    expect(stage.findOne('.r1').scaleY()).toBe(1);

    // Dragging past top-left anchor clamps at >= 1pt (12700 EMU) and never flips
    await dragAnchor(canvas, tr, 'bottom-right', -1000, -1000);
    await waitFor(() => {
      expect(editor.getSnapshot().revision).toBe(2);
    });
    const afterClamp = editor.getSnapshot().document.slides[0].objects[0].geometry;
    expect(afterClamp.width).toBeGreaterThanOrEqual(PT);
    expect(afterClamp.height).toBeGreaterThanOrEqual(PT);

    // Undo restores previous geometry cleanly in one step
    act(() => {
      editor.undo();
    });
    expect(editor.getSnapshot().document.slides[0].objects[0].geometry).toEqual(afterCorner);
    act(() => {
      editor.undo();
    });
    expect(editor.getSnapshot().document.slides[0].objects[0].geometry).toEqual(startGeom);
    act(() => {
      editor.redo();
    });
    expect(editor.getSnapshot().document.slides[0].objects[0].geometry).toEqual(afterCorner);
  });

  it.each([30, 90])('resizes %s-degree rotated objects along local axes while preserving the opposite anchor in slide coordinates', async angle => {
    const editor = makeEditor([makeRect('r1', 150, 150, 200, 100, angle)]);
    const { container } = render(
      <EditorProvider editor={editor}>
        <PresentationEditor surface="konva" />
      </EditorProvider>,
    );
    const canvas = await waitForKonvaCanvas(container);
    const { default: Konva } = await import('konva/lib/Core.js');
    const stage = getStageForContainer(Konva, container);

    selectObject(container, 'r1');
    await waitFor(() => expect(stage.findOne('Transformer').nodes().length).toBe(1));
    const tr = stage.findOne('Transformer');
    const before = structuredClone(editor.getSnapshot().document.slides[0].objects[0].geometry);
    const beforeCorners = cornerSlidePoints(before);

    await dragAnchor(canvas, tr, 'bottom-right', 45, 25);
    await waitFor(() => {
      expect(editor.getSnapshot().revision).toBe(1);
    });
    const after = editor.getSnapshot().document.slides[0].objects[0].geometry;
    const afterCorners = cornerSlidePoints(after);
    expect(after.rotation).toBe(angle);
    // Opposite anchor (top-left) stays fixed within 1 EMU rounding
    expect(Math.abs(afterCorners.tl.x - beforeCorners.tl.x)).toBeLessThanOrEqual(PX);
    expect(Math.abs(afterCorners.tl.y - beforeCorners.tl.y)).toBeLessThanOrEqual(PX);
  });

  it('locks aspect ratio on Shift+corner only (not edge), and cancels Alt+corner resize cleanly', async () => {
    const editor = makeEditor([makeRect('r1', 100, 100, 200, 100)]);
    const { container } = render(
      <EditorProvider editor={editor}>
        <PresentationEditor surface="konva" />
      </EditorProvider>,
    );
    const canvas = await waitForKonvaCanvas(container);
    const { default: Konva } = await import('konva/lib/Core.js');
    const stage = getStageForContainer(Konva, container);

    selectObject(container, 'r1');
    await waitFor(() => expect(stage.findOne('Transformer').nodes().length).toBe(1));
    const tr = stage.findOne('Transformer');
    const startGeom = structuredClone(editor.getSnapshot().document.slides[0].objects[0].geometry);

    // Alt + corner drag must cancel cleanly (0 commands, centeredScaling neutralized)
    await dragAnchor(canvas, tr, 'bottom-right', 40, 20, { altKey: true });
    expect(editor.getSnapshot().revision).toBe(0);
    expect(editor.getSnapshot().document.slides[0].objects[0].geometry).toEqual(startGeom);

    // Shift + corner keeps 2:1 aspect ratio
    await dragAnchor(canvas, tr, 'bottom-right', 60, 5, { shiftKey: true });
    await waitFor(() => {
      expect(editor.getSnapshot().revision).toBe(1);
    });
    const afterShiftCorner = editor.getSnapshot().document.slides[0].objects[0].geometry;
    expect(afterShiftCorner.width / afterShiftCorner.height).toBeCloseTo(2, 2);

    // Shift + edge does not lock aspect
    const beforeEdge = structuredClone(afterShiftCorner);
    await dragAnchor(canvas, tr, 'middle-right', 40, 0, { shiftKey: true });
    await waitFor(() => {
      expect(editor.getSnapshot().revision).toBe(2);
    });
    const afterShiftEdge = editor.getSnapshot().document.slides[0].objects[0].geometry;
    expect(afterShiftEdge.width).toBeGreaterThan(beforeEdge.width);
    expect(afterShiftEdge.height).toBe(beforeEdge.height);
  });

  it('rotates about center with [0, 360) normalization, Shift 15-degree snap, and disables rotater on ODP', async () => {
    const editor = makeEditor([makeRect('r1', 150, 150, 200, 100, 0)]);
    const { container, unmount } = render(
      <EditorProvider editor={editor}>
        <PresentationEditor surface="konva" />
      </EditorProvider>,
    );
    const canvas = await waitForKonvaCanvas(container);
    const { default: Konva } = await import('konva/lib/Core.js');
    const stage = getStageForContainer(Konva, container);

    selectObject(container, 'r1');
    await waitFor(() => expect(stage.findOne('Transformer').nodes().length).toBe(1));
    const tr = stage.findOne('Transformer');
    const startGeom = structuredClone(editor.getSnapshot().document.slides[0].objects[0].geometry);

    // Hold Shift and drag rotater ~18 degrees -> snaps to 15
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', shiftKey: true, bubbles: true }));
    });
    await dragAnchor(canvas, tr, 'rotater', 38, 10, { shiftKey: true });
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift', shiftKey: false, bubbles: true }));
    });
    await waitFor(() => {
      expect(editor.getSnapshot().revision).toBe(1);
    });
    const afterSnap = editor.getSnapshot().document.slides[0].objects[0].geometry;
    expect(afterSnap.rotation % 15).toBe(0);
    expect(afterSnap.rotation).toBeGreaterThanOrEqual(0);
    expect(afterSnap.rotation).toBeLessThan(360);
    expect(afterSnap.width).toBe(startGeom.width);
    expect(afterSnap.height).toBe(startGeom.height);

    // Free rotation (without Shift) rounds to 0.01 degrees and normalizes to [0, 360)
    await dragAnchor(canvas, tr, 'rotater', 20, 12, { shiftKey: false });
    await waitFor(() => {
      expect(editor.getSnapshot().revision).toBe(2);
    });
    const afterFree = editor.getSnapshot().document.slides[0].objects[0].geometry;
    expect(afterFree.rotation).toBeGreaterThanOrEqual(0);
    expect(afterFree.rotation).toBeLessThan(360);
    expect(Math.round(afterFree.rotation * 100) / 100).toBe(afterFree.rotation);
    unmount();

    // Direct KonvaStage respects canRotate={false} (e.g. ODP capability)
    const { default: KonvaStage } = await import('./KonvaStage.jsx');
    const { buildCanonicalScene } = await import('@stagecraft/renderer/canonical');
    const scene = buildCanonicalScene(makeDoc([makeRect('r2', 100, 100, 200, 100, 0)]), 's1').scene;
    const direct = render(
      <KonvaStage
        scene={scene}
        revision={0}
        ownerKey={{}}
        policyKey={{}}
        selectionId="r2"
        canMove={() => true}
        canRotate={() => false}
      />,
    );
    await waitFor(() => {
      const s = getStageForContainer(Konva, direct.container);
      expect(s.findOne('Transformer').rotateEnabled()).toBe(false);
    });
  });

  it('cancels on Escape with tr.stopTransform() and ignores Arrow/undo during active transform', async () => {
    const baseEditor = makeEditor([makeRect('r1', 100, 100, 200, 100)]);
    let dispatchCount = 0;
    const editor = {
      ...baseEditor,
      dispatch: (...args) => { dispatchCount += 1; return baseEditor.dispatch(...args); },
    };
    const { container } = render(
      <EditorProvider editor={editor}>
        <PresentationEditor surface="konva" />
      </EditorProvider>,
    );
    const canvas = await waitForKonvaCanvas(container);
    const { default: Konva } = await import('konva/lib/Core.js');
    const stage = getStageForContainer(Konva, container);

    selectObject(container, 'r1');
    await waitFor(() => expect(stage.findOne('Transformer').nodes().length).toBe(1));
    const tr = stage.findOne('Transformer');
    let anchor;
    let pos;
    await waitFor(() => {
      anchor = tr.findOne('.bottom-right');
      if (!anchor) throw new Error('bottom-right not found');
      pos = anchor.getAbsolutePosition();
      if (stage.getIntersection(pos) !== anchor) throw new Error('hit not ready');
    });
    const rect = canvas.getBoundingClientRect();
    const startX = rect.left + pos.x;
    const startY = rect.top + pos.y;

    act(() => {
      canvas.dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true, cancelable: true, button: 0, buttons: 1, clientX: startX, clientY: startY,
      }));
    });
    act(() => {
      window.dispatchEvent(new MouseEvent('mousemove', {
        bubbles: true, cancelable: true, buttons: 1, clientX: startX + 40, clientY: startY + 20,
      }));
    });
    expect(tr.isTransforming()).toBe(true);

    // Arrow key and Ctrl+Z during active transform are ignored (neither dispatch nor cancel)
    act(() => {
      canvas.closest('[aria-label="Slide canvas"]')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
      canvas.closest('[aria-label="Slide canvas"]')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }));
    });
    expect(dispatchCount).toBe(0);
    expect(tr.isTransforming()).toBe(true);

    // Escape stops Transformer and restores start geometry; late mouseup is inert
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });
    expect(tr.isTransforming()).toBe(false);
    act(() => {
      window.dispatchEvent(new MouseEvent('mouseup', {
        bubbles: true, cancelable: true, button: 0, buttons: 0, clientX: startX + 40, clientY: startY + 20,
      }));
    });
    expect(dispatchCount).toBe(0);
    expect(stage.findOne('.r1').scaleX()).toBe(1);
    expect(stage.findOne('.r1').scaleY()).toBe(1);
  });

  it('falls back to SVG on K3c fit-bound resize, keeps non-fit native text and rotation on Konva, and preserves SVG rotated guard', async () => {
    // 1. K3c fit-bound resize -> falls back to SVG with unresolved-appearance
    const fitEditor = createEditor({
      document: makeNativeTextDoc({ autofit: 'shrink', fit: { fontScale: 85000, lnSpcReduction: 0 } }),
      validateDocument,
      plugins: [documentPlugin, presentationPlugin],
    });
    const onSurfaceChange = vi.fn();
    const fitView = render(
      <EditorProvider editor={fitEditor}>
        <PresentationEditor surface="konva" onSurfaceChange={onSurfaceChange} />
      </EditorProvider>,
    );
    const fitCanvas = await waitForKonvaCanvas(fitView.container);
    const { default: Konva } = await import('konva/lib/Core.js');
    const fitStage = getStageForContainer(Konva, fitView.container);
    selectObject(fitView.container, 'n1');
    await waitFor(() => expect(fitStage.findOne('Transformer').nodes().length).toBe(1));
    await dragAnchor(fitCanvas, fitStage.findOne('Transformer'), 'middle-right', 40, 0);
    await waitFor(() => {
      expect(onSurfaceChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ active: 'svg', status: 'fallback', reason: 'unresolved-appearance' }),
      );
    });
    expect(fitView.container.querySelector('.stagecraft-konva-fallback-bar p[role="status"]')).toBeTruthy();
    fitView.unmount();

    // 1b. K3c fit-bound rotation-only -> stays on Konva
    const rotEditor = createEditor({
      document: makeNativeTextDoc({ autofit: 'shrink', fit: { fontScale: 85000, lnSpcReduction: 0 } }),
      validateDocument,
      plugins: [documentPlugin, presentationPlugin],
    });
    const onRotSurface = vi.fn();
    const rotView = render(
      <EditorProvider editor={rotEditor}>
        <PresentationEditor surface="konva" onSurfaceChange={onRotSurface} />
      </EditorProvider>,
    );
    const rotCanvas = await waitForKonvaCanvas(rotView.container);
    const rotStage = getStageForContainer(Konva, rotView.container);
    selectObject(rotView.container, 'n1');
    await waitFor(() => expect(rotStage.findOne('Transformer').nodes().length).toBe(1));
    await dragAnchor(rotCanvas, rotStage.findOne('Transformer'), 'rotater', 38, 10, { shiftKey: true });
    await waitFor(() => expect(rotEditor.getSnapshot().revision).toBe(1));
    expect(onRotSurface).toHaveBeenLastCalledWith(expect.objectContaining({ active: 'konva', status: 'ready' }));
    rotView.unmount();

    // 2. K3a non-fit native text resize -> stays on Konva
    const nonFitEditor = createEditor({
      document: makeNativeTextDoc({ autofit: 'none' }),
      validateDocument,
      plugins: [documentPlugin, presentationPlugin],
    });
    const onNonFitSurface = vi.fn();
    const nonFitView = render(
      <EditorProvider editor={nonFitEditor}>
        <PresentationEditor surface="konva" onSurfaceChange={onNonFitSurface} />
      </EditorProvider>,
    );
    const nonFitCanvas = await waitForKonvaCanvas(nonFitView.container);
    const nonFitStage = getStageForContainer(Konva, nonFitView.container);
    selectObject(nonFitView.container, 'n1');
    await waitFor(() => expect(nonFitStage.findOne('Transformer').nodes().length).toBe(1));
    await dragAnchor(nonFitCanvas, nonFitStage.findOne('Transformer'), 'middle-right', 40, 0);
    await waitFor(() => expect(nonFitEditor.getSnapshot().revision).toBe(1));
    expect(onNonFitSurface).toHaveBeenLastCalledWith(expect.objectContaining({ active: 'konva', status: 'ready' }));
    nonFitView.unmount();

    // 3. SVG guard preserved for rotated objects
    const svgEditor = makeEditor([makeRect('r1', 100, 100, 200, 100, 25)]);
    const svgView = render(
      <EditorProvider editor={svgEditor}>
        <PresentationEditor surface="svg" />
      </EditorProvider>,
    );
    expect(svgView.container.querySelectorAll('[data-resize-handle]')).toHaveLength(0);
  });

  it('produces zoom-independent EMU edits and isolates two mounted stages', async () => {
    const editorA = makeEditor([makeRect('a1', 100, 100, 200, 100)]);
    const editorB = makeEditor([makeRect('b1', 100, 100, 200, 100)]);
    const { container } = render(
      <>
        <div data-testid="stage-a">
          <EditorProvider editor={editorA}>
            <PresentationEditor surface="konva" zoom={200} />
          </EditorProvider>
        </div>
        <div data-testid="stage-b">
          <EditorProvider editor={editorB}>
            <PresentationEditor surface="konva" zoom={50} />
          </EditorProvider>
        </div>
      </>,
    );
    const containerA = container.querySelector('[data-testid="stage-a"]');
    const containerB = container.querySelector('[data-testid="stage-b"]');
    const canvasA = await waitForKonvaCanvas(containerA);
    await waitForKonvaCanvas(containerB);
    const { default: Konva } = await import('konva/lib/Core.js');
    const stageA = getStageForContainer(Konva, containerA);
    const stageB = getStageForContainer(Konva, containerB);

    selectObject(containerA, 'a1');
    selectObject(containerB, 'b1');
    await waitFor(() => {
      expect(stageA.findOne('Transformer').nodes().length).toBe(1);
      expect(stageB.findOne('Transformer').nodes().length).toBe(1);
    });
    await dragAnchor(canvasA, stageA.findOne('Transformer'), 'middle-right', 40, 0);
    await waitFor(() => expect(editorA.getSnapshot().revision).toBe(1));
    expect(editorB.getSnapshot().revision).toBe(0);
  });

  it('cancels mid-transform on blur, pointercancel, stale snapshot, selection change, and dispatches nothing on no-op', async () => {
    const baseEditor = makeEditor([makeRect('r1', 100, 100, 200, 100), makeRect('r2', 400, 100, 120, 80)]);
    let dispatchCount = 0;
    const editor = {
      ...baseEditor,
      dispatch: (...args) => { dispatchCount += 1; return baseEditor.dispatch(...args); },
    };
    const { container } = render(
      <EditorProvider editor={editor}>
        <PresentationEditor surface="konva" />
      </EditorProvider>,
    );
    const canvas = await waitForKonvaCanvas(container);
    const { default: Konva } = await import('konva/lib/Core.js');
    const stage = getStageForContainer(Konva, container);
    selectObject(container, 'r1');
    await waitFor(() => expect(stage.findOne('Transformer').nodes().length).toBe(1));
    const tr = stage.findOne('Transformer');

    // No-op transform (dx=0, dy=0) dispatches 0 commands
    await dragAnchor(canvas, tr, 'bottom-right', 0, 0);
    expect(dispatchCount).toBe(0);

    // Blur cancels active transform and makes late mouseup inert
    let anchor;
    let pos;
    await waitFor(() => {
      anchor = tr.findOne('.bottom-right');
      pos = anchor.getAbsolutePosition();
      if (stage.getIntersection(pos) !== anchor) throw new Error('hit not ready');
    });
    const rect = canvas.getBoundingClientRect();
    const startX = rect.left + pos.x;
    const startY = rect.top + pos.y;
    act(() => {
      canvas.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, buttons: 1, clientX: startX, clientY: startY }));
      window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, buttons: 1, clientX: startX + 30, clientY: startY + 20 }));
    });
    expect(tr.isTransforming()).toBe(true);
    act(() => { window.dispatchEvent(new Event('blur')); });
    expect(tr.isTransforming()).toBe(false);
    act(() => { window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0, buttons: 0, clientX: startX + 30, clientY: startY + 20 })); });
    expect(dispatchCount).toBe(0);

    // pointercancel on stage content cancels active transform
    await waitFor(() => {
      pos = tr.findOne('.bottom-right').getAbsolutePosition();
      if (stage.getIntersection(pos) !== tr.findOne('.bottom-right')) throw new Error('hit not ready');
    });
    act(() => {
      canvas.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, buttons: 1, clientX: rect.left + pos.x, clientY: rect.top + pos.y }));
      window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, buttons: 1, clientX: rect.left + pos.x + 25, clientY: rect.top + pos.y + 15 }));
    });
    expect(tr.isTransforming()).toBe(true);
    act(() => { stage.content.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, clientX: rect.left + pos.x + 25, clientY: rect.top + pos.y + 15 })); });
    expect(tr.isTransforming()).toBe(false);
    act(() => { window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0, buttons: 0, clientX: rect.left + pos.x + 25, clientY: rect.top + pos.y + 15 })); });
    expect(dispatchCount).toBe(0);

    // Selection change mid-transform cancels active transform
    await waitFor(() => {
      pos = tr.findOne('.bottom-right').getAbsolutePosition();
      if (stage.getIntersection(pos) !== tr.findOne('.bottom-right')) throw new Error('hit not ready');
    });
    act(() => {
      canvas.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, buttons: 1, clientX: rect.left + pos.x, clientY: rect.top + pos.y }));
      window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, buttons: 1, clientX: rect.left + pos.x + 25, clientY: rect.top + pos.y + 15 }));
    });
    expect(tr.isTransforming()).toBe(true);
    selectObject(container, 'r2');
    await waitFor(() => expect(tr.nodes()[0]?.name()).toBe('r2'));
    expect(tr.isTransforming()).toBe(false);
    expect(dispatchCount).toBe(0);
    expect(screen.queryAllByRole('alert')).toEqual([]);
    expect(stage.findOne('.r1').width()).toBeCloseTo(200 * PT / 9525, 2);
    expect(stage.findOne('.r1').height()).toBeCloseTo(100 * PT / 9525, 2);

    // Stale snapshot mutation mid-transform cancels and reports error
    await waitFor(() => {
      pos = tr.findOne('.bottom-right').getAbsolutePosition();
      if (stage.getIntersection(pos) !== tr.findOne('.bottom-right')) throw new Error('hit not ready');
    });
    act(() => {
      canvas.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, buttons: 1, clientX: rect.left + pos.x, clientY: rect.top + pos.y }));
      window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, buttons: 1, clientX: rect.left + pos.x + 25, clientY: rect.top + pos.y + 15 }));
    });
    act(() => {
      baseEditor.dispatch('presentation.setGeometry', {
        slideId: 's1', objectId: 'r2', geometry: { x: 420 * PT, y: 100 * PT, width: 120 * PT, height: 80 * PT, rotation: 0 },
      });
    });
    expect(tr.isTransforming()).toBe(false);
    expect(screen.getAllByRole('alert').map(el => el.textContent)).toEqual(['Transform could not be applied.']);
  });

  it('produces identical integer EMU geometry at DPR 2 as at DPR 1', async () => {
    const { default: Konva } = await import('konva/lib/Core.js');
    const runAtDpr = async (dpr) => {
      const prevPixelRatio = Konva.pixelRatio;
      const originalDescriptor = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio');
      Konva.pixelRatio = dpr;
      Object.defineProperty(window, 'devicePixelRatio', {
        configurable: true,
        value: dpr,
      });
      try {
        const editor = makeEditor([makeRect('r1', 100, 100, 200, 100)]);
        const { container, unmount } = render(
          <EditorProvider editor={editor}>
            <PresentationEditor surface="konva" />
          </EditorProvider>,
        );
        try {
          const canvas = await waitForKonvaCanvas(container);
          const stage = getStageForContainer(Konva, container);
          const backingWidth = canvas.width;
          const cssWidth = canvas.getBoundingClientRect().width;
          expect(backingWidth).toBe(Math.round(cssWidth * dpr));
          selectObject(container, 'r1');
          await waitFor(() => expect(stage.findOne('Transformer').nodes().length).toBe(1));
          const tr = stage.findOne('Transformer');
          await dragAnchor(canvas, tr, 'bottom-right', 48, 24);
          await waitFor(() => expect(editor.getSnapshot().revision).toBe(1));
          const geom = editor.getSnapshot().document.slides[0].objects[0].geometry;
          expect(Object.values(geom).every(Number.isSafeInteger)).toBe(true);
          return { geom, backingWidth, cssWidth };
        } finally {
          unmount();
        }
      } finally {
        Konva.pixelRatio = prevPixelRatio;
        if (originalDescriptor) {
          Object.defineProperty(window, 'devicePixelRatio', originalDescriptor);
        } else {
          delete window.devicePixelRatio;
        }
      }
    };

    const dpr1 = await runAtDpr(1);
    const dpr2 = await runAtDpr(2);
    expect(dpr2.backingWidth).toBe(dpr1.backingWidth * 2);
    expect(dpr2.geom).toEqual(dpr1.geom);
    expect(dpr2.geom.width).toBeGreaterThan(200 * PT);
    expect(dpr2.geom.height).toBeGreaterThan(100 * PT);
  });

  it('cancels active transform on any embedding CSS transform change (including supported scale-to-scale)', async () => {
    const baseEditor = makeEditor([makeRect('r1', 100, 100, 200, 100)]);
    let dispatchCount = 0;
    const editor = {
      ...baseEditor,
      dispatch: (...args) => { dispatchCount += 1; return baseEditor.dispatch(...args); },
    };
    const { container, rerender } = render(
      <div style={{ transform: 'scale(1)' }}>
        <EditorProvider editor={editor}>
          <PresentationEditor surface="konva" />
        </EditorProvider>
      </div>,
    );
    const canvas = await waitForKonvaCanvas(container);
    const { default: Konva } = await import('konva/lib/Core.js');
    const stage = getStageForContainer(Konva, container);
    selectObject(container, 'r1');
    await waitFor(() => expect(stage.findOne('Transformer').nodes().length).toBe(1));
    const tr = stage.findOne('Transformer');

    let pos;
    await waitFor(() => {
      const anchor = tr.findOne('.bottom-right');
      pos = anchor.getAbsolutePosition();
      if (stage.getIntersection(pos) !== anchor) throw new Error('hit not ready');
    });
    const rect = canvas.getBoundingClientRect();
    act(() => {
      canvas.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, buttons: 1, clientX: rect.left + pos.x, clientY: rect.top + pos.y }));
      window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, buttons: 1, clientX: rect.left + pos.x + 30, clientY: rect.top + pos.y + 20 }));
    });
    expect(tr.isTransforming()).toBe(true);

    rerender(
      <div style={{ transform: 'scale(1.25)' }}>
        <EditorProvider editor={editor}>
          <PresentationEditor surface="konva" />
        </EditorProvider>
      </div>,
    );
    await waitFor(() => expect(tr.isTransforming()).toBe(false));
    act(() => {
      window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0, buttons: 0, clientX: rect.left + pos.x + 30, clientY: rect.top + pos.y + 20 }));
    });
    expect(dispatchCount).toBe(0);
  });

  it('resets Konva node rotation to 0 (not 360) when committing an absent-rotation resize', async () => {
    const rectWithoutRotation = makeRect('r1', 100, 100, 200, 100);
    delete rectWithoutRotation.geometry.rotation;
    const editor = makeEditor([rectWithoutRotation]);
    const { container } = render(
      <EditorProvider editor={editor}>
        <PresentationEditor surface="konva" />
      </EditorProvider>,
    );
    const canvas = await waitForKonvaCanvas(container);
    const { default: Konva } = await import('konva/lib/Core.js');
    const stage = getStageForContainer(Konva, container);
    selectObject(container, 'r1');
    await waitFor(() => expect(stage.findOne('Transformer').nodes().length).toBe(1));
    const tr = stage.findOne('Transformer');
    const node = stage.findOne('.r1');

    let pos;
    await waitFor(() => {
      const anchor = tr.findOne('.bottom-right');
      pos = anchor.getAbsolutePosition();
      if (stage.getIntersection(pos) !== anchor) throw new Error('hit not ready');
    });
    const rect = canvas.getBoundingClientRect();
    act(() => {
      canvas.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, buttons: 1, clientX: rect.left + pos.x, clientY: rect.top + pos.y }));
      window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, buttons: 1, clientX: rect.left + pos.x + 30, clientY: rect.top + pos.y + 20 }));
      node.rotation(360);
      window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0, buttons: 0, clientX: rect.left + pos.x + 30, clientY: rect.top + pos.y + 20 }));
    });
    await waitFor(() => expect(editor.getSnapshot().revision).toBe(1));
    expect('rotation' in editor.getSnapshot().document.slides[0].objects[0].geometry).toBe(false);
    expect(node.rotation()).toBe(0);
  });

  it('preserves exact 33.3333deg rotation on handle click (0 commands) and resize, refuses concurrent drag+transform, and ignores Delete during transform', async () => {
    const baseEditor = makeEditor([makeRect('r1', 100, 100, 200, 100, 33.3333)]);
    let dispatchCount = 0;
    const editor = {
      ...baseEditor,
      dispatch: (...args) => { dispatchCount += 1; return baseEditor.dispatch(...args); },
    };
    const { container } = render(
      <EditorProvider editor={editor}>
        <PresentationEditor surface="konva" />
      </EditorProvider>,
    );
    const canvas = await waitForKonvaCanvas(container);
    const { default: Konva } = await import('konva/lib/Core.js');
    const stage = getStageForContainer(Konva, container);
    selectObject(container, 'r1');
    await waitFor(() => expect(stage.findOne('Transformer').nodes().length).toBe(1));
    const tr = stage.findOne('Transformer');
    const node = stage.findOne('.r1');

    // 1. Handle press+release (no movement) on 33.3333deg object dispatches 0 commands
    await dragAnchor(canvas, tr, 'bottom-right', 0, 0);
    expect(dispatchCount).toBe(0);
    expect(editor.getSnapshot().document.slides[0].objects[0].geometry.rotation).toBe(33.3333);

    // 2. Resize on 33.3333deg object preserves exact 33.3333 rotation
    await dragAnchor(canvas, tr, 'bottom-right', 30, 15);
    await waitFor(() => expect(editor.getSnapshot().revision).toBe(1));
    expect(editor.getSnapshot().document.slides[0].objects[0].geometry.rotation).toBe(33.3333);

    // 3. Delete / Backspace ignored during active transform
    let pos;
    await waitFor(() => {
      pos = tr.findOne('.bottom-right').getAbsolutePosition();
      if (stage.getIntersection(pos) !== tr.findOne('.bottom-right')) throw new Error('hit not ready');
    });
    const rect = canvas.getBoundingClientRect();
    act(() => {
      canvas.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, buttons: 1, clientX: rect.left + pos.x, clientY: rect.top + pos.y }));
      window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, buttons: 1, clientX: rect.left + pos.x + 20, clientY: rect.top + pos.y + 10 }));
    });
    expect(tr.isTransforming()).toBe(true);
    const editorRoot = container.querySelector('section');
    act(() => {
      editorRoot.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }));
      editorRoot.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }));
    });
    expect(editor.getSnapshot().document.slides[0].objects).toHaveLength(1);
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0, buttons: 0, clientX: rect.left + pos.x + 20, clientY: rect.top + pos.y + 10 }));
    });
    expect(tr.isTransforming()).toBe(false);

    // 4. Concurrent drag + transform: real anchor mousedown while dragging runs re-entrant stopTransform and must NOT discard the drag
    const nodePos = node.getAbsolutePosition();
    const startX = editor.getSnapshot().document.slides[0].objects[0].geometry.x;
    const revBeforeDrag = editor.getSnapshot().revision;
    act(() => {
      canvas.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, buttons: 1, clientX: rect.left + nodePos.x, clientY: rect.top + nodePos.y }));
      window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, buttons: 1, clientX: rect.left + nodePos.x + 40, clientY: rect.top + nodePos.y }));
    });
    expect(node.isDragging()).toBe(true);
    const anchor = tr.findOne('.bottom-right');
    act(() => {
      anchor.fire('mousedown', {
        evt: new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, buttons: 1, clientX: rect.left + anchor.getAbsolutePosition().x, clientY: rect.top + anchor.getAbsolutePosition().y }),
      });
    });
    expect(tr.isTransforming()).toBe(false);
    act(() => {
      window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0, buttons: 0, clientX: rect.left + nodePos.x + 40, clientY: rect.top + nodePos.y }));
    });
    await waitFor(() => expect(editor.getSnapshot().revision).toBe(revBeforeDrag + 1));
    expect(editor.getSnapshot().document.slides[0].objects[0].geometry.x).toBeGreaterThan(startX);
    expect(screen.queryAllByRole('alert')).toEqual([]);
  });
});
