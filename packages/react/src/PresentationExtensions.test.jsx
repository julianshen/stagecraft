import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import { createEditor } from '@stagecraft/core/editor';
import { createDocument, documentPlugin, presentationPlugin } from '@stagecraft/core/document';
import { EditorProvider } from './EditorProvider.jsx';
import {
  PresentationEditor,
  PresentationEditorProvider,
  PresentationPluginProvider,
  PresentationToolbar,
  PresentationCanvas,
  AttributePanel,
  NotesPanel,
  usePresentationPlugins,
  createPresentationPluginRegistry,
} from './PresentationEditor.jsx';
import { PresentationPluginProvider as PluginProviderDirect, usePresentationPlugins as usePluginsDirect } from './presentationPlugins.jsx';

const PT = 12700;

function makeCanonicalDoc(slides = [{
  id: 's1',
  objects: [{
    id: 't1',
    type: 'text',
    geometry: { x: 72 * PT, y: 72 * PT, width: 240 * PT, height: 100 * PT },
    extensions: { stagecraftAuthored: true },
    text: {
      paragraphs: [{
        id: 'p1',
        runs: [{
          id: 'r1',
          text: 'Hello',
          editable: true,
          style: { sz: '2400' },
          extensions: { stagecraftAuthored: true },
        }],
      }],
    },
  }],
}]) {
  return createDocument({ slides });
}

function makeEngine(doc = makeCanonicalDoc(), dispatchSpy) {
  const editor = createEditor({
    document: doc,
    plugins: [documentPlugin, presentationPlugin],
  });
  if (!dispatchSpy) return editor;
  return {
    ...editor,
    dispatch(command, payload, meta) {
      dispatchSpy(command, payload);
      return editor.dispatch(command, payload, meta);
    },
  };
}

describe('Presentation UI plugin registry & error isolation', () => {
  it('supports declarative plugins, imperative registerPlugin cleanup, custom renderers, toolbar actions, and inspector sections', () => {
    const editor = makeEngine();
    const onAction = vi.fn();

    function ImperativePluginHarness() {
      const { registerPlugin } = usePluginsDirect();
      return (
        <button
          type="button"
          onClick={() => {
            const unregister = registerPlugin({
              id: 'imp-plugin',
              toolbarActions: [{ id: 'imp-btn', label: 'Imperative Action', tab: 'Home', onAction }],
            });
            window.__unregisterImp = unregister;
          }}
        >
          Mount Imperative
        </button>
      );
    }

    const plugin = {
      id: 'acme-ui',
      toolbarActions: [
        { id: 'act-1', label: 'Plugin Home', tab: 'Home', order: 2, onAction },
        { id: 'act-hidden', label: 'Hidden Action', tab: 'Home', visible: () => false, onAction },
        { id: 'act-view', label: 'Plugin View', tab: 'View', onAction },
      ],
      inspectorSections: [
        {
          id: 'sec-1',
          title: 'Plugin Inspector',
          when: (ctx) => Boolean(ctx.selectedObject),
          render: (ctx) => <div data-testid="plugin-sec">Selected: {ctx.selectedObject.id}</div>,
        },
      ],
      objectRenderers: [
        {
          id: 'low',
          priority: 1,
          match: (obj) => obj.type === 'text',
          render: () => <text data-testid="low-prio">Low</text>,
        },
        {
          id: 'high',
          priority: 10,
          match: (obj) => obj.type === 'text',
          render: ({ object }) => <text data-testid="high-prio">Custom:{object.id}</text>,
        },
      ],
    };

    render(
      <PluginProviderDirect>
        <ImperativePluginHarness />
        <EditorProvider editor={editor}>
          <PresentationEditor plugins={[plugin]} />
        </EditorProvider>
      </PluginProviderDirect>
    );

    // Custom object renderer (highest priority) renders in SVG
    expect(screen.getAllByTestId('high-prio').length).toBeGreaterThan(0);
    expect(screen.queryByTestId('low-prio')).toBeNull();

    // Toolbar action on Home tab; hidden action is omitted
    const homeBtn = screen.getByRole('button', { name: 'Plugin Home' });
    expect(screen.queryByRole('button', { name: 'Hidden Action' })).toBeNull();
    fireEvent.click(homeBtn);
    expect(onAction).toHaveBeenCalledTimes(1);

    // View tab shows View plugin action
    fireEvent.click(screen.getByRole('tab', { name: 'View' }));
    expect(screen.getByRole('button', { name: 'Plugin View' })).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Home' }));

    // Inspector section appears only when an object is selected
    expect(screen.queryByTestId('plugin-sec')).toBeNull();
    fireEvent.click(screen.getAllByLabelText('Select object t1')[0]);
    expect(screen.getByTestId('plugin-sec')).toHaveTextContent('Selected: t1');

    // Imperative registration + cleanup
    fireEvent.click(screen.getByText('Mount Imperative'));
    expect(screen.getByRole('button', { name: 'Imperative Action' })).toBeTruthy();
    act(() => { window.__unregisterImp(); });
    expect(screen.queryByRole('button', { name: 'Imperative Action' })).toBeNull();
  });

  it('isolates throwing plugins without crashing editor or sibling plugins', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const editor = makeEngine();
    const onError = vi.fn();

    function BrokenSection() {
      throw new Error('broken-section-render');
    }
    function BrokenRenderer() {
      throw new Error('broken-object-render');
    }

    const brokenPlugin = {
      id: 'broken',
      toolbarActions: [
        { id: 'bad-vis', label: 'BadVis', visible: () => { throw new Error('bad-visible'); }, onAction: vi.fn() },
        { id: 'bad-act', label: 'BadAction', onAction: () => { throw new Error('bad-action'); } },
      ],
      inspectorSections: [
        { id: 'bad-sec', title: 'Bad Section', render: () => <BrokenSection /> },
      ],
      objectRenderers: [
        { id: 'bad-ren', priority: 99, match: () => true, render: () => <BrokenRenderer /> },
      ],
    };
    const healthyPlugin = {
      id: 'healthy',
      toolbarActions: [{ id: 'ok-act', label: 'Healthy Action', onAction: vi.fn() }],
      inspectorSections: [{ id: 'ok-sec', title: 'Healthy Section', render: () => <span>Healthy OK</span> }],
    };

    render(
      <EditorProvider editor={editor}>
        <PresentationEditor plugins={[brokenPlugin, healthyPlugin]} onError={onError} />
      </EditorProvider>
    );

    expect(screen.getByRole('button', { name: 'Healthy Action' })).toBeTruthy();
    expect(screen.getByText('Healthy OK')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'BadVis' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'BadAction' }));
    expect(onError).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('isolates direct throws inside plugin render callbacks and defers predicate error reporting', async () => {
    const consoleErrors = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...args) => {
      consoleErrors.push(args.map(String).join(' '));
    });
    const editor = makeEngine();
    const onError = vi.fn();

    const directThrowPlugin = {
      id: 'direct-throw',
      toolbarActions: [
        { id: 'direct-tb', label: 'DirectTB', render: () => { throw new Error('direct-tb-throw'); } },
        { id: 'pred-vis', label: 'PredVis', visible: () => { throw new Error('pred-vis-throw'); }, onAction: vi.fn() },
      ],
      inspectorSections: [
        { id: 'direct-sec', title: 'DirectSec', render: () => { throw new Error('direct-sec-throw'); } },
        { id: 'pred-sec', title: 'PredSec', when: () => { throw new Error('pred-sec-throw'); }, render: () => <span>Never</span> },
      ],
      objectRenderers: [
        { id: 'direct-ren', priority: 50, match: () => true, render: () => { throw new Error('direct-ren-throw'); } },
        { id: 'pred-match', priority: 60, match: () => { throw new Error('pred-match-throw'); }, render: () => <text>Never</text> },
      ],
    };
    const siblingPlugin = {
      id: 'sibling',
      toolbarActions: [{ id: 'sib-btn', label: 'Sibling OK', onAction: vi.fn() }],
      inspectorSections: [{ id: 'sib-sec', title: 'Sibling Sec', render: () => <span>Sibling Inspector OK</span> }],
    };

    render(
      <EditorProvider editor={editor}>
        <PresentationEditor plugins={[directThrowPlugin, siblingPlugin]} onError={onError} />
      </EditorProvider>
    );

    expect(screen.getByRole('button', { name: 'Sibling OK' })).toBeTruthy();
    expect(screen.getByText('Sibling Inspector OK')).toBeTruthy();
    expect(screen.queryByText('PredSec')).toBeNull();

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(onError).toHaveBeenCalled();
    expect(consoleErrors.some((msg) => msg.includes('Cannot update a component'))).toBe(false);
    spy.mockRestore();
  });

  it('caches snapshots on default and nested PresentationPluginProvider without infinite re-renders', () => {
    const editor = makeEngine();
    let renders = 0;
    function RenderCounter() {
      renders += 1;
      const { plugins } = usePluginsDirect();
      return <span data-testid="plugin-count">{plugins.length}</span>;
    }

    const parentPlugin = { id: 'parent-p', toolbarActions: [{ id: 'p-act', label: 'Parent Act', onAction: vi.fn() }] };
    const childPlugin = { id: 'child-p', toolbarActions: [{ id: 'c-act', label: 'Child Act', onAction: vi.fn() }] };

    const { rerender } = render(
      <PluginProviderDirect plugins={[parentPlugin]}>
        <PluginProviderDirect>
          <RenderCounter />
          <EditorProvider editor={editor}>
            <PresentationEditor plugins={[childPlugin]} />
          </EditorProvider>
        </PluginProviderDirect>
      </PluginProviderDirect>
    );

    const initialRenders = renders;
    expect(screen.getByTestId('plugin-count')).toHaveTextContent('1');
    expect(screen.getByRole('button', { name: 'Parent Act' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Child Act' })).toBeTruthy();

    rerender(
      <PluginProviderDirect plugins={[parentPlugin]}>
        <PluginProviderDirect>
          <RenderCounter />
          <EditorProvider editor={editor}>
            <PresentationEditor plugins={[childPlugin]} />
          </EditorProvider>
        </PluginProviderDirect>
      </PluginProviderDirect>
    );
    expect(renders).toBeLessThanOrEqual(initialRenders + 2);
  });

  it('resets PluginErrorBoundary when a broken contribution is replaced under the same IDs', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const editor = makeEngine();

    const brokenSameId = {
      id: 'same-plugin',
      toolbarActions: [{ id: 'same-act', label: 'SameAct', render: () => { throw new Error('broken-tb'); } }],
      inspectorSections: [{ id: 'same-sec', title: 'SameSec', render: () => { throw new Error('broken-sec'); } }],
      objectRenderers: [{ id: 'same-ren', priority: 10, match: () => true, render: () => { throw new Error('broken-ren'); } }],
    };
    const repairedSameId = {
      id: 'same-plugin',
      toolbarActions: [{ id: 'same-act', label: 'SameAct', render: () => <span data-testid="repaired-tb">Repaired TB</span> }],
      inspectorSections: [{ id: 'same-sec', title: 'SameSec', render: () => <span data-testid="repaired-sec">Repaired Sec</span> }],
      objectRenderers: [{ id: 'same-ren', priority: 10, match: () => true, render: () => <text data-testid="repaired-ren">Repaired Ren</text> }],
    };

    const { rerender } = render(
      <EditorProvider editor={editor}>
        <PresentationEditor plugins={[brokenSameId]} />
      </EditorProvider>
    );

    expect(screen.queryByTestId('repaired-tb')).toBeNull();
    expect(screen.queryByTestId('repaired-sec')).toBeNull();
    expect(screen.queryByTestId('repaired-ren')).toBeNull();

    rerender(
      <EditorProvider editor={editor}>
        <PresentationEditor plugins={[repairedSameId]} />
      </EditorProvider>
    );

    expect(screen.getByTestId('repaired-tb')).toHaveTextContent('Repaired TB');
    expect(screen.getByTestId('repaired-sec')).toHaveTextContent('Repaired Sec');
    expect(screen.getAllByTestId('repaired-ren').length).toBeGreaterThan(0);
    spy.mockRestore();
  });
});

