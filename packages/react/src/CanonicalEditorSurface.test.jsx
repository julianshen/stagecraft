import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { openPresentation } from '@stagecraft/source';
import { writePptx } from '../../pptx/src/index.js';
import { writeOdp } from '../../odp/src/index.js';
import { createEditor } from '@stagecraft/core';
import { createDocument, documentPlugin } from '@stagecraft/core/document';
import { EditorProvider } from './EditorProvider.jsx';
import { CanonicalEditorSurface } from './CanonicalEditorSurface.jsx';

const fixture = () => createDocument({ slides: [{ id: 'slide', objects: [{ id: 'group', type: 'group', children: [{ id: 'object', type: 'text', geometry: { x: 100, y: 100, width: 3000000, height: 2000000 }, text: { paragraphs: [{ id: 'paragraph', style: { algn: 'ctr' }, runs: [{ id: 'run', text: 'Original', style: { b: '1', i: '1', sz: '2400' }, source: { format: 'pptx', part: 'ppt/slides/slide1.xml', path: [1, 2] } }] }] } }] }] }] });
const makeEditor = options => createEditor({ document: fixture(), plugins: [documentPlugin], ...options });
const run = e => e.getSnapshot().document.slides[0].objects[0].children[0].text.paragraphs[0].runs[0];
const source = () => ({ capabilities: { readOnly: false, edits: ['existing-run-text'] }, export: vi.fn(async () => ({ bytes: new Uint8Array([1]), dirtyParts: [], diagnostics: [] })), dispose: vi.fn() });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function mount(editor = makeEditor(), props = {}) {
  const view = render(<StrictMode><EditorProvider editor={editor}><CanonicalEditorSurface {...props} /></EditorProvider></StrictMode>);
  return { ...view, editor, replace: (nextEditor, nextProps) => view.rerender(<StrictMode><EditorProvider editor={nextEditor}><CanonicalEditorSurface {...nextProps} /></EditorProvider></StrictMode>) };
}

