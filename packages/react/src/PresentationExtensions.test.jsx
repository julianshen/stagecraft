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

    // Unrelated revision bump invalidates range selection UI
    act(() => {
      editor.dispatch('document.setTextBodyLayout', { objectId: 't-live', layout: { autofit: 'none' } });
    });
    expect(screen.getByRole('button', { name: 'Range bold' })).toBeDisabled();
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
});
