import { expect, it, vi } from 'vitest';
import { waitForShrinkFonts } from './measureShrinkFits.js';
const body = (id, text, style={}) => ({id,type:'text',geometry:{width:2667000,height:952500},bodyLayout:{autofit:'shrink'},text:{paragraphs:[{runs:[{text,style:{sz:'1800',typeface:'Arial',...style}}]}]}});
const doc = {slides:[{objects:[body('a','Hello')]},{objects:[body('b','漢字 مرحبا',{eastAsian:'Yu Gothic',complexScript:'Tahoma'})]}]};
it('loads the snapshot fonts including hidden-slide script faces and waits for readiness',async()=>{
  const loaded = new Set();
  const fonts={status:'loaded',check:vi.fn(spec=>loaded.has(spec)),load:vi.fn(async spec=>{loaded.add(spec);return [];}),ready:Promise.resolve()};
  expect(await waitForShrinkFonts(doc,{fonts})).toBe(true);
  const requests=fonts.load.mock.calls;
  expect(requests.some(([spec,text])=>spec.includes('Arial')&&text.includes('H'))).toBe(true);
  expect(requests.some(([spec,text])=>spec.includes('Yu Gothic')&&text.includes('漢'))).toBe(true);
  expect(requests.some(([spec,text])=>spec.includes('Tahoma')&&text.includes('م'))).toBe(true);
});
it('does not reload ready faces and returns false when the API is unavailable',async()=>{
  const fonts={status:'loaded',check:()=>true,load:vi.fn(),ready:Promise.resolve()};
  expect(await waitForShrinkFonts(doc,{fonts})).toBe(true);expect(fonts.load).not.toHaveBeenCalled();
  expect(await waitForShrinkFonts(doc,{fonts:undefined})).toBe(false);
});
it('bounds pending readiness even after all font loads complete',async()=>{
  vi.useFakeTimers();
  try {const fonts={status:'loading',check:()=>true,load:vi.fn(),ready:new Promise(()=>{})};
    const result=waitForShrinkFonts(doc,{fonts,timeoutMs:10});await vi.advanceTimersByTimeAsync(10);expect(await result).toBe(false);expect(vi.getTimerCount()).toBe(0);
  } finally {vi.useRealTimers();}
});
it('rejects a completed load whose requested faces are still unavailable',async()=>{
  const fonts={status:'loaded',check:()=>false,load:async()=>[],ready:Promise.resolve()};
  expect(await waitForShrinkFonts(doc,{fonts})).toBe(false);
});
it('does not wait for unrelated fonts when there is no eligible shrink text',async()=>{
  vi.useFakeTimers();
  try {const fonts={status:'loading',check:vi.fn(),load:vi.fn(),ready:new Promise(()=>{})};
    let done=false;waitForShrinkFonts({slides:[]},{fonts}).then(value=>{done=value;});
    await vi.advanceTimersByTimeAsync(0);expect(done).toBe(true);expect(vi.getTimerCount()).toBe(0);expect(fonts.load).not.toHaveBeenCalled();
  } finally {vi.useRealTimers();}
});