describe('CanonicalEditorSurface', () => {
  it('explains a legacy provider document instead of attempting canonical rendering', () => {
    mount(createEditor({ document: { title: 'Legacy', slides: [] } }));
    expect(screen.getByRole('alert')).toHaveTextContent('requires a canonical v1 document');
    expect(screen.queryByText('Undo')).toBeNull();
  });
  it.each(['tiny', 'bounds'])('reports unrepresentable %s preview geometry without nonfinite DOM attributes', kind => {
    const d = fixture();
    if (kind === 'tiny') d.size.width = Number.MIN_VALUE;
    else { d.size.width = 1; d.slides[0].objects[0].children[0].geometry.x = Number.MAX_VALUE; }
    mount(makeEditor({ document: d }));
    expect(screen.getByRole('alert')).toHaveTextContent('Preview unavailable');
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByLabelText('Text run 1').value).toBe('Original');
  });
  it.each(['source', 'editor', 'unmount'])('suppresses old export errors on %s replacement', async kind => {
    const s = source(), pending = deferred(), onExport = vi.fn(), onError = vi.fn(); s.export.mockReturnValue(pending.promise);
    const view = mount(undefined, { source: s, onExport, onError }); fireEvent.click(screen.getByText('Export'));
    if (kind === 'unmount') view.unmount();
    else view.replace(kind === 'editor' ? makeEditor() : view.editor, { source: kind === 'source' ? source() : s, onExport, onError });
    await act(async () => pending.reject(Error('Obsolete')));
    expect(onExport).not.toHaveBeenCalled(); expect(onError).not.toHaveBeenCalled();
  });

  it.each(['pptx', 'odp'])('round-trips %s through a real source session and undo', async format => {
    const deck = { title: 'Test', sections: [{ id: 'section', name: 'Slides', slides: ['slide'] }], slides: [{ id: 'slide', title: 'Title', layout: 'blank', elements: [{ id: 'text', type: 'text', x: 100, y: 100, w: 600, h: 120, content: 'Roundtrip', bold: true, fontSize: 24 }] }] };
    const bytes = await (format === 'pptx' ? writePptx(deck) : writeOdp(deck));
    const session = await openPresentation(bytes, { format });
    const editor = makeEditor({ document: session.document });
    const onExport = vi.fn(); mount(editor, { source: session, onExport });
    const field = screen.getAllByRole('textbox').find(node => node.value === 'Roundtrip');
    expect(field).toBeTruthy();
    fireEvent.change(field, { target: { value: 'Native edited' } });
    await act(async () => fireEvent.click(screen.getByText('Export')));
    await waitFor(() => expect(onExport).toHaveBeenCalledTimes(1));
    const output = onExport.mock.calls[0][0];
    const reopened = await openPresentation(output.bytes, { format });
    expect(reopened.document.slides.flatMap(s => s.objects).flatMap(o => o.text?.paragraphs ?? []).flatMap(p => p.runs).map(r => r.text).join('')).toContain('Native edited');
    expect(output.dirtyParts).toHaveLength(1);
    fireEvent.click(screen.getByText('Undo'));
    expect((await session.export(editor.getSnapshot().document)).bytes).toEqual(new Uint8Array(bytes));
    reopened.dispose(); session.dispose();
  });

  it('edits nested stable runs while retaining source/styles and shares undo/redo', () => {
    const { editor } = mount();
    const before = run(editor);
    fireEvent.change(screen.getByLabelText('Text run 1'), { target: { value: 'New <script>' } });
    expect(run(editor)).toEqual({ ...before, text: 'New <script>' });
    expect(screen.getByRole('img').textContent).toContain('New <script>');
    expect(screen.getByRole('img').querySelector('span').style.fontWeight).toBe('bold');
    expect(screen.getByRole('img').querySelector('p').style.textAlign).toBe('center');
    fireEvent.click(screen.getByText('Undo')); expect(run(editor).text).toBe('Original');
    fireEvent.click(screen.getByText('Redo')); expect(run(editor).text).toBe('New <script>');
    expect(screen.queryByText('Export')).toBeNull();
  });
  it('isolates editors and never disposes host resources', () => {
    const a = { ...makeEditor() }, b = makeEditor(), s = source(); a.dispose = vi.fn();
    const view = render(<><EditorProvider editor={a}><CanonicalEditorSurface source={s} /></EditorProvider><EditorProvider editor={b}><CanonicalEditorSurface /></EditorProvider></>);
    fireEvent.change(screen.getAllByLabelText('Text run 1')[0], { target: { value: 'A' } });
    expect(run(a).text).toBe('A'); expect(run(b).text).toBe('Original');
    view.unmount(); expect(a.dispose).not.toHaveBeenCalled(); expect(s.dispose).not.toHaveBeenCalled();
  });
  it.each(['prop', 'source', 'capability', 'run', 'ancestor'])('enforces %s read-only state', kind => {
    const d = fixture(), props = {};
    if (kind === 'prop') props.readOnly = true;
    if (kind === 'source') props.source = { ...source(), capabilities: { readOnly: true } };
    if (kind === 'capability') props.source = { ...source(), capabilities: { readOnly: false, edits: [] } };
    if (kind === 'run') d.slides[0].objects[0].children[0].text.paragraphs[0].runs[0].editable = false;
    if (kind === 'ancestor') d.slides[0].objects[0].type = 'opaque';
    const { editor } = mount(makeEditor({ document: d }), props);
    expect(screen.getByLabelText('Text run 1').readOnly).toBe(true);
    fireEvent.change(screen.getByLabelText('Text run 1'), { target: { value: 'Forbidden' } });
    expect(run(editor).text).toBe('Original');
    if (kind === 'prop' || kind === 'source' || kind === 'capability') expect(screen.getByText('Undo')).toBeDisabled();
  });
  it('shows authorization failure even when the error handler throws', () => {
    const onError = vi.fn(() => { throw Error('host'); });
    const { editor } = mount(makeEditor({ authorize: () => false }), { onError });
    fireEvent.change(screen.getByLabelText('Text run 1'), { target: { value: 'No' } });
    expect(run(editor).text).toBe('Original'); expect(screen.getByRole('alert')).toBeTruthy();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'UNAUTHORIZED' }));
    expect(screen.getByLabelText('Text run 1').value).toBe('Original');
  });
  it('reports stale rendered revision without overwriting newer state', () => {
    const editor = { ...makeEditor() }, dispatch = editor.dispatch, onError = vi.fn();
    editor.dispatch = (...args) => { dispatch('document.setRunText', { runId: 'run', text: 'Concurrent' }); return dispatch(...args); };
    mount(editor, { onError });
    fireEvent.change(screen.getByLabelText('Text run 1'), { target: { value: 'Stale' } });
    expect(run(editor).text).toBe('Concurrent');
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'STALE_REVISION' }));
  });
  it('captures snapshot/revision, allows ongoing edits, and locks duplicate exports', async () => {
    const s = source(), pending = deferred(), onExport = vi.fn(); s.export.mockReturnValue(pending.promise);
    const { editor } = mount(undefined, { source: s, onExport });
    const button = screen.getByText('Export');
    act(() => { fireEvent.click(button); fireEvent.click(button); });
    fireEvent.change(screen.getByLabelText('Text run 1'), { target: { value: 'Later' } });
    expect(s.export).toHaveBeenCalledTimes(1);
    expect(s.export.mock.calls[0][0].slides[0].objects[0].children[0].text.paragraphs[0].runs[0].text).toBe('Original');
    await act(async () => pending.resolve({ bytes: new Uint8Array([2]) }));
    expect(onExport).toHaveBeenCalledWith(expect.anything(), { revision: 0 });
    expect(run(editor).text).toBe('Later'); expect(screen.getByRole('status')).toHaveTextContent('Exported revision 0');
  });
  it.each(['source', 'editor', 'unmount'])('suppresses old export delivery on %s replacement', async kind => {
    const s = source(), pending = deferred(), onExport = vi.fn(), onError = vi.fn(); s.export.mockReturnValue(pending.promise);
    const view = mount(undefined, { source: s, onExport, onError }); fireEvent.click(screen.getByText('Export'));
    if (kind === 'unmount') view.unmount();
    else view.replace(kind === 'editor' ? makeEditor() : view.editor, { source: kind === 'source' ? source() : s, onExport, onError });
    await act(async () => pending.resolve({ bytes: new Uint8Array() }));
    expect(onExport).not.toHaveBeenCalled(); expect(onError).not.toHaveBeenCalled();
  });
  it('suppresses stale errors and safely isolates async callback failures', async () => {
    const s = source(), pending = deferred(), onError = vi.fn(() => Promise.reject(Error('reporting failed')));
    s.export.mockReturnValueOnce(pending.promise);
    const view = mount(undefined, { source: s, onExport: vi.fn(), onError }); fireEvent.click(screen.getByText('Export'));
    const next = source(); view.replace(view.editor, { source: next, onExport: async () => { throw Error('Delivery failed'); }, onError });
    await act(async () => pending.reject(Error('Stale'))); expect(onError).not.toHaveBeenCalled();
    await act(async () => fireEvent.click(screen.getByText('Export')));
    expect(screen.getByRole('alert')).toHaveTextContent('Delivery failed'); expect(screen.getByText('Export')).not.toBeDisabled();
  });
  it('keeps slide selection through edits and resets after slide removal', () => {
    const d = fixture(); d.slides.push({ id: 'second', objects: [] }); const { editor } = mount(makeEditor({ document: d }));
    fireEvent.click(screen.getByText('Slide 2')); expect(screen.getByText('Slide 2')).toHaveAttribute('aria-current', 'page');
    act(() => editor.dispatch('document.setRunText', { runId: 'run', text: 'Other slide' }));
    expect(screen.getByText('Slide 2')).toHaveAttribute('aria-current', 'page');
    act(() => editor.update(draft => ({ ...draft, slides: draft.slides.slice(0, 1) })));
    expect(screen.getByLabelText('Text run 1').value).toBe('Other slide');
  });
});

