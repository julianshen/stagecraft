import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createEditor } from '@stagecraft/core/editor';
import { createDocument, documentPlugin, presentationPlugin } from '@stagecraft/core/document';
import { measureShrinkFits } from '@stagecraft/renderer';
import { EditorProvider } from './EditorProvider.jsx';
import { PresentationEditor } from './PresentationEditor.jsx';
vi.mock('@stagecraft/renderer', async original => ({ ...await original(), measureShrinkFits: vi.fn() }));
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a;reject=b; });return { promise, resolve, reject }; };
const fontDescriptor = Object.getOwnPropertyDescriptor(document, 'fonts');
let fonts, fit, editors;
beforeEach(() => {
  editors=[]; fit=new Map([['o',{fontScale:77500,lnSpcReduction:10000}]]);
  measureShrinkFits.mockReset().mockReturnValue({fit,status:'measured',count:1});
  fonts={status:'loaded',check:vi.fn(()=>true),load:vi.fn(async()=>[]),ready:Promise.resolve()};
  Object.defineProperty(document,'fonts',{configurable:true,value:fonts});
});
afterEach(() => { vi.useRealTimers();editors.forEach(e=>e.dispose());if(fontDescriptor)Object.defineProperty(document,'fonts',fontDescriptor);else delete document.fonts; });
function mount({format='pptx',readOnly=false,sourceReadOnly=false,edits=['text-body-layout'],onExport=vi.fn()}={}) {
  const d=createDocument({extensions:{sourceFormat:format},slides:[{id:'s',objects:[{id:'o',type:'text',geometry:{x:0,y:0,width:2667000,height:952500},extensions:{stagecraftAuthored:true},bodyLayout:{autofit:'shrink'},text:{paragraphs:[{id:'p',runs:[{id:'r',text:'Original overflowing content',editable:true,style:{sz:'1800',typeface:'Arial'},extensions:{stagecraftAuthored:true}}]}]}}]}]});
  const editor=createEditor({document:d,plugins:[documentPlugin,presentationPlugin]});editors.push(editor);
  const source={capabilities:{readOnly:sourceReadOnly,edits},export:vi.fn(async()=>({bytes:new Uint8Array([1])}))};
  const view=render(<EditorProvider editor={editor}><PresentationEditor source={source} readOnly={readOnly} onExport={onExport}/></EditorProvider>);
  return { ...view,editor,source,onExport };
}
it('passes a fit Map measured from exactly the exported snapshot', async()=>{
  const {editor,source,onExport}=mount();const captured=editor.getSnapshot().document;
  await act(async()=>fireEvent.click(screen.getByText('Export')));
  expect(measureShrinkFits).toHaveBeenCalledWith(captured,{fonts});
  expect(source.export).toHaveBeenCalledWith(captured,{fit});
  expect(source.export.mock.calls[0][0]).toBe(measureShrinkFits.mock.calls[0][0]);
  expect(onExport).toHaveBeenCalledWith(expect.anything(),{revision:0,shrinkFit:{status:'measured',count:1}});
});
it.each([{readOnly:true},{sourceReadOnly:true},{edits:[]},{format:'odp'},{format:'unknown'}])('exports without fit when measurement is not permitted: %j',async options=>{
  const {editor,source,onExport}=mount(options);
  await act(async()=>fireEvent.click(screen.getByText('Export')));
  expect(measureShrinkFits).not.toHaveBeenCalled();expect(fonts.load).not.toHaveBeenCalled();
  expect(source.export).toHaveBeenCalledWith(editor.getSnapshot().document);
  const reason=options.format?'not-pptx':options.edits?'no-capability':'locked';
  expect(onExport).toHaveBeenCalledWith(expect.anything(),{revision:0,shrinkFit:{status:'skipped',reason,count:0}});
});
it('keeps edits made during font loading out of measurement and export',async()=>{
  const pending=deferred();fonts.status='loading';fonts.check.mockReturnValue(false);fonts.load.mockReturnValue(pending.promise);
  const {editor,source}=mount();const captured=editor.getSnapshot().document;
  await act(async()=>fireEvent.click(screen.getByText('Export')));
  expect(source.export).not.toHaveBeenCalled();
  act(()=>editor.dispatch('document.setRunText',{runId:'r',text:'Later edit'}));
  await act(async()=>{fonts.status='loaded';fonts.check.mockReturnValue(true);pending.resolve([]);});
  expect(measureShrinkFits).toHaveBeenCalledWith(captured,{fonts});expect(source.export).toHaveBeenCalledWith(captured,{fit});
  expect(captured.slides[0].objects[0].text.paragraphs[0].runs[0].text).toBe('Original overflowing content');
  expect(editor.getSnapshot().document.slides[0].objects[0].text.paragraphs[0].runs[0].text).toBe('Later edit');
});
it('exports without fit after a font-readiness timeout and ignores late completion',async()=>{
  vi.useFakeTimers();const pending=deferred();fonts.status='loading';fonts.check.mockReturnValue(false);fonts.load.mockReturnValue(pending.promise);
  const {editor,source,onExport}=mount();
  await act(async()=>fireEvent.click(screen.getByText('Export')));
  expect(source.export).not.toHaveBeenCalled();
  await act(async()=>vi.advanceTimersByTimeAsync(2000));
  expect(onExport).toHaveBeenCalledWith(expect.anything(),{revision:0,shrinkFit:{status:'skipped',reason:'fonts-timeout',count:0}});
  expect(source.export).toHaveBeenCalledWith(editor.getSnapshot().document);expect(measureShrinkFits).not.toHaveBeenCalled();
  await act(async()=>{fonts.status='loaded';pending.resolve([]);});
  expect(source.export).toHaveBeenCalledTimes(1);expect(measureShrinkFits).not.toHaveBeenCalled();
});
it('exports without fit when loading fonts fails',async()=>{
  fonts.check.mockReturnValue(false);fonts.load.mockRejectedValue(Error('font unavailable'));
  const {editor,source,onExport}=mount();await act(async()=>fireEvent.click(screen.getByText('Export')));
  expect(onExport).toHaveBeenCalledWith(expect.anything(),{revision:0,shrinkFit:{status:'failed',reason:'error',message:'Font readiness failed.',count:0}});
  expect(source.export).toHaveBeenCalledWith(editor.getSnapshot().document);expect(measureShrinkFits).not.toHaveBeenCalled();
});
it('does not start an obsolete export after unmount during font readiness',async()=>{
  const pending=deferred();fonts.status='loading';fonts.check.mockReturnValue(false);fonts.load.mockReturnValue(pending.promise);
  const view=mount();await act(async()=>fireEvent.click(screen.getByText('Export')));view.unmount();
  await act(async()=>{fonts.status='loaded';pending.resolve([]);});
  expect(view.source.export).not.toHaveBeenCalled();expect(measureShrinkFits).not.toHaveBeenCalled();
});
it.each(['editor','source'])('does not start an obsolete export after %s replacement during font readiness',async kind=>{
  const pending=deferred();fonts.status='loading';fonts.check.mockReturnValue(false);fonts.load.mockReturnValue(pending.promise);
  const view=mount();await act(async()=>fireEvent.click(screen.getByText('Export')));
  const nextEditor=kind==='editor'?createEditor({document:view.editor.getSnapshot().document,plugins:[documentPlugin,presentationPlugin]}):view.editor;
  if(nextEditor!==view.editor)editors.push(nextEditor);
  const nextSource=kind==='source'?{...view.source,export:vi.fn()}:view.source;
  view.rerender(<EditorProvider editor={nextEditor}><PresentationEditor source={nextSource} onExport={view.onExport}/></EditorProvider>);
  await act(async()=>{fonts.status='loaded';fonts.check.mockReturnValue(true);pending.resolve([]);});
  expect(view.source.export).not.toHaveBeenCalled();expect(measureShrinkFits).not.toHaveBeenCalled();
});
it('exports without fit when browser font APIs are unavailable or measurement throws',async()=>{
  Object.defineProperty(document,'fonts',{configurable:true,value:undefined});const view=mount();
  await act(async()=>fireEvent.click(screen.getByText('Export')));
  expect(view.source.export).toHaveBeenLastCalledWith(view.editor.getSnapshot().document);
  expect(view.onExport).toHaveBeenLastCalledWith(expect.anything(),{revision:0,shrinkFit:{status:'skipped',reason:'fonts-unavailable',count:0}});
  Object.defineProperty(document,'fonts',{configurable:true,value:fonts});measureShrinkFits.mockImplementation(()=>{throw Error('canvas unavailable');});
  await act(async()=>fireEvent.click(screen.getByText('Export')));
  expect(view.source.export).toHaveBeenLastCalledWith(view.editor.getSnapshot().document);expect(view.source.export).toHaveBeenCalledTimes(2);
  expect(view.onExport).toHaveBeenLastCalledWith(expect.anything(),{revision:0,shrinkFit:{status:'failed',reason:'error',message:'Shrink measurement failed.',count:0}});
});
it.each(['prop','source','capability'])('omits fit when %s permission is revoked during font loading',async kind=>{
  const pending=deferred();fonts.status='loading';fonts.check.mockReturnValue(false);fonts.load.mockReturnValue(pending.promise);
  const view=mount();await act(async()=>fireEvent.click(screen.getByText('Export')));
  if(kind==='source')view.source.capabilities.readOnly=true;
  if(kind==='capability')view.source.capabilities.edits=[];
  view.rerender(<EditorProvider editor={view.editor}><PresentationEditor source={view.source} readOnly={kind==='prop'} onExport={view.onExport}/></EditorProvider>);
  await act(async()=>{fonts.status='loaded';fonts.check.mockReturnValue(true);pending.resolve([]);});
  expect(measureShrinkFits).not.toHaveBeenCalled();expect(view.source.export).toHaveBeenCalledWith(view.editor.getSnapshot().document);
  expect(view.onExport).toHaveBeenCalledWith(expect.anything(),{revision:0,shrinkFit:{status:'skipped',reason:'permission-revoked',count:0}});
});

it('reports no-fit when measurement produces no adjustment',async()=>{
  measureShrinkFits.mockReturnValue({fit:new Map(),status:'skipped',reason:'already-fits',count:0});const {onExport,source,editor}=mount();
  await act(async()=>fireEvent.click(screen.getByText('Export')));
  expect(onExport).toHaveBeenCalledWith(expect.anything(),{revision:0,shrinkFit:{status:'skipped',reason:'already-fits',count:0}});
  expect(source.export).toHaveBeenCalledWith(editor.getSnapshot().document);
});
