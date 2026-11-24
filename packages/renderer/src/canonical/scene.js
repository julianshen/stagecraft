import { validateAuthoredObject } from '@stagecraft/core/document';
import { AUTHORED_TEXT_COLOR } from '@stagecraft/core/lib/authoredText.js';
import { canonicalTextBody, themeForSlide, layoutForSlide } from '../text/canonicalTextBody.js';
const PX = 9525;
const color = value => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
const authored = item => item?.extensions?.stagecraftAuthored === true && !item.source;
const extraKeys = (value, keys) => Object.keys(value ?? {}).some(key => !keys.includes(key));
const freeze = value => {
 if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
 return value;
};
const unsupported = (reason, code, objectId) => ({status:'unsupported',reason,diagnostics:[{code,...(objectId?{objectId}:{})}]});
const validGeometry = g => g && ['x','y','width','height'].every(k=>Number.isSafeInteger(g[k])) && g.width>0 && g.height>0
 && Number.isSafeInteger(g.x+g.width) && Number.isSafeInteger(g.y+g.height) && (g.rotation===undefined||Number.isFinite(g.rotation));
function displayText(object, theme) {
 const adapted=canonicalTextBody(object,theme);
 if(!adapted)return null;
 for(const [pi,p] of adapted.body.paragraphs.entries()) {
  for(const [ri,r] of p.runs.entries())r.color=object.text.paragraphs[pi].runs[ri].style?.color??AUTHORED_TEXT_COLOR;
  p.endProperties.color=p.runs.at(-1).color;
 }
 return {body:adapted.body,theme:adapted.theme};
}
export function buildCanonicalScene(document,slideId) {
 if(document?.schemaVersion!==1||document.units!=='emu'||!Array.isArray(document.slides))return unsupported('not-canonical','document-model');
 if(document.extensions?.sourceFormat && document.extensions.sourceFormat!=='pptx')return unsupported('unsupported-format','format');
 const slide=document.slides.find(s=>s.id===slideId);
 if(!slide)return unsupported('no-slide','slide-missing');
 const size=document.size;
 if(!size||![size.width,size.height].every(n=>Number.isSafeInteger(n)&&n>0))return unsupported('invalid-geometry','slide-size');
 if(!authored(slide))return unsupported('unresolved-appearance','native-slide-appearance');
 if(slide.layoutId!=null&&slide.layoutId!==document.layouts?.[0]?.id)return unsupported('inherited-appearance','authored-layout-mismatch');
 const layout=layoutForSlide(document,slide),master=document.masters?.find(m=>m.id===layout?.masterId);
 if([layout,master].some(v=>v?.objects?.length))return unsupported('inherited-appearance','inherited-artwork');
 if([layout,master].some(v=>v?.source||v?.background)&&!slide.background)return unsupported('inherited-appearance','inherited-background');
 if(slide.background && (slide.background.type!=='solid'||!color(slide.background.color)||extraKeys(slide.background,['type','color'])))return unsupported('unsupported-content','slide-background');
 const nodes=[],theme=themeForSlide(document,slide),seen=new Set();
 for(const object of slide.objects) {
  if(!object.id||seen.has(object.id))return unsupported('unsupported-content','object-identity',object.id);
  seen.add(object.id);
  if(!['text','shape'].includes(object.type))return unsupported('unsupported-content','object-type',object.id);
  if(!authored(object))return unsupported('unresolved-appearance','native-object-appearance',object.id);
  if(!validGeometry(object.geometry))return unsupported('invalid-geometry','object-geometry',object.id);
  try { validateAuthoredObject(object); }
  catch { return unsupported('unsupported-content','authored-object-schema',object.id); }
  if(theme?.objectDefaults?.[object.type==='text'?'txDef':'spDef'])return unsupported('inherited-appearance','theme-object-defaults',object.id);
  const text=object.text?displayText(object,theme):null;
  if(object.text&&!text)return unsupported('unsupported-content','text-format',object.id);
  const g=object.geometry;
  nodes.push({id:object.id,type:object.type,geometry:{...g},frame:{x:g.x/PX,y:g.y/PX,width:g.width/PX,height:g.height/PX,rotation:g.rotation??0},hitShape:object.shape??'rect',textIds:object.text?.paragraphs.map(p=>({paragraphId:p.id,runIds:p.runs.map(r=>r.id)}))??[],paint:{shape:object.shape??'rect',fill:object.fill??null,text,layoutKey:text?JSON.stringify([g.width/PX,g.height/PX,text]):null}});
 }
 return {status:'ready',scene:freeze(structuredClone({slideId:slide.id,width:size.width/PX,height:size.height/PX,background:slide.background?.color??'#ffffff',nodes}))};
}