describe('NotesPanel, slide properties, rich text, native fill, tables and images', () => {
  it('supports NotesPanel visibility toggle and commits speaker notes via setSlideProperties', () => {
    const spy = vi.fn();
    const editor = makeEngine(makeCanonicalDoc(), spy);
    const { rerender } = render(
      <EditorProvider editor={editor}>
        <PresentationEditor showNotesPanel />
      </EditorProvider>
    );

    const notes = screen.getByLabelText('Speaker notes', { selector: 'textarea' });
    fireEvent.change(notes, { target: { value: 'Remind audience about Q4' } });
    fireEvent.blur(notes);
    expect(spy).toHaveBeenCalledWith('presentation.setSlideProperties', {
      slideId: 's1',
      properties: { notes: 'Remind audience about Q4' },
    });

    rerender(
      <EditorProvider editor={editor}>
        <PresentationEditor showNotesPanel={false} />
      </EditorProvider>
    );
    expect(screen.queryByLabelText('Speaker notes', { selector: 'textarea' })).toBeNull();
  });

  it('edits slide name and solid background via setSlideProperties', () => {
    const spy = vi.fn();
    const editor = makeEngine(makeCanonicalDoc(), spy);
    render(
      <EditorProvider editor={editor}>
        <PresentationEditor />
      </EditorProvider>
    );

    const nameInput = screen.getByLabelText('Slide name');
    fireEvent.change(nameInput, { target: { value: 'Title Slide' } });
    fireEvent.blur(nameInput);
    expect(spy).toHaveBeenCalledWith('presentation.setSlideProperties', {
      slideId: 's1',
      properties: { name: 'Title Slide' },
    });

    const bgInput = screen.getByLabelText('Slide background');
    fireEvent.change(bgInput, { target: { value: '#112233' } });
    expect(spy).toHaveBeenCalledWith('presentation.setSlideProperties', {
      slideId: 's1',
      properties: { background: { type: 'solid', color: '#112233' } },
    });
    expect(document.querySelector('.stagecraft-presentation-paper').style.background).toBe('rgb(17, 34, 51)');
  });

  it('supports multi-paragraph/run editing for authored text only (not native text)', () => {
    const spy = vi.fn();
    const doc = makeCanonicalDoc([{
      id: 's1',
      objects: [
        {
          id: 't-authored',
          type: 'text',
          geometry: { x: 72 * PT, y: 72 * PT, width: 240 * PT, height: 100 * PT },
          extensions: { stagecraftAuthored: true },
          text: {
            paragraphs: [{
              id: 'p1',
              runs: [{ id: 'r1', text: 'Authored', editable: true, style: { sz: '2400' }, extensions: { stagecraftAuthored: true } }],
            }],
          },
        },
        {
          id: 't-native',
          type: 'text',
          geometry: { x: 72 * PT, y: 200 * PT, width: 240 * PT, height: 100 * PT },
          text: {
            paragraphs: [{
              id: 'pn1',
              runs: [{ id: 'rn1', text: 'Native', editable: true, style: {} }],
            }],
          },
        },
      ],
    }]);
    const editor = makeEngine(doc, spy);
    render(
      <EditorProvider editor={editor}>
        <PresentationEditor />
      </EditorProvider>
    );

    // Select authored text
    fireEvent.click(screen.getAllByLabelText('Select object t-authored')[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Add run to paragraph 1' }));
    expect(spy).toHaveBeenLastCalledWith('presentation.setText', expect.objectContaining({
      slideId: 's1',
      objectId: 't-authored',
    }));
    expect(editor.getSnapshot().document.slides[0].objects[0].text.paragraphs[0].runs).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: 'Add paragraph' }));
    expect(editor.getSnapshot().document.slides[0].objects[0].text.paragraphs).toHaveLength(2);

    // Select native text — must NOT show Add paragraph / Add run
    fireEvent.click(screen.getAllByLabelText('Select object t-native')[0]);
    expect(screen.queryByRole('button', { name: 'Add paragraph' })).toBeNull();
  });

  it('supports widened editableFill, table insertion + setTableCell, and atomic addImage + getImage preview with URL cleanup', async () => {
    const spy = vi.fn();
    const doc = makeCanonicalDoc([{
      id: 's1',
      objects: [{
        id: 'native-rect',
        type: 'shape',
        shape: 'rect',
        fill: '#abcdef',
        geometry: { x: 72 * PT, y: 72 * PT, width: 120 * PT, height: 80 * PT },
        extensions: { editableFill: true },
      }],
    }]);
    const editor = makeEngine(doc, spy);
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const registerImage = vi.fn(() => ({ assetId: 'asset-img-1' }));
    const getImage = vi.fn((id) => (id === 'asset-img-1' ? { bytes: pngBytes.slice(), contentType: 'image/png' } : null));
    const origCreate = URL.createObjectURL;
    const origRevoke = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => 'blob:stagecraft-img-1');
    URL.revokeObjectURL = vi.fn();

    const source = {
      capabilities: {
        readOnly: false,
        edits: [
          'existing-run-text', 'existing-run-format', 'slide-structure', 'slide-properties',
          'object-structure', 'object-text', 'object-table', 'object-image',
          'object-geometry', 'object-style',
        ],
      },
      registerImage,
      getImage,
      export: vi.fn(),
    };

    try {
      const { unmount } = render(
        <EditorProvider editor={editor}>
          <PresentationEditor source={source} />
        </EditorProvider>
      );

      // Widened native fill edit
      fireEvent.click(screen.getAllByLabelText('Select object native-rect')[0]);
      fireEvent.change(screen.getByLabelText('Fill'), { target: { value: '#123456' } });
      expect(spy).toHaveBeenCalledWith('presentation.setPaint', {
        slideId: 's1',
        objectId: 'native-rect',
        fill: '#123456',
      });
      expect(editor.getSnapshot().document.slides[0].objects[0].fill).toBe('#123456');

      // Table insertion + real presentation.setTableCell
      fireEvent.click(screen.getByRole('tab', { name: 'Insert' }));
      fireEvent.click(screen.getByRole('button', { name: 'Table' }));
      expect(spy).toHaveBeenLastCalledWith('presentation.addObject', expect.objectContaining({
        slideId: 's1',
        object: expect.objectContaining({ type: 'table' }),
      }));
      const cellArea = screen.getByLabelText('Cell 1.1 run 1');
      fireEvent.change(cellArea, { target: { value: 'Q1 Revenue' } });
      expect(spy).toHaveBeenLastCalledWith('presentation.setTableCell', expect.objectContaining({
        slideId: 's1',
      }));
      const tableObj = editor.getSnapshot().document.slides[0].objects.find((o) => o.type === 'table');
      expect(tableObj.table.rows[0].cells[0].text.paragraphs[0].runs[0].text).toBe('Q1 Revenue');

      // Atomic presentation.addImage + source.getImage blob preview + URL.revokeObjectURL on unmount
      const fileInput = document.querySelector('input[type="file"][accept="image/png,image/jpeg"]');
      const file = new File([pngBytes], 'chart.png', { type: 'image/png' });
      file.arrayBuffer = async () => pngBytes.buffer;
      await act(async () => {
        fireEvent.change(fileInput, { target: { files: [file] } });
      });

      expect(registerImage).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenLastCalledWith('presentation.addImage', expect.objectContaining({
        slideId: 's1',
        asset: { id: 'asset-img-1', contentType: 'image/png' },
        object: expect.objectContaining({ type: 'image', image: { assetId: 'asset-img-1', alt: 'chart.png' } }),
      }));
      expect(getImage).toHaveBeenCalledWith('asset-img-1');
      const imgs = document.querySelectorAll('img.stagecraft-presentation-image');
      expect(imgs.length).toBeGreaterThan(0);
      expect(imgs[0].getAttribute('src')).toBe('blob:stagecraft-img-1');

      unmount();
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:stagecraft-img-1');
    } finally {
      URL.createObjectURL = origCreate;
      URL.revokeObjectURL = origRevoke;
    }
  });

  it('formats authored table-cell runs via presentation.setTableCell without UNKNOWN_RUN and preserves revision safety', () => {
    const doc = createDocument({
      id: 'table-fmt-deck',
      slides: [{
        id: 's1',
        objects: [{
          id: 'tbl1',
          type: 'table',
          geometry: { x: 72 * PT, y: 72 * PT, width: 400 * PT, height: 180 * PT },
          extensions: { stagecraftAuthored: true },
          table: {
            columns: [{ id: 'col1', width: 400 * PT }],
            rows: [{
              id: 'row1',
              cells: [{
                id: 'c1',
                text: {
                  paragraphs: [{
                    id: 'cp1',
                    runs: [{ id: 'cr1', text: 'Cell A', editable: true, style: {}, extensions: { stagecraftAuthored: true } }],
                  }],
                },
              }],
            }],
          },
        }],
      }],
    });
    const editor = createEditor({ document: doc, plugins: [documentPlugin, presentationPlugin] });
    const source = {
      capabilities: { readOnly: false, edits: ['object-table', 'existing-run-format'] },
      export: vi.fn(),
    };

    render(
      <EditorProvider editor={editor}>
        <PresentationEditor source={source} />
      </EditorProvider>
    );

    fireEvent.click(screen.getAllByLabelText('Select object tbl1')[0]);
    fireEvent.change(screen.getByLabelText('Bold run 1'), { target: { value: 'true' } });
    const fontInput = screen.getByLabelText('Font family run 1');
    fireEvent.change(fontInput, { target: { value: 'Georgia' } });
    fireEvent.blur(fontInput);
    const sizeInput = screen.getByLabelText('Font size run 1');
    fireEvent.change(sizeInput, { target: { value: '18' } });
    fireEvent.blur(sizeInput);

    expect(screen.queryByRole('alert')).toBeNull();
    const run = editor.getSnapshot().document.slides[0].objects[0].table.rows[0].cells[0].text.paragraphs[0].runs[0];
    expect(run.style).toEqual({ b: '1', typeface: 'Georgia', sz: '1800' });

    // Stale draft on authored table cell resets when revision advances
    fireEvent.focus(screen.getByLabelText('Font family run 1'));
    fireEvent.change(screen.getByLabelText('Font family run 1'), { target: { value: 'StaleFont' } });
    const revBefore = editor.getSnapshot().revision;
    act(() => {
      editor.dispatch('presentation.setSlideProperties', { slideId: 's1', properties: { name: 'Bumped' } });
    });
    expect(editor.getSnapshot().revision).toBe(revBefore + 1);
    expect(screen.getByLabelText('Font family run 1')).toHaveValue('Georgia');
  });

  it('commits NotesPanel once on Ctrl+Enter without STALE_REVISION and resets drafts on editor/source swap', () => {
    expect(typeof PresentationPluginProvider).toBe('function');
    expect(typeof usePresentationPlugins).toBe('function');
    expect(typeof createPresentationPluginRegistry).toBe('function');

    const spy1 = vi.fn();
    const editor1 = makeEngine(makeCanonicalDoc([{ id: 's1', objects: [] }]), spy1);
    const editor2 = makeEngine(makeCanonicalDoc([{ id: 's1', objects: [] }]));
    const source1 = { capabilities: { readOnly: false, edits: ['slide-structure', 'slide-properties'] }, export: vi.fn() };
    const source2 = { capabilities: { readOnly: false, edits: ['slide-structure', 'slide-properties'] }, export: vi.fn() };

    const { rerender } = render(
      <EditorProvider editor={editor1}>
        <PresentationEditor source={source1} />
      </EditorProvider>
    );

    const notes = screen.getByLabelText('Speaker notes', { selector: 'textarea' });
    notes.focus();
    fireEvent.change(notes, { target: { value: 'Single commit note' } });
    fireEvent.keyDown(notes, { key: 'Enter', ctrlKey: true });

    expect(spy1).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(editor1.getSnapshot().document.slides[0].notes).toBe('Single commit note');

    // Type unsaved drafts into NotesPanel and Slide name, then swap editor & source with same slide ID 's1'
    fireEvent.change(notes, { target: { value: 'Unsaved draft note' } });
    const nameInput = screen.getByLabelText('Slide name');
    fireEvent.change(nameInput, { target: { value: 'Unsaved draft name' } });

    rerender(
      <EditorProvider editor={editor2}>
        <PresentationEditor source={source2} />
      </EditorProvider>
    );

    expect(screen.getByLabelText('Speaker notes', { selector: 'textarea' })).toHaveValue('');
    expect(screen.getByLabelText('Slide name')).toHaveValue('');
  });

  it('ignores stale pending image file reads and errors after editor/source swap or unmount', async () => {
    const spy1 = vi.fn();
    const spy2 = vi.fn();
    const editor1 = makeEngine(makeCanonicalDoc([{ id: 's1', objects: [] }]), spy1);
    const editor2 = makeEngine(makeCanonicalDoc([{ id: 's2', objects: [] }]), spy2);
    const register1 = vi.fn(() => ({ assetId: 'img-1' }));
    const register2 = vi.fn(() => ({ assetId: 'img-2' }));
    const onError = vi.fn();
    const source1 = {
      capabilities: { readOnly: false, edits: ['object-image', 'slide-structure'] },
      registerImage: register1,
      export: vi.fn(),
    };
    const source2 = {
      capabilities: { readOnly: false, edits: ['object-image', 'slide-structure'] },
      registerImage: register2,
      export: vi.fn(),
    };

    const { rerender, unmount } = render(
      <EditorProvider editor={editor1}>
        <PresentationEditor source={source1} onError={onError} />
      </EditorProvider>
    );

    fireEvent.click(screen.getByRole('tab', { name: 'Insert' }));
    const fileInput = document.querySelector('input[type="file"][accept="image/png,image/jpeg"]');

    let resolveRead;
    const pendingFile = new File([new Uint8Array([1, 2, 3])], 'slow.png', { type: 'image/png' });
    pendingFile.arrayBuffer = () => new Promise((resolve) => { resolveRead = resolve; });
    fireEvent.change(fileInput, { target: { files: [pendingFile] } });

    // Swap editor + source while file.arrayBuffer() is in flight
    rerender(
      <EditorProvider editor={editor2}>
        <PresentationEditor source={source2} onError={onError} />
      </EditorProvider>
    );

    await act(async () => {
      resolveRead(new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer);
    });
    expect(register1).not.toHaveBeenCalled();
    expect(register2).not.toHaveBeenCalled();
    expect(spy1).not.toHaveBeenCalled();
    expect(spy2).not.toHaveBeenCalled();

    // Rejecting read after unmount must not emit stale onError
    let rejectRead;
    const failingFile = new File([new Uint8Array([1, 2, 3])], 'fail.png', { type: 'image/png' });
    failingFile.arrayBuffer = () => new Promise((_, reject) => { rejectRead = reject; });
    fireEvent.change(document.querySelector('input[type="file"][accept="image/png,image/jpeg"]'), { target: { files: [failingFile] } });
    unmount();

    await act(async () => {
      rejectRead(new Error('disk-read-failed'));
    });
    expect(onError).not.toHaveBeenCalled();
  });

  it('cancels pending image file reads when transitioning to readOnly', async () => {
    const spy = vi.fn();
    const editor = makeEngine(makeCanonicalDoc([{ id: 's1', objects: [] }]), spy);
    const registerImage = vi.fn(() => ({ assetId: 'img-ro' }));
    const source = {
      capabilities: { readOnly: false, edits: ['object-image', 'slide-structure'] },
      registerImage,
      export: vi.fn(),
    };

    const { rerender } = render(
      <EditorProvider editor={editor}>
        <PresentationEditor source={source} readOnly={false} />
      </EditorProvider>
    );

    fireEvent.click(screen.getByRole('tab', { name: 'Insert' }));
    const fileInput = document.querySelector('input[type="file"][accept="image/png,image/jpeg"]');
    let resolveRead;
    const pendingFile = new File([new Uint8Array([1, 2, 3])], 'ro.png', { type: 'image/png' });
    pendingFile.arrayBuffer = () => new Promise((resolve) => { resolveRead = resolve; });
    fireEvent.change(fileInput, { target: { files: [pendingFile] } });

    // Transition to readOnly while file.arrayBuffer() is pending
    rerender(
      <EditorProvider editor={editor}>
        <PresentationEditor source={source} readOnly />
      </EditorProvider>
    );

    await act(async () => {
      resolveRead(new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer);
    });
    expect(registerImage).not.toHaveBeenCalled();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('Direct canvas inline run editing', () => {
  it('double-clicks a targeted run to edit via document.setRunText without flattening sibling runs, commits once on Ctrl+Enter', () => {
    const spy = vi.fn();
    const doc = makeCanonicalDoc([{
      id: 's1',
      objects: [{
        id: 't-multi',
        type: 'text',
        geometry: { x: 72 * PT, y: 72 * PT, width: 240 * PT, height: 100 * PT },
        extensions: { stagecraftAuthored: true },
        text: {
          paragraphs: [{
            id: 'p1',
            runs: [
              { id: 'r1', text: 'Keep ', editable: true, style: { b: '1', sz: '2400' }, extensions: { stagecraftAuthored: true } },
              { id: 'r2', text: 'Target', editable: true, style: { i: '1', sz: '2400' }, extensions: { stagecraftAuthored: true } },
            ],
          }],
        },
      }],
    }]);
    const editor = makeEngine(doc, spy);
    render(
      <EditorProvider editor={editor}>
        <PresentationEditor />
      </EditorProvider>
    );

    const canvas = screen.getByLabelText('Slide canvas');
    const run2Span = canvas.querySelector('[data-run-id="r2"]');
    fireEvent.doubleClick(run2Span);

    const textarea = screen.getByLabelText('Edit run text');
    expect(textarea).toHaveValue('Target');
    fireEvent.change(textarea, { target: { value: 'Updated' } });
    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('document.setRunText', { runId: 'r2', text: 'Updated' });
    const runs = editor.getSnapshot().document.slides[0].objects[0].text.paragraphs[0].runs;
    expect(runs).toHaveLength(2);
    expect(runs[0].text).toBe('Keep ');
    expect(runs[1].text).toBe('Updated');
    expect(screen.queryByLabelText('Edit run text')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('supports Enter to start, IME composition guard, Escape cancel, stale revision rejection, and readOnly/selection cancel', () => {
    const editor = makeEngine();
    const { rerender } = render(
      <EditorProvider editor={editor}>
        <PresentationEditor />
      </EditorProvider>
    );

    const obj = screen.getAllByLabelText('Select object t1')[0];
    fireEvent.click(obj);
    fireEvent.keyDown(obj, { key: 'Enter' });

    const textarea = screen.getByLabelText('Edit run text');
    // IME composition ignores Escape and Mod+Enter
    fireEvent.compositionStart(textarea);
    fireEvent.keyDown(textarea, { key: 'Escape' });
    expect(screen.getByLabelText('Edit run text')).toBeTruthy();
    fireEvent.compositionEnd(textarea);

    // Escape cancels without committing
    fireEvent.change(textarea, { target: { value: 'Discarded' } });
    fireEvent.keyDown(textarea, { key: 'Escape' });
    expect(screen.queryByLabelText('Edit run text')).toBeNull();
    expect(editor.getSnapshot().document.slides[0].objects[0].text.paragraphs[0].runs[0].text).toBe('Hello');

    // Stale revision rejection: external edit bumps revision while inline edit is open
    fireEvent.keyDown(obj, { key: 'Enter' });
    const ta2 = screen.getByLabelText('Edit run text');
    fireEvent.change(ta2, { target: { value: 'Stale edit' } });
    act(() => {
      editor.dispatch('document.setRunText', { runId: 'r1', text: 'Newer external' });
    });
    fireEvent.blur(ta2);
    expect(screen.getByRole('alert')).toHaveTextContent(/STALE_REVISION/i);
    expect(editor.getSnapshot().document.slides[0].objects[0].text.paragraphs[0].runs[0].text).toBe('Newer external');

    // readOnly cancels active inline edit
    fireEvent.keyDown(obj, { key: 'Enter' });
    expect(screen.getByLabelText('Edit run text')).toBeTruthy();
    rerender(
      <EditorProvider editor={editor}>
        <PresentationEditor readOnly />
      </EditorProvider>
    );
    expect(screen.queryByLabelText('Edit run text')).toBeNull();
  });
});

describe('Chart integration (toolbar, PresentationChart canvas, inspector, read-only native)', () => {
  function makeChartEngine(initialSlides, dispatchSpy) {
    const doc = {
      schemaVersion: 1,
      units: 'emu',
      size: { width: 12192000, height: 6858000 },
      slides: initialSlides,
    };
    const chartPlugin = {
      id: 'chart-test-plugin',
      version: '1.0.0',
      commands: [
        {
          id: 'presentation.addObject',
          apply(d, p) {
            dispatchSpy?.('presentation.addObject', p);
            return {
              ...d,
              slides: d.slides.map(s => (s.id === p.slideId ? { ...s, objects: [...s.objects, p.object] } : s)),
            };
          },
        },
        {
          id: 'presentation.setChart',
          apply(d, p) {
            dispatchSpy?.('presentation.setChart', p);
            return {
              ...d,
              slides: d.slides.map(s => (
                s.id === p.slideId
                  ? { ...s, objects: s.objects.map(o => (o.id === p.objectId ? { ...o, chart: p.chart } : o)) }
                  : s
              )),
            };
          },
        },
      ],
    };
    return createEditor({ document: doc, plugins: [chartPlugin] });
  }

  it('inserts default bar chart, renders PresentationChart, edits kind/categories/series, and validates bounds', () => {
    const spy = vi.fn();
    const onError = vi.fn();
    const editor = makeChartEngine([{ id: 's1', objects: [] }], spy);
    const source = {
      capabilities: { readOnly: false, edits: ['object-chart', 'slide-structure'] },
      export: vi.fn(),
    };

    render(
      <EditorProvider editor={editor}>
        <PresentationEditor source={source} onError={onError} />
      </EditorProvider>
    );

    fireEvent.click(screen.getByRole('tab', { name: 'Insert' }));
    fireEvent.click(screen.getByRole('button', { name: 'Chart' }));

    expect(spy).toHaveBeenCalledWith('presentation.addObject', expect.objectContaining({
      slideId: 's1',
      object: expect.objectContaining({
        type: 'chart',
        chart: expect.objectContaining({ kind: 'bar' }),
      }),
    }));

    const canvas = screen.getByLabelText('Slide canvas');
    expect(within(canvas).getByRole('img', { name: 'bar chart' })).toBeTruthy();

    // Edit category & series value
    const cat1 = screen.getByLabelText('Category 1');
    fireEvent.change(cat1, { target: { value: 'North' } });
    fireEvent.blur(cat1);
    expect(spy).toHaveBeenLastCalledWith('presentation.setChart', expect.objectContaining({
      chart: expect.objectContaining({ categories: ['North', 'Q2', 'Q3'] }),
    }));

    // Add series & switch to line
    fireEvent.click(screen.getByRole('button', { name: 'Add series' }));
    expect(editor.getSnapshot().document.slides[0].objects[0].chart.series).toHaveLength(2);
    fireEvent.change(screen.getByLabelText('Chart kind'), { target: { value: 'line' } });
    expect(within(canvas).getByRole('img', { name: 'line chart' })).toBeTruthy();

    // Switching to pie clamps to 1 series; negative value triggers validation error and does not dispatch
    fireEvent.change(screen.getByLabelText('Chart kind'), { target: { value: 'pie' } });
    expect(editor.getSnapshot().document.slides[0].objects[0].chart.series).toHaveLength(1);
    const val1 = screen.getByLabelText('Series 1 value 1');
    const callsBefore = spy.mock.calls.length;
    fireEvent.change(val1, { target: { value: '-5' } });
    fireEvent.blur(val1);
    expect(spy.mock.calls.length).toBe(callsBefore);
    expect(onError).toHaveBeenCalled();
  });

  it('disables Chart insert when object-chart capability is absent and previews native charts read-only', () => {
    const editor = makeChartEngine([{
      id: 's1',
      objects: [{
        id: 'native-chart',
        type: 'chart',
        geometry: { x: 72 * PT, y: 72 * PT, width: 320 * PT, height: 200 * PT },
        chart: { kind: 'bar', categories: ['A', 'B'], series: [{ name: 'Rev', values: [10, 20] }] },
      }],
    }]);
    const source = {
      capabilities: { readOnly: false, edits: ['slide-structure'] },
      export: vi.fn(),
    };

    render(
      <EditorProvider editor={editor}>
        <PresentationEditor source={source} />
      </EditorProvider>
    );

    fireEvent.click(screen.getByRole('tab', { name: 'Insert' }));
    expect(screen.getByRole('button', { name: 'Chart' })).toBeDisabled();

    const canvas = screen.getByLabelText('Slide canvas');
    expect(within(canvas).getByRole('img', { name: 'bar chart' })).toBeTruthy();
    fireEvent.click(screen.getAllByLabelText('Select object native-chart')[0]);
    expect(screen.getByText('Chart (read-only)')).toBeTruthy();
    expect(screen.queryByLabelText('Chart kind')).toBeNull();
  });
});

describe('Text editing tranche (fonts/colors, cross-run codepoint range, paragraph format, autofit)', () => {
  function makeTextTrancheEngine(initialSlides, docExtensions, dispatchSpy) {
    const doc = {
      schemaVersion: 1,
      units: 'emu',
      size: { width: 12192000, height: 6858000 },
      ...(docExtensions ? { extensions: docExtensions } : {}),
      slides: initialSlides,
    };
    const textPlugin = {
      id: 'text-tranche-test-plugin',
      version: '1.0.0',
      commands: [
        {
          id: 'document.setRunFormat',
          apply(d, p) {
            dispatchSpy?.('document.setRunFormat', p);
            return d;
          },
        },
        {
          id: 'document.setParagraphFormat',
          apply(d, p) {
            dispatchSpy?.('document.setParagraphFormat', p);
            return {
              ...d,
              slides: d.slides.map(s => ({
                ...s,
                objects: s.objects.map(o => (
                  o.text?.paragraphs
                    ? {
                        ...o,
                        text: {
                          ...o.text,
                          paragraphs: o.text.paragraphs.map(para => (
                            para.id === p.paragraphId ? { ...para, style: { ...para.style, ...p.format } } : para
                          )),
                        },
                      }
                    : o
                )),
              })),
            };
          },
        },
        {
          id: 'document.setTextBodyLayout',
          apply(d, p) {
            dispatchSpy?.('document.setTextBodyLayout', p);
            return {
              ...d,
              slides: d.slides.map(s => ({
                ...s,
                objects: s.objects.map(o => (
                  o.id === p.objectId ? { ...o, bodyLayout: { ...o.bodyLayout, ...p.layout } } : o
                )),
              })),
            };
          },
        },
        {
          id: 'document.setRunRangeFormat',
          apply(d, p) {
            dispatchSpy?.('document.setRunRangeFormat', p);
            return d;
          },
        },
      ],
    };
    return createEditor({ document: doc, plugins: [textPlugin] });
  }

  it('edits run fontFamily/color, maps partial cross-run UTF-16 selection to Unicode codepoints, and invalidates on readOnly', () => {
    const spy = vi.fn();
    const editor = makeTextTrancheEngine([{
      id: 's1',
      objects: [{
        id: 't-cross',
        type: 'text',
        geometry: { x: 72 * PT, y: 72 * PT, width: 300 * PT, height: 120 * PT },
        extensions: { stagecraftAuthored: true },
        text: {
          paragraphs: [{
            id: 'p1',
            runs: [
              { id: 'r1', text: '😀Hi ', editable: true, style: { sz: '2400', typeface: 'Inter', color: '#112233' }, extensions: { stagecraftAuthored: true } },
              { id: 'r2', text: 'World', editable: true, style: { sz: '2400' }, extensions: { stagecraftAuthored: true } },
            ],
          }],
        },
      }],
    }], undefined, spy);
    const source = {
      capabilities: {
        readOnly: false,
        edits: ['existing-run-format', 'paragraph-format', 'text-body-layout', 'run-range-format'],
      },
      export: vi.fn(),
    };

    const { rerender } = render(
      <EditorProvider editor={editor}>
        <PresentationEditor source={source} />
      </EditorProvider>
    );

    // Canvas renders authored typeface & color
    const canvas = screen.getByLabelText('Slide canvas');
    const r1Span = canvas.querySelector('[data-run-id="r1"]');
    expect(r1Span.style.color).toBe('rgb(17, 34, 51)');
    expect(r1Span.style.fontFamily).toContain('Inter');

    fireEvent.click(screen.getAllByLabelText('Select object t-cross')[0]);

    // Edit run fontFamily & reset color
    const fontInput = screen.getByLabelText('Font family run 1');
    fireEvent.change(fontInput, { target: { value: 'Georgia' } });
    fireEvent.blur(fontInput);
    expect(spy).toHaveBeenCalledWith('document.setRunFormat', { runId: 'r1', format: { fontFamily: 'Georgia' } });
    fireEvent.click(screen.getByLabelText('Reset color run 1'));
    expect(spy).toHaveBeenCalledWith('document.setRunFormat', { runId: 'r1', format: { color: null } });

    // Partial cross-run selection: '😀Hi World' -> UTF-16 [2..7] = code points [1..6] ('Hi ' + 'Wo')
    expect(screen.getByRole('button', { name: 'Range bold' })).toBeDisabled();
    const rangeArea = screen.getByLabelText('Select text range');
    rangeArea.selectionStart = 2;
    rangeArea.selectionEnd = 7;
    fireEvent.select(rangeArea);

    const rangeBold = screen.getByRole('button', { name: 'Range bold' });
    expect(rangeBold).not.toBeDisabled();
    fireEvent.click(rangeBold);
    expect(spy).toHaveBeenLastCalledWith('document.setRunRangeFormat', {
      objectId: 't-cross',
      range: {
        start: { paragraphId: 'p1', runId: 'r1', offset: 1 },
        end: { paragraphId: 'p1', runId: 'r2', offset: 2 },
      },
      format: { bold: true },
    });

    // Transition to readOnly clears range selection & disables controls
    rerender(
      <EditorProvider editor={editor}>
        <PresentationEditor source={source} readOnly />
      </EditorProvider>
    );
    expect(screen.getByRole('button', { name: 'Range bold' })).toBeDisabled();
  });

  it('edits paragraph format & text body layout with Artwork preview and keeps ODP native paragraphs read-only', () => {
    const spy = vi.fn();
    const editor = makeTextTrancheEngine([{
      id: 's1',
      objects: [
        {
          id: 't-auth',
          type: 'text',
          geometry: { x: 72 * PT, y: 72 * PT, width: 300 * PT, height: 120 * PT },
          extensions: { stagecraftAuthored: true },
          text: {
            paragraphs: [{
              id: 'p1',
              runs: [{ id: 'r1', text: 'Item', editable: true, style: { sz: '2400' }, extensions: { stagecraftAuthored: true } }],
            }],
          },
        },
        {
          id: 't-odp-native',
          type: 'text',
          geometry: { x: 72 * PT, y: 220 * PT, width: 300 * PT, height: 100 * PT },
          source: { format: 'odp', part: 'content.xml', path: '0' },
          text: {
            paragraphs: [{
              id: 'p-odp',
              source: { format: 'odp', part: 'content.xml', path: '0/0' },
              runs: [{ id: 'r-odp', text: 'ODP Native', editable: true, source: { format: 'odp' }, style: {} }],
            }],
          },
        },
      ],
    }], { sourceFormat: 'odp' }, spy);
    const source = {
      capabilities: {
        readOnly: false,
        edits: ['existing-run-format', 'paragraph-format', 'text-body-layout'],
      },
      export: vi.fn(),
    };

    render(
      <EditorProvider editor={editor}>
        <PresentationEditor source={source} />
      </EditorProvider>
    );

    // Authored object on ODP doc: paragraph format works; autofit restricts to none/resize (no shrink)
    fireEvent.click(screen.getAllByLabelText('Select object t-auth')[0]);
    const autofit = screen.getByLabelText('Text autofit');
    expect(within(autofit).queryByText('Shrink text')).toBeNull();
    fireEvent.change(autofit, { target: { value: 'resize' } });
    expect(spy).toHaveBeenLastCalledWith('document.setTextBodyLayout', {
      objectId: 't-auth',
      layout: { autofit: 'resize' },
    });

    fireEvent.change(screen.getByLabelText('Paragraph 1 alignment'), { target: { value: 'center' } });
    fireEvent.change(screen.getByLabelText('Paragraph 1 bullet'), { target: { value: 'char:•' } });
    expect(spy).toHaveBeenLastCalledWith('document.setParagraphFormat', {
      paragraphId: 'p1',
      format: { bullet: { type: 'char', char: '•' } },
    });

    const canvas = screen.getByLabelText('Slide canvas');
    expect(within(canvas).getByText('•')).toBeTruthy();

    // Native ODP paragraph stays strictly read-only
    fireEvent.click(screen.getAllByLabelText('Select object t-odp-native')[0]);
    expect(screen.getByText('Native ODP paragraph formatting is read-only.')).toBeTruthy();
    expect(screen.getByLabelText('Paragraph 1 alignment')).toBeDisabled();
  });

  it('aligns Artwork/TextBodyLayoutFields with object.bodyLayout, supports indents/insets, and resets drafts on revision change', () => {
    const spy = vi.fn();
    const editor = makeTextTrancheEngine([{
      id: 's1',
      objects: [{
        id: 't-pptx',
        type: 'text',
        geometry: { x: 72 * PT, y: 72 * PT, width: 300 * PT, height: 120 * PT },
        extensions: { stagecraftAuthored: true },
        text: {
          paragraphs: [{
            id: 'p1',
            runs: [{ id: 'r1', text: 'Body', editable: true, style: { sz: '2400' }, extensions: { stagecraftAuthored: true } }],
          }],
        },
      }],
    }], undefined, spy);
    const source = {
      capabilities: {
        readOnly: false,
        edits: ['paragraph-format', 'text-body-layout'],
      },
      export: vi.fn(),
    };

    render(
      <EditorProvider editor={editor}>
        <PresentationEditor source={source} />
      </EditorProvider>
    );

    fireEvent.click(screen.getAllByLabelText('Select object t-pptx')[0]);
    fireEvent.change(screen.getByLabelText('Text vertical anchor'), { target: { value: 'middle' } });
    expect(editor.getSnapshot().document.slides[0].objects[0].bodyLayout).toEqual({ anchor: 'middle' });
    const canvasObj = screen.getByLabelText('Slide canvas').querySelector('[data-object-id="t-pptx"] .stagecraft-presentation-object');
    expect(canvasObj.style.justifyContent).toBe('center');

    // Insets & indents
    const insetLeft = screen.getByLabelText('Text inset left');
    fireEvent.focus(insetLeft);
    fireEvent.change(insetLeft, { target: { value: '10' } });
    fireEvent.blur(insetLeft);
    expect(spy).toHaveBeenLastCalledWith('document.setTextBodyLayout', {
      objectId: 't-pptx',
      layout: { insets: { left: 10 * PT } },
    });

    const indentStart = screen.getByLabelText('Paragraph 1 indentStart');
    fireEvent.focus(indentStart);
    fireEvent.change(indentStart, { target: { value: '12' } });
    fireEvent.blur(indentStart);
    expect(spy).toHaveBeenLastCalledWith('document.setParagraphFormat', {
      paragraphId: 'p1',
      format: { indentStart: 12 * PT },
    });

    // Unrelated revision bump resets uncommitted paragraph numeric draft
    const sb = screen.getByLabelText('Paragraph 1 space before');
    fireEvent.focus(sb);
    fireEvent.change(sb, { target: { value: '24' } });
    expect(sb).toHaveValue(24);
    act(() => {
      editor.dispatch('document.setTextBodyLayout', { objectId: 't-pptx', layout: { wrap: 'none' } });
    });
    expect(screen.getByLabelText('Paragraph 1 space before')).toHaveValue(null);
  });

  it('prefers live run.style typeface/color over imported pptxAppearance and invalidates range selection on unrelated revision', () => {
    const editor = makeTextTrancheEngine([{
      id: 's1',
      objects: [{
        id: 't-live',
        type: 'text',
        geometry: { x: 72 * PT, y: 72 * PT, width: 300 * PT, height: 120 * PT },
        extensions: { stagecraftAuthored: true },
        text: {
          paragraphs: [{
            id: 'p1',
            runs: [{
              id: 'r1',
              text: 'LiveStyle',
              editable: true,
              style: { sz: '2400', typeface: 'Mono', color: '#aa0000' },
              extensions: {
                stagecraftAuthored: true,
                pptxAppearance: { fontFamily: 'OldFont', color: '#0000ff' },
              },
            }],
          }],
        },
      }],
    }]);
    const source = {
      capabilities: { readOnly: false, edits: ['run-range-format', 'text-body-layout'] },
      export: vi.fn(),
    };

    render(
      <EditorProvider editor={editor}>
        <PresentationEditor source={source} />
      </EditorProvider>
    );

    const r1Span = screen.getByLabelText('Slide canvas').querySelector('[data-run-id="r1"]');
    expect(r1Span.style.color).toBe('rgb(170, 0, 0)');
    expect(r1Span.style.fontFamily).toContain('Mono');

    fireEvent.click(screen.getAllByLabelText('Select object t-live')[0]);
    const rangeArea = screen.getByLabelText('Select text range');
    rangeArea.selectionStart = 0;
    rangeArea.selectionEnd = 4;
    fireEvent.select(rangeArea);
    expect(screen.getByRole('button', { name: 'Range bold' })).not.toBeDisabled();

    // Unrelated revision bump re-maps range selection with fresh startRevision instead of disabling
    act(() => {
      editor.dispatch('document.setTextBodyLayout', { objectId: 't-live', layout: { autofit: 'none' } });
    });
    expect(screen.getByRole('button', { name: 'Range bold' })).not.toBeDisabled();
  });

  it('numbers contiguous matching list items starting at 1 by level, supports bullet {type:none}, and discloses autofit preview', () => {
    const spy = vi.fn();
    const editor = makeTextTrancheEngine([{
      id: 's1',
      objects: [{
        id: 't-list',
        type: 'text',
        geometry: { x: 72 * PT, y: 72 * PT, width: 320 * PT, height: 180 * PT },
        extensions: { stagecraftAuthored: true },
        text: {
          paragraphs: [
            { id: 'p0', runs: [{ id: 'r0', text: 'Title', editable: true, style: { sz: '2400' }, extensions: { stagecraftAuthored: true } }] },
            { id: 'p1', style: { bullet: { type: 'char', char: '•' } }, runs: [{ id: 'r1', text: 'Bullet', editable: true, style: { sz: '2000' }, extensions: { stagecraftAuthored: true } }] },
            { id: 'p2', style: { bullet: { type: 'number', format: 'arabicPeriod' }, level: 0 }, runs: [{ id: 'r2', text: 'First', editable: true, style: { sz: '2000' }, extensions: { stagecraftAuthored: true } }] },
            { id: 'p3', style: { bullet: { type: 'number', format: 'lowerAlphaPeriod' }, level: 1 }, runs: [{ id: 'r3', text: 'SubFirst', editable: true, style: { sz: '2000' }, extensions: { stagecraftAuthored: true } }] },
            { id: 'p4', style: { bullet: { type: 'number', format: 'arabicPeriod' }, level: 0 }, runs: [{ id: 'r4', text: 'Second', editable: true, style: { sz: '2000' }, extensions: { stagecraftAuthored: true } }] },
          ],
        },
      }],
    }], undefined, spy);
    const source = {
      capabilities: { readOnly: false, edits: ['paragraph-format', 'text-body-layout'] },
      export: vi.fn(),
    };

    render(
      <EditorProvider editor={editor}>
        <PresentationEditor source={source} />
      </EditorProvider>
    );

    const canvas = screen.getByLabelText('Slide canvas');
    const markers = [...canvas.querySelectorAll('.stagecraft-presentation-bullet')].map(el => el.textContent.trim());
    expect(markers).toEqual(['•', '1.', 'a.', '2.']);

    fireEvent.click(screen.getAllByLabelText('Select object t-list')[0]);
    expect(screen.getByText(/Autofit settings are saved for export/i)).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Paragraph 1 bullet'), { target: { value: 'none' } });
    expect(spy).toHaveBeenLastCalledWith('document.setParagraphFormat', {
      paragraphId: 'p0',
      format: { bullet: { type: 'none' } },
    });
  });

  it('shows Reset color button for run.style.color:null sentinel and dispatches { color: null }', () => {
    const spy = vi.fn();
    const editor = makeTextTrancheEngine([{
      id: 's1',
      objects: [{
        id: 't-sentinel',
        type: 'text',
        geometry: { x: 72 * PT, y: 72 * PT, width: 300 * PT, height: 120 * PT },
        text: {
          paragraphs: [{
            id: 'p1',
            runs: [{
              id: 'r1',
              text: 'ThemeColor',
              editable: true,
              source: { format: 'pptx' },
              style: { color: null },
            }],
          }],
        },
      }],
    }], undefined, spy);
    const source = {
      capabilities: { readOnly: false, edits: ['existing-run-format'] },
      export: vi.fn(),
    };

    render(
      <EditorProvider editor={editor}>
        <PresentationEditor source={source} />
      </EditorProvider>
    );

    fireEvent.click(screen.getAllByLabelText('Select object t-sentinel')[0]);
    const resetBtn = screen.getByRole('button', { name: 'Reset color run 1' });
    fireEvent.click(resetBtn);
    expect(spy).toHaveBeenLastCalledWith('document.setRunFormat', {
      runId: 'r1',
      format: { color: null },
    });
  });

  it.each(['authored', 'native'])('cancels stale %s RunFormatControls font+size drafts on unrelated revision, readOnly, and same-runId source switch', kind => {
    const spy = vi.fn();
    const doc1 = {
      id: 's1',
      objects: [{
        id: 't1',
        type: 'text',
        geometry: { x: 72 * PT, y: 72 * PT, width: 300 * PT, height: 120 * PT },
        extensions: { stagecraftAuthored: true },
        text: {
          paragraphs: [{
            id: 'p1',
            runs: [{ id: 'r1', text: 'One', editable: true, style: { sz: '2400', typeface: 'Inter' }, extensions: { stagecraftAuthored: true } }],
          }],
        },
      }],
    };
    if (kind === 'native') {
      delete doc1.objects[0].extensions.stagecraftAuthored;
      doc1.objects[0].source = { format: 'pptx' };
      doc1.objects[0].text.paragraphs[0].runs[0].source = { format: 'pptx' };
      delete doc1.objects[0].text.paragraphs[0].runs[0].extensions.stagecraftAuthored;
    }
    const editor = makeTextTrancheEngine([doc1], undefined, spy);
    const source1 = { capabilities: { readOnly: false, edits: ['existing-run-format', 'text-body-layout'] }, export: vi.fn() };
    const source2 = { capabilities: { readOnly: false, edits: ['existing-run-format', 'text-body-layout'] }, export: vi.fn() };

    const { rerender } = render(
      <EditorProvider editor={editor}>
        <PresentationEditor source={source1} />
      </EditorProvider>
    );

    fireEvent.click(screen.getAllByLabelText('Select object t1')[0]);

    // 1. Unrelated revision bump resets font + size drafts
    const fontInput = screen.getByLabelText('Font family run 1');
    const sizeInput = screen.getByLabelText('Font size run 1');
    fireEvent.focus(fontInput);
    fireEvent.change(fontInput, { target: { value: 'StaleFont' } });
    fireEvent.focus(sizeInput);
    fireEvent.change(sizeInput, { target: { value: '77' } });
    const revBefore = editor.getSnapshot().revision;
    act(() => {
      editor.dispatch('document.setTextBodyLayout', { objectId: 't1', layout: { autofit: 'none' } });
    });
    expect(editor.getSnapshot().revision).toBe(revBefore + 1);
    expect(screen.getByLabelText('Font family run 1')).toHaveValue('Inter');
    expect(screen.getByLabelText('Font size run 1')).toHaveValue(24);

    // 2. readOnly transition resets font + size drafts
    fireEvent.change(screen.getByLabelText('Font family run 1'), { target: { value: 'DraftRO' } });
    fireEvent.change(screen.getByLabelText('Font size run 1'), { target: { value: '88' } });
    rerender(
      <EditorProvider editor={editor}>
        <PresentationEditor source={source1} readOnly />
      </EditorProvider>
    );
    expect(screen.getByLabelText('Font family run 1')).toHaveValue('Inter');
    expect(screen.getByLabelText('Font size run 1')).toHaveValue(24);

    // 3. Same-runId source switch resets font + size drafts
    rerender(
      <EditorProvider editor={editor}>
        <PresentationEditor source={source1} readOnly={false} />
      </EditorProvider>
    );
    fireEvent.change(screen.getByLabelText('Font family run 1'), { target: { value: 'DraftSrc' } });
    fireEvent.change(screen.getByLabelText('Font size run 1'), { target: { value: '99' } });
    rerender(
      <EditorProvider editor={editor}>
        <PresentationEditor source={source2} readOnly={false} />
      </EditorProvider>
    );
    fireEvent.click(screen.getAllByLabelText('Select object t1')[0]);
    expect(screen.getByLabelText('Font family run 1')).toHaveValue('Inter');
    expect(screen.getByLabelText('Font size run 1')).toHaveValue(24);
  });

  it('clears level atomically in the same setParagraphFormat command when removing bullet at level > 0 in ODP', () => {
    const doc = createDocument({
      id: 'odp-list-deck',
      extensions: { sourceFormat: 'odp' },
      slides: [{
        id: 's1',
        objects: [{
          id: 't-odp-auth',
          type: 'text',
          geometry: { x: 72 * PT, y: 72 * PT, width: 300 * PT, height: 120 * PT },
          extensions: { stagecraftAuthored: true },
          text: {
            paragraphs: [{
              id: 'p1',
              style: { level: 2, bullet: { type: 'char', char: '•' } },
              runs: [{ id: 'r1', text: 'Nested item', editable: true, style: {}, extensions: { stagecraftAuthored: true } }],
            }],
          },
        }],
      }],
    });
    const editor = createEditor({ document: doc, plugins: [documentPlugin, presentationPlugin] });
    const source = {
      capabilities: { readOnly: false, edits: ['paragraph-format'] },
      export: vi.fn(),
    };

    render(
      <EditorProvider editor={editor}>
        <PresentationEditor source={source} />
      </EditorProvider>
    );

    fireEvent.click(screen.getAllByLabelText('Select object t-odp-auth')[0]);
    fireEvent.change(screen.getByLabelText('Paragraph 1 bullet'), { target: { value: 'none' } });

    expect(screen.queryByRole('alert')).toBeNull();
    const style = editor.getSnapshot().document.slides[0].objects[0].text.paragraphs[0].style;
    expect(style.bullet).toEqual({ type: 'none' });
    expect(style.level).toBeUndefined();
  });

  it('preserves level when selecting a real bullet in ODP, removing bullet in PPTX, or removing bullet at level 0 in ODP', () => {
    const makeDoc = (sourceFormat, level) => createDocument({
      id: `list-${sourceFormat}-${level}`,
      extensions: { sourceFormat },
      slides: [{
        id: 's1',
        objects: [{
          id: 't-list',
          type: 'text',
          geometry: { x: 72 * PT, y: 72 * PT, width: 300 * PT, height: 120 * PT },
          extensions: { stagecraftAuthored: true },
          text: {
            paragraphs: [{
              id: 'p1',
              style: { level, bullet: { type: 'char', char: '•' } },
              runs: [{ id: 'r1', text: 'Item', editable: true, style: {}, extensions: { stagecraftAuthored: true } }],
            }],
          },
        }],
      }],
    });

    // 1. ODP real bullet at level 2 keeps level 2
    const odpReal = createEditor({ document: makeDoc('odp', 2), plugins: [documentPlugin, presentationPlugin] });
    const odpSource = { capabilities: { readOnly: false, edits: ['paragraph-format'] }, export: vi.fn() };
    const { unmount: u1 } = render(<EditorProvider editor={odpReal}><PresentationEditor source={odpSource} /></EditorProvider>);
    fireEvent.click(screen.getAllByLabelText('Select object t-list')[0]);
    fireEvent.change(screen.getByLabelText('Paragraph 1 bullet'), { target: { value: 'number:arabicPeriod' } });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(odpReal.getSnapshot().document.slides[0].objects[0].text.paragraphs[0].style).toEqual({
      level: 2,
      bullet: { type: 'number', format: 'arabicPeriod' },
    });
    u1();

    // 2. PPTX bullet removal at level 2 keeps level 2
    const pptxNone = createEditor({ document: makeDoc('pptx', 2), plugins: [documentPlugin, presentationPlugin] });
    const pptxSource = { capabilities: { readOnly: false, edits: ['paragraph-format'] }, export: vi.fn() };
    const { unmount: u2 } = render(<EditorProvider editor={pptxNone}><PresentationEditor source={pptxSource} /></EditorProvider>);
    fireEvent.click(screen.getAllByLabelText('Select object t-list')[0]);
    fireEvent.change(screen.getByLabelText('Paragraph 1 bullet'), { target: { value: 'none' } });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(pptxNone.getSnapshot().document.slides[0].objects[0].text.paragraphs[0].style).toEqual({
      level: 2,
      bullet: { type: 'none' },
    });
    u2();

    // 3. ODP bullet removal at level 0 succeeds
    const odpLevel0 = createEditor({ document: makeDoc('odp', 0), plugins: [documentPlugin, presentationPlugin] });
    render(<EditorProvider editor={odpLevel0}><PresentationEditor source={odpSource} /></EditorProvider>);
    fireEvent.click(screen.getAllByLabelText('Select object t-list')[0]);
    fireEvent.change(screen.getByLabelText('Paragraph 1 bullet'), { target: { value: 'none' } });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(odpLevel0.getSnapshot().document.slides[0].objects[0].text.paragraphs[0].style).toEqual({
      level: 0,
      bullet: { type: 'none' },
    });
  });

  it('maps normalized textarea CRLF selection boundaries back to canonical run code-point offsets for CRLF, surrogate pairs, and cross-paragraph ranges', () => {
    const doc = createDocument({
      id: 'crlf-range-deck',
      slides: [{
        id: 's1',
        objects: [
          {
            id: 't-crlf-in-run',
            type: 'text',
            geometry: { x: 72 * PT, y: 72 * PT, width: 300 * PT, height: 120 * PT },
            extensions: { stagecraftAuthored: true },
            text: {
              paragraphs: [{
                id: 'p1',
                runs: [{ id: 'r1', text: 'A\r\nB', editable: true, style: {}, extensions: { stagecraftAuthored: true } }],
              }],
            },
          },
          {
            id: 't-crlf-boundary',
            type: 'text',
            geometry: { x: 72 * PT, y: 200 * PT, width: 300 * PT, height: 120 * PT },
            extensions: { stagecraftAuthored: true },
            text: {
              paragraphs: [{
                id: 'p2',
                runs: [
                  { id: 'rb1', text: 'X\r', editable: true, style: {}, extensions: { stagecraftAuthored: true } },
                  { id: 'rb2', text: '\nYZ', editable: true, style: {}, extensions: { stagecraftAuthored: true } },
                ],
              }],
            },
          },
          {
            id: 't-surrogate-cross',
            type: 'text',
            geometry: { x: 72 * PT, y: 340 * PT, width: 300 * PT, height: 120 * PT },
            extensions: { stagecraftAuthored: true },
            text: {
              paragraphs: [
                {
                  id: 'ps1',
                  runs: [{ id: 'rs1', text: '😀A', editable: true, style: {}, extensions: { stagecraftAuthored: true } }],
                },
                {
                  id: 'ps2',
                  runs: [{ id: 'rs2', text: 'B😀C', editable: true, style: {}, extensions: { stagecraftAuthored: true } }],
                },
              ],
            },
          },
        ],
      }],
    });
    const editor = createEditor({ document: doc, plugins: [documentPlugin, presentationPlugin] });
    const source = { capabilities: { readOnly: false, edits: ['run-range-format'] }, export: vi.fn() };

    render(
      <EditorProvider editor={editor}>
        <PresentationEditor source={source} />
      </EditorProvider>
    );

    // 1. CRLF inside a run: 'A\r\nB' -> textarea displays 'A\nB', selecting [2, 3) selects 'B'
    fireEvent.click(screen.getAllByLabelText('Select object t-crlf-in-run')[0]);
    let rangeArea = screen.getByLabelText('Select text range');
    rangeArea.selectionStart = 2;
    rangeArea.selectionEnd = 3;
    fireEvent.select(rangeArea);
    fireEvent.click(screen.getByRole('button', { name: 'Range bold' }));
    expect(screen.queryByRole('alert')).toBeNull();
    const runsInRun = editor.getSnapshot().document.slides[0].objects[0].text.paragraphs[0].runs;
    expect(runsInRun.map(r => [r.text, r.style.b])).toEqual([['A\r\n', undefined], ['B', '1']]);

    // 2. CRLF across a run boundary: 'X\r' + '\nYZ' -> textarea displays 'X\nYZ', selecting [2, 4) selects 'YZ'
    fireEvent.click(screen.getAllByLabelText('Select object t-crlf-boundary')[0]);
    rangeArea = screen.getByLabelText('Select text range');
    rangeArea.selectionStart = 2;
    rangeArea.selectionEnd = 4;
    fireEvent.select(rangeArea);
    fireEvent.click(screen.getByRole('button', { name: 'Range bold' }));
    expect(screen.queryByRole('alert')).toBeNull();
    const runsBoundary = editor.getSnapshot().document.slides[0].objects[1].text.paragraphs[0].runs;
    expect(runsBoundary.map(r => [r.text, r.style.b])).toEqual([['X\r', undefined], ['\n', undefined], ['YZ', '1']]);

    // 3. Surrogate pairs + cross-paragraph: '😀A\nB😀C' -> UTF-16 [2, 5) selects 'A\nB'
    fireEvent.click(screen.getAllByLabelText('Select object t-surrogate-cross')[0]);
    rangeArea = screen.getByLabelText('Select text range');
    rangeArea.selectionStart = 2;
    rangeArea.selectionEnd = 5;
    fireEvent.select(rangeArea);
    fireEvent.click(screen.getByRole('button', { name: 'Range bold' }));
    expect(screen.queryByRole('alert')).toBeNull();
    const crossParas = editor.getSnapshot().document.slides[0].objects[2].text.paragraphs;
    expect(crossParas[0].runs.map(r => [r.text, r.style.b])).toEqual([['😀', undefined], ['A', '1']]);
    expect(crossParas[1].runs.map(r => [r.text, r.style.b])).toEqual([['B', '1'], ['😀C', undefined]]);
  });

  it('maps CR before paragraph separator, lone CR, and leading/trailing/consecutive empty paragraphs on select-all', () => {
    const makeObj = (id, paraTexts) => ({
      id,
      type: 'text',
      geometry: { x: 72 * PT, y: 72 * PT, width: 300 * PT, height: 120 * PT },
      extensions: { stagecraftAuthored: true },
      text: {
        paragraphs: paraTexts.map((txt, idx) => ({
          id: `${id}-p${idx}`,
          runs: [{ id: `${id}-r${idx}`, text: txt, editable: true, style: {}, extensions: { stagecraftAuthored: true } }],
        })),
      },
    });
    const doc = createDocument({
      id: 'edge-range-deck',
      slides: [{
        id: 's1',
        objects: [
          makeObj('t-cr-sep', ['A\r', 'B']),
          makeObj('t-lone-cr', ['CD\rE']),
          makeObj('t-trail-empty', ['E1', '']),
          makeObj('t-lead-empty', ['', 'F']),
          makeObj('t-consec-empty', ['', '', 'G', '', '']),
        ],
      }],
    });
    const editor = createEditor({ document: doc, plugins: [documentPlugin, presentationPlugin] });
    const source = { capabilities: { readOnly: false, edits: ['run-range-format'] }, export: vi.fn() };

    render(
      <EditorProvider editor={editor}>
        <PresentationEditor source={source} />
      </EditorProvider>
    );

    const selectAndBold = (objId, start, end) => {
      fireEvent.click(screen.getAllByLabelText(`Select object ${objId}`)[0]);
      const rangeArea = screen.getByLabelText('Select text range');
      rangeArea.selectionStart = start;
      rangeArea.selectionEnd = end;
      fireEvent.select(rangeArea);
      const btn = screen.getByRole('button', { name: 'Range bold' });
      expect(btn).not.toBeDisabled();
      fireEvent.click(btn);
      expect(screen.queryByRole('alert')).toBeNull();
    };

    // 1. CR at paragraph end before synthetic separator: ['A\r', 'B'] -> displays 'A\nB', [2, 3) selects 'B'
    selectAndBold('t-cr-sep', 2, 3);
    const crSepParas = editor.getSnapshot().document.slides[0].objects[0].text.paragraphs;
    expect(crSepParas[0].runs.map(r => [r.text, r.style.b])).toEqual([['A\r', undefined]]);
    expect(crSepParas[1].runs.map(r => [r.text, r.style.b])).toEqual([['B', '1']]);

    // 2. Lone CR: 'CD\rE' -> displays 'CD\nE', [3, 4) selects 'E'
    selectAndBold('t-lone-cr', 3, 4);
    const loneCrRuns = editor.getSnapshot().document.slides[0].objects[1].text.paragraphs[0].runs;
    expect(loneCrRuns.map(r => [r.text, r.style.b])).toEqual([['CD\r', undefined], ['E', '1']]);

    // 3. Trailing empty paragraph: ['E1', ''] -> displays 'E1\n', select-all [0, 3)
    selectAndBold('t-trail-empty', 0, 3);
    const trailParas = editor.getSnapshot().document.slides[0].objects[2].text.paragraphs;
    expect(trailParas[0].runs.map(r => [r.text, r.style.b])).toEqual([['E1', '1']]);

    // 4. Leading empty paragraph: ['', 'F'] -> displays '\nF', select-all [0, 2)
    selectAndBold('t-lead-empty', 0, 2);
    const leadParas = editor.getSnapshot().document.slides[0].objects[3].text.paragraphs;
    expect(leadParas[1].runs.map(r => [r.text, r.style.b])).toEqual([['F', '1']]);

    // 5. Consecutive leading & trailing empty paragraphs: ['', '', 'G', '', ''] -> displays '\n\nG\n\n', select-all [0, 5)
    selectAndBold('t-consec-empty', 0, 5);
    const consecParas = editor.getSnapshot().document.slides[0].objects[4].text.paragraphs;
    expect(consecParas[2].runs.map(r => [r.text, r.style.b])).toEqual([['G', '1']]);
  });

  it('hides body-layout controls on textless inserted shapes while keeping them on shapes with text', () => {
    const doc = createDocument({
      id: 'shape-layout-deck',
      slides: [{
        id: 's1',
        objects: [{
          id: 'shape-with-text',
          type: 'shape',
          geometry: { x: 72 * PT, y: 72 * PT, width: 200 * PT, height: 100 * PT },
          shape: 'rect',
          fill: '#4472c4',
          extensions: { stagecraftAuthored: true },
          text: {
            paragraphs: [{
              id: 'p1',
              runs: [{ id: 'r1', text: 'Label', editable: true, style: {}, extensions: { stagecraftAuthored: true } }],
            }],
          },
        }],
      }],
    });
    const editor = createEditor({ document: doc, plugins: [documentPlugin, presentationPlugin] });
    const source = {
      capabilities: { readOnly: false, edits: ['object-structure', 'text-body-layout'] },
      export: vi.fn(),
    };

    render(
      <EditorProvider editor={editor}>
        <PresentationEditor source={source} />
      </EditorProvider>
    );

    // Shape with text exposes Text autofit and commits via real document.setTextBodyLayout
    fireEvent.click(screen.getAllByLabelText('Select object shape-with-text')[0]);
    expect(screen.getByLabelText('Text autofit')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Text autofit'), { target: { value: 'resize' } });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(editor.getSnapshot().document.slides[0].objects[0].bodyLayout).toEqual({ autofit: 'resize' });

    // Inserting a textless Rectangle does NOT expose Text body layout controls
    fireEvent.click(screen.getByRole('tab', { name: 'Insert' }));
    fireEvent.click(screen.getByRole('button', { name: 'Rectangle' }));
    const insertedRect = editor.getSnapshot().document.slides[0].objects.find(o => o.id !== 'shape-with-text');
    expect(insertedRect.text).toBeUndefined();
    expect(screen.queryByLabelText('Text autofit')).toBeNull();
  });

  it('discloses the PowerPoint autofit limitation for shrink and resize, but not for none/inherit or ODP', () => {
    const doc = createDocument({
      id: 'autofit-hint-deck',
      slides: [{
        id: 's1',
        objects: [{
          id: 'shape-with-text',
          type: 'text',
          geometry: { x: 72 * PT, y: 72 * PT, width: 300 * PT, height: 100 * PT },
          extensions: { stagecraftAuthored: true },
          bodyLayout: { autofit: 'shrink' },
          text: { paragraphs: [{ id: 'p1', runs: [{ id: 'r1', text: 'Hello', editable: true, style: { sz: '2400' }, extensions: { stagecraftAuthored: true } }] }] },
        }],
      }],
    });
    const editor = createEditor({ document: doc, plugins: [documentPlugin, presentationPlugin] });
    const source = { capabilities: { readOnly: false, edits: ['text-body-layout'] }, export: vi.fn() };
    const view = render(<EditorProvider editor={editor}><PresentationEditor source={source} /></EditorProvider>);
    fireEvent.click(screen.getAllByLabelText('Select object shape-with-text')[0]);
    expect(screen.getByText('PowerPoint applies shrink-to-fit when the text is next edited there. Exports from this editor include a measured fit; files exported elsewhere may overflow when first opened.')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Text autofit'), { target: { value: 'resize' } });
    expect(screen.getByText(/PowerPoint resizes the shape to fit the text when it is next edited there/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Text autofit'), { target: { value: 'none' } });
    expect(screen.queryByText(/PowerPoint applies shrink-to-fit/)).toBeNull();
    expect(screen.queryByText(/PowerPoint resizes the shape to fit the text when it is next edited there/)).toBeNull();

    fireEvent.change(screen.getByLabelText('Text autofit'), { target: { value: '' } });
    expect(screen.queryByText(/PowerPoint applies shrink-to-fit/)).toBeNull();
    expect(screen.queryByText(/PowerPoint resizes the shape to fit the text when it is next edited there/)).toBeNull();

    // ODP: shrink is unsupported and no PowerPoint hint is shown.
    const odpDoc = createDocument({
      id: 'odp-hint-deck',
      extensions: { sourceFormat: 'odp' },
      slides: [{
        id: 's1',
        objects: [{
          id: 'shape-with-text',
          type: 'text',
          geometry: { x: 72 * PT, y: 72 * PT, width: 300 * PT, height: 100 * PT },
          extensions: { stagecraftAuthored: true },
          bodyLayout: { autofit: 'resize' },
          text: { paragraphs: [{ id: 'p1', runs: [{ id: 'r1', text: 'Hello', editable: true, style: { sz: '2400' }, extensions: { stagecraftAuthored: true } }] }] },
        }],
      }],
    });
    const odpEditor = createEditor({ document: odpDoc, plugins: [documentPlugin, presentationPlugin] });
    const odpSource = { capabilities: { readOnly: false, edits: ['text-body-layout'] }, export: vi.fn() };
    view.unmount();
    render(<EditorProvider editor={odpEditor}><PresentationEditor source={odpSource} /></EditorProvider>);
    fireEvent.click(screen.getByLabelText('Select object shape-with-text'));
    expect(screen.queryByText(/PowerPoint applies shrink-to-fit/)).toBeNull();
    expect(screen.queryByText(/PowerPoint resizes the shape to fit the text when it is next edited there/)).toBeNull();
  });

  it('commits range color on change (including #000000), preserves selection across Bold->Italic->Unbold->Reset, and shows canonical code-point label after CR', () => {
    const doc = createDocument({
      id: 'range-ux-deck',
      slides: [{
        id: 's1',
        objects: [{
          id: 't-ux',
          type: 'text',
          geometry: { x: 72 * PT, y: 72 * PT, width: 300 * PT, height: 120 * PT },
          extensions: { stagecraftAuthored: true },
          text: {
            paragraphs: [{
              id: 'p1',
              runs: [{ id: 'r1', text: 'A\r\nB', editable: true, style: {}, extensions: { stagecraftAuthored: true } }],
            }],
          },
        }],
      }],
    });
    const editor = createEditor({ document: doc, plugins: [documentPlugin, presentationPlugin] });
    const source = { capabilities: { readOnly: false, edits: ['run-range-format'] }, export: vi.fn() };

    const { rerender } = render(
      <EditorProvider editor={editor}>
        <PresentationEditor source={source} />
      </EditorProvider>
    );

    fireEvent.click(screen.getAllByLabelText('Select object t-ux')[0]);
    const rangeArea = screen.getByLabelText('Select text range');
    rangeArea.selectionStart = 2;
    rangeArea.selectionEnd = 3;
    fireEvent.select(rangeArea);

    // Canonical code-point label: 'A'(0), '\r'(1), '\n'(2), 'B'(3..4)
    expect(screen.getByText('Selected code points 3–4')).toBeTruthy();

    // Sequential actions work without reselecting
    fireEvent.click(screen.getByRole('button', { name: 'Range bold' }));
    expect(editor.getSnapshot().document.slides[0].objects[0].text.paragraphs[0].runs[1].style.b).toBe('1');
    fireEvent.click(screen.getByRole('button', { name: 'Range italic' }));
    expect(editor.getSnapshot().document.slides[0].objects[0].text.paragraphs[0].runs[1].style.i).toBe('1');
    fireEvent.click(screen.getByRole('button', { name: 'Range unitalic' }));
    expect(editor.getSnapshot().document.slides[0].objects[0].text.paragraphs[0].runs[1].style.i).toBe('0');
    fireEvent.click(screen.getByRole('button', { name: 'Range reset italic' }));
    expect(editor.getSnapshot().document.slides[0].objects[0].text.paragraphs[0].runs[1].style.i).toBeUndefined();
    fireEvent.click(screen.getByRole('button', { name: 'Range unbold' }));
    expect(editor.getSnapshot().document.slides[0].objects[0].text.paragraphs[0].runs[1].style.b).toBe('0');
    fireEvent.click(screen.getByRole('button', { name: 'Range reset bold' }));
    expect(editor.getSnapshot().document.slides[0].objects[0].text.paragraphs[0].runs[1].style.b).toBeUndefined();

    // Color picker is a pure local draft; Apply colour button commits (including #000000)
    const revBeforeColor = editor.getSnapshot().revision;
    const colorInput = screen.getByLabelText('Range color');
    fireEvent.input(colorInput, { target: { value: '#112233' } });
    fireEvent.change(colorInput, { target: { value: '#000000' } });
    expect(editor.getSnapshot().revision).toBe(revBeforeColor);
    fireEvent.click(screen.getByRole('button', { name: 'Range apply colour' }));
    expect(editor.getSnapshot().revision).toBe(revBeforeColor + 1);
    expect(editor.getSnapshot().document.slides[0].objects[0].text.paragraphs[0].runs[1].style.color).toBe('#000000');

    // Stale-draft safety: readOnly clears range selection
    rerender(
      <EditorProvider editor={editor}>
        <PresentationEditor source={source} readOnly />
      </EditorProvider>
    );
    expect(screen.getByRole('button', { name: 'Range bold' })).toBeDisabled();
  });

  it('renders dynamic bullet option, ODP shrink (unsupported) option, isOdpDoc precedence, and non-pptx native read-only paragraphs', () => {
    const doc = createDocument({
      id: 'review-meta-deck',
      extensions: { sourceFormat: 'odp' },
      slides: [{
        id: 's1',
        objects: [
          {
            id: 't-odp-shrink',
            type: 'text',
            geometry: { x: 72 * PT, y: 72 * PT, width: 300 * PT, height: 120 * PT },
            extensions: { stagecraftAuthored: true },
            bodyLayout: { autofit: 'shrink' },
            text: {
              paragraphs: [{
                id: 'p-dash',
                style: { bullet: { type: 'char', char: '–' } },
                runs: [{ id: 'r-dash', text: 'Dash', editable: true, style: {}, extensions: { stagecraftAuthored: true } }],
              }],
            },
          },
          {
            id: 't-pptx-in-odp',
            type: 'text',
            geometry: { x: 72 * PT, y: 200 * PT, width: 300 * PT, height: 120 * PT },
            source: { format: 'pptx', part: 'ppt/slides/slide1.xml', path: [0] },
            text: {
              paragraphs: [{
                id: 'p-pptx',
                source: { format: 'pptx', part: 'ppt/slides/slide1.xml', path: [0, 0] },
                style: { level: 2, bullet: { type: 'char', char: '•' } },
                runs: [{ id: 'r-pptx', text: 'PPTX', editable: true, source: { format: 'pptx', part: 'ppt/slides/slide1.xml', path: [0, 0, 0] }, style: {} }],
              }],
            },
          },
          {
            id: 't-unknown-native',
            type: 'text',
            geometry: { x: 72 * PT, y: 340 * PT, width: 300 * PT, height: 120 * PT },
            source: { format: 'pptx', part: 'ppt/slides/slide1.xml', path: [1] },
            text: {
              paragraphs: [{
                id: 'p-unk',
                runs: [{ id: 'r-unk', text: 'Unknown', editable: false, style: {} }],
              }],
            },
          },
        ],
      }],
    });
    const editor = createEditor({ document: doc, plugins: [documentPlugin, presentationPlugin] });
    const source = {
      capabilities: { readOnly: false, edits: ['paragraph-format', 'text-body-layout'] },
      export: vi.fn(),
    };

    render(
      <EditorProvider editor={editor}>
        <PresentationEditor source={source} />
      </EditorProvider>
    );

    // 1. Dynamic bullet option + ODP autofit 'shrink' shown as disabled "Shrink (unsupported)" + real core commits
    fireEvent.click(screen.getAllByLabelText('Select object t-odp-shrink')[0]);
    const bulletSelect = screen.getByLabelText('Paragraph 1 bullet');
    expect(bulletSelect).toHaveValue('char:–');
    expect(within(bulletSelect).getByRole('option', { name: 'Bullet (–)' })).toBeTruthy();
    fireEvent.change(bulletSelect, { target: { value: 'none' } });
    expect(editor.getSnapshot().document.slides[0].objects[0].text.paragraphs[0].style.bullet).toEqual({ type: 'none' });

    const autofitSelect = screen.getByLabelText('Text autofit');
    expect(autofitSelect).toHaveValue('shrink');
    const shrinkOpt = within(autofitSelect).getByRole('option', { name: 'Shrink (unsupported)' });
    expect(shrinkOpt).toBeDisabled();
    fireEvent.change(autofitSelect, { target: { value: '' } });
    expect(editor.getSnapshot().document.slides[0].objects[0].bodyLayout).toBeUndefined();

    // 2. isOdpDoc precedence: object.source.format === 'pptx' overrides doc.extensions.sourceFormat === 'odp'
    fireEvent.click(screen.getAllByLabelText('Select object t-pptx-in-odp')[0]);
    expect(screen.getByLabelText('Text wrap')).toBeTruthy();
    expect(screen.getByLabelText('Paragraph 1 alignment')).not.toBeDisabled();
    fireEvent.change(screen.getByLabelText('Paragraph 1 bullet'), { target: { value: 'none' } });
    expect(editor.getSnapshot().document.slides[0].objects[1].text.paragraphs[0].style).toEqual({
      level: 2,
      bullet: { type: 'none' },
    });
    fireEvent.change(screen.getByLabelText('Paragraph 1 alignment'), { target: { value: 'center' } });
    expect(editor.getSnapshot().document.slides[0].objects[1].text.paragraphs[0].style.alignment).toBe('center');

    // 3. Non-pptx native paragraph (no source.format) is disabled in ParagraphFormatFields with read-only notice
    fireEvent.click(screen.getAllByLabelText('Select object t-unknown-native')[0]);
    expect(screen.getByLabelText('Paragraph 1 alignment')).toBeDisabled();
    expect(screen.getByText('Native paragraph formatting is read-only.')).toBeTruthy();
  });

  it('does not resurrect cleared range selection after readOnly on->off->revision and cancels in-flight range color draft on concurrent revision', () => {
    const doc = createDocument({
      id: 'stale-range-race-deck',
      slides: [{
        id: 's1',
        objects: [{
          id: 't-race',
          type: 'text',
          geometry: { x: 72 * PT, y: 72 * PT, width: 300 * PT, height: 120 * PT },
          extensions: { stagecraftAuthored: true },
          text: {
            paragraphs: [{
              id: 'p1',
              runs: [{ id: 'r1', text: 'Hello', editable: true, style: {}, extensions: { stagecraftAuthored: true } }],
            }],
          },
        }],
      }],
    });
    const editor = createEditor({ document: doc, plugins: [documentPlugin, presentationPlugin] });
    const source = { capabilities: { readOnly: false, edits: ['run-range-format', 'text-body-layout'] }, export: vi.fn() };

    const { rerender } = render(
      <EditorProvider editor={editor}>
        <PresentationEditor source={source} />
      </EditorProvider>
    );

    // 1. readOnly on -> off -> unrelated revision must NOT resurrect cleared range selection
    fireEvent.click(screen.getAllByLabelText('Select object t-race')[0]);
    const rangeArea = screen.getByLabelText('Select text range');
    rangeArea.selectionStart = 1;
    rangeArea.selectionEnd = 4;
    fireEvent.select(rangeArea);
    expect(screen.getByRole('button', { name: 'Range bold' })).not.toBeDisabled();

    rerender(<EditorProvider editor={editor}><PresentationEditor source={source} readOnly /></EditorProvider>);
    expect(screen.getByRole('button', { name: 'Range bold' })).toBeDisabled();

    rerender(<EditorProvider editor={editor}><PresentationEditor source={source} readOnly={false} /></EditorProvider>);
    expect(screen.getByRole('button', { name: 'Range bold' })).toBeDisabled();

    act(() => {
      editor.dispatch('document.setTextBodyLayout', { objectId: 't-race', layout: { autofit: 'none' } });
    });
    expect(screen.getByRole('button', { name: 'Range bold' })).toBeDisabled();

    // 2. Re-arm selection; picker events (focus, pointerdown, input, change) never dispatch without Apply colour
    rangeArea.selectionStart = 0;
    rangeArea.selectionEnd = 4;
    fireEvent.select(rangeArea);
    expect(screen.getByRole('button', { name: 'Range bold' })).not.toBeDisabled();

    const colorInput = screen.getByLabelText('Range color');
    fireEvent.focus(colorInput);
    fireEvent.pointerDown(colorInput);
    fireEvent.input(colorInput, { target: { value: '#112233' } });
    fireEvent.change(colorInput, { target: { value: '#112233' } });
    expect(editor.getSnapshot().revision).toBe(1);

    act(() => {
      editor.dispatch('document.setTextBodyLayout', { objectId: 't-race', layout: { autofit: 'resize' } });
    });
    expect(editor.getSnapshot().revision).toBe(2);

    fireEvent.pointerDown(colorInput);
    fireEvent.focus(colorInput);
    fireEvent.input(colorInput, { target: { value: '#445566' } });
    fireEvent.change(colorInput, { target: { value: '#445566' } });
    expect(editor.getSnapshot().revision).toBe(2);
    expect(editor.getSnapshot().document.slides[0].objects[0].text.paragraphs[0].runs).toHaveLength(1);

    // Explicit Apply colour commits the current draft once at the current revision
    fireEvent.change(colorInput, { target: { value: '#224488' } });
    fireEvent.click(screen.getByRole('button', { name: 'Range apply colour' }));
    expect(editor.getSnapshot().revision).toBe(3);
    expect(editor.getSnapshot().document.slides[0].objects[0].text.paragraphs[0].runs[0].style.color).toBe('#224488');

    // readOnly disables Apply colour
    rerender(<EditorProvider editor={editor}><PresentationEditor source={source} readOnly /></EditorProvider>);
    expect(screen.getByRole('button', { name: 'Range apply colour' })).toBeDisabled();
  });

  it('clears active range selection when fullText changes and renders readable label for unknown number bullet format and read-only native notice', () => {
    // 1. fullText change clears active selection explicitly (real core-backed)
    const doc = createDocument({
      id: 'fulltext-clear-deck',
      slides: [{
        id: 's1',
        objects: [{
          id: 't-ft',
          type: 'text',
          geometry: { x: 72 * PT, y: 72 * PT, width: 300 * PT, height: 120 * PT },
          extensions: { stagecraftAuthored: true },
          text: {
            paragraphs: [{
              id: 'p1',
              runs: [{ id: 'r1', text: 'Hello', editable: true, style: {}, extensions: { stagecraftAuthored: true } }],
            }],
          },
        }],
      }],
    });
    const editor = createEditor({ document: doc, plugins: [documentPlugin, presentationPlugin] });
    const source = { capabilities: { readOnly: false, edits: ['existing-run-text', 'run-range-format'] }, export: vi.fn() };
    const { unmount } = render(
      <EditorProvider editor={editor}>
        <PresentationEditor source={source} />
      </EditorProvider>
    );

    fireEvent.click(screen.getAllByLabelText('Select object t-ft')[0]);
    const rangeArea = screen.getByLabelText('Select text range');
    rangeArea.selectionStart = 1;
    rangeArea.selectionEnd = 4;
    fireEvent.select(rangeArea);
    expect(screen.getByRole('button', { name: 'Range bold' })).not.toBeDisabled();

    // Mutate run text -> fullText changes from 'Hello' to 'Hello world'
    act(() => {
      editor.dispatch('document.setRunText', { runId: 'r1', text: 'Hello world' });
    });
    expect(screen.getByRole('button', { name: 'Range bold' })).toBeDisabled();
    expect(rangeArea.selectionStart).toBe(0);
    expect(rangeArea.selectionEnd).toBe(0);
    unmount();

    // 2. Unknown number: bullet format renders readable label ("Number (romanParenR)")
    const customEngine = makeTextTrancheEngine([{
      id: 's1',
      objects: [{
        id: 't-num',
        type: 'text',
        geometry: { x: 72 * PT, y: 72 * PT, width: 300 * PT, height: 120 * PT },
        extensions: { stagecraftAuthored: true },
        text: {
          paragraphs: [{
            id: 'p-num',
            style: { bullet: { type: 'number', format: 'romanParenR' } },
            runs: [{ id: 'r-num', text: 'Item', editable: true, style: {}, extensions: { stagecraftAuthored: true } }],
          }],
        },
      }],
    }]);
    const paraSource = { capabilities: { readOnly: false, edits: ['paragraph-format'] }, export: vi.fn() };
    render(
      <EditorProvider editor={customEngine}>
        <PresentationEditor source={paraSource} />
      </EditorProvider>
    );
    fireEvent.click(screen.getAllByLabelText('Select object t-num')[0]);
    const bulletSelect = screen.getByLabelText('Paragraph 1 bullet');
    expect(bulletSelect).toHaveValue('number:romanParenR');
    expect(within(bulletSelect).getByRole('option', { name: 'Number (romanParenR)' })).toBeTruthy();
  });

  it('edits and resets East Asian / complex-script fonts in Font details (PPTX, ODP, theme tokens, mixed range, read-only) while main box sends only fontFamily', () => {
    // 1. PPTX native run with theme tokens (+mn-ea, +mj-cs) + authored object for range testing
    const pptxDoc = createDocument({
      id: 'font-slots-pptx',
      extensions: { sourceFormat: 'pptx' },
      slides: [{
        id: 's1',
        objects: [
          {
            id: 'native-pptx',
            type: 'text',
            geometry: { x: 72 * PT, y: 72 * PT, width: 300 * PT, height: 100 * PT },
            source: { format: 'pptx', part: 'ppt/slides/slide1.xml', path: [0] },
            text: {
              paragraphs: [{
                id: 'p-nat',
                source: { format: 'pptx', part: 'ppt/slides/slide1.xml', path: [0, 0] },
                runs: [{
                  id: 'r-nat',
                  text: '日本語',
                  editable: true,
                  source: { format: 'pptx', part: 'ppt/slides/slide1.xml', path: [0, 0, 0] },
                  style: { typeface: 'Calibri', eastAsian: '+mn-ea', complexScript: '+mj-cs' },
                }],
              }],
            },
          },
          {
            id: 'authored-range',
            type: 'text',
            geometry: { x: 72 * PT, y: 200 * PT, width: 300 * PT, height: 100 * PT },
            extensions: { stagecraftAuthored: true },
            text: {
              paragraphs: [{
                id: 'p-auth',
                runs: [
                  { id: 'r-a1', text: 'One', editable: true, style: { typeface: 'Arial', eastAsian: 'Songti TC', complexScript: '+mn-cs' }, extensions: { stagecraftAuthored: true } },
                  { id: 'r-a2', text: 'Two', editable: true, style: { typeface: 'Arial', eastAsian: 'PingFang SC', complexScript: '+mn-cs' }, extensions: { stagecraftAuthored: true } },
                ],
              }],
            },
          },
        ],
      }],
    });
    const rawEditor = createEditor({ document: pptxDoc, plugins: [documentPlugin, presentationPlugin] });
    const dispatchSpy = vi.fn((...args) => rawEditor.dispatch(...args));
    const editor = { ...rawEditor, dispatch: dispatchSpy };
    const source = { capabilities: { readOnly: false, edits: ['existing-run-text', 'existing-run-format', 'object-text', 'run-range-format'] }, export: vi.fn() };
    const { rerender, unmount } = render(
      <EditorProvider editor={editor}>
        <PresentationEditor source={source} />
      </EditorProvider>
    );

    // Select native PPTX run: theme tokens shown as tokens, never resolved family
    fireEvent.click(screen.getAllByLabelText('Select object native-pptx')[0]);
    expect(screen.getByText('Theme (minor East Asian)')).toBeTruthy();
    expect(screen.getByText('Theme (major Complex script)')).toBeTruthy();
    const eaRunInput = screen.getByLabelText('East Asian text font run 1');
    const csRunInput = screen.getByLabelText('Complex script font run 1');
    expect(eaRunInput).toHaveValue('+mn-ea');
    expect(csRunInput).toHaveValue('+mj-cs');

    // Main font box sends ONLY fontFamily
    const mainFontInput = screen.getByLabelText('Font family run 1');
    fireEvent.change(mainFontInput, { target: { value: 'Georgia' } });
    fireEvent.blur(mainFontInput);
    expect(dispatchSpy).toHaveBeenLastCalledWith(
      'document.setRunFormat',
      { runId: 'r-nat', format: { fontFamily: 'Georgia' } },
      expect.any(Object),
    );

    // Set East Asian & Complex script fonts
    fireEvent.change(eaRunInput, { target: { value: 'Songti TC' } });
    fireEvent.blur(eaRunInput);
    expect(dispatchSpy).toHaveBeenLastCalledWith(
      'document.setRunFormat',
      { runId: 'r-nat', format: { eastAsian: 'Songti TC' } },
      expect.any(Object),
    );
    fireEvent.change(csRunInput, { target: { value: 'Geeza Pro' } });
    fireEvent.blur(csRunInput);
    expect(dispatchSpy).toHaveBeenLastCalledWith(
      'document.setRunFormat',
      { runId: 'r-nat', format: { complexScript: 'Geeza Pro' } },
      expect.any(Object),
    );

    // Reset East Asian only -> sends null and preserves fontFamily & complexScript
    fireEvent.click(screen.getByRole('button', { name: 'Reset east asian text font run 1' }));
    expect(dispatchSpy).toHaveBeenLastCalledWith(
      'document.setRunFormat',
      { runId: 'r-nat', format: { eastAsian: null } },
      expect.any(Object),
    );
    expect(editor.getSnapshot().document.slides[0].objects[0].text.paragraphs[0].runs[0].style).toMatchObject({
      typeface: 'Georgia',
      complexScript: 'Geeza Pro',
    });
    expect(editor.getSnapshot().document.slides[0].objects[0].text.paragraphs[0].runs[0].style.eastAsian).toBeUndefined();

    // Read-only disables Font details inputs and Reset buttons
    rerender(
      <EditorProvider editor={editor}>
        <PresentationEditor source={source} readOnly />
      </EditorProvider>
    );
    expect(screen.getByLabelText('East Asian text font run 1')).toBeDisabled();
    expect(screen.getByLabelText('Complex script font run 1')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reset complex script font run 1' })).toBeDisabled();

    // Authored range: mixed East Asian + uniform theme token Complex script
    rerender(
      <EditorProvider editor={editor}>
        <PresentationEditor source={source} readOnly={false} />
      </EditorProvider>
    );
    fireEvent.click(screen.getAllByLabelText('Select object authored-range')[0]);
    const rangeArea = screen.getByLabelText('Select text range');
    rangeArea.selectionStart = 0;
    rangeArea.selectionEnd = 6; // "OneTwo"
    fireEvent.select(rangeArea);

    const rangeEa = screen.getByLabelText('Range East Asian text font');
    const rangeCs = screen.getByLabelText('Range Complex script font');
    expect(rangeEa).toHaveAttribute('placeholder', 'Mixed');
    expect(rangeEa).toHaveValue('');
    dispatchSpy.mockClear();
    fireEvent.keyDown(rangeEa, { key: 'Enter' });
    expect(dispatchSpy).not.toHaveBeenCalled();
    expect(rangeCs).toHaveValue('+mn-cs');
    expect(screen.getAllByText('Theme (minor Complex script)').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Range font sets Latin text; use Font details for East Asian and complex-script text\./)).toBeTruthy();

    fireEvent.change(rangeEa, { target: { value: 'Yu Mincho' } });
    fireEvent.keyDown(rangeEa, { key: 'Enter' });
    expect(dispatchSpy).toHaveBeenLastCalledWith(
      'document.setRunRangeFormat',
      expect.objectContaining({ format: { eastAsian: 'Yu Mincho' } }),
      expect.any(Object),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Range reset Complex script font' }));
    expect(dispatchSpy).toHaveBeenLastCalledWith(
      'document.setRunRangeFormat',
      expect.objectContaining({ format: { complexScript: null } }),
      expect.any(Object),
    );
    unmount();

    // 2. ODP native run overrides
    const odpDoc = createDocument({
      id: 'font-slots-odp',
      extensions: { sourceFormat: 'odp' },
      slides: [{
        id: 's1',
        objects: [{
          id: 'native-odp',
          type: 'text',
          geometry: { x: 72 * PT, y: 72 * PT, width: 300 * PT, height: 100 * PT },
          source: { format: 'odp', part: 'content.xml', path: [0] },
          text: {
            paragraphs: [{
              id: 'p-odp',
              source: { format: 'odp', part: 'content.xml', path: [0, 0] },
              runs: [{
                id: 'r-odp',
                text: '中文',
                editable: true,
                source: { format: 'odp', part: 'content.xml', path: [0, 0, 0] },
                style: { overrides: { eastAsian: 'Noto Sans CJK JP' } },
              }],
            }],
          },
        }],
      }],
    });
    const rawOdpEditor = createEditor({ document: odpDoc, plugins: [documentPlugin, presentationPlugin] });
    const odpSpy = vi.fn((...args) => rawOdpEditor.dispatch(...args));
    const odpEditor = { ...rawOdpEditor, dispatch: odpSpy };
    render(
      <EditorProvider editor={odpEditor}>
        <PresentationEditor source={source} />
      </EditorProvider>
    );
    fireEvent.click(screen.getAllByLabelText('Select object native-odp')[0]);
    const odpEa = screen.getByLabelText('East Asian text font run 1');
    expect(odpEa).toHaveValue('Noto Sans CJK JP');
    fireEvent.change(odpEa, { target: { value: '' } });
    fireEvent.blur(odpEa);
    expect(odpSpy).toHaveBeenLastCalledWith(
      'document.setRunFormat',
      { runId: 'r-odp', format: { eastAsian: null } },
      expect.any(Object),
    );
  });

  it('clears stale range East Asian / Complex script drafts on unrelated revision, same-value new selection, and readOnly toggle', () => {
    const doc = createDocument({
      id: 'stale-font-drafts',
      slides: [{
        id: 's1',
        objects: [{
          id: 't1',
          type: 'text',
          geometry: { x: 72 * PT, y: 72 * PT, width: 300 * PT, height: 100 * PT },
          extensions: { stagecraftAuthored: true },
          text: {
            paragraphs: [{
              id: 'p1',
              runs: [
                { id: 'r1', text: 'First', editable: true, style: { eastAsian: 'Songti TC', complexScript: '+mn-cs' }, extensions: { stagecraftAuthored: true } },
                { id: 'r2', text: 'Second', editable: true, style: { eastAsian: 'PingFang SC', complexScript: '+mn-cs' }, extensions: { stagecraftAuthored: true } },
              ],
            }],
          },
        }],
      }],
    });
    const editor = createEditor({ document: doc, plugins: [documentPlugin, presentationPlugin] });
    const source = { capabilities: { readOnly: false, edits: ['object-text', 'run-range-format', 'existing-run-format'] }, export: vi.fn() };
    const { rerender } = render(
      <EditorProvider editor={editor}>
        <PresentationEditor source={source} />
      </EditorProvider>
    );

    fireEvent.click(screen.getAllByLabelText('Select object t1')[0]);
    const rangeArea = screen.getByLabelText('Select text range');
    const rangeEa = screen.getByLabelText('Range East Asian text font');
    const rangeCs = screen.getByLabelText('Range Complex script font');

    // 1. Unrelated revision clears half-typed EA draft
    rangeArea.selectionStart = 0;
    rangeArea.selectionEnd = 11; // "FirstSecond" (mixed EA)
    fireEvent.select(rangeArea);
    fireEvent.change(rangeEa, { target: { value: 'DraftEA' } });
    expect(rangeEa).toHaveValue('DraftEA');
    act(() => {
      editor.dispatch('document.setRunFormat', { runId: 'r1', format: { bold: true } });
    });
    expect(rangeEa).toHaveValue('');

    // 2. Same-value new selection clears half-typed CS draft
    rangeArea.selectionStart = 0;
    rangeArea.selectionEnd = 5; // "First" (+mn-cs)
    fireEvent.select(rangeArea);
    expect(rangeCs).toHaveValue('+mn-cs');
    fireEvent.change(rangeCs, { target: { value: 'DraftCS' } });
    expect(rangeCs).toHaveValue('DraftCS');
    rangeArea.selectionStart = 5;
    rangeArea.selectionEnd = 11; // "Second" (also +mn-cs)
    fireEvent.select(rangeArea);
    expect(rangeCs).toHaveValue('+mn-cs');

    // 3. readOnly on -> off clears half-typed EA draft
    fireEvent.change(rangeEa, { target: { value: 'DraftEA2' } });
    expect(rangeEa).toHaveValue('DraftEA2');
    rerender(
      <EditorProvider editor={editor}>
        <PresentationEditor source={source} readOnly />
      </EditorProvider>
    );
    rerender(
      <EditorProvider editor={editor}>
        <PresentationEditor source={source} readOnly={false} />
      </EditorProvider>
    );
    expect(rangeEa).toHaveValue('');
  });

  function mountFu142Fixture(edits = ['object-text', 'run-range-format', 'existing-run-format', 'object-table']) {
    const doc = createDocument({
      id: 'fu142-followups',
      slides: [
        {
          id: 's1',
          objects: [
            {
              id: 't1',
              type: 'text',
              geometry: { x: 72 * PT, y: 72 * PT, width: 300 * PT, height: 100 * PT },
              extensions: { stagecraftAuthored: true },
              text: {
                paragraphs: [{
                  id: 'p1',
                  runs: [{ id: 'r1', text: 'Alpha', editable: true, style: { typeface: 'Arial', eastAsian: 'Songti TC', complexScript: 'Geeza Pro' }, extensions: { stagecraftAuthored: true } }],
                }],
              },
            },
            {
              id: 't2',
              type: 'text',
              geometry: { x: 400 * PT, y: 72 * PT, width: 300 * PT, height: 100 * PT },
              extensions: { stagecraftAuthored: true },
              text: {
                paragraphs: [{
                  id: 'p2',
                  runs: [{ id: 'r2', text: 'Alpha', editable: true, style: { typeface: 'Arial', eastAsian: 'Yu Mincho', complexScript: 'Tahoma' }, extensions: { stagecraftAuthored: true } }],
                }],
              },
            },
            {
              id: 'tbl1',
              type: 'table',
              geometry: { x: 72 * PT, y: 200 * PT, width: 300 * PT, height: 100 * PT },
              extensions: { stagecraftAuthored: true },
              table: {
                columns: [{ id: 'col1', width: 300 * PT }],
                rows: [{
                  id: 'row1',
                  cells: [{
                    id: 'c1',
                    text: {
                      paragraphs: [{
                        id: 'cp1',
                        runs: [{ id: 'cr1', text: 'Cell', editable: true, style: { eastAsian: 'Yu Mincho', complexScript: 'Tahoma' }, extensions: { stagecraftAuthored: true } }],
                      }],
                    },
                  }],
                }],
              },
            },
          ],
        },
      ],
    });
    const rawEditor = createEditor({ document: doc, plugins: [documentPlugin, presentationPlugin] });
    const dispatchSpy = vi.fn((...args) => rawEditor.dispatch(...args));
    const editor = { ...rawEditor, dispatch: dispatchSpy };
    const source = { capabilities: { readOnly: false, edits }, export: vi.fn() };
    const view = render(
      <EditorProvider editor={editor}>
        <PresentationEditor source={source} />
      </EditorProvider>,
    );
    return { editor, source, dispatchSpy, ...view };
  }

  function selectT1Range() {
    fireEvent.click(screen.getAllByLabelText('Select object t1')[0]);
    const rangeArea = screen.getByLabelText('Select text range');
    rangeArea.selectionStart = 0;
    rangeArea.selectionEnd = 5;
    fireEvent.select(rangeArea);
  }

  it('skips unchanged range Enter on Range East Asian and Complex script font fields', () => {
    const { dispatchSpy } = mountFu142Fixture();
    selectT1Range();
    const rangeEa = screen.getByLabelText('Range East Asian text font');
    const rangeCs = screen.getByLabelText('Range Complex script font');
    expect(rangeEa).toHaveValue('Songti TC');
    expect(rangeCs).toHaveValue('Geeza Pro');

    dispatchSpy.mockClear();
    fireEvent.keyDown(rangeEa, { key: 'Enter' });
    fireEvent.keyDown(rangeCs, { key: 'Enter' });
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it('sends only fontFamily from Range font family field', () => {
    const { dispatchSpy } = mountFu142Fixture();
    selectT1Range();
    const rangeFont = screen.getByLabelText('Range font family');
    fireEvent.change(rangeFont, { target: { value: 'Georgia' } });
    fireEvent.keyDown(rangeFont, { key: 'Enter' });
    expect(dispatchSpy).toHaveBeenLastCalledWith(
      'document.setRunRangeFormat',
      expect.objectContaining({ format: { fontFamily: 'Georgia' } }),
      expect.any(Object),
    );
  });

  it('resets range East Asian and Complex script drafts on owner (object) change without unmounting', () => {
    mountFu142Fixture();
    selectT1Range();
    const rangeEa = screen.getByLabelText('Range East Asian text font');
    const rangeCs = screen.getByLabelText('Range Complex script font');
    fireEvent.change(rangeEa, { target: { value: 'HalfTypedEA' } });
    fireEvent.change(rangeCs, { target: { value: 'HalfTypedCS' } });
    expect(rangeEa).toHaveValue('HalfTypedEA');
    expect(rangeCs).toHaveValue('HalfTypedCS');

    // Switch to another text object on the same slide with identical text ("Alpha");
    // CrossRunRangeFormatFields stays mounted and must clear drafts + selection via ownerChanged.
    fireEvent.click(screen.getAllByLabelText('Select object t2')[0]);
    expect(rangeEa).toHaveValue('');
    expect(rangeCs).toHaveValue('');
  });

  it('disables Font details controls when existing-run-format or run-range-format capability is denied', () => {
    mountFu142Fixture(['object-text']);
    fireEvent.click(screen.getAllByLabelText('Select object t1')[0]);
    expect(screen.getByLabelText('East Asian text font run 1')).toBeDisabled();
    expect(screen.getByLabelText('Complex script font run 1')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reset east asian text font run 1' })).toBeDisabled();
    expect(screen.getByLabelText('Range East Asian text font')).toBeDisabled();
    expect(screen.getByLabelText('Range Complex script font')).toBeDisabled();
  });

  it('disables range controls and Reset and blocks dispatch when run-range-format is revoked after range selection', () => {
    const { editor, source, dispatchSpy, rerender } = mountFu142Fixture();
    selectT1Range();
    const rangeEa = screen.getByLabelText('Range East Asian text font');
    const rangeCs = screen.getByLabelText('Range Complex script font');
    const boldBtn = screen.getByRole('button', { name: 'Range bold' });
    const resetEa = screen.getByRole('button', { name: 'Range reset East Asian text font' });
    const resetCs = screen.getByRole('button', { name: 'Range reset Complex script font' });
    expect(boldBtn).toBeEnabled();
    expect(rangeEa).toBeEnabled();
    expect(resetEa).toBeEnabled();

    // Revoke run-range-format on the same source reference so CrossRunRangeFormatFields stays mounted
    source.capabilities = { readOnly: false, edits: ['object-text', 'existing-run-format'] };
    rerender(
      <EditorProvider editor={editor}>
        <PresentationEditor source={source} className="revoked" />
      </EditorProvider>,
    );

    expect(boldBtn).toBeDisabled();
    expect(rangeEa).toBeDisabled();
    expect(rangeCs).toBeDisabled();
    expect(resetEa).toBeDisabled();
    expect(resetCs).toBeDisabled();

    dispatchSpy.mockClear();
    fireEvent.click(boldBtn);
    fireEvent.click(resetEa);
    fireEvent.click(resetCs);
    fireEvent.change(rangeEa, { target: { value: 'PingFang SC' } });
    fireEvent.keyDown(rangeEa, { key: 'Enter' });
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it('displays and edits authored table-cell eastAsian and complexScript font slots', () => {
    const { dispatchSpy } = mountFu142Fixture();
    fireEvent.click(screen.getAllByLabelText('Select object tbl1')[0]);
    const cellEa = screen.getByLabelText('East Asian text font run 1');
    const cellCs = screen.getByLabelText('Complex script font run 1');
    expect(cellEa).toHaveValue('Yu Mincho');
    expect(cellCs).toHaveValue('Tahoma');
    fireEvent.change(cellEa, { target: { value: 'PingFang TC' } });
    fireEvent.blur(cellEa);
    expect(dispatchSpy).toHaveBeenLastCalledWith(
      'presentation.setTableCell',
      expect.objectContaining({
        cellId: 'c1',
        text: expect.objectContaining({
          paragraphs: expect.arrayContaining([
            expect.objectContaining({
              runs: expect.arrayContaining([
                expect.objectContaining({ style: expect.objectContaining({ eastAsian: 'PingFang TC', complexScript: 'Tahoma' }) }),
              ]),
            }),
          ]),
        }),
      }),
      expect.any(Object),
    );
  });
});
