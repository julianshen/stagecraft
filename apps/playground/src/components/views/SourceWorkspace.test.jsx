import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createDocument } from '@stagecraft/core/document';
import SourceWorkspace, { downloadSource } from './SourceWorkspace.jsx';

vi.mock('@stagecraft/react/presentation', async () => {
  const { useEditorSnapshot } = await import('@stagecraft/react/editor');
  return { PresentationEditor: ({ source, onExport }) => {
    const snapshot = useEditorSnapshot();
    return <div><output>{snapshot.document.metadata.title}</output><button onClick={() => onExport({ bytes: new Uint8Array([1]), dirtyParts: [] }, { revision: snapshot.revision, shrinkFit: source.shrinkFit, resizeFit: source.resizeFit })}>Export fixture</button></div>;
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

it.each(['PPTX', 'ODP'])('creates a new local %s without a user file via createPresentation', async format => {
  const opened = source('New document');
  const create = vi.fn().mockResolvedValue(opened);
  const load = vi.fn();
  render(<SourceWorkspace createSource={create} openSource={load} />);
  fireEvent.click(screen.getByRole('button', { name: `New ${format}` }));
  await screen.findByText('New document');
  expect(load).not.toHaveBeenCalled();
  expect(create).toHaveBeenCalledWith(expect.objectContaining({
    format: format.toLowerCase(),
    title: 'Untitled',
    signal: expect.any(AbortSignal),
  }));
  expect(screen.getByLabelText(`Untitled.${format.toLowerCase()}`)).toBeInTheDocument();
});

it('aborts a pending open and bumps generation when an unsupported file is selected', async () => {
  const slow = deferred();
  const lateA = source('Late A');
  const load = vi.fn().mockReturnValueOnce(slow.promise);
  render(<SourceWorkspace openSource={load} />);

  choose('A.pptx');
  expect(screen.getByRole('status')).toHaveTextContent('Opening presentation…');
  expect(load.mock.calls[0][1].signal.aborted).toBe(false);

  choose('bad.txt');
  expect(load.mock.calls[0][1].signal.aborted).toBe(true);
  expect(screen.getByRole('alert')).toHaveTextContent('Choose a .pptx or .odp file.');
  expect(screen.queryByText('Opening presentation…')).toBeNull();

  await act(async () => { slow.resolve(lateA); await slow.promise; });
  expect(screen.queryByText('Late A')).toBeNull();
  expect(lateA.dispose).toHaveBeenCalledTimes(1);
});

it.each([
 [{status:'measured',count:2},'Shrink-to-fit measured for 2 text boxes.'],
 [{status:'skipped',reason:'already-fits',count:0},'Text already fits its frame.'],
 [{status:'skipped',reason:'no-shrink',count:0},'No shrink-to-fit text to measure.'],
 [{status:'failed',reason:'error',message:'Private document details',count:0},'Shrink-to-fit measurement failed.'],
])('shows the export outcome %j without exposing internal messages',async(shrinkFit,text)=>{
 const opened={...source('Outcomes'),shrinkFit};render(<SourceWorkspace openSource={async()=>opened} save={vi.fn()}/>);choose('status.pptx');await screen.findByText('Outcomes');
 fireEvent.click(screen.getByText('Export fixture'));expect(await screen.findByRole('status',{name:'Export result'})).toHaveTextContent(text);expect(screen.getByRole('status',{name:'Export result'})).not.toHaveTextContent(/Exported revision/);expect(screen.queryByText(/Private document details/)).toBeNull();expect(screen.queryByRole('alert')).toBeNull();
});
it.each([
 [{shrinkReasons:{'unchanged-native':1},resizeReasons:{}},'1 text box unchanged since import was left as PowerPoint saved it.'],
 [{shrinkReasons:{'unchanged-native':2},resizeReasons:{'unchanged-native':1}},'3 text boxes unchanged since import were left as PowerPoint saved them.'],
])('explains untouched native autofit boxes %j',async({shrinkReasons,resizeReasons},text)=>{
 const opened={...source('Native outcomes'),shrinkFit:{status:'skipped',reason:'unchanged-native',count:0,reasons:shrinkReasons},...(Object.keys(resizeReasons).length?{resizeFit:{status:'skipped',reason:'unchanged-native',count:0,reasons:resizeReasons}}:{})};
 render(<SourceWorkspace openSource={async()=>opened} save={vi.fn()}/>);choose('native.pptx');await screen.findByText('Native outcomes');
 fireEvent.click(screen.getByText('Export fixture'));expect(await screen.findByRole('status',{name:'Export result'})).toHaveTextContent(text);
});

it('suppresses old export feedback after document replacement during save',async()=>{
 const pending=deferred(), a={...source('A'),shrinkFit:{status:'measured',count:1}},b=source('B');
 render(<SourceWorkspace openSource={vi.fn().mockResolvedValueOnce(a).mockResolvedValueOnce(b)} save={()=>pending.promise}/>);choose('a.pptx');await screen.findByText('A');fireEvent.click(screen.getByText('Export fixture'));choose('b.pptx');await screen.findByText('B');await act(async()=>pending.resolve());expect(screen.queryByText(/Shrink-to-fit measured/)).toBeNull();
});

it('does not carry export feedback into a replacement already loading',async()=>{
 const pending=deferred(),a={...source('A'),shrinkFit:{status:'measured',count:1}},b=source('B');
 render(<SourceWorkspace openSource={vi.fn().mockResolvedValueOnce(a).mockReturnValueOnce(pending.promise)} save={vi.fn()}/>);choose('a.pptx');await screen.findByText('A');choose('b.pptx');fireEvent.click(screen.getByText('Export fixture'));await act(async()=>{});await act(async()=>pending.resolve(b));await screen.findByText('B');expect(screen.queryByLabelText('Export result')).toBeNull();
});

it.each([
 [{status:'measured',count:1,stats:{skipped:1}},'Sized 1 text box for export; the canvas size is unchanged. 1 text box was skipped.'],
 [{status:'measured',count:0,stats:{skipped:0}},'Resize text already fits; no growth was needed.'],
 [{status:'failed',count:1,stats:{failed:1,skipped:0},message:'SECRET'},'Resize measurement failed for 1 text box. 1 box was sized for export.'],
 [{status:'skipped',count:0,reason:'no-resize'},'No resize text to measure.'],
])('shows resize outcome %j',async(resizeFit,text)=>{
 const opened={...source('Resize outcomes'),resizeFit};render(<SourceWorkspace openSource={async()=>opened} save={vi.fn()}/>);choose('status.pptx');await screen.findByText('Resize outcomes');
 fireEvent.click(screen.getByText('Export fixture'));expect(await screen.findByLabelText('Export result')).toHaveTextContent(text);expect(screen.queryByText(/SECRET/)).toBeNull();
});
