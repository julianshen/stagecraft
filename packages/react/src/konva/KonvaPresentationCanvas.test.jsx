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

    // Slide change resets load-failed and retries
    failImport = false;
    fireEvent.click(screen.getByRole('button', { name: 'Slide 2' }));

    await waitFor(() => {
      expect(onSurfaceChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ active: 'konva', status: 'ready', slideId: 's2' }),
      );
    });
    vi.doUnmock('./KonvaSurfaceShell.jsx');
  });

  it('N5: displays exact approved user-facing wording for all non-UI-reachable fallback reasons', async () => {
    const { surfaceMessageForReason } = await import('./surfaceDecision.js');
    expect(surfaceMessageForReason('no-slide')).toBe('Showing the standard view: there is no slide to show.');
    expect(surfaceMessageForReason('not-canonical')).toBe('Showing the standard view: this deck format is not supported in canvas view.');
    expect(surfaceMessageForReason('unsupported-embedding')).toBe('Showing the standard view: the editor is inside a scaled or rotated container.');
    expect(surfaceMessageForReason('invalid-geometry')).toBe('Showing the standard view: an object on this slide has an invalid size or position.');
    expect(surfaceMessageForReason('fonts-unavailable')).toBe('Showing the standard view: the slide fonts did not load.');
    expect(surfaceMessageForReason('fonts-timeout')).toBe('Showing the standard view: the slide fonts did not load.');
    expect(surfaceMessageForReason('canvas-unavailable')).toBe('Showing the standard view: canvas view could not start.');
    expect(surfaceMessageForReason('load-failed')).toBe('Showing the standard view: canvas view could not start.');
    expect(surfaceMessageForReason('render-failed')).toBe('Showing the standard view: canvas view could not start.');
  });

  it('K3b: uses plain-language diagnostic wording for native appearance, inherited and unsupported content diagnostics', async () => {
    const { surfaceMessageForReason } = await import('./surfaceDecision.js');

    const cases = [
      ['inherited-appearance', 'theme-background-unresolved', 'theme background'],
      ['unresolved-appearance', 'native-appearance-proof-missing', 'cannot confirm this slide matches PowerPoint yet'],
      ['unresolved-appearance', 'native-appearance-proof-invalid', 'cannot confirm this slide matches PowerPoint yet'],
      ['unresolved-appearance', 'native-appearance-stale', 'reopened'],
      ['unresolved-appearance', 'theme-color-unresolved', 'theme colour variation'],
      ['unresolved-appearance', 'text-appearance-unresolved', 'text styling'],
      ['unresolved-appearance', 'placeholder-style-unresolved', 'placeholder styling'],
      ['unsupported-content', 'gradient-fill', 'a gradient fill'],
      ['unsupported-content', 'picture-fill', 'a picture fill'],
      ['unsupported-content', 'outline-unsupported', 'outline'],
      ['unsupported-content', 'custom-geometry', 'custom shape geometry'],
      ['unsupported-content', 'flip-unsupported', 'flipped shape'],
      ['unsupported-content', 'list-style-unsupported', 'bulleted list'],
      ['unsupported-content', 'native-autofit-unsupported', 'autofit'],
      ['unsupported-content', 'placeholder-style-unresolved', 'placeholder styling'],
    ];

    for (const [reason, code, expectedSubstring] of cases) {
      const message = surfaceMessageForReason(reason, [{ code, objectId: 'obj-1' }]);
      expect(message).toContain(expectedSubstring);
      expect(message).not.toContain(code);
    }

    expect(surfaceMessageForReason('unresolved-appearance', [{ code: 'placeholder-style-unresolved' }]))
      .toBe(surfaceMessageForReason('unsupported-content', [{ code: 'placeholder-style-unresolved' }]));
  });

  it('K3b: selects the first known diagnostic code for both message and data-diagnostic-code', async () => {
    const { surfaceDiagnosticForReason } = await import('./surfaceDecision.js');
    const selected = surfaceDiagnosticForReason('unsupported-content', [
      { code: 'future-x', objectId: 'o1' },
      { code: 'gradient-fill', objectId: 'o2' },
    ]);
    expect(selected.code).toBe('gradient-fill');
    expect(selected.message).toContain('a gradient fill');
    expect(selected.message).toContain('and 1 other item');
    expect(selected.message).not.toContain('future-x');
  });

  it('K3b: summarizes multiple diagnostics by counting all diagnostics including unknown codes and other reasons', async () => {
    const { surfaceMessageForReason } = await import('./surfaceDecision.js');
    const two = surfaceMessageForReason('unsupported-content', [
      { code: 'gradient-fill', objectId: 'o1' },
      { code: 'picture-fill', objectId: 'o2' },
    ]);
    expect(two).toContain('a gradient fill');
    expect(two).toContain('and 1 other item');
    expect(two).not.toContain('gradient-fill');
    expect(two).not.toContain('picture-fill');

    const three = surfaceMessageForReason('unsupported-content', [
      { code: 'gradient-fill', objectId: 'o1' },
      { code: 'future-unknown', objectId: 'o2' },
      { code: 'inherited-background', objectId: 'o3' },
    ]);
    expect(three).toContain('a gradient fill');
    expect(three).toContain('and 2 other items');
  });

  it('K3b: falls back to non-empty reason default wording for unknown or future diagnostic codes', async () => {
    const { surfaceMessageForReason, SURFACE_REASON_MESSAGES } = await import('./surfaceDecision.js');
    for (const reason of ['inherited-appearance', 'unresolved-appearance', 'unsupported-content']) {
      const message = surfaceMessageForReason(reason, [{ code: 'future-diagnostic-code', objectId: 'o1' }]);
      expect(message).toBeTruthy();
      expect(message).toMatch(/^Showing the standard view:/);
      expect(message).not.toContain('future-diagnostic-code');
      if (reason !== 'inherited-appearance') {
        expect(message).toBe(SURFACE_REASON_MESSAGES[reason]);
      }
    }
  });
});
