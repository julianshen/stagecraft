import { validateAuthoredObject } from '@stagecraft/core/document';
import { AUTHORED_TEXT_COLOR } from '@stagecraft/core/lib/authoredText.js';
import {
 isNativeLayoutAppearanceValid, isNativeObjectAppearanceValid, isNativeSlideAppearanceValid,
 nativeAutofitEffectiveFit, nativeLayoutAppearanceInput, nativeObjectAppearanceInput, nativeSlideAppearanceInput,
  nativeAppearanceContext, nativeTextFontSlots, nativeTextScripts,
} from '@stagecraft/core/lib/nativeAppearance.js';
import { canonicalTextBody, themeForSlide, layoutForSlide } from '../text/canonicalTextBody.js';
import { scaledTextBody } from '../text/measureShrinkFits.js';
import { resolveTextFamily } from '../vendor/officeview/drawing/text-layout.ts';
import { fontQueries } from '../text/fontReadiness.js';
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
const nativeShrinkParagraphMetricsSupported = body => body.paragraphs.every(p=>(!p.lineSpacing
 ||p.lineSpacing.kind==='percent'&&Number.isFinite(p.lineSpacing.value))&&(!p.spaceBefore||p.spaceBefore.value===0)&&(!p.spaceAfter||p.spaceAfter.value===0));
