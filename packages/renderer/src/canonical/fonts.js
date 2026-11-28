import { collectFontQueries, createFontAvailability } from '../text/fontReadiness.js';
export async function waitForCanonicalFonts(scene,{fonts=globalThis.document?.fonts,timeoutMs=2000,fontAvailability,canvas}={}) {
 let timer;
 try {
  const queries=[...collectFontQueries(scene.nodes.flatMap(n=>n.paint.text?[n.paint.text]:[]))].map(([font,chars])=>[font,[...chars].join('')]);
  if(!queries.length)return {status:'ready'};
  if(typeof fonts?.check!=='function'||typeof fonts?.load!=='function')return {status:'skipped',reason:'fonts-unavailable'};
  const availability=fontAvailability ?? createFontAvailability({fonts,canvas:canvas ?? globalThis.document?.createElement?.('canvas')});
  if(!availability.isAvailable(...queries[0]))return {status:'skipped',reason:'fonts-unavailable'};
  const missing=queries.filter(([font,text])=>!availability.isAvailable(font,text));
  const loads=missing.map(([font,text])=>Promise.resolve().then(()=>fonts.load(font,text)));
  const timeout=await Promise.race([Promise.allSettled(loads).then(()=>false),new Promise(resolve=>{timer=setTimeout(()=>resolve(true),timeoutMs);})]);
  availability.invalidate?.();
  return queries.every(([font,text])=>availability.isAvailable(font,text))?{status:'ready'}:{status:'skipped',reason:timeout?'fonts-timeout':'fonts-unavailable'};
 }catch{return {status:'failed',reason:'error',message:'Canvas font readiness failed.'};}
 finally{clearTimeout(timer);}
}
