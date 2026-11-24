import { resizeIneligibility, resizedGeometry } from '@stagecraft/core/lib/resizeGeometry.js';
import { canvasFont } from '../canvas/paint.js';
import { canonicalTextBody, themeForSlide } from './canonicalTextBody.js';
import { layoutTextBody } from '../vendor/officeview/drawing/text-layout.ts';
import { createTextBodyMeasurer } from '../vendor/officeview/drawing/text-paint.ts';
import { fontsReady } from './fontReadiness.js';
export const RESIZE_FIT_POLICY=Object.freeze({heightMargin:0.97});
export function resizeCandidates(document) {
 const candidates=[];
 for(const slide of document.slides??[]) {
  const theme=themeForSlide(document,slide);
  const visit=(objects,nested=false)=>{for(const object of objects??[]) {
   if(object.bodyLayout?.autofit==='resize') {
    let reason=document.extensions?.sourceFormat==='odp'?'not-pptx':nested?'grouped':resizeIneligibility(object,object.source?object:null,theme?.objectDefaults);
    const adapted=reason?null:canonicalTextBody(object,theme);
    if(!reason&&!adapted)reason='unsupported-metrics';
    if(!reason&&!adapted.body.paragraphs.some(p=>p.runs.some(r=>r.text.trim())))reason='empty-text';
    candidates.push({object,...adapted,reason});
   }
   visit(object.children,true);
  }};visit(slide.objects);
 }
 return candidates;
}
export function resizeFallback(document,status,reason,message) {
 let count=0;
 try {
  const pending=(document.slides??[]).flatMap(slide=>slide.objects??[]);
  while(pending.length){const object=pending.pop();if(object.bodyLayout?.autofit==='resize')count++;for(const child of object.children??[])pending.push(child);}
  if(!count&&status==='skipped'){reason='no-resize';message=undefined;}
 } catch {status='failed';reason='error';message='Resize measurement failed.';}
 return {resize:new Map(),status,count:0,reason,...(message?{message}:{}),stats:{candidates:count,measured:0,skipped:status==='skipped'?count:0,failed:status==='failed'?count:0},reasons:count?{[reason]:count}:{}};
}
export function measureResizeFits(document,{fonts=globalThis.document?.fonts,canvas}={}) {
 try {
  const candidates=resizeCandidates(document), resize=new Map(), stats={candidates:candidates.length,measured:0,skipped:0,failed:0},reasons={};
  const record=(bucket,reason)=>{stats[bucket]++;if(reason)reasons[reason]=(reasons[reason]??0)+1;};
  let measure, canvasAttempted=false; const checked=new Set();
  for(const candidate of candidates) {
   if(candidate.reason){record('skipped',candidate.reason);continue;}
   if(typeof fonts?.check!=='function'){record('skipped','fonts-unavailable');continue;}
   try {
    if(!fontsReady(candidate.body,candidate.theme,fonts,checked)){record('skipped','fonts-unavailable');continue;}
    if(!canvasAttempted){canvasAttempted=true;const ctx=(canvas??globalThis.document?.createElement('canvas'))?.getContext('2d');if(ctx)measure=createTextBodyMeasurer(ctx,canvasFont);}
    if(!measure){record('skipped','canvas-unavailable');continue;}
    const {object,body,width,height,availableHeight,theme}=candidate;
    const natural=layoutTextBody({...body,anchor:'t'},width,height,measure,theme).height;
    if(!Number.isFinite(natural)||natural<0){record('failed','error');continue;}
    if(natural<=availableHeight){record('measured','already-fits');continue;}
    const grown=Math.max(object.geometry.height,Math.ceil(natural/RESIZE_FIT_POLICY.heightMargin*9525+body.insetTopEmu+body.insetBottomEmu));
    if(!resizedGeometry(object,grown)){record('skipped','unsupported-geometry');continue;}
    resize.set(object.id,{height:grown});record('measured');
   }catch {record('failed','error');}
  }
  const status=stats.failed?'failed':stats.measured?'measured':'skipped';
  const reason=stats.failed?'error':!candidates.length?'no-resize':!resize.size?Object.keys(reasons)[0]:undefined;
  return {resize,status,count:resize.size,stats,reasons,...(reason?{reason}:{}),...(stats.failed?{message:'Resize measurement failed for some text boxes.'}:{})};
 }catch{return resizeFallback(document,'failed','error','Resize measurement failed.');}
}