it('edits direct PPTX formatting, clears overrides and previews explicit native appearance', () => {
  const d = fixture();
  const original = d.slides[0].objects[0].children[0].text.paragraphs[0].runs[0];
  original.extensions = { pptxAppearance: { fontFamily: 'Arial', color: '#123456' } };
  const { editor } = mount(makeEditor({ document: d }));
  fireEvent.change(screen.getByLabelText('Bold run 1'), { target: { value: 'false' } });
  fireEvent.change(screen.getByLabelText('Italic run 1'), { target: { value: '' } });
  const size = screen.getByLabelText('Font size run 1');
  fireEvent.change(size, { target: { value: '18.25' } }); fireEvent.blur(size);
  expect(run(editor).style).toEqual({ b: '0', sz: '1825' });
  expect(size.value).toBe('18.25');
  const preview = screen.getByText('Original', { selector: 'span' });
  expect(preview.style.fontWeight).toBe('normal'); expect(preview.style.color).toBe('rgb(18, 52, 86)');
  expect(preview.style.fontFamily).toContain('Arial');
  fireEvent.click(screen.getByText('Undo')); expect(size.value).toBe('24');
  fireEvent.change(size, { target: { value: '0' } }); fireEvent.blur(size);
  expect(screen.getByRole('alert')).toBeTruthy(); expect(run(editor).style.sz).toBe('2400');
  expect(size.value).toBe('24');
  fireEvent.change(size, { target: { value: '' } }); fireEvent.blur(size);
  expect(run(editor).style.sz).toBeUndefined();
});
it('gates formatting separately from text editing and rejects denied formatting commands', () => {
  const view = mount(undefined, { source: source() });
  expect(screen.getByLabelText('Bold run 1')).toBeDisabled();
  expect(screen.getByLabelText('Text run 1')).not.toHaveAttribute('readonly');
  const editor = makeEditor({ authorize: () => false });
  view.replace(editor, { source: { ...source(), capabilities: { readOnly: false, edits: ['existing-run-text', 'existing-run-format'] } } });
  fireEvent.change(screen.getByLabelText('Bold run 1'), { target: { value: 'false' } });
  expect(run(editor).style.b).toBe('1'); expect(screen.getByRole('alert')).toBeTruthy();
});

