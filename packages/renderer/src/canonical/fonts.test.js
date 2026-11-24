import {expect,it,vi} from 'vitest';
import {buildCanonicalScene,waitForCanonicalFonts} from './index.js';
import {box,deck} from '../../../../tests/helpers/canonicalScene.js';
const scene=()=>buildCanonicalScene(deck(),'s').scene;
it('loads only scene queries once and does not wait on unrelated fonts',async()=>{
 const s=scene(),loaded=new Set(),fonts={status:'loading',ready:new Promise(()=>{}),check:vi.fn(q=>loaded.has(q)),load:vi.fn(async q=>loaded.add(q))};
 expect(await waitForCanonicalFonts(s,{fonts})).toEqual({status:'ready'});expect(fonts.load).toHaveBeenCalledTimes(1);expect(fonts.load.mock.calls[0][0]).toContain('Arial');
});
it('returns ready for shape-only scenes without a font API',async()=>{
 const s=buildCanonicalScene(deck([box({type:'shape',shape:'rect',fill:'#ff0000',text:undefined})]),'s').scene;
 expect(await waitForCanonicalFonts(s,{fonts:{}})).toEqual({status:'ready'});
});
it('reports missing APIs, rejected loads and thrown checks without leaking content',async()=>{
 expect(await waitForCanonicalFonts(scene(),{fonts:{}})).toEqual({status:'skipped',reason:'fonts-unavailable'});
 expect(await waitForCanonicalFonts(scene(),{fonts:{check:()=>false,load:()=>Promise.reject(Error('SECRET'))}})).toEqual({status:'skipped',reason:'fonts-unavailable'});
 expect(await waitForCanonicalFonts(scene(),{fonts:{check:()=>{throw Error('SECRET');},load:vi.fn()}})).toEqual({status:'failed',reason:'error',message:'Canvas font readiness failed.'});
});
it('bounds a stalled font load and releases its deadline timer',async()=>{
 vi.useFakeTimers();try{const pending=waitForCanonicalFonts(scene(),{fonts:{check:()=>false,load:()=>new Promise(()=>{})},timeoutMs:20});await vi.advanceTimersByTimeAsync(20);expect(await pending).toEqual({status:'skipped',reason:'fonts-timeout'});expect(vi.getTimerCount()).toBe(0);}finally{vi.useRealTimers();}
});
