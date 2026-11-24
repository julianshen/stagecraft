import { expect, it } from 'vitest';
import { measureResizeFits } from './measureResizeFits.js';
import { canonicalTextBody } from './canonicalTextBody.js';
import { layoutTextBody } from '../vendor/officeview/drawing/text-layout.ts';
import { createTextBodyMeasurer } from '../vendor/officeview/drawing/text-paint.ts';
import { canvasFont } from '../canvas/paint.js';
const make = (text = 'Long text that must grow the box. '.repeat(12)) => ({id:'box',type:'text',extensions:{stagecraftAuthored:true},geometry:{x:0,y:12700,width:2667000,height:635000},bodyLayout:{autofit:'resize',anchor:'bottom'},text:{paragraphs:[{id:'p',runs:[{id:'r',text,style:{typeface:'Arial',sz:'1800'}}]}]}});
const doc = object => ({extensions:{sourceFormat:'pptx'},slides:[{id:'s',objects:[object]}],layouts:[],masters:[],themes:[]});
it('grows at unchanged font size using natural height and preserves the input', async () => {
 await document.fonts.ready; const object=make(), d=doc(object), before=structuredClone(d);
 const result=measureResizeFits(d,{fonts:document.fonts});
 expect(result.status).toBe('measured');expect(result.count).toBe(1);expect(result.stats).toEqual({candidates:1,measured:1,skipped:0,failed:0});
 const height=result.resize.get('box').height; expect(height).toBeGreaterThan(object.geometry.height);expect(Number.isSafeInteger(height)).toBe(true);
 const a=canonicalTextBody({...object,geometry:{...object.geometry,height}});
 const measured=layoutTextBody(a.body,a.width,a.height,createTextBodyMeasurer(document.createElement('canvas').getContext('2d'),canvasFont)).height;
 expect(measured).toBeLessThanOrEqual(a.availableHeight*.97);expect(d).toEqual(before);
});
it('reports already fitting and empty text without treating them as failures',()=>{
 const fits=measureResizeFits(doc(make('Short')),{fonts:document.fonts});expect(fits.count).toBe(0);expect(fits.status).toBe('measured');expect(fits.reasons['already-fits']).toBe(1);
 const empty=measureResizeFits(doc(make('')),{fonts:document.fonts});expect(empty.status).toBe('skipped');expect(empty.reasons['empty-text']).toBe(1);
});
it.each(['rotation','flip','wrap','geometry','native','theme','group','odp'])('skips unsupported %s without emitting a rejected hint', kind=>{
 const o=make(),d=doc(o);
 if(kind==='rotation')o.geometry.rotation=30;
 if(kind==='flip')o.geometry.flipH=true;
 if(kind==='wrap')o.bodyLayout.wrap='none';
 if(kind==='geometry')o.geometry.width=0;
 if(kind==='native'){o.source={format:'pptx'};o.extensions.pptxTextMetrics={supported:true};}
 if(kind==='theme'){d.slides[0].layoutId='l';d.layouts=[{id:'l',masterId:'m'}];d.masters=[{id:'m',themeId:'t'}];d.themes=[{id:'t',extensions:{pptxObjectDefaults:{txDef:true}}}];}
 if(kind==='group')d.slides[0].objects=[{id:'group',type:'group',children:[o]}];
 if(kind==='odp')d.extensions.sourceFormat='odp';
 const result=measureResizeFits(d,{fonts:document.fonts});expect(result.resize.size).toBe(0);expect(result.status).toBe('skipped');expect(result.stats.candidates).toBe(1);expect(result.stats.skipped).toBe(1);
});
it('keeps successful entries when a different box is unsupported',()=>{
 const d=doc(make());const bad=make();bad.id='bad';bad.geometry.rotation=10;d.slides[0].objects.push(bad);
 const result=measureResizeFits(d,{fonts:document.fonts});expect(result.count).toBe(1);expect(result.stats).toEqual({candidates:2,measured:1,skipped:1,failed:0});expect(result.reasons.rotated).toBe(1);
});
it('handles font and canvas failures without leaking document text',()=>{
 const d=doc(make('SECRET '.repeat(50)));
 expect(measureResizeFits(d,{fonts:{status:'loading'}}).reason).toBe('fonts-unavailable');
 const failure=measureResizeFits(d,{fonts:{status:'loaded',check(){throw Error('SECRET');}}});expect(failure.status).toBe('failed');expect(JSON.stringify(failure)).not.toContain('SECRET');
 expect(measureResizeFits(d,{fonts:document.fonts,canvas:{getContext:()=>null}}).reason).toBe('canvas-unavailable');
});
it('supports CRLF, multiple runs, paragraphs and insets consistently across anchors',()=>{
 const o=make('A\r\nB\r');o.text.paragraphs[0].runs.push({text:'\nC '.repeat(15),style:{typeface:'Arial',sz:'2400'}});o.text.paragraphs.push({runs:[{text:'Last paragraph',style:{typeface:'Arial',sz:'1800'}}]});
 o.bodyLayout.insets={top:127000,bottom:127000,left:127000,right:127000};
 const heights=['top','middle','bottom'].map(anchor=>{o.bodyLayout.anchor=anchor;return measureResizeFits(doc(o),{fonts:document.fonts}).resize.get('box').height;});
 expect(new Set(heights).size).toBe(1);expect(heights[0]).toBeGreaterThan(o.geometry.height);
});
it('never emits a source-rejected hint for theme defaults and exports supported resize safely', async()=>{
 const {writePptx}=await import('../../../pptx/src/index.js'); const {openPresentation}=await import('../../../source/src/index.js');const {default:JSZip}=await import('jszip');
 const bytes=await writePptx({title:'Resize parity',sections:[{id:'sec',slides:['s']}],slides:[{id:'s',layout:'blank',elements:[]}]});
 const zip=await JSZip.loadAsync(bytes),part='ppt/theme/theme1.xml',a='http://schemas.openxmlformats.org/drawingml/2006/main';
 const xml=new DOMParser().parseFromString(await zip.file(part).async('string'),'application/xml');
 const defaults=xml.getElementsByTagNameNS(a,'objectDefaults')[0]??xml.documentElement.appendChild(xml.createElementNS(a,'a:objectDefaults'));
 const def=defaults.appendChild(xml.createElementNS(a,'a:txDef'));def.appendChild(xml.createElementNS(a,'a:bodyPr')).setAttribute('anchor','b');
 zip.file(part,new XMLSerializer().serializeToString(xml));
 const source=await openPresentation(await zip.generateAsync({type:'uint8array'}),{format:'pptx'});
 const d=structuredClone(source.document),o=make();o.text.paragraphs[0].runs[0].editable=true;o.text.paragraphs[0].runs[0].extensions={stagecraftAuthored:true};delete o.bodyLayout.anchor;d.slides[0].objects.push(o);
 const result=measureResizeFits(d,{fonts:document.fonts});expect(result.status).toBe('skipped');expect(result.reason).toBe('unsupported-metrics');expect(result.resize.size).toBe(0);
 const exported=await source.export(d,{resize:result.resize});expect(exported.bytes.length).toBeGreaterThan(0);source.dispose();
 const normal=await openPresentation(bytes,{format:'pptx'}),normalDoc=structuredClone(normal.document);normalDoc.slides[0].objects.push(o);
 const shrink=structuredClone(o);shrink.id='shrink';shrink.text.paragraphs[0].id='shrink-p';shrink.text.paragraphs[0].runs[0].id='shrink-r';shrink.bodyLayout.autofit='shrink';normalDoc.slides[0].objects.push(shrink);
 const {measureShrinkFits}=await import('./measureShrinkFits.js');const fit=measureShrinkFits(normalDoc,{fonts:document.fonts}).fit;expect(fit.size).toBe(1);
 const valid=measureResizeFits(normalDoc,{fonts:document.fonts});expect(valid.count).toBe(1);const exportedBoth=await normal.export(normalDoc,{resize:valid.resize,fit});
 const packageBoth=await JSZip.loadAsync(exportedBoth.bytes);expect(await packageBoth.file('ppt/slides/slide1.xml').async('string')).toContain('fontScale="'+fit.get('shrink').fontScale+'"');
 const reopened=await openPresentation(exportedBoth.bytes,{format:'pptx'});expect(reopened.document.slides[0].objects[1].geometry.height).toBe(shrink.geometry.height);
 expect(reopened.document.slides[0].objects[0].geometry.height).toBe(valid.resize.get('box').height);normal.dispose();reopened.dispose();
},30000);

