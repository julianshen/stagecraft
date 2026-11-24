import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createEditor } from '@stagecraft/core/editor';
import { createDocument, documentPlugin, presentationPlugin } from '@stagecraft/core/document';
import { measureResizeFits, measureShrinkFits } from '@stagecraft/renderer';
import { EditorProvider } from './EditorProvider.jsx';
import { PresentationEditor } from './PresentationEditor.jsx';
vi.mock('@stagecraft/renderer',async original=>({...await original(),measureResizeFits:vi.fn(),measureShrinkFits:vi.fn()}));
let fonts,editors;const descriptor=Object.getOwnPropertyDescriptor(document,'fonts');
beforeEach(()=>{editors=[];fonts={status:'loaded',check:vi.fn(()=>true),load:vi.fn(async()=>[]),ready:Promise.resolve()};Object.defineProperty(document,'fonts',{configurable:true,value:fonts});measureResizeFits.mockReset().mockReturnValue({resize:new Map([['o',{height:2000000}]]),status:'measured',count:1,stats:{candidates:1,measured:1,skipped:0,failed:0},reasons:{}});});
afterEach(()=>{editors.forEach(e=>e.dispose());vi.useRealTimers();if(descriptor)Object.defineProperty(document,'fonts',descriptor);else delete document.fonts;});
function mount({mixed=false,format='pptx',readOnly=false,edits=['text-body-layout','object-geometry']}={}){
 const d=createDocument({extensions:{sourceFormat:format},slides:[{id:'s',objects:[{id:'o',type:'text',geometry:{x:0,y:0,width:2667000,height:952500},extensions:{stagecraftAuthored:true},bodyLayout:{autofit:'resize'},text:{paragraphs:[{id:'p',runs:[{id:'r',text:'Original text',editable:true,style:{sz:'1800',typeface:'Arial'},extensions:{stagecraftAuthored:true}}]}]}}]}]});
 if(mixed){const o=structuredClone(d.slides[0].objects[0]);o.id='shrink';o.bodyLayout.autofit='shrink';o.text.paragraphs[0].id='sp';o.text.paragraphs[0].runs[0].id='sr';o.text.paragraphs[0].runs[0].style.typeface='Verdana';d.slides[0].objects.push(o);}
 const editor=createEditor({document:d,plugins:[documentPlugin,presentationPlugin]});editors.push(editor);const source={capabilities:{readOnly:false,edits},export:vi.fn(async()=>({bytes:new Uint8Array([1])}))},onExport=vi.fn();
 return{editor,source,onExport,...render(<EditorProvider editor={editor}><PresentationEditor source={source} readOnly={readOnly} onExport={onExport}/></EditorProvider>)};
}
it('exports a resize Map from the same snapshot and reports its outcome',async()=>{
 const {editor,source,onExport}=mount();const snapshot=editor.getSnapshot();await act(async()=>fireEvent.click(screen.getByText('Export')));
 expect(measureResizeFits).toHaveBeenCalledWith(snapshot.document,{fonts});expect(source.export).toHaveBeenCalledWith(snapshot.document,{resize:new Map([['o',{height:2000000}]])});expect(editor.getSnapshot()).toBe(snapshot);
 expect(onExport.mock.calls[0][1].resizeFit).toEqual({status:'measured',count:1,stats:{candidates:1,measured:1,skipped:0,failed:0},reasons:{}});
});
it.each([{readOnly:true},{edits:[]},{edits:['text-body-layout']},{edits:['object-geometry']},{format:'odp'}])('omits hints when ineligible %j',async options=>{
 const {editor,source,onExport}=mount(options);await act(async()=>fireEvent.click(screen.getByText('Export')));expect(measureResizeFits).not.toHaveBeenCalled();expect(source.export).toHaveBeenCalledWith(editor.getSnapshot().document);expect(onExport.mock.calls[0][1].resizeFit.status).toBe('skipped');
});
it('keeps a pending text edit outside the measured snapshot',async()=>{
 let resolve;fonts.check.mockReturnValue(false);fonts.load.mockReturnValue(new Promise(r=>resolve=r));
 const {editor,source}=mount(),captured=editor.getSnapshot().document;await act(async()=>fireEvent.click(screen.getByText('Export')));act(()=>editor.dispatch('document.setRunText',{runId:'r',text:'Later'}));
 await act(async()=>{fonts.check.mockReturnValue(true);resolve([]);});expect(measureResizeFits).toHaveBeenCalledWith(captured,{fonts});expect(source.export.mock.calls[0][0]).toBe(captured);
});
it('reports a font timeout and exports without a resize hint',async()=>{
 vi.useFakeTimers();fonts.check.mockReturnValue(false);fonts.load.mockReturnValue(new Promise(()=>{}));const {source,onExport}=mount();await act(async()=>fireEvent.click(screen.getByText('Export')));await act(async()=>vi.advanceTimersByTimeAsync(2000));
 expect(source.export).toHaveBeenCalledTimes(1);expect(source.export.mock.calls[0]).toHaveLength(1);expect(measureResizeFits).not.toHaveBeenCalled();expect(onExport.mock.calls[0][1].resizeFit).toMatchObject({status:'skipped',reason:'fonts-timeout',count:0});
});
it('reports measurement exceptions without document text and still exports',async()=>{
 measureResizeFits.mockImplementation(()=>{throw Error('SECRET CONTENT');});const {onExport,source}=mount();await act(async()=>fireEvent.click(screen.getByText('Export')));
 expect(source.export.mock.calls[0]).toHaveLength(1);expect(onExport.mock.calls[0][1].resizeFit).toMatchObject({status:'failed',reason:'error',count:0});expect(JSON.stringify(onExport.mock.calls[0][1])).not.toContain('SECRET CONTENT');
});
it('rechecks geometry permission after the wait',async()=>{
 let resolve;fonts.check.mockReturnValue(false);fonts.load.mockReturnValue(new Promise(r=>resolve=r));const view=mount();await act(async()=>fireEvent.click(screen.getByText('Export')));
 view.source.capabilities.edits=['text-body-layout'];view.rerender(<EditorProvider editor={view.editor}><PresentationEditor source={view.source} onExport={view.onExport}/></EditorProvider>);
 await act(async()=>{fonts.check.mockReturnValue(true);resolve([]);});expect(measureResizeFits).not.toHaveBeenCalled();expect(view.onExport.mock.calls[0][1].resizeFit.reason).toBe('permission-revoked');
});
it('shows the export-only resize disclosure in the inspector',()=>{
 mount();fireEvent.click(screen.getAllByLabelText('Select object o')[0]);expect(screen.getByText(/Exports from this editor size the box to fit, growing from its anchor/)).toBeVisible();
});
it.each(['source','editor','unmount'])('suppresses obsolete export after %s replacement',async kind=>{
 let resolve;fonts.check.mockReturnValue(false);fonts.load.mockReturnValue(new Promise(r=>resolve=r));const view=mount();await act(async()=>fireEvent.click(screen.getByText('Export')));
 if(kind==='unmount')view.unmount();else{
 const editor=kind==='editor'?createEditor({document:view.editor.getSnapshot().document,plugins:[documentPlugin,presentationPlugin]}):view.editor;if(editor!==view.editor)editors.push(editor);
 view.rerender(<EditorProvider editor={editor}><PresentationEditor source={kind==='source'?{...view.source}:view.source} onExport={view.onExport}/></EditorProvider>);
 }
 await act(async()=>{fonts.check.mockReturnValue(true);resolve([]);});expect(view.source.export).not.toHaveBeenCalled();expect(measureResizeFits).not.toHaveBeenCalled();
});

