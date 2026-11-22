import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createDocument } from '@stagecraft/core/document';
import SourceWorkspace, { downloadSource } from './SourceWorkspace.jsx';

vi.mock('@stagecraft/react/presentation', async () => {
  const { useEditorSnapshot } = await import('@stagecraft/react/editor');
  return { PresentationEditor: ({ source, onExport }) => {
    const snapshot = useEditorSnapshot();
    return <div><output>{snapshot.document.metadata.title}</output><button onClick={() => onExport({ bytes: new Uint8Array([1]), dirtyParts: [] }, { revision: snapshot.revision })}>Export fixture</button></div>;
  } };
});
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const source = title => ({ document: createDocument({ metadata: { title } }), dispose: vi.fn() });
const choose = name => fireEvent.change(screen.getByLabelText('Open PPTX or ODP'), { target: { files: [new File(['test'], name)] } });

describe('local source workspace', () => {
  it('opens and exports using a host callback without changing the active source signal', async () => {
    const original = source('First'); const save = vi.fn();
    const load = vi.fn().mockResolvedValue(original);
    const view = render(<StrictMode><SourceWorkspace openSource={load} save={save} /></StrictMode>);
    choose('first.PPTX');
    await screen.findByText('First');
    expect(load.mock.calls[0][1].format).toBe('pptx');
    fireEvent.click(screen.getByText('Export fixture'));
    expect(save).toHaveBeenCalledWith(expect.anything(), { fileName: 'first.PPTX', format: 'pptx', revision: 0 });
    expect(load.mock.calls[0][1].signal.aborted).toBe(false);
    view.unmount();
    expect(original.dispose).toHaveBeenCalledTimes(1);
  });
  it('keeps the current document when a replacement fails', async () => {
    const original = source('Keep me');
    const load = vi.fn().mockResolvedValueOnce(original).mockRejectedValueOnce(Error('Invalid package'));
    render(<SourceWorkspace openSource={load} />);
    choose('good.odp'); await screen.findByText('Keep me');
    choose('bad.pptx'); await screen.findByRole('alert');
    expect(screen.getByText('Keep me')).toBeInTheDocument();
    expect(original.dispose).not.toHaveBeenCalled();
    expect(load.mock.calls[0][1].signal.aborted).toBe(false);
  });
  it('aborts obsolete loads and disposes late arrivals without replacing the latest document', async () => {
    const slow = deferred(), fast = deferred();
    const load = vi.fn().mockReturnValueOnce(slow.promise).mockReturnValueOnce(fast.promise);
    const a = source('Late'), b = source('Latest');
    render(<SourceWorkspace openSource={load} />);
    choose('slow.pptx'); choose('fast.odp');
    expect(load.mock.calls[0][1].signal.aborted).toBe(true);
    await act(async () => { fast.resolve(b); await fast.promise; });
    await screen.findByText('Latest');
    await act(async () => { slow.resolve(a); await slow.promise; });
    expect(screen.queryByText('Late')).not.toBeInTheDocument();
    expect(a.dispose).toHaveBeenCalledTimes(1); expect(b.dispose).not.toHaveBeenCalled();
  });
  it('releases replaced and unmounted sources and rejects invalid model imports', async () => {
    const a = source('First'), b = source('Second'), invalid = { document: {}, dispose: vi.fn() };
    const load = vi.fn().mockResolvedValueOnce(a).mockResolvedValueOnce(b).mockResolvedValueOnce(invalid);
    const view = render(<SourceWorkspace openSource={load} />);
    choose('first.pptx'); await screen.findByText('First');
    choose('second.odp'); await screen.findByText('Second');
    expect(a.dispose).toHaveBeenCalledTimes(1);
    choose('invalid.pptx'); await screen.findByRole('alert');
    expect(invalid.dispose).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Second')).toBeInTheDocument();
    view.unmount(); expect(b.dispose).toHaveBeenCalledTimes(1);
  });
  it('ignores a load that resolves after unmount and rejects legacy ppt files', async () => {
    const pending = deferred(), late = source('Late'); const load = vi.fn(() => pending.promise);
    const view = render(<SourceWorkspace openSource={load} />);
    choose('old.ppt'); expect(screen.getByRole('alert')).toHaveTextContent('.pptx or .odp'); expect(load).not.toHaveBeenCalled();
    choose('new.pptx'); view.unmount();
    expect(load.mock.calls[0][1].signal.aborted).toBe(true);
    await act(async () => { pending.resolve(late); await pending.promise; });
    expect(late.dispose).toHaveBeenCalledTimes(1);
  });
  it('downloads only when the host callback is invoked', async () => {
    vi.useFakeTimers();
    const oldCreate = URL.createObjectURL, oldRevoke = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => 'blob:fixture'); URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    try {
      downloadSource({ bytes: new Uint8Array([1, 2]) }, { fileName: 'file.pptx', format: 'pptx' });
      expect(click).toHaveBeenCalledOnce(); expect(URL.createObjectURL.mock.calls[0][0].type).toContain('presentationml');
      await vi.runAllTimersAsync(); expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fixture');
    } finally { click.mockRestore(); URL.createObjectURL = oldCreate; URL.revokeObjectURL = oldRevoke; vi.useRealTimers(); }
  });
});

it.each(['PPTX', 'ODP'])('creates a new local %s without a user file', async format => {
  const opened = source('New document');
  const load = vi.fn().mockResolvedValue(opened);
  render(<SourceWorkspace openSource={load} />);
  fireEvent.click(screen.getByRole('button', { name: `New ${format}` }));
  await screen.findByText('New document');
  const [file, options] = load.mock.calls[0];
  expect(file.name).toBe(`Untitled.${format.toLowerCase()}`);
  expect(file.size).toBeGreaterThan(0);
  expect(options.format).toBe(format.toLowerCase());
});
