import { shrinkBodies } from './measureShrinkFits.js';
import { resizeCandidates } from './measureResizeFits.js';
import { collectFontQueries } from './fontReadiness.js';
/** One bounded loading pass; each kind checks only its own snapshot fonts. */
export async function waitForAutofitFonts(document,{fonts=globalThis.document?.fonts,timeoutMs=2000,kinds=['shrink','resize'],baseline}={}) {
 let timer;
 try {
  const shrink=kinds.includes('shrink')?shrinkBodies(document,{baseline}):{bodies:[],reason:'no-shrink',candidates:0,reasons:{}};
  const resize=kinds.includes('resize')?resizeCandidates(document,{baseline}).filter(c=>!c.reason):[];
  const queries={shrink:collectFontQueries(shrink.bodies),resize:collectFontQueries(resize)};
  const available=typeof fonts?.load==='function'&&typeof fonts?.check==='function';
  let timedOut=false;
  if(available) {
   const union=new Map();
   for(const group of Object.values(queries))for(const [font,chars] of group) {
    if(!union.has(font))union.set(font,new Set());
    for(const char of chars)union.get(font).add(char);
   }
   const missing=[...union].map(([font,chars])=>[font,[...chars].join('')])
    .filter(([font,text])=>!fonts.check(font,text));
   const loads=missing.map(([font,text])=>Promise.resolve().then(()=>fonts.load(font,text)));
   timedOut=await Promise.race([
    Promise.allSettled(loads).then(()=>false),
    new Promise(resolve=>{timer=setTimeout(()=>resolve(true),timeoutMs);}),
   ]);
  }
  const readiness=kind=>available&&[...queries[kind]].every(([font,chars])=>fonts.check(font,[...chars].join('')))
   ?{status:'ready'}:{status:'skipped',reason:timedOut?'fonts-timeout':'fonts-unavailable'};
  return {shrink:shrink.bodies.length?readiness('shrink'):{status:'skipped',reason:shrink.reason,count:0,reasons:shrink.reasons},resize:resize.length?readiness('resize'):{status:'ready'}};
 }catch {
  const failure={status:'failed',reason:'error',message:'Font readiness failed.'};
  return {shrink:failure,resize:failure};
 }finally{clearTimeout(timer);}
}
