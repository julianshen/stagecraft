import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createEditor } from '@stagecraft/core';
import { createDocument, documentPlugin, presentationPlugin } from '@stagecraft/core/document';
import { EditorProvider } from './EditorProvider.jsx';
import { DeckList, PresentationEditor, PresentationEditorProvider, PresentationToolbar, PresentationCanvas, AttributePanel, SlideList, usePresentationEditor } from './PresentationEditor.jsx';
const engine = () => createEditor({
  document: createDocument({
    slides: [{
      id: 's',
      objects: []
    }]
  }),
  plugins: [documentPlugin, presentationPlugin]
});
describe('presentation regions', () => {
  it('offers an independent controlled deck collection', () => {
    const select = vi.fn();
    render(<DeckList items={[{
      id: 'a',
      title: 'Alpha'
    }, {
      id: 'b',
      title: 'Beta',
      disabled: true
    }]} activeId="a" onSelect={select} />);
    fireEvent.click(screen.getByText('Alpha'));
    fireEvent.click(screen.getByText('Beta'));
    expect(select).toHaveBeenCalledTimes(1);
    expect(select).toHaveBeenCalledWith('a');
    expect(screen.getByText('Alpha').closest('button')).toHaveAttribute('aria-current', 'page');
  });
  it('unmounts optional regions while retaining canvas', () => {
    render(<EditorProvider editor={engine()}><PresentationEditor showToolbar={false} showSlideList={false} showAttributePanel={false} /></EditorProvider>);
    expect(screen.queryByRole('toolbar')).toBeNull();
    expect(screen.queryByLabelText('Slides')).toBeNull();
    expect(screen.queryByLabelText('Attribute panel')).toBeNull();
    expect(screen.getByLabelText('Slide canvas')).toBeTruthy();
  });
  it('composes standalone regions under a provider', () => {
    render(<EditorProvider editor={engine()}><PresentationEditorProvider><PresentationToolbar /><SlideList /><PresentationCanvas /><AttributePanel /></PresentationEditorProvider></EditorProvider>);
    fireEvent.click(screen.getByRole('tab', {
      name: 'View'
    }));
    fireEvent.change(screen.getByLabelText('Zoom'), {
      target: {
        value: '150'
      }
    });
    expect(screen.getByLabelText('Zoom')).toHaveValue(150);
    expect(screen.getByText('Select an object to inspect its properties.')).toBeTruthy();
  });
});
const object = (id = 'o', type = 'shape') => ({
  id,
  type,
  geometry: {
    x: 100,
    y: 200,
    width: 3000000,
    height: 2000000
  },
  extensions: {
    stagecraftAuthored: true
  },
  ...(type === 'shape' ? {
    shape: 'rect',
    fill: '#4472C4'
  } : {
    text: {
      paragraphs: [{
        id: `${id}-p`,
        runs: [{
          id: `${id}-r`,
          text: 'Original',
          editable: true,
          style: {},
          extensions: {
            stagecraftAuthored: true
          }
        }]
      }]
    }
  })
});
function mount(props = {}, objects = [object()]) {
  const editor = createEditor({
    document: createDocument({
      slides: [{
        id: 's',
        objects
      }]
    }),
    plugins: [documentPlugin, presentationPlugin]
  });
  const view = render(<EditorProvider editor={editor}><PresentationEditor {...props} /></EditorProvider>);
  return {
    ...view,
    editor,
    replace: (next, options = props) => view.rerender(<EditorProvider editor={next}><PresentationEditor {...options} /></EditorProvider>)
  };
}
const select = (id = 'o') => fireEvent.click(screen.getByLabelText(`Select object ${id}`));
const source = () => ({
  capabilities: {
    edits: ['existing-run-text', 'existing-run-format', 'object-geometry', 'object-structure', 'object-style', 'slide-structure']
  },
  export: vi.fn(async () => ({
    bytes: new Uint8Array([1])
  }))
});
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return {
    promise,
    resolve,
    reject
  };
};
describe('presentation editing', () => {
  it('authors, formats, arranges, removes and undoes objects through commands', () => {
    const {
      editor
    } = mount();
    fireEvent.click(screen.getByRole('tab', {
      name: 'Insert'
    }));
    fireEvent.click(screen.getByText('Text box'));
    expect(editor.getSnapshot().document.slides[0].objects).toHaveLength(2);
    fireEvent.change(screen.getByLabelText('Text run 1'), {
      target: {
        value: 'Updated'
      }
    });
    fireEvent.change(screen.getByLabelText('Bold run 1'), {
      target: {
        value: 'true'
      }
    });
    expect(editor.getSnapshot().document.slides[0].objects[1].text.paragraphs[0].runs[0]).toMatchObject({
      text: 'Updated',
      style: {
        b: '1'
      }
    });
    fireEvent.click(screen.getByRole('tab', {
      name: 'Home'
    }));
    fireEvent.click(screen.getByText('Send backward'));
    expect(editor.getSnapshot().document.slides[0].objects[0].type).toBe('text');
    fireEvent.click(screen.getByText('Bring forward'));
    fireEvent.click(screen.getByText('Delete object'));
    expect(editor.getSnapshot().document.slides[0].objects).toHaveLength(1);
    fireEvent.click(screen.getByText('Undo'));
    expect(editor.getSnapshot().document.slides[0].objects).toHaveLength(2);
    fireEvent.click(screen.getByText('Redo'));
    expect(editor.getSnapshot().document.slides[0].objects).toHaveLength(1);
    fireEvent.click(screen.getByRole('tab', {
      name: 'Insert'
    }));
    fireEvent.click(screen.getByText('Ellipse'));
    expect(editor.getSnapshot().document.slides[0].objects[1].shape).toBe('ellipse');
    fireEvent.change(screen.getByLabelText('Fill'), {
      target: {
        value: '#ff0000'
      }
    });
    expect(editor.getSnapshot().document.slides[0].objects[1].fill).toBe('#ff0000');
  });
  it('navigates, moves and removes slides with a valid fallback', () => {
    const {
      editor
    } = mount();
    fireEvent.click(screen.getByText('Add slide'));
    expect(editor.getSnapshot().document.slides).toHaveLength(2);
    fireEvent.click(screen.getByText('Move slide up'));
    expect(editor.getSnapshot().document.slides[0].id).not.toBe('s');
    fireEvent.click(screen.getByText('Move slide down'));
    fireEvent.click(screen.getByText('Remove slide'));
    expect(screen.getByLabelText('Slide 1')).toHaveAttribute('aria-current', 'page');
    fireEvent.click(screen.getByText('Remove slide'));
    expect(screen.getByText('No slides. Add a slide to begin.')).toBeTruthy();
  });
  it('preserves at least one slide in source-backed workspaces while allowing 2->1 removal', () => {
    const editor = createEditor({
      document: createDocument({
        slides: [{ id: 's1', objects: [] }, { id: 's2', objects: [] }]
      }),
      plugins: [documentPlugin, presentationPlugin]
    });
    const source = {
      capabilities: { readOnly: false, edits: ['slide-structure'] },
      export: vi.fn()
    };
    let latestCtx = null;
    function ContextProbe() {
      latestCtx = usePresentationEditor();
      return null;
    }
    render(
      <EditorProvider editor={editor}>
        <PresentationEditorProvider source={source}>
          <SlideList />
          <ContextProbe />
        </PresentationEditorProvider>
      </EditorProvider>
    );

    const removeBtn = screen.getByRole('button', { name: 'Remove slide' });
    expect(removeBtn).not.toBeDisabled();
    fireEvent.click(removeBtn);
    expect(editor.getSnapshot().document.slides).toHaveLength(1);
    expect(removeBtn).toBeDisabled();

    const revBefore = editor.getSnapshot().revision;
    const canUndoBefore = editor.getSnapshot().canUndo;
    const canRedoBefore = editor.getSnapshot().canRedo;
    act(() => {
      latestCtx.removeSlide();
    });
    expect(editor.getSnapshot().document.slides).toHaveLength(1);
    expect(editor.getSnapshot().revision).toBe(revBefore);
    expect(editor.getSnapshot().canUndo).toBe(canUndoBefore);
    expect(editor.getSnapshot().canRedo).toBe(canRedoBefore);
  });
  it('validates points and applies numeric geometry and keyboard nudges', () => {
    const {
      editor
    } = mount();
    select();
    const width = screen.getByLabelText('Width (pt)');
    fireEvent.change(width, {
      target: {
        value: '-1'
      }
    });
    fireEvent.blur(width);
    expect(screen.getByRole('alert')).toHaveTextContent('positive sizes');
    expect(editor.getSnapshot().revision).toBe(0);
    fireEvent.change(width, {
      target: {
        value: '100'
      }
    });
    fireEvent.blur(width);
    expect(editor.getSnapshot().document.slides[0].objects[0].geometry.width).toBe(1270000);
    const canvas = screen.getByLabelText('Slide canvas');
    fireEvent.keyDown(canvas, {
      key: 'ArrowRight'
    });
    expect(editor.getSnapshot().document.slides[0].objects[0].geometry.x).toBeGreaterThan(100);
    fireEvent.keyDown(canvas, {
      key: 'z',
      ctrlKey: true
    });
    expect(editor.getSnapshot().document.slides[0].objects[0].geometry.x).toBe(100);
    fireEvent.keyDown(canvas, {
      key: 'z',
      ctrlKey: true,
      shiftKey: true
    });
    fireEvent.keyDown(canvas, {
      key: 'Escape'
    });
    expect(screen.getByText('Select an object to inspect its properties.')).toBeTruthy();
    select();
    fireEvent.keyDown(canvas, {
      key: 'Delete'
    });
    expect(editor.getSnapshot().document.slides[0].objects).toHaveLength(0);
  });
  it('never routes input typing or window shortcuts through canvas', () => {
    const {
      editor
    } = mount({}, [object('t', 'text')]);
    select('t');
    fireEvent.keyDown(screen.getByLabelText('Text run 1'), {
      key: 'Backspace'
    });
    fireEvent.keyDown(window, {
      key: 'Delete'
    });
    expect(editor.getSnapshot().revision).toBe(0);
  });
  it('locks imported opaque geometry and respects source capabilities', () => {
    const native = {
      ...object(),
      type: 'opaque',
      extensions: {}
    };
    mount({
      source: {
        capabilities: {
          edits: []
        }
      }
    }, [native]);
    select();
    expect(screen.getByLabelText('Width (pt)')).toBeDisabled();
    expect(screen.getByText('Delete object')).toBeDisabled();
    expect(screen.getByText(/Simplified preview/)).toBeTruthy();
    expect(screen.queryByText('Export')).toBeNull();
  });
  it('readOnly prevents authored edits while preserving inspection', () => {
    const {
      editor
    } = mount({
      readOnly: true
    });
    select();
    expect(screen.getByLabelText('Fill')).toBeDisabled();
    fireEvent.keyDown(screen.getByLabelText('Slide canvas'), {
      key: 'Delete'
    });
    expect(editor.getSnapshot().revision).toBe(0);
  });
  it('resets selection on editor replacement and keeps instances isolated', () => {
    const first = mount();
    select();
    first.replace(engine());
    expect(screen.getByText('Select an object to inspect its properties.')).toBeTruthy();
    first.unmount();
    const a = engine(),
      b = engine();
    render(<><EditorProvider editor={a}><PresentationEditor /></EditorProvider><EditorProvider editor={b}><PresentationEditor /></EditorProvider></>);
    fireEvent.click(within(screen.getAllByLabelText('Presentation editor')[0]).getByText('Add slide'));
    expect(a.getSnapshot().document.slides).toHaveLength(2);
    expect(b.getSnapshot().document.slides).toHaveLength(1);
  });
});
describe('presentation export', () => {
  it('captures one immutable revision and locks until callback settles', async () => {
    const s = source(),
      pending = deferred(),
      saved = deferred(),
      onExport = vi.fn(() => saved.promise);
    s.export.mockReturnValue(pending.promise);
    const {
      editor
    } = mount({
      source: s,
      onExport
    });
    fireEvent.click(screen.getByText('Export'));
    fireEvent.click(screen.getByText('Exporting…'));
    select();
    fireEvent.keyDown(screen.getByLabelText('Slide canvas'), {
      key: 'ArrowRight'
    });
    expect(s.export).toHaveBeenCalledTimes(1);
    expect(s.export.mock.calls[0][0].slides[0].objects[0].geometry.x).toBe(100);
    expect(editor.getSnapshot().revision).toBe(1);
    await act(async () => pending.resolve({
      bytes: new Uint8Array()
    }));
    expect(onExport).toHaveBeenCalledWith(expect.anything(), {
      revision: 0, resizeFit: expect.objectContaining({status:'skipped',reason:'no-resize',count:0}), shrinkFit: {status: 'skipped', reason: 'not-pptx', count: 0}
    });
    expect(screen.getByText('Exporting…')).toBeDisabled();
    await act(async () => saved.resolve());
    expect(screen.getByRole('status')).toHaveTextContent('Exported revision 0');
  });
  it('allows exporting an imported zero-slide source', async () => {
    const emptyEditor = createEditor({
      document: createDocument({ slides: [] }),
      plugins: [documentPlugin, presentationPlugin]
    });
    const s = source();
    const exported = { bytes: new Uint8Array([1, 2, 3]) };
    s.export.mockResolvedValue(exported);
    const onExport = vi.fn();
    render(
      <EditorProvider editor={emptyEditor}>
        <PresentationEditor source={s} onExport={onExport} />
      </EditorProvider>
    );
    const exportBtn = screen.getByRole('button', { name: 'Export' });
    expect(exportBtn).not.toBeDisabled();
    await act(async () => {
      fireEvent.click(exportBtn);
    });
    expect(s.export).toHaveBeenCalledTimes(1);
    expect(s.export.mock.calls[0][0].slides).toEqual([]);
    expect(onExport).toHaveBeenCalledWith(exported, { revision: 0, resizeFit: expect.objectContaining({status:'skipped',reason:'no-resize',count:0}), shrinkFit: {status: 'skipped', reason: 'not-pptx', count: 0} });
  });
  it.each(['source', 'editor', 'unmount'])('suppresses stale completion after %s replacement', async kind => {
    const s = source(),
      pending = deferred(),
      onExport = vi.fn(),
      onError = vi.fn();
    s.export.mockReturnValue(pending.promise);
    const view = mount({
      source: s,
      onExport,
      onError
    });
    fireEvent.click(screen.getByText('Export'));
    if (kind === 'unmount') view.unmount();else view.replace(kind === 'editor' ? engine() : view.editor, {
      source: kind === 'source' ? source() : s,
      onExport,
      onError
    });
    await act(async () => pending.reject(Error('obsolete')));
    expect(onExport).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });
  it('reports source and callback errors without breaking the provider', async () => {
    const s = source(),
      onError = vi.fn(() => {
        throw Error('host');
      });
    s.export.mockRejectedValue(Error('source failed'));
    mount({
      source: s,
      onExport: () => {},
      onError
    });
    await act(async () => fireEvent.click(screen.getByText('Export')));
    expect(screen.getByRole('alert')).toHaveTextContent('source failed');
    expect(screen.getByRole('alert')).toHaveTextContent('ERROR_CALLBACK_FAILED');
    expect(onError).toHaveBeenCalled();
  });
});
describe('canvas gestures and focus', () => {
  function pointerSetup() {
    vi.stubGlobal('PointerEvent', MouseEvent);
    const target = screen.getByLabelText('Select object o');
    target.ownerSVGElement.getBoundingClientRect = () => ({
      width: 960,
      height: 540,
      left: 0,
      top: 0
    });
    return target;
  }
  it.each([false, true])('releases pointer capture only when owned: %s', owns => {
    mount(); const target = pointerSetup();
    target.hasPointerCapture = vi.fn(() => owns);
    target.releasePointerCapture = vi.fn(() => { if (!owns) throw Error('not captured'); });
    fireEvent.pointerDown(target, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerCancel(screen.getByLabelText('Slide canvas'));
    expect(target.hasPointerCapture).toHaveBeenCalled();
    expect(target.releasePointerCapture).toHaveBeenCalledTimes(owns ? 1 : 0);
    vi.unstubAllGlobals();
  });
  it('previews pointer movement and commits once; cancel discards', () => {
    const {
      editor
    } = mount();
    const target = pointerSetup(),
      canvas = screen.getByLabelText('Slide canvas');
    fireEvent.pointerDown(target, {
      button: 0,
      clientX: 10,
      clientY: 10
    });
    fireEvent.pointerMove(canvas, {
      clientX: 30,
      clientY: 40
    });
    fireEvent.pointerMove(canvas, {
      clientX: 40,
      clientY: 50
    });
    expect(editor.getSnapshot().revision).toBe(0);
    fireEvent.pointerUp(canvas);
    expect(editor.getSnapshot().revision).toBe(1);
    const x = editor.getSnapshot().document.slides[0].objects[0].geometry.x;
    fireEvent.pointerDown(target, {
      button: 0,
      clientX: 10,
      clientY: 10
    });
    fireEvent.pointerMove(canvas, {
      clientX: 30,
      clientY: 40
    });
    fireEvent.pointerCancel(canvas);
    expect(editor.getSnapshot().revision).toBe(1);
    expect(editor.getSnapshot().document.slides[0].objects[0].geometry.x).toBe(x);
    vi.unstubAllGlobals();
  });
  it('omits pointer resize handles for rotated native objects while retaining inspector edits', () => {
    const rotated = object();
    rotated.extensions = { editableGeometry: true };
    rotated.geometry.rotation = 90;
    const { editor } = mount({}, [rotated]);
    select();
    expect(screen.queryAllByLabelText('Resize object').length).toBe(0);
    expect(editor.getSnapshot().revision).toBe(0);
    fireEvent.change(screen.getByLabelText('Width (pt)'), { target: { value: '300' } });
    fireEvent.blur(screen.getByLabelText('Width (pt)'));
    expect(editor.getSnapshot().document.slides[0].objects[0].geometry).toMatchObject({ width: 3810000, rotation: 90 });
    expect(editor.getSnapshot().revision).toBe(1);
  });
  it('rejects stale gestures and resizes in one transaction', () => {
    const {
      editor
    } = mount();
    const target = pointerSetup(),
      canvas = screen.getByLabelText('Slide canvas');
    fireEvent.pointerDown(target, {
      button: 0,
      clientX: 10,
      clientY: 10
    });
    fireEvent.pointerMove(canvas, {
      clientX: 30,
      clientY: 40
    });
    act(() => editor.dispatch('presentation.setPaint', {
      slideId: 's',
      objectId: 'o',
      fill: '#ff0000'
    }, {
      expectedRevision: 0
    }));
    fireEvent.pointerUp(canvas);
    expect(editor.getSnapshot().revision).toBe(1);
    expect(screen.getByRole('alert')).toBeTruthy();
    fireEvent.pointerDown(screen.getByLabelText('Resize object'), {
      button: 0,
      clientX: 10,
      clientY: 10
    });
    fireEvent.pointerMove(canvas, {
      clientX: 30,
      clientY: 40
    });
    fireEvent.pointerUp(canvas);
    expect(editor.getSnapshot().revision).toBe(2);
    expect(editor.getSnapshot().document.slides[0].objects[0].geometry.width).toBeGreaterThan(3000000);
    vi.unstubAllGlobals();
  });
  it('supports keyboard selection and one-point nudges independently of zoom', () => {
    const {
      editor
    } = mount();
    fireEvent.keyDown(screen.getByLabelText('Select object o'), {
      key: 'Enter'
    });
    expect(screen.getByLabelText('Width (pt)')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', {
      name: 'View'
    }));
    fireEvent.change(screen.getByLabelText('Zoom'), {
      target: {
        value: '200'
      }
    });
    fireEvent.keyDown(screen.getByLabelText('Slide canvas'), {
      key: 'ArrowRight'
    });
    expect(editor.getSnapshot().document.slides[0].objects[0].geometry.x).toBe(12800);
  });
  it('cancels gestures when the browser loses focus', () => {
    const {
      editor
    } = mount();
    const target = pointerSetup(),
      canvas = screen.getByLabelText('Slide canvas');
    fireEvent.pointerDown(target, {
      button: 0,
      clientX: 10,
      clientY: 10
    });
    fireEvent.pointerMove(canvas, {
      clientX: 30,
      clientY: 40
    });
    fireEvent.blur(window);
    fireEvent.pointerUp(canvas);
    expect(editor.getSnapshot().revision).toBe(0);
    vi.unstubAllGlobals();
  });
});
describe('region lifecycle and accessibility', () => {
  it('switches ribbon tabs by arrow keys and links its panel', () => {
    mount();
    const home = screen.getByRole('tab', {
      name: 'Home'
    });
    fireEvent.keyDown(home, {
      key: 'ArrowRight'
    });
    const insert = screen.getByRole('tab', {
      name: 'Insert'
    });
    expect(insert).toHaveAttribute('aria-selected', 'true');
    expect(insert).toHaveFocus();
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', insert.id);
    fireEvent.keyDown(insert, {
      key: 'End'
    });
    expect(screen.getByRole('tab', {
      name: 'View'
    })).toHaveFocus();
  });
  it('supports collection mounting, custom toolbar and selection callbacks', () => {
    const onSelectionChange = vi.fn();
    mount({
      showDeckList: true,
      decks: [{
        id: 'd',
        title: 'My deck'
      }],
      activeDeckId: 'd',
      renderToolbar: () => <p>Custom tools</p>,
      onSelectionChange
    });
    expect(screen.getByText('Custom tools')).toBeTruthy();
    expect(screen.getByLabelText('Presentations')).toBeTruthy();
    expect(onSelectionChange).toHaveBeenCalledWith({
      slideId: 's',
      objectId: null
    });
    select();
    expect(onSelectionChange).toHaveBeenLastCalledWith({
      slideId: 's',
      objectId: 'o'
    });
    fireEvent.pointerDown(within(screen.getByLabelText('Slide canvas')).getByLabelText('Slide artwork'));
    expect(onSelectionChange).toHaveBeenLastCalledWith({
      slideId: 's',
      objectId: null
    });
  });
  it('resets selection with source identity and discards hidden inspector drafts', () => {
    const s = source(),
      view = mount({
        source: s
      });
    select();
    const width = screen.getByLabelText('Width (pt)');
    fireEvent.change(width, {
      target: {
        value: '999'
      }
    });
    view.replace(view.editor, {
      source: s,
      showAttributePanel: false
    });
    view.replace(view.editor, {
      source: s
    });
    expect(screen.getByLabelText('Width (pt)')).not.toHaveValue(999);
    view.replace(view.editor, {
      source: source()
    });
    expect(screen.getByText('Select an object to inspect its properties.')).toBeTruthy();
  });
  it('handles invalid canonical data and empty controlled lists', () => {
    const editor = createEditor({
      document: {
        slides: []
      }
    });
    render(<EditorProvider editor={editor}><PresentationEditor /></EditorProvider>);
    expect(screen.getByRole('alert')).toHaveTextContent('requires a canonical v1 document');
    render(<DeckList items={[]} emptyMessage="Nothing here" />);
    expect(screen.getByText('Nothing here')).toBeTruthy();
  });
});
describe('native primitive previews', () => {
  it.each(['pptx', 'odp'])('renders authored primitives after %s export and reopen', async format => {
    const { openPresentation } = await import('@stagecraft/source');
    const { writePptx } = await import('../../pptx/src/index.js');
    const { writeOdp } = await import('../../odp/src/index.js');
    const bytes = await (format === 'pptx' ? writePptx : writeOdp)({title:'Primitives',sections:[{id:'section',name:'Slides',slides:['s']}],slides:[{id:'s',layout:'blank',elements:[]}]});
    const session = await openPresentation(bytes,{format});
    const document = structuredClone(session.document);
    document.slides[0].objects.push(object('rectangle'),{...object('ellipse'),shape:'ellipse',fill:'#00AA44'});
    const reopened = await openPresentation((await session.export(document)).bytes,{format});
    const editor = createEditor({document:reopened.document,plugins:[documentPlugin,presentationPlugin]});
    render(<EditorProvider editor={editor}><PresentationEditor source={reopened}/></EditorProvider>);
    const canvas = screen.getByLabelText('Slide canvas');
    expect(canvas.querySelector('rect[fill="#4472C4"]')).toBeTruthy();
    expect(canvas.querySelector('ellipse[fill="#00AA44"]')).toBeTruthy();
    expect(within(canvas).queryByText('Unsupported preview: shape')).toBeNull();
    const native = reopened.document.slides[0].objects[0];
    expect(native.extensions.stagecraftAuthored).not.toBe(true);
    select(native.id);
    expect(native.extensions.editableFill).toBe(true);
    expect(screen.getByLabelText('Fill')).toHaveValue('#4472c4');
    session.dispose(); reopened.dispose();
  });
  it('preserves text overlays, restricts primitives and sanitizes fill', () => {
    const text = {...object('label','text'),shape:'rect',fill:'url(https://invalid.test/payload)',extensions:{}};
    mount({},[text,{...object('unknown'),shape:'triangle',extensions:{}}]);
    const label = screen.getByLabelText('Select object label');
    expect(label.querySelector('rect')).toHaveAttribute('fill','#e5e7eb');
    expect(within(label).getByText('Original')).toBeTruthy();
    expect(screen.getByLabelText('Select object unknown').querySelector('rect')).toBeNull();
  });
});
describe('host integration guards', () => {
  it('disables missing command families and reacts to plugin registration', () => {
    const editor = createEditor({document:createDocument({slides:[{id:'s',objects:[object('text','text')]}]}),plugins:[presentationPlugin]});
    render(<EditorProvider editor={editor}><PresentationEditor/></EditorProvider>);
    select('text');
    expect(screen.getByLabelText('Text run 1')).toHaveAttribute('readonly');
    expect(screen.getByLabelText('Bold run 1')).toBeDisabled();
    act(()=>editor.registerPlugin(documentPlugin));
    expect(screen.getByLabelText('Text run 1')).not.toHaveAttribute('readonly');
    act(()=>editor.unregisterPlugin(presentationPlugin.id));
    expect(screen.getByText('Add slide')).toBeDisabled();
    expect(screen.getByText('Delete object')).toBeDisabled();
    expect(screen.getByLabelText('Width (pt)')).toBeDisabled();
  });
  it('keeps zoom unchanged for empty input and reports unsafe geometry clearly', () => {
    const {editor} = mount();
    fireEvent.click(screen.getByRole('tab',{name:'View'}));
    fireEvent.change(screen.getByLabelText('Zoom'),{target:{value:''}});
    fireEvent.blur(screen.getByLabelText('Zoom'));
    expect(screen.getByLabelText('Zoom')).toHaveValue(100);
    fireEvent.change(screen.getByLabelText('Zoom'),{target:{value:'5'}});
    expect(screen.getByLabelText('Zoom')).toHaveValue(5);
    fireEvent.change(screen.getByLabelText('Zoom'),{target:{value:'50'}});
    fireEvent.blur(screen.getByLabelText('Zoom'));
    expect(screen.getByLabelText('Zoom')).toHaveValue(50);
    select();
    fireEvent.change(screen.getByLabelText('Width (pt)'),{target:{value:'1e20'}});
    fireEvent.blur(screen.getByLabelText('Width (pt)'));
    expect(screen.getByRole('alert')).toHaveTextContent('safe integer');
    expect(editor.getSnapshot().revision).toBe(0);
  });
  it('generates distinct IDs when randomUUID is unavailable', () => {
    const {editor}=mount();
    const random = vi.spyOn(globalThis.crypto,'randomUUID').mockImplementation(undefined);
    // Older browsers expose getRandomValues without randomUUID.
    Object.defineProperty(globalThis.crypto,'randomUUID',{configurable:true,value:undefined});
    try {
      fireEvent.click(screen.getByText('Add slide'));
      fireEvent.click(screen.getByText('Add slide'));
      const ids=editor.getSnapshot().document.slides.map(slide=>slide.id);
      expect(new Set(ids).size).toBe(3);
      expect(ids[1]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    } finally { random.mockRestore(); }
  });
});
