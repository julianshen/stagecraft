import { resolvePreset } from '../vendor/officeview/drawing/geometry.ts';
import { paintGeometry } from '../vendor/officeview/drawing/paint.ts';
import { layoutTextBody } from '../vendor/officeview/drawing/text-layout.ts';
import { createTextBodyMeasurer, paintTextBody } from '../vendor/officeview/drawing/text-paint.ts';
import { canvasFont } from '../canvas/paint.js';
import { hexToRgb } from '@stagecraft/core/lib/color.js';
const environments=new WeakMap();
function state(environment) {
 const s=environments.get(environment);
 if(!s||s.disposed)throw Error('CANONICAL_ENVIRONMENT_DISPOSED');
 return s;
}
function cached(map,key,limit,create) {
 if(map.has(key)){const value=map.get(key);map.delete(key);map.set(key,value);return value;}
 const value=create();map.set(key,value);
 if(map.size>limit)map.delete(map.keys().next().value);
 return value;
}
export function createCanonicalPaintEnvironment({cacheLimit=128}={}) {
 if(!Number.isInteger(cacheLimit)||cacheLimit<1||cacheLimit>512)throw Error('INVALID_CANONICAL_CACHE_LIMIT');
 const s={layouts:new Map(),geometries:new Map(),layoutBuilds:0,disposed:false,epoch:0,limit:cacheLimit};
 const environment={get fontEpoch(){return s.epoch;},invalidateFonts(){state(environment);s.epoch++;s.layouts.clear();},dispose(){s.disposed=true;s.layouts.clear();s.geometries.clear();},getStats(){return {layoutEntries:s.layouts.size,geometryEntries:s.geometries.size,layoutBuilds:s.layoutBuilds,disposed:s.disposed};}};
 environments.set(environment,s);return Object.freeze(environment);
}
/** Local pixels; the stage owns placement and center rotation. */
export function paintCanonicalNode(ctx,node,environment) {
 const s=state(environment),{width,height}=node.frame,{shape,fill,text}=node.paint;
 ctx.save();
 try {
  if(shape&&fill) {
   const geometry=cached(s.geometries,JSON.stringify([shape,width,height]),s.limit,()=>resolvePreset(shape,width,height));
   paintGeometry(ctx,geometry,{fill:{kind:'solid',color:{...hexToRgb(fill),a:1}},issues:[]},width,height);
  }
  if(text) {
   const key=node.paint.layoutKey;
   const layout=cached(s.layouts,key,s.limit,()=>{s.layoutBuilds++;return layoutTextBody(text.body,width,height,createTextBodyMeasurer(ctx,canvasFont),text.theme);});
   paintTextBody(text.body,ctx,0,0,width,height,canvasFont,text.theme,{layout,clip:{x:0,y:0,width,height}});
  }
 }finally{ctx.restore();}
}
export function paintCanonicalScene(ctx,scene,environment) {
 state(environment);ctx.save();
 try {
  ctx.fillStyle=scene.background;ctx.fillRect(0,0,scene.width,scene.height);
  for(const node of scene.nodes){const f=node.frame;ctx.save();try{ctx.translate(f.x+f.width/2,f.y+f.height/2);ctx.rotate(f.rotation*Math.PI/180);ctx.translate(-f.width/2,-f.height/2);paintCanonicalNode(ctx,node,environment);}finally{ctx.restore();}}
 }finally{ctx.restore();}
}