it('formats ODP runs, previews imported styles and resets to Original without changing shared styles', async () => {
  const bytes = await writeOdp({ sections: [{ id: 'section', name: 'Slides', slides: ['s'] }], slides: [{ id: 's', layout: 'blank', elements: [{ id: 't', type: 'text', x: 0, y: 0, w: 300, h: 100, content: 'ODPformatted', fontFamily: "'Liberation Sans', serif", bold: true, fontSize: 24, color: '#123456' }] }] });
  const s = await openPresentation(bytes, { format: 'odp' });
  const { editor } = mount(makeEditor({ document: s.document }), { source: s });
  const preview = screen.getByText('ODPformatted', { selector: 'span' });
  const expected = document.createElement('span'); expected.style.fontFamily = "'Liberation Sans', serif";
  expect(preview.style.fontFamily).toBe(expected.style.fontFamily);
  expect(preview.style.fontWeight).toBe('bold');
  const bold = screen.getByLabelText('Bold run 1');
  expect(bold.value).toBe(''); expect(bold).not.toBeDisabled();
  expect(bold.options[0].text).toBe('Original');
  fireEvent.change(bold, { target: { value: 'false' } });
  expect(preview.style.fontWeight).toBe('normal');
  const changed = await s.export(editor.getSnapshot().document);
  const reopened = await openPresentation(changed.bytes, { format: 'odp' });
  expect(reopened.document.slides[0].objects[0].text.paragraphs[0].runs[0].extensions.odpAppearance.bold).toBe(false);
  fireEvent.change(bold, { target: { value: '' } });
  expect(preview.style.fontWeight).toBe('bold');
  expect((await s.export(editor.getSnapshot().document)).bytes).toEqual(bytes);
  s.dispose(); reopened.dispose();
});
