import { shrinkBodies } from './measureShrinkFits.js';
import { resizeCandidates } from './measureResizeFits.js';
import { waitForBodyFonts } from './fontReadiness.js';
/** One bounded wait for the union of fonts in the captured snapshot. */
export async function waitForAutofitFonts(document,{fonts=globalThis.document?.fonts,timeoutMs=2000,kinds=['shrink','resize']}={}) {
 const shrink=kinds.includes('shrink')?shrinkBodies(document):{bodies:[],reason:'no-shrink'};
 const resize=kinds.includes('resize')?resizeCandidates(document).filter(c=>!c.reason):[];
 const readiness=await waitForBodyFonts([...shrink.bodies,...resize],{fonts,timeoutMs});
 return {shrink:shrink.bodies.length?readiness:{status:'skipped',reason:shrink.reason},resize:resize.length?readiness:{status:'ready'}};
}
