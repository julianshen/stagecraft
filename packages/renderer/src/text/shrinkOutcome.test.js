import { expect, it } from 'vitest';
import { measureShrinkFits } from './measureShrinkFits.js';
const fonts = {status:'loaded',check:()=>true};
const shrink = {id:'o',type:'text',geometry:{width:2000000,height:1000000},bodyLayout:{autofit:'shrink'},text:{paragraphs:[{runs:[{text:'Secret document text',style:{typeface:'Arial',sz:'1800'}}]}]}};
const doc = objects => ({slides:[{objects}]});
it('returns a typed unsupported-format outcome instead of a silent empty Map',()=>{
  const result=measureShrinkFits({...doc([shrink]),extensions:{sourceFormat:'odp'}},{fonts});
  expect(result).toMatchObject({status:'skipped',reason:'not-pptx',count:0});expect(result.fit.size).toBe(0);
});
it('distinguishes missing fonts and a missing canvas',()=>{
  expect(measureShrinkFits(doc([shrink]),{fonts:{}})).toMatchObject({status:'skipped',reason:'fonts-unavailable',count:0});
  expect(measureShrinkFits(doc([shrink]),{fonts,canvas:{getContext:()=>null}})).toMatchObject({status:'skipped',reason:'canvas-unavailable',count:0});
});
it('reports a measurement failure without leaking exception document content',()=>{
  const result=measureShrinkFits(doc([shrink]),{fonts,canvas:{getContext(){throw Error('Secret document text');}}});
  expect(result).toMatchObject({status:'failed',reason:'error',count:0,message:'Shrink measurement failed.'});expect(JSON.stringify(result)).not.toContain('Secret');
});

it('reports grouped shrink content as unsupported rather than absent',()=>{
 expect(measureShrinkFits(doc([{type:'group',children:[shrink]}]),{fonts})).toMatchObject({status:'skipped',reason:'unsupported-metrics',count:0});
});