it.each([['resize','reject'],['resize','timeout'],['shrink','reject'],['shrink','timeout']])('exports the healthy fit when %s fonts %s',async(bad,mode)=>{
 vi.useFakeTimers();const loaded=new Set(),badFamily=bad==='resize'?'Arial':'Verdana';fonts.status='loading';fonts.check.mockImplementation(q=>loaded.has(q));fonts.load.mockImplementation(q=>q.includes(badFamily)?(mode==='reject'?Promise.reject(Error('font load')):new Promise(()=>{})):Promise.resolve(loaded.add(q)));
 measureShrinkFits.mockReturnValue({fit:new Map([['shrink',{fontScale:50000,lnSpcReduction:0}]]),status:'measured',count:1});
 const {source,onExport}=mount({mixed:true});await act(async()=>fireEvent.click(screen.getByText('Export')));if(mode==='timeout')await act(async()=>vi.advanceTimersByTimeAsync(2000));
 expect(source.export).toHaveBeenCalledTimes(1);const options=source.export.mock.calls[0][1],meta=onExport.mock.calls[0][1];
 expect(meta[bad+'Fit']).toMatchObject({status:'skipped',reason:mode==='timeout'?'fonts-timeout':'fonts-unavailable'});
 const good=bad==='resize'?'shrink':'resize';expect(meta[good+'Fit']).toMatchObject({status:'measured',count:1});expect(options[good==='shrink'?'fit':'resize'].size).toBe(1);expect(options[bad==='shrink'?'fit':'resize']).toBeUndefined();
});
