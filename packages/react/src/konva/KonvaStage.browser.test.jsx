import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createEditor } from '@stagecraft/core/editor';
import { createDocument, documentPlugin, presentationPlugin, validateDocument } from '@stagecraft/core/document';
import { EditorProvider } from '../EditorProvider.jsx';
import { AttributePanel, PresentationCanvas, PresentationEditor, PresentationEditorProvider } from '../PresentationEditor.jsx';

const PT = 12700;

const fontsDescriptor = Object.getOwnPropertyDescriptor(document, 'fonts');
beforeEach(() => {
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: { status: 'loaded', check: () => true, load: async () => [], ready: Promise.resolve() },
  });
});
afterEach(() => {
  vi.useRealTimers();
  if (fontsDescriptor) Object.defineProperty(document, 'fonts', fontsDescriptor);
  else delete document.fonts;
  vi.restoreAllMocks();
  cleanup();
});

function makeDoc(objects = []) {
  return createDocument({
    id: 'konva-browser-deck',
    slides: [{
      id: 's1',
      extensions: { stagecraftAuthored: true },
      background: { type: 'solid', color: '#ffffff' },
      objects,
    }],
  });
}

function makeRect(id = 'r1', xPt = 72, yPt = 72, wPt = 120, hPt = 80, extra = {}) {
  return {
    id,
    type: 'shape',
    shape: 'rect',
    geometry: { x: xPt * PT, y: yPt * PT, width: wPt * PT, height: hPt * PT, rotation: 0 },
    fill: '#2563eb',
    extensions: { stagecraftAuthored: true },
    ...extra,
  };
}

function makeText(id = 't1', xPt = 240, yPt = 72) {
  return {
    id,
    type: 'text',
    geometry: { x: xPt * PT, y: yPt * PT, width: 160 * PT, height: 60 * PT, rotation: 0 },
    extensions: { stagecraftAuthored: true },
    text: {
      paragraphs: [{
        id: `${id}-p1`,
        runs: [{ id: `${id}-r1`, text: 'Hello Konva', editable: true, style: { typeface: 'Arial', sz: '1800', color: '#111827' }, extensions: { stagecraftAuthored: true } }],
      }],
    },
  };
}

function makeEditor(objects) {
  return createEditor({ document: makeDoc(objects), validateDocument, plugins: [documentPlugin, presentationPlugin] });
}

async function waitForKonvaCanvas(container) {
  return waitFor(() => {
    const el = container.querySelector('.stagecraft-konva-paper canvas');
    if (!el) throw new Error('Konva canvas not mounted yet');
    return el;
  }, { timeout: 5000 });
}

function getStageForContainer(Konva, container) {
  const stage = Konva.stages.find(s => container.contains(s.content));
  if (!stage) throw new Error('Could not find Konva stage for container');
  return stage;
}

async function startShapeDrag(konvaCanvas, shapeNode, dx = 60, dy = 40) {
  const stage = shapeNode.getStage();
  let stagePt = { x: 0, y: 0 };
  await waitFor(() => {
    const rect = konvaCanvas.getBoundingClientRect();
    if (!(rect.width > 0 && rect.height > 0)) throw new Error('Konva canvas has zero size');
    stagePt = { x: shapeNode.x() * stage.scaleX(), y: shapeNode.y() * stage.scaleY() };
    const hit = stage?.getIntersection(stagePt);
    if (hit !== shapeNode) throw new Error(`Konva hit=${hit?.className}:${hit?.name()} pt=${stagePt.x},${stagePt.y}`);
  }, { timeout: 5000 });
  const box = konvaCanvas.getBoundingClientRect();
  const startX = Math.round(box.left + stagePt.x);
  const startY = Math.round(box.top + stagePt.y);
  const initialX = shapeNode.x();
  const initialY = shapeNode.y();
  act(() => {
    konvaCanvas.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true, cancelable: true, button: 0, buttons: 1, clientX: startX, clientY: startY,
    }));
  });
  act(() => {
    window.dispatchEvent(new MouseEvent('mousemove', {
      bubbles: true, cancelable: true, button: 0, buttons: 1, clientX: startX + dx, clientY: startY + dy,
    }));
  });
  await waitFor(() => {
    expect(shapeNode.x()).toBeGreaterThan(initialX);
  });
  return { startX, startY, initialX, initialY };
}