export function rendererNativeAppearanceContext(document, slide) {
 return nativeAppearanceContext(document, slide);
}
function proofCheck(entity, expectedInput, validate, missingCode='native-appearance-proof-missing') {
 const proof=entity?.extensions?.stagecraftNativeAppearance
  ??entity?.extensions?.stagecraftSlideAppearance
  ??entity?.extensions?.stagecraftLayoutSummary;
 if(!proof)return { valid:false, code:missingCode };
 if(typeof proof.input!=='string')return { valid:false, code:'native-appearance-proof-invalid' };
 if(expectedInput!==null&&proof.input!==expectedInput)
  return { valid:false, code:'native-appearance-stale' };
 try { if(validate())return {valid:true,proof}; }
 catch { /* A malformed proof is a fixed refusal, not a scene-build exception. */ }
 return { valid:false, code:'native-appearance-proof-invalid' };
}
function appearanceBackground(value) {
 if(value?.kind==='solid'&&color(value.color))return value.color;
 if(value?.kind==='none')return '#FFFFFF';
 return null;
}
function proofResult(reason, code, objectId) { return unsupported(reason,code,objectId); }
const runScriptSlot = scripts => {
 if(scripts.length!==1||scripts[0]==='Other')return null;
 const script=scripts[0];
 if(['Hani','Hira','Kana','Hang'].includes(script))return 'eastAsian';
 if(['Latn','Cyrl','Grek','Armn','Geor','Cher','Cans','Yiii'].includes(script))return 'latin';
 return 'complexScript';
};
const familyField = {latin:'fontFamily',eastAsian:'fontFamilyEastAsia',complexScript:'fontFamilyComplexScript'};
const sampleText = {latin:'A',eastAsian:'漢',complexScript:'م'};
function nativeRunFonts(run, theme, resolved) {
 const style=run.style??{},language=style.lang??style.language;
 const input={language,fontFamily:style.typeface,fontFamilyEastAsia:style.eastAsian,fontFamilyComplexScript:style.complexScript};
 const fontTheme=theme?.fonts?theme:undefined;
 const families={
  latin:resolveTextFamily({...input,text:sampleText.latin},fontTheme),
  eastAsian:resolveTextFamily({...input,text:sampleText.eastAsian},fontTheme),
  complexScript:resolveTextFamily({...input,text:sampleText.complexScript},fontTheme),
 };
 const currentSlot=runScriptSlot(nativeTextScripts(run.text));
 const sourceScript=run.extensions?.pptxAppearance?.script;
 if(currentSlot&&sourceScript&&runScriptSlot([sourceScript])===currentSlot&&resolved?.[familyField[currentSlot]])
  families[currentSlot]=resolved[familyField[currentSlot]];
 return families;
}
function nativeDisplayObject(object, appearance, theme) {
 const display=structuredClone(object),paragraphProof=appearance.text?.paragraphs??[];
 for(const [pi,paragraph] of display.text.paragraphs.entries()){
  const proof=paragraphProof[pi];
  for(const run of paragraph.runs){
   const resolved=run.extensions?.pptxAppearance?.resolved;
   if(!resolved)return null;
   const families=nativeRunFonts(run,theme,resolved),style=run.style??{};
   run.style={...style,typeface:families.latin,eastAsian:families.eastAsian,complexScript:families.complexScript,
    sz:style.sz??String(Math.round(resolved.fontSizePt*100)),b:style.b??(resolved.bold?'1':'0'),i:style.i??(resolved.italic?'1':'0'),
    color:style.color??resolved.color};
   // The source proof establishes complete appearance; editability remains a separate capability.
   run.editable=true;
  }
  if(proof?.endRun){
   const last=paragraph.runs.at(-1),end=proof.endRun;
   const fonts=last?nativeRunFonts(last,theme,end):null;
   paragraph.extensions={...paragraph.extensions,pptxEndRunAppearance:{...end,
    ...(fonts?{fontFamily:fonts.latin,fontFamilyEastAsia:fonts.eastAsian,fontFamilyComplexScript:fonts.complexScript}:{})}};
  }
 }
 return display;
}
function displayText(object, theme, appearance=null) {
 const source=appearance?nativeDisplayObject(object,appearance,theme):object;
 if(!source)return null;
 // Native proof fonts are resolved before paint; the painter receives literal faces only.
 const adapted=canonicalTextBody(source,appearance?undefined:theme);
 if(!adapted)return null;
 if(appearance&&object.source?.format==='pptx')adapted.body.powerPoint=true;
 for(const [pi,p] of adapted.body.paragraphs.entries()) {
  for(const [ri,r] of p.runs.entries())r.color=source.text.paragraphs[pi].runs[ri].style?.color??AUTHORED_TEXT_COLOR;
  const end=source.text.paragraphs[pi].extensions?.pptxEndRunAppearance;
  if(appearance&&end)p.endProperties={...p.endProperties,fontSizePt:end.fontSizePt,fontFamily:end.fontFamily,
   fontFamilyEastAsia:end.fontFamilyEastAsia,fontFamilyComplexScript:end.fontFamilyComplexScript,bold:end.bold,italic:end.italic,color:end.color};
  else p.endProperties.color=end?.color??p.runs.at(-1).color;
 }
 return {body:adapted.body,theme:adapted.theme};
}
export function buildCanonicalScene(document,slideId,{fontAvailability}={}) {
 if(document?.schemaVersion!==1||document.units!=='emu'||!Array.isArray(document.slides))return unsupported('not-canonical','document-model');
 if(document.extensions?.sourceFormat && document.extensions.sourceFormat!=='pptx')return unsupported('unsupported-format','format');
 const slide=document.slides.find(s=>s.id===slideId);
 if(!slide)return unsupported('no-slide','slide-missing');
 const size=document.size;
 if(!size||![size.width,size.height].every(n=>Number.isSafeInteger(n)&&n>0))return unsupported('invalid-geometry','slide-size');
 const nativeSlide=slide.source?.format==='pptx';
 const authoredSlide=authored(slide);
 if(!nativeSlide&&!authoredSlide)return unsupported('unresolved-appearance','native-appearance-proof-missing');
 if(authoredSlide&&slide.layoutId!=null&&slide.layoutId!==document.layouts?.[0]?.id)return unsupported('inherited-appearance','authored-layout-mismatch');
 const layout=nativeSlide?document.layouts?.find(item=>item.id===slide.layoutId):layoutForSlide(document,slide);
 const master=document.masters?.find(item=>item.id===(slide.masterId??layout?.masterId));
 if(nativeSlide&&[layout,master].some(value=>value?.objects?.length))return unsupported('inherited-appearance','inherited-artwork');
 if(!nativeSlide&&[layout,master].some(value=>value?.objects?.length))return unsupported('inherited-appearance','inherited-artwork');
 const theme=themeForSlide(document,slide),nativeContext=nativeSlide?rendererNativeAppearanceContext(document,slide):null;
 const rawTheme=nativeContext?.theme??null,colorMap=nativeContext?.colorMap??null;
 if(nativeSlide){
  let input=null;try{input=nativeSlideAppearanceInput(slide,document);}catch{}
  const check=proofCheck(slide,input,()=>isNativeSlideAppearanceValid(slide,document));
  if(!check.valid)return proofResult('unresolved-appearance',check.code);
 }
 if(authoredSlide&&document.extensions?.sourceFormat==='pptx'){
  for(const entity of [layout,master]){
   if(!entity||entity.source?.format!=='pptx')continue;
   let summaryInput=null;try{summaryInput=nativeLayoutAppearanceInput(entity,document);}catch{}
   const summary=proofCheck(entity,summaryInput,()=>isNativeLayoutAppearanceValid(entity,document),'native-layout-summary-missing');
   if(!summary.valid)return proofResult('inherited-appearance',summary.code);
   if(summary.proof.artworkCount!==0)return unsupported('inherited-appearance','inherited-artwork');
  }
 }
 if(!nativeSlide&&[layout,master].some(value=>value?.objects?.length))return unsupported('inherited-appearance','inherited-artwork');
 if(!nativeSlide&&[layout,master].some(value=>value?.source||value?.background)&&!slide.background&&!layout?.extensions?.stagecraftLayoutSummary&&!master?.extensions?.stagecraftLayoutSummary)return unsupported('inherited-appearance','inherited-background');
 if(slide.background && (slide.background.type!=='solid'||!color(slide.background.color)||extraKeys(slide.background,['type','color'])))return unsupported('unsupported-content','slide-background');
 const inheritedBackground=nativeSlide?appearanceBackground(slide.extensions?.stagecraftSlideAppearance?.background)
  :slide.background?.color??appearanceBackground(layout?.extensions?.stagecraftLayoutSummary?.background)
   ??appearanceBackground(master?.extensions?.stagecraftLayoutSummary?.background);
 if(nativeSlide&&!inheritedBackground)return unsupported('inherited-appearance','theme-background-unresolved');
 const nodes=[],seen=new Set();
 for(const object of slide.objects) {
  if(!object.id||seen.has(object.id))return unsupported('unsupported-content','object-identity',object.id);
  seen.add(object.id);
  if(!['text','shape'].includes(object.type))return unsupported('unsupported-content','object-type',object.id);
  if(!validGeometry(object.geometry))return unsupported('invalid-geometry','object-geometry',object.id);
  const nativeObject=object.source?.format==='pptx';
  let appearance=null;
  if(nativeObject){
   if(object.bodyLayout?.autofit==='shrink'&&!nativeAutofitEffectiveFit(object))
    return proofResult('unresolved-appearance','native-appearance-proof-invalid',object.id);
   if(object.text?.paragraphs?.some(paragraph=>paragraph.runs?.some(run=>nativeTextFontSlots(run.text,run.style?.lang??run.style?.language).length!==1)))
    return proofResult('unresolved-appearance','text-appearance-unresolved',object.id);
   if(theme?.objectDefaults?.[object.type==='text'?'txDef':'spDef'])return unsupported('inherited-appearance','theme-object-defaults',object.id);
   let input=null;try{input=nativeObjectAppearanceInput(object,{theme:rawTheme,colorMap,document,slide});}catch{}
   const check=proofCheck(object,input,()=>isNativeObjectAppearanceValid(object,{theme:rawTheme,colorMap,document,slide}));
   if(!check.valid)return proofResult('unresolved-appearance',check.code,object.id);
   appearance=check.proof;
  }else {
   if(!authored(object))return unsupported('unresolved-appearance','native-appearance-proof-missing',object.id);
   try { validateAuthoredObject(object); }
   catch { return unsupported('unsupported-content','authored-object-schema',object.id); }
   if(theme?.objectDefaults?.[object.type==='text'?'txDef':'spDef'])return unsupported('inherited-appearance','theme-object-defaults',object.id);
  }
  let text=object.text?displayText(object,theme,appearance):null;
  if(nativeObject&&text&&fontAvailability){
   for(const query of fontQueries(text.body))
    if(!fontAvailability.isAvailable(query.shorthand,query.text))return unsupported('fonts-unavailable','native-font-face-unavailable',object.id);
  }
  if(object.text&&!text)return unsupported('unsupported-content','text-format',object.id);
  if(nativeObject&&object.bodyLayout?.autofit==='shrink') {
   const fit=nativeAutofitEffectiveFit(object);
   if(!fit||!text)return proofResult('unresolved-appearance','native-appearance-proof-invalid',object.id);
   if(!nativeShrinkParagraphMetricsSupported(text.body))
    return proofResult('unresolved-appearance','native-appearance-proof-invalid',object.id);
   const scaled = scaledTextBody(text.body,fit,{
    snapFontSize:true,minimumSnappedFontSizePt:1,lineSpacingReduction:'subtractive',
   });
   const sizes = scaled.paragraphs.flatMap(p => [
    ...p.runs.map(r => r.fontSizePt), p.endProperties?.fontSizePt,
   ]);
   const lineSpacings=scaled.paragraphs.map(p=>p.lineSpacing?.value??1);
   if(sizes.some(size => !Number.isFinite(size) || size < 1)
    ||lineSpacings.some(value=>!Number.isFinite(value)||value<=0))
    return proofResult('unresolved-appearance','native-appearance-proof-invalid',object.id);
   text={...text,body:scaled};
  }
  const g=object.geometry;
  const fill=object.fill??(appearance?.fill?.kind==='solid'?appearance.fill.color:null);
  nodes.push({id:object.id,type:object.type,geometry:{...g},frame:{x:g.x/PX,y:g.y/PX,width:g.width/PX,height:g.height/PX,rotation:g.rotation??0},hitShape:object.shape??'rect',textIds:object.text?.paragraphs.map(p=>({paragraphId:p.id,runIds:p.runs.map(r=>r.id)}))??[],paint:{shape:object.shape??'rect',fill,stroke:appearance?.stroke??null,adjust:appearance?.adjust,native:nativeObject,text,layoutKey:text?JSON.stringify([g.width/PX,g.height/PX,text]):null}});
 }
 return {status:'ready',scene:freeze(structuredClone({slideId:slide.id,width:size.width/PX,height:size.height/PX,background:nativeSlide?inheritedBackground:slide.background?.color??inheritedBackground??'#ffffff',nodes}))};
}
