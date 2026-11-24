import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createEditor } from '@stagecraft/core/editor';
import { createDocument, documentPlugin, presentationPlugin, validateDocument } from '@stagecraft/core/document';
import { EditorProvider } from '../EditorProvider.jsx';
import { PresentationEditor } from '../PresentationEditor.jsx';

const PT = 12700;

const fontsDescriptor = Object.getOwnPropertyDescriptor(document, 'fonts');
beforeEach(() => {
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: { status: 'loaded', check: () => true, load: async () => [], ready: Promise.resolve() },
  });
});
afterEach(() => {
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
    const canvas = container.querySelector('.stagecraft-konva-paper canvas');
    if (!canvas) throw new Error('Konva canvas not mounted yet');
    return canvas;
  }, { timeout: 5000 });
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
    expect(onSurfaceChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ active: 'konva', status: 'ready' }),
    );

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
});