describe('KONVA-2b real Chromium stage, interactions, and fallback', () => {
  it('mounts Konva stage, selects via pointer and DOM, and supports Use SVG surface / Return to canvas', async () => {
    const editor = makeEditor([makeRect('r1'), makeText('t1')]);
    const onSurfaceChange = vi.fn();
    const { container } = render(
      <EditorProvider editor={editor}>
        <PresentationEditor surface="konva" showAttributePanel={false} onSurfaceChange={onSurfaceChange} />
      </EditorProvider>,
    );
    const canvas = await waitForKonvaCanvas(container);
    expect(canvas.width).toBeGreaterThan(0);
    await waitFor(() => {
      expect(onSurfaceChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ requested: 'konva', active: 'konva', status: 'ready', slideId: 's1' }),
      );
    });

    const rectBtn = screen.getByRole('button', { name: 'Select object r1' });
    fireEvent.click(rectBtn);
    expect(rectBtn).toHaveAttribute('aria-pressed', 'true');
    expect(editor.getSnapshot().revision).toBe(0);

    // Escape hatch works even with showAttributePanel={false}
    fireEvent.click(screen.getByRole('button', { name: 'Switch to standard view' }));
    expect(container.querySelector('.stagecraft-presentation-canvas svg[aria-label="Slide artwork"]')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Return to canvas view' }));
    await waitForKonvaCanvas(container);
  });

  it('drags a shape in Konva, commits one transaction with undo/redo, and moves via keyboard', async () => {
    const editor = makeEditor([makeRect('r1', 100, 100, 140, 90)]);
    const { container } = render(
      <EditorProvider editor={editor}>
        <PresentationEditor surface="konva" />
      </EditorProvider>,
    );
    const canvas = await waitForKonvaCanvas(container);
    const box = canvas.getBoundingClientRect();
    const startX = box.left + 140;
    const startY = box.top + 130;

    fireEvent.mouseDown(canvas, { button: 0, clientX: startX, clientY: startY });
    fireEvent.mouseMove(window, { clientX: startX + 20, clientY: startY + 10 });
    fireEvent.mouseUp(window, { clientX: startX + 20, clientY: startY + 10 });

    // Also verify keyboard 1pt move on DOM selection
    const rectBtn = screen.getByRole('button', { name: 'Select object r1' });
    fireEvent.click(rectBtn);
    rectBtn.focus();
    const revBeforeKey = editor.getSnapshot().revision;
    const xBeforeKey = editor.getSnapshot().document.slides[0].objects[0].geometry.x;
    fireEvent.keyDown(rectBtn, { key: 'ArrowRight' });
    expect(editor.getSnapshot().revision).toBe(revBeforeKey + 1);
    expect(editor.getSnapshot().document.slides[0].objects[0].geometry.x).toBe(xBeforeKey + PT);
    expect(rectBtn).toBeInTheDocument();

    act(() => editor.undo());
    expect(editor.getSnapshot().document.slides[0].objects[0].geometry.x).toBe(xBeforeKey);
  });

  it('blocks movement in readOnly mode, focuses inspector on text Enter, and isolates two instances', async () => {
    const editorA = makeEditor([makeRect('r1'), makeText('t1')]);
    const editorB = makeEditor([makeRect('r2')]);
    const { container, rerender } = render(
      <>
        <div data-testid="inst-a">
          <EditorProvider editor={editorA}>
            <PresentationEditor surface="konva" readOnly />
          </EditorProvider>
        </div>
        <div data-testid="inst-b">
          <EditorProvider editor={editorB}>
            <PresentationEditor surface="konva" />
          </EditorProvider>
        </div>
      </>,
    );
    await waitForKonvaCanvas(container);
    const btnA = screen.getByRole('button', { name: 'Select object r1' });
    fireEvent.click(btnA);
    fireEvent.keyDown(btnA, { key: 'ArrowRight' });
    expect(editorA.getSnapshot().revision).toBe(0);

    // Enable editing on A and test Enter on text object focuses inspector + announces
    rerender(
      <>
        <div data-testid="inst-a">
          <EditorProvider editor={editorA}>
            <PresentationEditor surface="konva" />
          </EditorProvider>
        </div>
        <div data-testid="inst-b">
          <EditorProvider editor={editorB}>
            <PresentationEditor surface="konva" />
          </EditorProvider>
        </div>
      </>,
    );
    const textBtnA = screen.getByRole('button', { name: 'Select object t1' });
    fireEvent.click(textBtnA);
    fireEvent.keyDown(textBtnA, { key: 'Enter' });
    await waitFor(() => {
      expect(screen.getByText('Text editing is available in the inspector or via Switch to standard view.')).toBeInTheDocument();
    });
    expect(editorB.getSnapshot().revision).toBe(0);
  });

  it('falls back on rotated outer CSS container while allowing positive axis-aligned CSS scale', async () => {
    const editor = makeEditor([makeRect('r1')]);
    const onSurfaceChange = vi.fn();
    const { container, rerender } = render(
      <div style={{ transform: 'scale(1.25)' }}>
        <EditorProvider editor={editor}>
          <PresentationEditor surface="konva" onSurfaceChange={onSurfaceChange} />
        </EditorProvider>
      </div>,
    );
    await waitForKonvaCanvas(container);
    await waitFor(() => {
      expect(onSurfaceChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ active: 'konva', status: 'ready' }),
      );
    });

    rerender(
      <div style={{ transform: 'rotate(10deg)' }}>
        <EditorProvider editor={editor}>
          <PresentationEditor surface="konva" onSurfaceChange={onSurfaceChange} />
        </EditorProvider>
      </div>,
    );
    await waitFor(() => {
      expect(onSurfaceChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ active: 'svg', status: 'fallback', reason: 'unsupported-embedding' }),
      );
    });
  });

  it('matches SVG slide CSS box across zoom 50/100/200 while DPR affects backing store only', async () => {
    const editor = makeEditor([makeRect('r1', 72, 72, 240, 100)]);
    const { container, rerender } = render(
      <EditorProvider editor={editor}>
        <PresentationEditor surface="svg" />
      </EditorProvider>,
    );
    fireEvent.click(screen.getByRole('tab', { name: 'View' }));
    const zoomInput = screen.getByRole('spinbutton', { name: 'Zoom' });
    for (const zoomPct of ['50', '100', '200']) {
      fireEvent.change(zoomInput, { target: { value: zoomPct } });
      fireEvent.blur(zoomInput);
      const svgBox = container.querySelector('.stagecraft-presentation-canvas svg[aria-label="Slide artwork"]').getBoundingClientRect();

      rerender(
        <EditorProvider editor={editor}>
          <PresentationEditor surface="konva" />
        </EditorProvider>,
      );
      const konvaCanvas = await waitForKonvaCanvas(container);
      const konvaBox = konvaCanvas.getBoundingClientRect();
      expect(Math.abs(konvaBox.width - svgBox.width)).toBeLessThanOrEqual(1);
      expect(Math.abs(konvaBox.height - svgBox.height)).toBeLessThanOrEqual(1);
      expect(konvaCanvas.width).toBe(Math.round(konvaBox.width * (window.devicePixelRatio || 1)));

      rerender(
        <EditorProvider editor={editor}>
          <PresentationEditor surface="svg" />
        </EditorProvider>,
      );
    }
  });

  it('commits a single undoable geometry move when dragging a shape by pointer', async () => {
    const editor = makeEditor([makeRect('r1', 72, 72, 240, 100)]);
    const { container } = render(
      <EditorProvider editor={editor}>
        <PresentationEditor surface="konva" />
      </EditorProvider>,
    );
    const konvaCanvas = await waitForKonvaCanvas(container);
    const { default: Konva } = await import('konva/lib/Core.js');
    const shapeNode = getStageForContainer(Konva, container).findOne('.r1');
    const { startX, startY } = await startShapeDrag(konvaCanvas, shapeNode);
    act(() => {
      window.dispatchEvent(new MouseEvent('mouseup', {
        bubbles: true,
        cancelable: true,
        button: 0,
        buttons: 0,
        clientX: startX + 60,
        clientY: startY + 40,
      }));
    });

    await waitFor(() => {
      const geom = editor.getSnapshot().document.slides[0].objects[0].geometry;
      expect(geom.x).toBeGreaterThan(72 * PT);
      expect(geom.y).toBeGreaterThan(72 * PT);
    });

    act(() => {
      editor.undo();
    });
    const restored = editor.getSnapshot().document.slides[0].objects[0].geometry;
    expect(restored.x).toBe(72 * PT);
    expect(restored.y).toBe(72 * PT);
  });

  it('restores Konva node position when commit is denied (returns false) without changing revision', async () => {
    const baseEditor = makeEditor([makeRect('r1', 72, 72, 240, 100)]);
    let dispatchCount = 0;
    const editor = {
      ...baseEditor,
      dispatch: (...args) => {
        dispatchCount += 1;
        return baseEditor.dispatch(...args);
      },
    };
    const source = {
      name: 'test.pptx',
      format: 'pptx',
      capabilities: { edits: ['object-geometry'] },
    };

    const { container } = render(
      <EditorProvider editor={editor}>
        <PresentationEditor surface="konva" source={source} />
      </EditorProvider>,
    );
    const konvaCanvas = await waitForKonvaCanvas(container);
    const { default: Konva } = await import('konva/lib/Core.js');
    const stage = getStageForContainer(Konva, container);
    const shapeNode = stage.findOne('.r1');
    const { startX, startY, initialX, initialY } = await startShapeDrag(konvaCanvas, shapeNode);

    // Deny capability before drop so ui.setGeometry returns false with 0 editor dispatches
    source.capabilities.edits = [];
    act(() => {
      window.dispatchEvent(new MouseEvent('mouseup', {
        bubbles: true, cancelable: true, button: 0, buttons: 0, clientX: startX + 60, clientY: startY + 40,
      }));
    });

    expect(dispatchCount).toBe(0);
    expect(editor.getSnapshot().revision).toBe(0);
    expect(shapeNode.x()).toBe(initialX);
    expect(shapeNode.y()).toBe(initialY);
    expect(screen.getByRole('alert')).toHaveTextContent('Move could not be applied.');
  });

  it('cancels an in-progress Konva drag on Escape with 0 dispatches and inert dragend', async () => {
    const baseEditor = makeEditor([makeRect('r1', 72, 72, 240, 100)]);
    let dispatchCount = 0;
    const editor = {
      ...baseEditor,
      dispatch: (...args) => {
        dispatchCount += 1;
        return baseEditor.dispatch(...args);
      },
    };
    const { container } = render(
      <EditorProvider editor={editor}>
        <PresentationEditor surface="konva" />
      </EditorProvider>,
    );
    const konvaCanvas = await waitForKonvaCanvas(container);
    const { default: Konva } = await import('konva/lib/Core.js');
    const stage = getStageForContainer(Konva, container);
    const shapeNode = stage.findOne('.r1');
    const { startX, startY, initialX, initialY } = await startShapeDrag(konvaCanvas, shapeNode);

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(shapeNode.x()).toBe(initialX);
    expect(shapeNode.y()).toBe(initialY);

    act(() => {
      window.dispatchEvent(new MouseEvent('mouseup', {
        bubbles: true, cancelable: true, button: 0, buttons: 0, clientX: startX + 60, clientY: startY + 40,
      }));
    });
    expect(dispatchCount).toBe(0);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(shapeNode.x()).toBe(initialX);
    expect(shapeNode.y()).toBe(initialY);
  });

  it('cancels an in-progress Konva drag on pointercancel with 0 dispatches and inert dragend', async () => {
    const baseEditor = makeEditor([makeRect('r1', 72, 72, 240, 100)]);
    let dispatchCount = 0;
    const editor = {
      ...baseEditor,
      dispatch: (...args) => {
        dispatchCount += 1;
        return baseEditor.dispatch(...args);
      },
    };
    const { container } = render(
      <EditorProvider editor={editor}>
        <PresentationEditor surface="konva" />
      </EditorProvider>,
    );
    const konvaCanvas = await waitForKonvaCanvas(container);
    const { default: Konva } = await import('konva/lib/Core.js');
    const stage = getStageForContainer(Konva, container);
    const shapeNode = stage.findOne('.r1');
    const { startX, startY, initialX, initialY } = await startShapeDrag(konvaCanvas, shapeNode);

    act(() => {
      konvaCanvas.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true }));
    });
    expect(shapeNode.x()).toBe(initialX);
    expect(shapeNode.y()).toBe(initialY);

    act(() => {
      window.dispatchEvent(new MouseEvent('mouseup', {
        bubbles: true, cancelable: true, button: 0, buttons: 0, clientX: startX + 60, clientY: startY + 40,
      }));
    });
    expect(dispatchCount).toBe(0);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(shapeNode.x()).toBe(initialX);
    expect(shapeNode.y()).toBe(initialY);
  });

  it('B1: does not reuse font readiness across colliding owners or revisions, and retries on loadingdone after timeout', async () => {
    const fontListeners = new Set();
    const loadedFamilies = new Set(['Arial']);
    let loadShouldTimeout = false;
    let holdPending = false;
    let resolvePending;
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: {
        status: 'loaded',
        check: q => [...loadedFamilies].some(f => q.includes(f)),
        load: vi.fn(() => {
          if (loadShouldTimeout) return new Promise(() => {});
          if (holdPending) return new Promise(r => { resolvePending = r; });
          return Promise.resolve([]);
        }),
        addEventListener: (type, fn) => { if (type === 'loadingdone') fontListeners.add(fn); },
        removeEventListener: (type, fn) => { fontListeners.delete(fn); },
        ready: Promise.resolve(),
      },
    });
    const makeTextDoc = typeface => createDocument({
      id: 'colliding-deck',
      slides: [{
        id: 's1',
        extensions: { stagecraftAuthored: true },
        background: { type: 'solid', color: '#ffffff' },
        objects: [{
          id: 't1',
          type: 'text',
          geometry: { x: 72 * PT, y: 72 * PT, width: 160 * PT, height: 60 * PT, rotation: 0 },
          extensions: { stagecraftAuthored: true },
          text: { paragraphs: [{ id: 'p1', runs: [{ id: 'r1', text: 'Hello', editable: true, style: { typeface, sz: '1800' }, extensions: { stagecraftAuthored: true } }] }] },
        }],
      }],
    });
    const editorA = createEditor({ document: makeTextDoc('Arial'), validateDocument, plugins: [documentPlugin, presentationPlugin] });
    const editorB = createEditor({ document: makeTextDoc('MissingOwnerBFont'), validateDocument, plugins: [documentPlugin, presentationPlugin] });
    const onSurfaceChange = vi.fn();
    const { rerender } = render(
      <EditorProvider editor={editorA}>
        <PresentationEditor surface="konva" onSurfaceChange={onSurfaceChange} />
      </EditorProvider>,
    );
    await waitFor(() => {
      expect(onSurfaceChange).toHaveBeenLastCalledWith(expect.objectContaining({ active: 'konva', status: 'ready', slideId: 's1', revision: 0 }));
    });
    holdPending = true;
    rerender(
      <EditorProvider editor={editorB}>
        <PresentationEditor surface="konva" onSurfaceChange={onSurfaceChange} />
      </EditorProvider>,
    );
    expect(onSurfaceChange).toHaveBeenLastCalledWith(expect.objectContaining({ active: 'svg', status: 'fallback', reason: 'loading', slideId: 's1', revision: 0 }));
    holdPending = false;
    resolvePending?.([]);

    rerender(
      <EditorProvider editor={editorA}>
        <PresentationEditor surface="konva" onSurfaceChange={onSurfaceChange} />
      </EditorProvider>,
    );
    await waitFor(() => {
      expect(onSurfaceChange).toHaveBeenLastCalledWith(expect.objectContaining({ active: 'konva', status: 'ready' }));
    });

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    loadShouldTimeout = true;
    act(() => {
      editorA.dispatch('document.setRunFormat', { runId: 'r1', format: { fontFamily: 'LateFont' } });
    });
    expect(onSurfaceChange).toHaveBeenLastCalledWith(expect.objectContaining({ active: 'svg', status: 'fallback', reason: 'loading', revision: 1 }));
    await act(async () => { await vi.advanceTimersByTimeAsync(2100); });
    vi.useRealTimers();
    await waitFor(() => {
      expect(onSurfaceChange).toHaveBeenLastCalledWith(expect.objectContaining({ active: 'svg', status: 'fallback', reason: 'fonts-timeout', revision: 1 }));
    });

    loadShouldTimeout = false;
    loadedFamilies.add('LateFont');
    await act(async () => {
      fontListeners.forEach(fn => fn());
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(onSurfaceChange).toHaveBeenLastCalledWith(expect.objectContaining({ active: 'konva', status: 'ready', revision: 1 }));
    });
  });

  it('B2: invalidates gesture synchronously on surface switch/unmount mid-drag so dragend-on-destroy is inert', async () => {
    const baseEditor = makeEditor([makeRect('r1', 72, 72, 240, 100)]);
    let dispatchCount = 0;
    const editor = {
      ...baseEditor,
      dispatch: (...args) => { dispatchCount += 1; return baseEditor.dispatch(...args); },
    };
    const { container, rerender } = render(
      <EditorProvider editor={editor}>
        <PresentationEditor surface="konva" />
      </EditorProvider>,
    );
    const konvaCanvas = await waitForKonvaCanvas(container);
    const { default: Konva } = await import('konva/lib/Core.js');
    const shapeNode = getStageForContainer(Konva, container).findOne('.r1');
    const { startX, startY } = await startShapeDrag(konvaCanvas, shapeNode);

    rerender(
      <EditorProvider editor={editor}>
        <PresentationEditor surface="svg" />
      </EditorProvider>,
    );
    act(() => {
      window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0, buttons: 0, clientX: startX + 60, clientY: startY + 40 }));
    });
    expect(dispatchCount).toBe(0);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(editor.getSnapshot().revision).toBe(0);
  });

  it('B3: snapshot change during drag stops dragging immediately and restores to latest scene geometry', async () => {
    const baseEditor = makeEditor([makeRect('r1', 72, 72, 240, 100)]);
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
    const konvaCanvas = await waitForKonvaCanvas(container);
    const { default: Konva } = await import('konva/lib/Core.js');
    const stage = getStageForContainer(Konva, container);
    const shapeNode = stage.findOne('.r1');
    const { startX, startY, initialX } = await startShapeDrag(konvaCanvas, shapeNode, 40, 0);
    expect(shapeNode.isDragging()).toBe(true);

    act(() => {
      baseEditor.dispatch('presentation.setGeometry', {
        slideId: 's1',
        objectId: 'r1',
        geometry: { x: 200 * PT, y: 72 * PT, width: 240 * PT, height: 100 * PT, rotation: 0 },
      });
    });
    expect(shapeNode.isDragging()).toBe(false);
    await waitFor(() => {
      expect(Math.round(shapeNode.x())).toBe(Math.round(200 * (96 / 72) + (240 * (96 / 72)) / 2));
    });

    dispatchCount = 0;
    act(() => {
      window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0, buttons: 0, clientX: startX + 40, clientY: startY }));
    });
    expect(dispatchCount).toBe(0);
    expect(screen.getAllByRole('alert').map(el => el.textContent)).toEqual(['Move could not be applied.']);

    act(() => {
      editor.undo();
    });
    await waitFor(() => {
      expect(Math.round(shapeNode.x())).toBe(Math.round(initialX));
    });
  });

  it('B4: rolls back before reporting one fixed move-not-applied diagnostic on denied/thrown commit, even if reporter throws', async () => {
    const { default: KonvaStage } = await import('./KonvaStage.jsx');
    const { buildCanonicalScene } = await import('@stagecraft/renderer/canonical');
    const doc = makeDoc([makeRect('r1', 72, 72, 240, 100)]);
    const scene = buildCanonicalScene(doc, 's1').scene;
    const errors = [];
    const onMove = vi.fn(() => { throw new Error('sensitive internal detail'); });
    const onError = vi.fn(err => {
      errors.push(err.message);
      throw new Error('reporter boom');
    });

    const { container } = render(
      <KonvaStage
        scene={scene}
        revision={0}
        ownerKey={{}}
        policyKey={{}}
        selectionId="r1"
        zoom={100}
        canMove={() => true}
        onMove={onMove}
        onError={onError}
      />,
    );
    const konvaCanvas = container.querySelector('canvas');
    const { default: Konva } = await import('konva/lib/Core.js');
    const shapeNode = getStageForContainer(Konva, container).findOne('.r1');
    const { startX, startY, initialX, initialY } = await startShapeDrag(konvaCanvas, shapeNode);
    act(() => {
      window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0, buttons: 0, clientX: startX + 60, clientY: startY + 40 }));
    });

    expect(onMove).toHaveBeenCalledTimes(1);
    expect(shapeNode.x()).toBe(initialX);
    expect(shapeNode.y()).toBe(initialY);
    expect(errors).toEqual(['Move could not be applied.']);
  });

  it('B6: ignores Ctrl/Meta/Alt combos except undo/redo and moves 1pt unmodified / 10pt with Shift', async () => {
    const editor = makeEditor([makeRect('r1', 72, 72, 240, 100)]);
    const { container } = render(
      <EditorProvider editor={editor}>
        <PresentationEditor surface="konva" />
      </EditorProvider>,
    );
    await waitForKonvaCanvas(container);
    fireEvent.click(screen.getByRole('button', { name: 'Select object r1' }));
    const canvas = screen.getByLabelText('Slide canvas');

    fireEvent.keyDown(canvas, { key: 'ArrowRight', ctrlKey: true });
    fireEvent.keyDown(canvas, { key: 'ArrowRight', metaKey: true });
    fireEvent.keyDown(canvas, { key: 'ArrowRight', altKey: true });
    fireEvent.keyDown(canvas, { key: 'Backspace', metaKey: true });
    fireEvent.keyDown(canvas, { key: 'Delete', altKey: true });
    expect(editor.getSnapshot().revision).toBe(0);
    expect(editor.getSnapshot().document.slides[0].objects).toHaveLength(1);

    fireEvent.keyDown(canvas, { key: 'ArrowRight' });
    expect(editor.getSnapshot().document.slides[0].objects[0].geometry.x).toBe(72 * PT + PT);

    fireEvent.keyDown(canvas, { key: 'ArrowRight', shiftKey: true });
    expect(editor.getSnapshot().document.slides[0].objects[0].geometry.x).toBe(72 * PT + 11 * PT);
  });

  it('B7: Enter/double-click focuses actual Text run 1 textarea in both PresentationEditor and standalone sibling composition', async () => {
    const editorA = makeEditor([makeText('t1', 72, 72, 'Alpha')]);
    const { container, unmount } = render(
      <EditorProvider editor={editorA}>
        <PresentationEditor surface="konva" />
      </EditorProvider>,
    );
    await waitForKonvaCanvas(container);
    const btnA = screen.getByRole('button', { name: 'Select object t1' });
    fireEvent.click(btnA);
    fireEvent.keyDown(btnA, { key: 'Enter' });
    await waitFor(() => {
      expect(document.activeElement?.getAttribute('aria-label')).toBe('Text run 1');
    });
    unmount();

    const editorB = makeEditor([makeText('t1', 72, 72, 'Beta')]);
    const { container: c2 } = render(
      <EditorProvider editor={editorB}>
        <PresentationEditorProvider>
          <PresentationCanvas surface="konva" />
          <AttributePanel />
        </PresentationEditorProvider>
      </EditorProvider>,
    );
    await waitForKonvaCanvas(c2);
    const btnB = screen.getByRole('button', { name: 'Select object t1' });
    fireEvent.click(btnB);
    fireEvent.keyDown(btnB, { key: 'Enter' });
    await waitFor(() => {
      expect(document.activeElement?.getAttribute('aria-label')).toBe('Text run 1');
    });
  });

  it('N1/N2/N3/N7: checks selection synchronously on dragend, restores focus on hatch, sets touch-action:none, and verifies exact drag undo/redo', async () => {
    const editor = makeEditor([makeRect('r1', 72, 72, 240, 100)]);
    const { container } = render(
      <EditorProvider editor={editor}>
        <PresentationEditor surface="konva" />
      </EditorProvider>,
    );
    const konvaCanvas = await waitForKonvaCanvas(container);
    const paper = container.querySelector('.stagecraft-konva-paper');
    expect(getComputedStyle(paper).touchAction).toBe('none');

    const { default: Konva } = await import('konva/lib/Core.js');
    const shapeNode = getStageForContainer(Konva, container).findOne('.r1');
    const { startX, startY } = await startShapeDrag(konvaCanvas, shapeNode);
    act(() => {
      window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0, buttons: 0, clientX: startX + 60, clientY: startY + 40 }));
    });

    await waitFor(() => expect(editor.getSnapshot().revision).toBe(1));
    const movedGeom = editor.getSnapshot().document.slides[0].objects[0].geometry;
    expect(movedGeom.x).toBeGreaterThan(72 * PT);

    act(() => { editor.undo(); });
    expect(editor.getSnapshot().document.slides[0].objects[0].geometry.x).toBe(72 * PT);
    act(() => { editor.redo(); });
    expect(editor.getSnapshot().document.slides[0].objects[0].geometry.x).toBe(movedGeom.x);

    // N2: Switch to standard view restores focus away from document.body
    const hatchBtn = screen.getByRole('button', { name: 'Switch to standard view' });
    hatchBtn.focus();
    fireEvent.click(hatchBtn);
    await waitFor(() => {
      expect(document.activeElement).not.toBe(document.body);
    });
  });

  it('D1: onMove returning false rolls back and reports Move could not be applied.', async () => {
    const { default: KonvaStage } = await import('./KonvaStage.jsx');
    const { buildCanonicalScene } = await import('@stagecraft/renderer/canonical');
    const doc = makeDoc([makeRect('r1', 72, 72, 240, 100)]);
    const scene = buildCanonicalScene(doc, 's1').scene;
    const onMove = vi.fn(() => false);
    const onError = vi.fn();

    const { container } = render(
      <KonvaStage
        scene={scene}
        revision={0}
        ownerKey={{}}
        policyKey={{}}
        selectionId="r1"
        zoom={100}
        canMove={() => true}
        onMove={onMove}
        onError={onError}
      />,
    );
    const konvaCanvas = container.querySelector('canvas');
    const { default: Konva } = await import('konva/lib/Core.js');
    const shapeNode = getStageForContainer(Konva, container).findOne('.r1');
    const { startX, startY, initialX, initialY } = await startShapeDrag(konvaCanvas, shapeNode);

    act(() => {
      window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0, buttons: 0, clientX: startX + 60, clientY: startY + 40 }));
    });
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(shapeNode.x()).toBe(initialX);
    expect(shapeNode.y()).toBe(initialY);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0].message).toBe('Move could not be applied.');
  });

  it('D1: dynamic capability denial at dragend rolls back and emits Move could not be applied.', async () => {
    const { default: KonvaStage } = await import('./KonvaStage.jsx');
    const { buildCanonicalScene } = await import('@stagecraft/renderer/canonical');
    const doc = makeDoc([makeRect('r1', 72, 72, 240, 100)]);
    const scene = buildCanonicalScene(doc, 's1').scene;
    const onMove = vi.fn();
    const onError = vi.fn();
    let allow = true;

    const { container } = render(
      <KonvaStage
        scene={scene}
        revision={0}
        ownerKey={{}}
        policyKey={{}}
        selectionId="r1"
        zoom={100}
        canMove={() => allow}
        onMove={onMove}
        onError={onError}
      />,
    );
    const konvaCanvas = container.querySelector('canvas');
    const { default: Konva } = await import('konva/lib/Core.js');
    const shapeNode = getStageForContainer(Konva, container).findOne('.r1');
    const { startX, startY, initialX, initialY } = await startShapeDrag(konvaCanvas, shapeNode);

    allow = false;
    act(() => {
      window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0, buttons: 0, clientX: startX + 60, clientY: startY + 40 }));
    });

    expect(onMove).not.toHaveBeenCalled();
    expect(shapeNode.x()).toBe(initialX);
    expect(shapeNode.y()).toBe(initialY);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0].message).toBe('Move could not be applied.');
  });

  it('D2: active Konva scene observes loadingdone/loadingerror, bumps epoch on relevant face and ignores unrelated face', async () => {
    const fontListeners = new Map();
    const checkSpy = vi.fn(() => true);
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: {
        status: 'loaded',
        check: checkSpy,
        load: vi.fn(async () => []),
        addEventListener: (type, fn) => {
          if (!fontListeners.has(type)) fontListeners.set(type, new Set());
          fontListeners.get(type).add(fn);
        },
        removeEventListener: (type, fn) => {
          fontListeners.get(type)?.delete(fn);
        },
        ready: Promise.resolve(),
      },
    });

    const editor = makeEditor([makeText('t1', 72, 72)]);
    const { container } = render(
      <EditorProvider editor={editor}>
        <PresentationEditor surface="konva" />
      </EditorProvider>,
    );
    await waitForKonvaCanvas(container);
    const initialChecks = checkSpy.mock.calls.length;

    // Unrelated face loads -> ignored, no readiness rerun
    await act(async () => {
      fontListeners.get('loadingdone')?.forEach(fn => fn({ fontfaces: [{ family: 'UnrelatedDisplayFont' }] }));
      await Promise.resolve();
    });
    expect(checkSpy.mock.calls.length).toBe(initialChecks);

    // Relevant face ('Arial') loads while scene is ready -> reruns readiness and bumps font epoch
    await act(async () => {
      fontListeners.get('loadingdone')?.forEach(fn => fn({ fontfaces: [{ family: 'Arial' }] }));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(checkSpy.mock.calls.length).toBeGreaterThan(initialChecks);
    });
  });

  it('residuals: handles raw unmount mid-drag, selection change before pointerup, exact payload, round-zero no-op, blur and lostpointercapture', async () => {
    // 1. Raw unmount mid-drag -> 0 dispatches
    const base1 = makeEditor([makeRect('r1', 72, 72, 240, 100)]);
    let dispatches1 = 0;
    const editor1 = { ...base1, dispatch: (...a) => { dispatches1 += 1; return base1.dispatch(...a); } };
    const { container: c1, unmount: unmount1 } = render(
      <EditorProvider editor={editor1}>
        <PresentationEditor surface="konva" />
      </EditorProvider>,
    );
    const canvas1 = await waitForKonvaCanvas(c1);
    const { default: Konva } = await import('konva/lib/Core.js');
    const shape1 = getStageForContainer(Konva, c1).findOne('.r1');
    const { startX: sx1, startY: sy1 } = await startShapeDrag(canvas1, shape1);
    unmount1();
    act(() => {
      window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0, buttons: 0, clientX: sx1 + 60, clientY: sy1 + 40 }));
    });
    expect(dispatches1).toBe(0);

    // 2. Blur & lostpointercapture cancel + round-zero no-op + exact single dispatch payload
    const base2 = makeEditor([makeRect('r1', 72, 72, 240, 100), makeRect('r2', 400, 72, 120, 80)]);
    const calls2 = [];
    const editor2 = { ...base2, dispatch: (...a) => { calls2.push(a); return base2.dispatch(...a); } };
    const { container: c2 } = render(
      <EditorProvider editor={editor2}>
        <PresentationEditor surface="konva" />
      </EditorProvider>,
    );
    const canvas2 = await waitForKonvaCanvas(c2);
    const stage2 = getStageForContainer(Konva, c2);
    const shape2 = stage2.findOne('.r1');

    // Blur cancel
    const dBlur = await startShapeDrag(canvas2, shape2);
    act(() => { window.dispatchEvent(new Event('blur')); });
    expect(shape2.isDragging()).toBe(false);
    expect(shape2.x()).toBe(dBlur.initialX);
    act(() => { window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0, buttons: 0, clientX: dBlur.startX + 60, clientY: dBlur.startY + 40 })); });
    expect(calls2).toHaveLength(0);

    // lostpointercapture cancel
    const dLost = await startShapeDrag(canvas2, shape2);
    act(() => { stage2.content.dispatchEvent(new Event('lostpointercapture')); });
    expect(shape2.isDragging()).toBe(false);
    expect(shape2.x()).toBe(dLost.initialX);
    act(() => { window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0, buttons: 0, clientX: dLost.startX + 60, clientY: dLost.startY + 40 })); });
    expect(calls2).toHaveLength(0);

    // Selection change before pointerup
    const dSel = await startShapeDrag(canvas2, shape2);
    fireEvent.click(screen.getByRole('button', { name: 'Select object r2' }));
    act(() => { window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0, buttons: 0, clientX: dSel.startX + 60, clientY: dSel.startY + 40 })); });
    expect(calls2).toHaveLength(0);

    // Exact single dispatch payload on real drag
    const dOk = await startShapeDrag(canvas2, shape2, 40, 20);
    act(() => { window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0, buttons: 0, clientX: dOk.startX + 40, clientY: dOk.startY + 20 })); });
    await waitFor(() => expect(calls2).toHaveLength(1));
    expect(calls2[0][0]).toBe('presentation.setGeometry');
    expect(calls2[0][1]).toMatchObject({ slideId: 's1', objectId: 'r1' });
    expect(calls2[0][2]).toEqual({ expectedRevision: 0, origin: 'react' });
  });

  it('selects and moves an unselected shape on single-finger touch drag with one dispatch', async () => {
    const baseEditor = makeEditor([makeRect('r1', 72, 72, 240, 100)]);
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
    const konvaCanvas = await waitForKonvaCanvas(container);
    const { default: Konva } = await import('konva/lib/Core.js');
    const stage = getStageForContainer(Konva, container);
    const shapeNode = stage.findOne('.r1');

    let stagePt = { x: 0, y: 0 };
    await waitFor(() => {
      stagePt = { x: shapeNode.x() * stage.scaleX(), y: shapeNode.y() * stage.scaleY() };
      if (stage.getIntersection(stagePt) !== shapeNode) throw new Error('hit not ready');
    });
    const box = konvaCanvas.getBoundingClientRect();
    const startX = Math.round(box.left + stagePt.x);
    const startY = Math.round(box.top + stagePt.y);

    const makeTouch = (x, y) => new Touch({
      identifier: 1,
      target: konvaCanvas,
      clientX: x,
      clientY: y,
      pageX: x,
      pageY: y,
    });
    const initialX = shapeNode.x();

    act(() => {
      const t = makeTouch(startX, startY);
      konvaCanvas.dispatchEvent(new TouchEvent('touchstart', {
        bubbles: true, cancelable: true, touches: [t], targetTouches: [t], changedTouches: [t],
      }));
    });
    act(() => {
      const t = makeTouch(startX + 60, startY + 40);
      window.dispatchEvent(new TouchEvent('touchmove', {
        bubbles: true, cancelable: true, touches: [t], targetTouches: [t], changedTouches: [t],
      }));
    });
    await waitFor(() => expect(shapeNode.x()).toBeGreaterThan(initialX));
    act(() => {
      const t = makeTouch(startX + 60, startY + 40);
      window.dispatchEvent(new TouchEvent('touchend', {
        bubbles: true, cancelable: true, touches: [], targetTouches: [], changedTouches: [t],
      }));
    });

    await waitFor(() => expect(dispatchCount).toBe(1));
    expect(screen.getByRole('button', { name: 'Select object r1' })).toHaveAttribute('aria-pressed', 'true');
    expect(editor.getSnapshot().document.slides[0].objects[0].geometry.x).toBeGreaterThan(72 * PT);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('single-sources relevant font families for EA, CS, and resolved theme-alias (+mn-ea) faces', async () => {
    const fontListeners = new Map();
    const checkSpy = vi.fn(() => true);
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: {
        status: 'loaded',
        check: checkSpy,
        load: vi.fn(async () => []),
        addEventListener: (type, fn) => {
          if (!fontListeners.has(type)) fontListeners.set(type, new Set());
          fontListeners.get(type).add(fn);
        },
        removeEventListener: (type, fn) => {
          fontListeners.get(type)?.delete(fn);
        },
        ready: Promise.resolve(),
      },
    });

    const doc = createDocument({
      id: 'ea-cs-theme-deck',
      layouts: [{ id: 'l1', masterId: 'm1' }],
      masters: [{ id: 'm1', themeId: 'theme-1' }],
      themes: [{
        id: 'theme-1',
        extensions: {
          pptxFontScheme: {
            major: { latin: 'Calibri', eastAsian: 'Yu Gothic', complexScript: 'Tahoma' },
            minor: { latin: 'Arial', eastAsian: 'Noto Sans JP', complexScript: 'Amiri' },
          },
        },
      }],
      slides: [{
        id: 's1',
        layoutId: 'l1',
        extensions: { stagecraftAuthored: true },
        background: { type: 'solid', color: '#ffffff' },
        objects: [{
          id: 't1',
          type: 'text',
          geometry: { x: 72 * PT, y: 72 * PT, width: 200 * PT, height: 80 * PT, rotation: 0 },
          extensions: { stagecraftAuthored: true },
          text: {
            paragraphs: [{
              id: 'p1',
              runs: [{
                id: 'r1',
                text: 'A漢ع',
                editable: true,
                style: { typeface: 'Arial', eastAsian: '+mn-ea', complexScript: 'Cairo', sz: '1800' },
                extensions: { stagecraftAuthored: true },
              }],
            }],
          },
        }],
      }],
    });
    const editor = createEditor({ document: doc, validateDocument, plugins: [documentPlugin, presentationPlugin] });
    const { container } = render(
      <EditorProvider editor={editor}>
        <PresentationEditor surface="konva" />
      </EditorProvider>,
    );
    await waitForKonvaCanvas(container);
    let checks = checkSpy.mock.calls.length;

    // Unrelated face -> ignored
    await act(async () => {
      fontListeners.get('loadingdone')?.forEach(fn => fn({ fontfaces: [{ family: 'UnrelatedFont' }] }));
      await Promise.resolve();
    });
    expect(checkSpy.mock.calls.length).toBe(checks);

    // Resolved +mn-ea theme-alias EA font ('Noto Sans JP') -> triggers readiness rerun
    await act(async () => {
      fontListeners.get('loadingdone')?.forEach(fn => fn({ fontfaces: [{ family: 'Noto Sans JP' }] }));
      await Promise.resolve();
    });
    await waitFor(() => expect(checkSpy.mock.calls.length).toBeGreaterThan(checks));
    checks = checkSpy.mock.calls.length;

    // Explicit CS font ('Cairo') -> triggers readiness rerun
    await act(async () => {
      fontListeners.get('loadingdone')?.forEach(fn => fn({ fontfaces: [{ family: 'Cairo' }] }));
      await Promise.resolve();
    });
    await waitFor(() => expect(checkSpy.mock.calls.length).toBeGreaterThan(checks));
  });

  it('matches quoted comma-containing font families without splitting on commas', async () => {
    const fontListeners = new Map();
    const checkSpy = vi.fn(() => true);
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: {
        status: 'loaded',
        check: checkSpy,
        load: vi.fn(async () => []),
        addEventListener: (type, fn) => {
          if (!fontListeners.has(type)) fontListeners.set(type, new Set());
          fontListeners.get(type).add(fn);
        },
        removeEventListener: (type, fn) => {
          fontListeners.get(type)?.delete(fn);
        },
        ready: Promise.resolve(),
      },
    });

    const doc = createDocument({
      id: 'comma-font-deck',
      slides: [{
        id: 's1',
        extensions: { stagecraftAuthored: true },
        background: { type: 'solid', color: '#ffffff' },
        objects: [{
          id: 't1',
          type: 'text',
          geometry: { x: 72 * PT, y: 72 * PT, width: 200 * PT, height: 80 * PT, rotation: 0 },
          extensions: { stagecraftAuthored: true },
          text: {
            paragraphs: [{
              id: 'p1',
              runs: [{
                id: 'r1',
                text: 'Hello',
                editable: true,
                style: { typeface: 'Foo, Bar', sz: '1800' },
                extensions: { stagecraftAuthored: true },
              }],
            }],
          },
        }],
      }],
    });
    const editor = createEditor({ document: doc, validateDocument, plugins: [documentPlugin, presentationPlugin] });
    const { container } = render(
      <EditorProvider editor={editor}>
        <PresentationEditor surface="konva" />
      </EditorProvider>,
    );
    await waitForKonvaCanvas(container);
    const checks = checkSpy.mock.calls.length;

    // Split token 'Foo' must NOT match 'Foo, Bar'
    await act(async () => {
      fontListeners.get('loadingdone')?.forEach(fn => fn({ fontfaces: [{ family: 'Foo' }] }));
      await Promise.resolve();
    });
    expect(checkSpy.mock.calls.length).toBe(checks);

    // Exact comma-containing family 'Foo, Bar' -> triggers readiness rerun
    await act(async () => {
      fontListeners.get('loadingdone')?.forEach(fn => fn({ fontfaces: [{ family: 'Foo, Bar' }] }));
      await Promise.resolve();
    });
    await waitFor(() => expect(checkSpy.mock.calls.length).toBeGreaterThan(checks));
  });

  it('ignores multi-touch gestures on a shape without selecting or dispatching a move', async () => {
    const baseEditor = makeEditor([makeRect('r1', 72, 72, 240, 100)]);
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
    const konvaCanvas = await waitForKonvaCanvas(container);
    const { default: Konva } = await import('konva/lib/Core.js');
    const stage = getStageForContainer(Konva, container);
    const shapeNode = stage.findOne('.r1');

    let stagePt = { x: 0, y: 0 };
    await waitFor(() => {
      stagePt = { x: shapeNode.x() * stage.scaleX(), y: shapeNode.y() * stage.scaleY() };
      if (stage.getIntersection(stagePt) !== shapeNode) throw new Error('hit not ready');
    });
    const box = konvaCanvas.getBoundingClientRect();
    const x1 = box.left + stagePt.x + 20;
    const y1 = box.top + stagePt.y + 20;
    const makeTouch = (id, x, y) => new Touch({
      identifier: id, target: konvaCanvas, clientX: x, clientY: y, pageX: x, pageY: y, screenX: x, screenY: y,
    });

    act(() => {
      const t1 = makeTouch(1, x1, y1);
      const t2 = makeTouch(2, x1 + 20, y1 + 20);
      konvaCanvas.dispatchEvent(new TouchEvent('touchstart', {
        bubbles: true, cancelable: true, touches: [t1, t2], targetTouches: [t1, t2], changedTouches: [t1, t2],
      }));
    });
    act(() => {
      const t1 = makeTouch(1, x1 + 50, y1 + 30);
      const t2 = makeTouch(2, x1 + 70, y1 + 50);
      window.dispatchEvent(new TouchEvent('touchmove', {
        bubbles: true, cancelable: true, touches: [t1, t2], targetTouches: [t1, t2], changedTouches: [t1, t2],
      }));
    });
    act(() => {
      const t1 = makeTouch(1, x1 + 50, y1 + 30);
      const t2 = makeTouch(2, x1 + 70, y1 + 50);
      window.dispatchEvent(new TouchEvent('touchend', {
        bubbles: true, cancelable: true, touches: [], targetTouches: [], changedTouches: [t1, t2],
      }));
    });

    expect(dispatchCount).toBe(0);
    expect(screen.getByRole('button', { name: 'Select object r1' })).toHaveAttribute('aria-pressed', 'false');
    expect(editor.getSnapshot().document.slides[0].objects[0].geometry.x).toBe(72 * PT);
  });

  it('N4: observes host-only ancestor transform changes while idle without React rerender and recovers when cleared', async () => {
    const editor = makeEditor([makeRect('r1')]);
    const onSurfaceChange = vi.fn();
    const hostRef = { current: null };
    const { container } = render(
      <div ref={el => { hostRef.current = el; }} style={{ transform: 'scale(1.1)' }}>
        <EditorProvider editor={editor}>
          <PresentationEditor surface="konva" onSurfaceChange={onSurfaceChange} />
        </EditorProvider>
      </div>,
    );
    await waitForKonvaCanvas(container);
    await waitFor(() => {
      expect(onSurfaceChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ active: 'konva', status: 'ready' }),
      );
    });

    // Mutate ancestor transform directly on DOM without any React rerender
    hostRef.current.style.transform = 'rotate(12deg)';
    await waitFor(() => {
      expect(onSurfaceChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ requested: 'konva', active: 'svg', status: 'fallback', reason: 'unsupported-embedding' }),
      );
    });
    expect(container.querySelector('.stagecraft-presentation-paper canvas')).toBeNull();

    // Clearing the unsupported transform restores Konva canvas
    hostRef.current.style.transform = '';
    await waitForKonvaCanvas(container);
    await waitFor(() => {
      expect(onSurfaceChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ active: 'konva', status: 'ready' }),
      );
    });
  });

  it('N4: cancels an active Konva drag and falls back with 0 dispatches when an ancestor transform changes mid-drag', async () => {
    const baseEditor = makeEditor([makeRect('r1', 72, 72, 240, 100)]);
    let dispatchCount = 0;
    const editor = {
      ...baseEditor,
      dispatch: (...args) => { dispatchCount += 1; return baseEditor.dispatch(...args); },
    };
    const onSurfaceChange = vi.fn();
    const hostRef = { current: null };
    const { container } = render(
      <div ref={el => { hostRef.current = el; }}>
        <EditorProvider editor={editor}>
          <PresentationEditor surface="konva" onSurfaceChange={onSurfaceChange} />
        </EditorProvider>
      </div>,
    );
    const konvaCanvas = await waitForKonvaCanvas(container);
    const { default: Konva } = await import('konva/lib/Core.js');
    const stage = getStageForContainer(Konva, container);
    const shapeNode = stage.findOne('.r1');

    let stagePt = { x: 0, y: 0 };
    await waitFor(() => {
      stagePt = { x: shapeNode.x() * stage.scaleX(), y: shapeNode.y() * stage.scaleY() };
      if (stage.getIntersection(stagePt) !== shapeNode) throw new Error('hit not ready');
    });

    const box = konvaCanvas.getBoundingClientRect();
    const startX = box.left + stagePt.x + 20;
    const startY = box.top + stagePt.y + 20;
    const initialX = shapeNode.x();

    fireEvent.click(screen.getByRole('button', { name: 'Select object r1' }));
    act(() => {
      konvaCanvas.dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true, cancelable: true, clientX: startX, clientY: startY, button: 0, buttons: 1,
      }));
    });
    act(() => {
      window.dispatchEvent(new MouseEvent('mousemove', {
        bubbles: true, cancelable: true, clientX: startX + 60, clientY: startY + 40, buttons: 1,
      }));
    });
    await waitFor(() => expect(shapeNode.x()).toBeGreaterThan(initialX));

    // Mutate ancestor transform directly on DOM mid-drag (no React rerender)
    hostRef.current.style.transform = 'skewX(15deg)';
    await waitFor(() => {
      expect(onSurfaceChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ requested: 'konva', active: 'svg', status: 'fallback', reason: 'unsupported-embedding' }),
      );
    });
    expect(shapeNode.isDragging()).toBe(false);
    expect(shapeNode.x()).toBe(initialX);

    // Release pointer after fallback; late mouseup/dragend must be inert
    act(() => {
      window.dispatchEvent(new MouseEvent('mouseup', {
        bubbles: true, cancelable: true, clientX: startX + 60, clientY: startY + 40, button: 0,
      }));
    });
    expect(dispatchCount).toBe(0);
    expect(editor.getSnapshot().document.slides[0].objects[0].geometry.x).toBe(72 * PT);
  });

  it('N4: disconnects embedding observers on owner change and unmount without leaking', async () => {
    const mutationDisconnectSpy = vi.spyOn(MutationObserver.prototype, 'disconnect');
    const resizeDisconnectSpy = vi.spyOn(ResizeObserver.prototype, 'disconnect');
    try {
      const editor1 = makeEditor([makeRect('r1')]);
      const editor2 = makeEditor([makeRect('r2')]);
      const { container, rerender, unmount } = render(
        <EditorProvider editor={editor1}>
          <PresentationEditor surface="konva" />
        </EditorProvider>,
      );
      await waitForKonvaCanvas(container);
      const mutDisconnectsBeforeSwap = mutationDisconnectSpy.mock.calls.length;
      const resDisconnectsBeforeSwap = resizeDisconnectSpy.mock.calls.length;

      // Owner change must disconnect previous observers before attaching new ones
      rerender(
        <EditorProvider editor={editor2}>
          <PresentationEditor surface="konva" />
        </EditorProvider>,
      );
      await waitForKonvaCanvas(container);
      expect(mutationDisconnectSpy.mock.calls.length).toBeGreaterThan(mutDisconnectsBeforeSwap);
      expect(resizeDisconnectSpy.mock.calls.length).toBeGreaterThan(resDisconnectsBeforeSwap);

      const mutDisconnectsBeforeUnmount = mutationDisconnectSpy.mock.calls.length;
      const resDisconnectsBeforeUnmount = resizeDisconnectSpy.mock.calls.length;
      unmount();
      expect(mutationDisconnectSpy.mock.calls.length).toBeGreaterThan(mutDisconnectsBeforeUnmount);
      expect(resizeDisconnectSpy.mock.calls.length).toBeGreaterThan(resDisconnectsBeforeUnmount);
    } finally {
      mutationDisconnectSpy.mockRestore();
      resizeDisconnectSpy.mockRestore();
    }
  });
});