it('retains a successful resize when another object fails font checking',()=>{
 const d=doc(make()),bad=make();bad.id='bad';bad.text.paragraphs[0].runs[0].style.typeface='BrokenFont';d.slides[0].objects.push(bad);
 const fonts={status:'loaded',check(query){if(query.includes('BrokenFont'))throw Error('SECRET');return true;}};
 const result=measureResizeFits(d,{fonts});expect(result.count).toBe(1);expect(result.status).toBe('failed');expect(result.stats).toEqual({candidates:2,measured:1,skipped:0,failed:1});expect(result.resize.has('box')).toBe(true);expect(JSON.stringify(result)).not.toContain('SECRET');
});

it('skips untouched native resize boxes and measures only native text edits', async () => {
 await document.fonts.ready;
 const object=make();delete object.extensions.stagecraftAuthored;object.source={format:'pptx',part:'ppt/slides/slide1.xml',path:[0]};object.extensions={editableGeometry:true,pptxTextMetrics:{supported:true}};
 const input=doc(object),baseline=structuredClone(input);
 const unchanged=measureResizeFits(input,{fonts:document.fonts,baseline});
 expect(unchanged).toMatchObject({status:'skipped',reason:'unchanged-native',count:0,reasons:{'unchanged-native':1}});expect(unchanged.resize.size).toBe(0);
 object.text.paragraphs[0].runs[0].text+=' Edited';
 const changed=measureResizeFits(input,{fonts:document.fonts,baseline});
 expect(changed.status).toBe('measured');expect(changed.resize.has('box')).toBe(true);
});

it('measures available resize fonts while unrelated fonts are loading',()=>{const result=measureResizeFits(doc(make()),{fonts:{status:'loading',check:()=>true}});expect(result.status).toBe('measured');expect(result.resize.size).toBe(1);});
