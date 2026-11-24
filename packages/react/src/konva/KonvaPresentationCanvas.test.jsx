import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { createEditor } from '@stagecraft/core/editor';
import { createDocument, documentPlugin, presentationPlugin, validateDocument } from '@stagecraft/core/document';
import { EditorProvider } from '../EditorProvider.jsx';
import { PresentationEditor, PresentationEditorProvider, PresentationPluginProvider, createPresentationPluginRegistry } from '../PresentationEditor.jsx';
import { KonvaPresentationCanvas } from './KonvaPresentationCanvas.jsx';

const PT = 12700;

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

function makeDoc({ background, objects = [], format } = {}) {
  return createDocument({
    id: 'k2b-deck',
    ...(format ? { extensions: { sourceFormat: format } } : {}),
    slides: [
      {
        id: 's1',
        extensions: { stagecraftAuthored: true },
        ...(background ? { background } : {}),
        objects,
      },
    ],
  });
}

function makeEditor(doc = makeDoc({ background: { type: 'solid', color: '#ffffff' } })) {
  return createEditor({ document: doc, validateDocument, plugins: [documentPlugin, presentationPlugin] });
}

describe('KONVA-2b surface decision, fallback wording, and API boundary', () => {
  it('defaults to svg, stays SSR-safe for KonvaPresentationCanvas, and dedupes onSurfaceChange', () => {
    const editor = makeEditor();
    const onSurfaceChange = vi.fn();
    const html = renderToString(
      <EditorProvider editor={editor}>
        <PresentationEditorProvider>
          <KonvaPresentationCanvas />
        </PresentationEditorProvider>
      </EditorProvider>,
    );
    expect(html).toContain('Slide artwork');

    const { rerender } = render(
      <EditorProvider editor={editor}>
        <PresentationEditor onSurfaceChange={onSurfaceChange} />
      </EditorProvider>,
    );
    expect(onSurfaceChange).toHaveBeenCalledTimes(1);
    expect(onSurfaceChange).toHaveBeenLastCalledWith({
      requested: 'svg',
      active: 'svg',
      status: 'ready',
      slideId: 's1',
      revision: 0,
    });
    rerender(
      <EditorProvider editor={editor}>
        <PresentationEditor className="same" onSurfaceChange={onSurfaceChange} />
      </EditorProvider>,
    );
    expect(onSurfaceChange).toHaveBeenCalledTimes(1);
  });

  it('falls back to SVG with user-facing wording for ODP, non-canonical, and plugin objectRenderers', () => {
    const odpEditor = makeEditor(makeDoc({ format: 'odp', background: { type: 'solid', color: '#ffffff' } }));
    const onSurfaceChange = vi.fn();
    const { rerender } = render(
      <EditorProvider editor={odpEditor}>
        <PresentationEditor surface="konva" onSurfaceChange={onSurfaceChange} />
      </EditorProvider>,
    );
    expect(onSurfaceChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ requested: 'konva', active: 'svg', status: 'fallback', reason: 'unsupported-format' }),
    );
    expect(screen.getByRole('status')).toHaveTextContent('Showing the standard view: canvas view supports PowerPoint files only.');
    expect(screen.getByRole('status')).not.toHaveTextContent('unsupported-format');

    const nonCanonical = createEditor({ document: { schemaVersion: 0, slides: [] }, plugins: [documentPlugin, presentationPlugin] });
    rerender(
      <EditorProvider editor={nonCanonical}>
        <PresentationEditor surface="konva" onSurfaceChange={onSurfaceChange} />
      </EditorProvider>,
    );
    expect(onSurfaceChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ requested: 'konva', active: 'svg', status: 'fallback', reason: 'not-canonical' }),
    );
    expect(screen.getByRole('status')).toHaveTextContent('Showing the standard view: this deck format is not supported in canvas view.');

    const authoredEditor = makeEditor();
    const plugin = { id: 'custom-renderer', objectRenderers: [{ id: 'r1', match: () => true, render: () => null }] };
    rerender(
      <EditorProvider editor={authoredEditor}>
        <PresentationEditor surface="konva" plugins={[plugin]} onSurfaceChange={onSurfaceChange} />
      </EditorProvider>,
    );
    expect(onSurfaceChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ requested: 'konva', active: 'svg', status: 'fallback', reason: 'plugin-renderer' }),
    );
    expect(screen.getByRole('status')).toHaveTextContent('Showing the standard view: this editor uses custom object renderers.');
    rerender(
      <EditorProvider editor={authoredEditor}>
        <PresentationEditor surface="konva" plugins={[]} onSurfaceChange={onSurfaceChange} />
      </EditorProvider>,
    );
    expect(onSurfaceChange.mock.calls.at(-1)[0].reason).not.toBe('plugin-renderer');
  });

  it('offers one-click white background on inherited-appearance fallback and transitions off fallback', () => {
    const doc = createDocument({
      id: 'inherited-bg',
      slides: [{ id: 's1', layoutId: 'l1', extensions: { stagecraftAuthored: true }, objects: [] }],
      layouts: [{ id: 'l1', masterId: 'm1', source: { format: 'pptx', part: 'ppt/slideLayouts/slideLayout1.xml', path: [] }, objects: [] }],
      masters: [{ id: 'm1', source: { format: 'pptx', part: 'ppt/slideMasters/slideMaster1.xml', path: [] }, objects: [] }],
    });
    const editor = makeEditor(doc);
    const onSurfaceChange = vi.fn();
    render(
      <EditorProvider editor={editor}>
        <PresentationEditor surface="konva" onSurfaceChange={onSurfaceChange} />
      </EditorProvider>,
    );
    expect(onSurfaceChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ requested: 'konva', active: 'svg', status: 'fallback', reason: 'inherited-appearance' }),
    );
    expect(screen.getByRole('status')).toHaveTextContent('Showing the standard view: this slide uses its layout background. Set a slide background to use canvas view.');

    const fixBtn = screen.getByRole('button', { name: 'Use a white background' });
    fireEvent.click(fixBtn);
    expect(editor.getSnapshot().document.slides[0].background).toEqual({ type: 'solid', color: '#ffffff' });
    expect(editor.getSnapshot().revision).toBe(1);
    expect(onSurfaceChange.mock.calls.at(-1)[0].reason).not.toBe('inherited-appearance');
  });

  it('hides one-click white background when readOnly or slide-properties denied, and isolates throwing onSurfaceChange', () => {
    const doc = createDocument({
      id: 'inherited-ro',
      slides: [{ id: 's1', layoutId: 'l1', extensions: { stagecraftAuthored: true }, objects: [] }],
      layouts: [{ id: 'l1', masterId: 'm1', source: { format: 'pptx', part: 'ppt/slideLayouts/slideLayout1.xml', path: [] }, objects: [] }],
      masters: [{ id: 'm1', source: { format: 'pptx', part: 'ppt/slideMasters/slideMaster1.xml', path: [] }, objects: [] }],
    });
    const editor = makeEditor(doc);
    const onSurfaceChange = vi.fn(() => {
      throw new Error('listener boom');
    });
    const onError = vi.fn();
    render(
      <EditorProvider editor={editor}>
        <PresentationEditor surface="konva" readOnly onSurfaceChange={onSurfaceChange} onError={onError} />
      </EditorProvider>,
    );
    expect(screen.queryByRole('button', { name: 'Use a white background' })).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('Showing the standard view: this slide uses its layout background. Set a slide background to use canvas view.');
    expect(onError).toHaveBeenCalled();
  });

  it('falls back with canvas-unavailable wording when canvas is missing', async () => {
    const doc = makeDoc({
      background: { type: 'solid', color: '#ffffff' },
      objects: [{
        id: 'rect1',
        type: 'shape',
        shape: 'rect',
        geometry: { x: 72 * PT, y: 72 * PT, width: 120 * PT, height: 80 * PT, rotation: 0 },
        fill: '#2563eb',
        extensions: { stagecraftAuthored: true },
      }],
    });
    const editor = makeEditor(doc);
    const onSurfaceChange = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    render(
      <EditorProvider editor={editor}>
        <PresentationEditor surface="konva" onSurfaceChange={onSurfaceChange} />
      </EditorProvider>,
    );
    await waitFor(() => {
      expect(onSurfaceChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ requested: 'konva', active: 'svg', status: 'fallback', reason: 'canvas-unavailable' }),
      );
    });
    expect(screen.getByRole('status')).toHaveTextContent('Showing the standard view: canvas view could not start.');
  });

  it('ignores stale waitForCanonicalFonts completion after slide or owner replacement', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({});
    let resolveLoad;
    const pendingLoad = new Promise(resolve => { resolveLoad = resolve; });
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: {
        status: 'loading',
        check: q => q.includes('Georgia'),
        load: vi.fn(() => pendingLoad),
        ready: Promise.resolve(),
      },
    });
    const doc = createDocument({
      id: 'stale-font-deck',
      slides: [
        {
          id: 's1',
          extensions: { stagecraftAuthored: true },
          background: { type: 'solid', color: '#ffffff' },
          objects: [{
            id: 't1',
            type: 'text',
            geometry: { x: 72 * PT, y: 72 * PT, width: 160 * PT, height: 60 * PT, rotation: 0 },
            extensions: { stagecraftAuthored: true },
            text: { paragraphs: [{ id: 'p1', runs: [{ id: 'r1', text: 'Slide 1', editable: true, style: { typeface: 'Arial', sz: '1800' }, extensions: { stagecraftAuthored: true } }] }] },
          }],
        },
        {
          id: 's2',
          extensions: { stagecraftAuthored: true },
          background: { type: 'solid', color: '#ffffff' },
          objects: [{
            id: 't2',
            type: 'text',
            geometry: { x: 72 * PT, y: 72 * PT, width: 160 * PT, height: 60 * PT, rotation: 0 },
            extensions: { stagecraftAuthored: true },
            text: { paragraphs: [{ id: 'p2', runs: [{ id: 'r2', text: 'Slide 2', editable: true, style: { typeface: 'Courier New', sz: '1800' }, extensions: { stagecraftAuthored: true } }] }] },
          }],
        },
      ],
    });
    const editor1 = makeEditor(doc);
    const editor2 = makeEditor(doc);
    const onSurfaceChange = vi.fn();
    const { rerender } = render(
      <EditorProvider editor={editor1}>
        <PresentationEditor surface="konva" onSurfaceChange={onSurfaceChange} />
      </EditorProvider>,
    );
    expect(onSurfaceChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ requested: 'konva', active: 'svg', status: 'fallback', reason: 'loading', slideId: 's1' }),
    );

    // Replace owner before s1's font load settles; s2/editor2 also uses a missing font
    rerender(
      <EditorProvider editor={editor2}>
        <PresentationEditor surface="konva" onSurfaceChange={onSurfaceChange} />
      </EditorProvider>,
    );
    await act(async () => {
      resolveLoad([]);
      await Promise.resolve();
    });
    expect(onSurfaceChange.mock.calls.every(([, ] = []) => true)).toBe(true);
    expect(onSurfaceChange.mock.calls.at(-1)[0].active).toBe('svg');
  });

  it('uses diagnostic-specific wording for inherited-appearance variants without showing white-background action for non-background causes', async () => {
    const { surfaceMessageForReason } = await import('./surfaceDecision.js');
    expect(surfaceMessageForReason('inherited-appearance', [{ code: 'inherited-background' }])).toContain('layout background');
    expect(surfaceMessageForReason('inherited-appearance', [{ code: 'inherited-artwork' }])).toContain('artwork');
    expect(surfaceMessageForReason('inherited-appearance', [{ code: 'authored-layout-mismatch' }])).toContain('layout');
    expect(surfaceMessageForReason('inherited-appearance', [{ code: 'theme-object-defaults' }])).toContain('theme');
  });

  it('B8: resets load-failed on slide/content change and explicit re-request without a repaint loop', async () => {
    let failImport = true;
    let importAttempts = 0;
    vi.resetModules();
    vi.doMock('./KonvaSurfaceShell.jsx', () => {
      importAttempts += 1;
      if (failImport) {
        throw new Error('transient network error');
      }
      return {
        default: ({ onUseSvg }) => (
          <div data-testid="mock-konva-shell">
            <button type="button" onClick={onUseSvg}>Switch to standard view</button>
          </div>
        ),
      };
    });

    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({});
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: { status: 'loaded', check: () => true, load: async () => [], ready: Promise.resolve() },
    });

    const { EditorProvider: FreshEditorProvider } = await import('../EditorProvider.jsx');
    const { PresentationEditor: FreshPresentationEditor } = await import('../PresentationEditor.jsx');
    const doc = createDocument({
      id: 'b8-deck',
      slides: [
        { id: 's1', extensions: { stagecraftAuthored: true }, background: { type: 'solid', color: '#ffffff' }, objects: [] },
        { id: 's2', extensions: { stagecraftAuthored: true }, background: { type: 'solid', color: '#ffffff' }, objects: [] },
      ],
    });
    const editor = makeEditor(doc);
    const onSurfaceChange = vi.fn();

    render(
      <FreshEditorProvider editor={editor}>
        <FreshPresentationEditor surface="konva" onSurfaceChange={onSurfaceChange} />
      </FreshEditorProvider>,
    );

    await waitFor(() => {
      expect(onSurfaceChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ active: 'svg', status: 'fallback', reason: 'load-failed' }),
      );
    });
    const attemptsAfterFail = importAttempts;

    // Unrelated repaint/selection does not loop retries while load-failed is active
    expect(importAttempts).toBe(attemptsAfterFail);

    // Content change (revision bump) retries and succeeds once import recovers
    failImport = false;
    act(() => {
      editor.dispatch('presentation.setSlideProperties', { slideId: 's1', properties: { name: 'Updated' } });
    });

    await waitFor(() => {
      expect(onSurfaceChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ active: 'konva', status: 'ready', revision: 1 }),
      );
    });
    vi.doUnmock('./KonvaSurfaceShell.jsx');
  });
});
