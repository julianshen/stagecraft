import { expect,it,vi } from 'vitest';
import {waitForAutofitFonts} from './waitForAutofitFonts.js';
const object=(id,autofit,typeface)=>({id,type:'text',extensions:{stagecraftAuthored:true},geometry:{x:0,y:0,width:2667000,height:952500},bodyLayout:{autofit},text:{paragraphs:[{runs:[{text:'Both fonts',style:{sz:'1800',typeface}}]}]}});
it('loads the union of snapshot fonts in one wait and deduplicates queries',async()=>{
 const document={slides:[{objects:[object('a','shrink','Arial'),object('b','resize','Verdana'),object('c','resize','Arial')]}]};const loaded=new Set();
 const fonts={status:'loaded',check:vi.fn(query=>loaded.has(query)),load:vi.fn(async query=>{loaded.add(query);return [];}),ready:Promise.resolve()};
 const result=await waitForAutofitFonts(document,{fonts});expect(result).toEqual({shrink:{status:'ready'},resize:{status:'ready'}});expect(fonts.load.mock.calls.length).toBe(2);
 const checks=fonts.check.mock.calls.map(call=>call[0]).join(' ');expect(checks).toContain('Arial');expect(checks).toContain('Verdana');
});

it.each(['shrink','resize'])('isolates a rejected %s font from the other kind',async bad=>{
 const document={slides:[{objects:[object('s','shrink','Arial'),object('r','resize','Verdana')]}]},loaded=new Set();
 const badFamily=bad==='shrink'?'Arial':'Verdana';
 const fonts={status:'loading',check:q=>loaded.has(q),load:vi.fn(async q=>{if(q.includes(badFamily))throw Error('load rejected');loaded.add(q);}),ready:Promise.resolve()};
 const result=await waitForAutofitFonts(document,{fonts});
 expect(result[bad]).toEqual({status:'skipped',reason:'fonts-unavailable'});
 expect(result[bad==='shrink'?'resize':'shrink']).toEqual({status:'ready'});expect(fonts.load).toHaveBeenCalledTimes(2);
});
it.each(['shrink','resize'])('isolates a hanging %s font at the shared deadline',async bad=>{
 vi.useFakeTimers();try{
 const document={slides:[{objects:[object('s','shrink','Arial'),object('r','resize','Verdana')]}]},loaded=new Set();
 const badFamily=bad==='shrink'?'Arial':'Verdana';
 const fonts={status:'loading',check:q=>loaded.has(q),load:vi.fn(q=>q.includes(badFamily)?new Promise(()=>{}):Promise.resolve(loaded.add(q))),ready:new Promise(()=>{})};
 const pending=waitForAutofitFonts(document,{fonts,timeoutMs:20});await vi.advanceTimersByTimeAsync(20);const result=await pending;
 expect(result[bad]).toEqual({status:'skipped',reason:'fonts-timeout'});expect(result[bad==='shrink'?'resize':'shrink']).toEqual({status:'ready'});expect(fonts.load).toHaveBeenCalledTimes(2);expect(vi.getTimerCount()).toBe(0);
 }finally{vi.useRealTimers();}
});
it('reports unavailable APIs and sanitized non-load errors',async()=>{
 const document={slides:[{objects:[object('s','shrink','Arial'),object('r','resize','Verdana')]}]};
 expect(await waitForAutofitFonts(document,{fonts:{}})).toEqual({shrink:{status:'skipped',reason:'fonts-unavailable'},resize:{status:'skipped',reason:'fonts-unavailable'}});
 const failure={status:'failed',reason:'error',message:'Font readiness failed.'};
 expect(await waitForAutofitFonts(document,{fonts:{load:vi.fn(),check(){throw Error('SECRET');}}})).toEqual({shrink:failure,resize:failure});
});
it('does not wait on unrelated FontFaceSet.ready when both query sets are available',async()=>{
 const document={slides:[{objects:[object('s','shrink','Arial'),object('r','resize','Verdana')]}]};
 const fonts={status:'loading',load:vi.fn(),check:()=>true,ready:new Promise(()=>{})};
 expect(await waitForAutofitFonts(document,{fonts})).toEqual({shrink:{status:'ready'},resize:{status:'ready'}});expect(fonts.load).not.toHaveBeenCalled();
});
it('validates every initial font check before scheduling any load',async()=>{
 const document={slides:[{objects:[object('s','shrink','Arial'),object('r','resize','Verdana')]}]};
 const fonts={load:vi.fn(async()=>[]),check:vi.fn(q=>{if(q.includes('Verdana'))throw Error('SECRET');return false;})};
 const result=await waitForAutofitFonts(document,{fonts});
 expect(result.shrink.status).toBe('failed');expect(result.resize.status).toBe('failed');expect(fonts.load).not.toHaveBeenCalled();
});
