import { expect,it,vi } from 'vitest';
import { buildCanonicalScene,createCanonicalPaintEnvironment,paintCanonicalScene,paintCanonicalNode,waitForCanonicalFonts } from './index.js';
import { box,deck } from '../../../../tests/helpers/canonicalScene.js';
import { nativeShapeFixture } from './nativeShapeFixture.js';
import { openPresentation } from '../../../source/src/index.js';
import JSZip from 'jszip';
import { NS,buildPptx,para,shape,slideXml,textBox,tree } from '../../../../tests/helpers/pptxFixture.js';
const EDGE_CHANNEL_TOLERANCE=18;
const scene=objects=>{const r=buildCanonicalScene(deck(objects),'s');expect(r.status).toBe('ready');return r.scene;};
const canvas=(dpr=1)=>{const c=document.createElement('canvas');c.width=960*dpr;c.height=540*dpr;const ctx=c.getContext('2d');if(dpr!==1)ctx.scale(dpr,dpr);return ctx;};
const pixel=(ctx,x,y)=>[...ctx.getImageData(x,y,1,1).data];
const devicePixel=(ctx,x,y,dpr,zoom=1)=>pixel(ctx,Math.round(x*dpr*zoom),Math.round(y*dpr*zoom));
const withinPixel=(actual,expected,tolerance)=>actual.every((channel,index)=>Math.abs(channel-expected[index])<=tolerance);
const EMPTY_MASTER=`<p:sldMaster ${NS}>${tree('')}<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2"/><p:txStyles><p:otherStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>`;
const EMPTY_LAYOUT=`<p:sldLayout ${NS}>${tree('')}</p:sldLayout>`;
const PACKAGE_RELS='<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>';
const CONTENT_TYPES='<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/></Types>';
const explicitWhiteBackground='<p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></p:bgPr></p:bg>';
async function openNativeFixture(inner){
 let bytes=await buildPptx({master:EMPTY_MASTER,layout:EMPTY_LAYOUT,slides:[{xml:slideXml(inner,{bg:explicitWhiteBackground})}]});
 const zip=await JSZip.loadAsync(bytes);zip.file('_rels/.rels',PACKAGE_RELS);zip.file('[Content_Types].xml',CONTENT_TYPES);bytes=await zip.generateAsync({type:'uint8array'});
 return openPresentation(bytes,{format:'pptx'});
}
async function paintNativeFixture(inner,dpr=1,zoom=1){
 const source=await openNativeFixture(inner);
 try {const result=buildCanonicalScene(source.document,source.document.slides[0].id);if(result.status!=='ready')throw new Error(JSON.stringify({result,objects:source.document.slides[0].objects}));const ctx=canvas(dpr);ctx.scale(zoom,zoom);paintCanonicalScene(ctx,result.scene,createCanonicalPaintEnvironment());return {ctx,result};}
 finally {source.dispose();}
}
it('paints solid rect/ellipse in canonical z order and local versus scene placement',()=>{
 const g={x:95250,y:95250,width:952500,height:952500},a=box({id:'a',type:'shape',shape:'rect',fill:'#ff0000',text:undefined,geometry:g}),b=box({id:'b',type:'shape',shape:'ellipse',fill:'#00ff00',text:undefined,geometry:g});
 const s=scene([a,b]),ctx=canvas(),env=createCanonicalPaintEnvironment();paintCanonicalScene(ctx,s,env);
 expect(pixel(ctx,10,10)).toEqual([255,0,0,255]);expect(pixel(ctx,60,60)).toEqual([0,255,0,255]);expect(pixel(ctx,0,0)).toEqual([255,255,255,255]);
 ctx.clearRect(0,0,960,540);paintCanonicalNode(ctx,s.nodes[0],env);expect(pixel(ctx,0,0)).toEqual([255,0,0,255]);expect(pixel(ctx,105,105)).toEqual([0,0,0,0]);
});
it('rotates around frame center and restores caller canvas state',()=>{
 const s=scene([box({type:'shape',shape:'rect',fill:'#123456',text:undefined,geometry:{x:952500,y:952500,width:952500,height:381000,rotation:90}})]),ctx=canvas();ctx.fillStyle='#abcdef';ctx.globalAlpha=.5;
 paintCanonicalScene(ctx,s,createCanonicalPaintEnvironment());expect(pixel(ctx,150,80)[3]).toBeGreaterThan(0);expect(pixel(ctx,110,110).slice(0,3)).toEqual([255,255,255]);expect(ctx.fillStyle).toBe('#abcdef');expect(ctx.globalAlpha).toBe(.5);expect(ctx.getTransform().isIdentity).toBe(true);
});
it('paints multi-run direct colors and caches layout across translation but invalidates font epoch',async()=>{
 const o=box();o.text.paragraphs[0].runs.push({id:'b',text:' world',editable:true,extensions:{stagecraftAuthored:true},style:{sz:'1800',typeface:'Arial',b:'1',i:'1',color:'#0000ff'}});
 const s=scene([o]);expect(await waitForCanonicalFonts(s)).toEqual({status:'ready'});const ctx=canvas(),env=createCanonicalPaintEnvironment();paintCanonicalScene(ctx,s,env);
 const data=ctx.getImageData(10,20,300,200).data;let red=0,blue=0;for(let i=0;i<data.length;i+=4){if(data[i]>150&&data[i+1]<80&&data[i+2]<80)red++;if(data[i+2]>150&&data[i]<80&&data[i+1]<80)blue++;}expect(red).toBeGreaterThan(20);expect(blue).toBeGreaterThan(20);
 expect(env.getStats().layoutBuilds).toBe(1);o.geometry.x+=95250;paintCanonicalScene(ctx,scene([o]),env);expect(env.getStats().layoutBuilds).toBe(1);env.invalidateFonts();paintCanonicalScene(ctx,s,env);expect(env.getStats().layoutBuilds).toBe(2);
});
it('bounds and disposes layout/geometry caches and restores state on paint exceptions',()=>{
 const ctx=canvas(),env=createCanonicalPaintEnvironment({cacheLimit:1});
 paintCanonicalScene(ctx,scene([box()]),env);const b=box();b.text.paragraphs[0].runs[0].text='Changed';paintCanonicalScene(ctx,scene([b]),env);expect(env.getStats().layoutEntries).toBe(1);
 const spy=vi.spyOn(ctx,'fillText').mockImplementation(()=>{throw Error('paint');});expect(()=>paintCanonicalNode(ctx,scene([box()]).nodes[0],env)).toThrow('paint');expect(ctx.getTransform().isIdentity).toBe(true);spy.mockRestore();
 env.dispose();env.dispose();expect(env.getStats()).toMatchObject({disposed:true,layoutEntries:0,geometryEntries:0});expect(()=>paintCanonicalScene(ctx,scene([box()]),env)).toThrow('DISPOSED');expect(()=>env.invalidateFonts()).toThrow('DISPOSED');expect(()=>createCanonicalPaintEnvironment({cacheLimit:0})).toThrow('LIMIT');
});
it('keeps CRLF across runs and empty runs equivalent to a single display break',()=>{
 const a=box(),b=box();a.text.paragraphs[0].runs[0].text='A\r';a.text.paragraphs[0].runs.push({...a.text.paragraphs[0].runs[0],id:'empty',text:''},{...a.text.paragraphs[0].runs[0],id:'last',text:'\nB😀'});b.text.paragraphs[0].runs[0].text='A\nB😀';
 const ctxA=canvas(),ctxB=canvas();paintCanonicalScene(ctxA,scene([a]),createCanonicalPaintEnvironment());paintCanonicalScene(ctxB,scene([b]),createCanonicalPaintEnvironment());expect(ctxA.getImageData(0,0,400,300).data).toEqual(ctxB.getImageData(0,0,400,300).data);
});
it('honors a rectangular text-bearing shape fill behind its text',()=>{
 const s=scene([box({type:'shape',shape:'rect',fill:'#ffff00'})]),ctx=canvas();paintCanonicalScene(ctx,s,createCanonicalPaintEnvironment());expect(pixel(ctx,295,195)).toEqual([255,255,0,255]);
});
it.each([1,2])('honors anchor and inset placement without applying export autofit at DPR %s',dpr=>{
 const bounds=o=>{const ctx=canvas(dpr);paintCanonicalScene(ctx,scene([o]),createCanonicalPaintEnvironment());const width=400*dpr,height=300*dpr,data=ctx.getImageData(0,0,width,height).data;let top=height,left=width,bottom=0;for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=(y*width+x)*4;if(data[i]>150&&data[i+1]<80&&data[i+2]<80){top=Math.min(top,y);left=Math.min(left,x);bottom=Math.max(bottom,y);}}return {top:top/dpr,left:left/dpr,bottom:bottom/dpr};};
 const top=box({bodyLayout:{anchor:'top',autofit:'none',insets:{left:190500,top:95250,bottom:95250,right:0}}}),middle=structuredClone(top),bottom=structuredClone(top);middle.bodyLayout.anchor='middle';bottom.bodyLayout.anchor='bottom';
 const a=bounds(top),b=bounds(middle),c=bounds(bottom);expect(a.left).toBeGreaterThanOrEqual(30);expect(a.top).toBeLessThan(b.top);expect(b.top).toBeLessThan(c.top);expect(c.bottom).toBeLessThan(210);
 const resize=structuredClone(top);resize.bodyLayout.autofit='resize';const shrink=structuredClone(top);shrink.bodyLayout.autofit='shrink';expect(bounds(resize)).toEqual(a);expect(bounds(shrink)).toEqual(a);
});
it.each([1,2])('leaves DPR %s to the caller without changing geometry',dpr=>{
 const s=scene([box({type:'shape',shape:'rect',text:undefined,fill:'#ff0000'})]),ctx=canvas();ctx.scale(dpr,dpr);paintCanonicalScene(ctx,s,createCanonicalPaintEnvironment());expect(pixel(ctx,20*dpr,30*dpr)).toEqual([255,0,0,255]);expect(ctx.getTransform().a).toBe(dpr);expect(s.nodes[0].geometry.x).toBe(95250);
});
it('uses the separate script font slots for mixed-script text',()=>{
 const o=box();o.text.paragraphs[0].runs[0].text='A漢العربية';o.text.paragraphs[0].runs[0].style.eastAsian='Courier New';o.text.paragraphs[0].runs[0].style.complexScript='Times New Roman';const ctx=canvas(),seen=[];const original=ctx.fillText.bind(ctx);vi.spyOn(ctx,'fillText').mockImplementation((...args)=>{seen.push(ctx.font);return original(...args);});paintCanonicalScene(ctx,scene([o]),createCanonicalPaintEnvironment());expect(seen.some(s=>s.includes('Arial'))).toBe(true);expect(seen.some(s=>s.includes('Courier New'))).toBe(true);expect(seen.some(s=>s.includes('Times New Roman'))).toBe(true);
});
it('lays out alignment, paragraph spacing and wrapping through the real painter',()=>{
 const draw=o=>{const ctx=canvas(),calls=[],original=ctx.fillText.bind(ctx);vi.spyOn(ctx,'fillText').mockImplementation((text,x,y,...rest)=>{calls.push({text,x,y});return original(text,x,y,...rest);});paintCanonicalNode(ctx,scene([o]).nodes[0],createCanonicalPaintEnvironment());return calls;};
 const left=box(),center=structuredClone(left),right=structuredClone(left);center.text.paragraphs[0].style={alignment:'center'};right.text.paragraphs[0].style={alignment:'right'};
 expect(draw(left)[0].x).toBeLessThan(draw(center)[0].x);expect(draw(center)[0].x).toBeLessThan(draw(right)[0].x);
 const paragraphs=box();paragraphs.text.paragraphs.push({...structuredClone(paragraphs.text.paragraphs[0]),id:'p2',runs:[{...structuredClone(paragraphs.text.paragraphs[0].runs[0]),id:'r2'}]});const normal=draw(paragraphs);paragraphs.text.paragraphs[0].style={spaceAfter:18};const spaced=draw(paragraphs);expect(spaced[0].y).toBe(normal[0].y);expect(spaced.at(-1).y-normal.at(-1).y).toBeCloseTo(24,1);
 const wrapped=box({geometry:{x:0,y:0,width:952500,height:2857500}});wrapped.text.paragraphs[0].runs[0].text='one two three four five';const unwrapped=structuredClone(wrapped);unwrapped.bodyLayout={wrap:'none'};
 expect(new Set(draw(wrapped).map(c=>c.y)).size).toBeGreaterThan(1);expect(new Set(draw(unwrapped).map(c=>c.y)).size).toBe(1);
});
it.each(['bottom','nowrap'])('spills horizontal text outside its frame: %s',kind=>{
 const o=box({geometry:{x:952500,y:952500,width:952500,height:285750},bodyLayout:{anchor:kind==='bottom'?'bottom':'top',wrap:kind==='nowrap'?'none':'square',insets:{left:0,right:0,top:0,bottom:0}}});o.text.paragraphs[0].runs[0].text=kind==='bottom'?'Hello\nHello\nHello':'Hello Hello Hello Hello';
 const ctx=canvas();paintCanonicalScene(ctx,scene([o]),createCanonicalPaintEnvironment());const area=kind==='bottom'?[100,40,100,60]:[201,100,250,30];const data=ctx.getImageData(...area).data;let red=0;for(let i=0;i<data.length;i+=4)if(data[i]>150&&data[i+1]<80&&data[i+2]<80)red++;
 expect(red).toBeGreaterThan(20);expect(scene([o]).nodes[0].frame).toMatchObject({x:100,y:100,width:100,height:30});
});
it('evicts filled-shape geometry at the configured cache limit',()=>{
 const env=createCanonicalPaintEnvironment({cacheLimit:1}),ctx=canvas();
 for(const [shape,fill] of [['rect','#ff0000'],['ellipse','#00ff00']]) {paintCanonicalScene(ctx,scene([box({type:'shape',shape,fill,text:undefined})]),env);expect(env.getStats().geometryEntries).toBe(1);}
 expect(pixel(ctx,160,120)).toEqual([0,255,0,255]);env.dispose();expect(env.getStats().geometryEntries).toBe(0);
});
it('matches native projected EMU fill and centred outline pixels',()=>{
 const result=buildCanonicalScene(nativeShapeFixture({stroke:{kind:'solid',color:'#654321',widthEmu:19050}}),'native-slide');
 expect(result.status).toBe('ready');const ctx=canvas();paintCanonicalScene(ctx,result.scene,createCanonicalPaintEnvironment());
 // The fixture is 95250,95250 EMU with a 952500x476250 EMU frame: 10,10,100x50 CSS px.
 expect(pixel(ctx,50,30)).toEqual([18,52,86,255]);expect(pixel(ctx,10,30)).toEqual([101,67,33,255]);
});
it('paints native no-fill as transparent and honours the projected roundRect adjustment',()=>{
 const outline=buildCanonicalScene(nativeShapeFixture({fill:{kind:'none'},stroke:{kind:'solid',color:'#654321',widthEmu:19050}}),'native-slide');
 expect(outline.status).toBe('ready');const outlineContext=canvas();paintCanonicalScene(outlineContext,outline.scene,createCanonicalPaintEnvironment());
 expect(pixel(outlineContext,50,30)).toEqual([255,255,255,255]);expect(pixel(outlineContext,10,30)).toEqual([101,67,33,255]);
 // 19050 EMU is 2 CSS px; the outline occupies its fixture-derived boundary only.
 expect(pixel(outlineContext,9,30)).toEqual([101,67,33,255]);expect(pixel(outlineContext,11,30)).toEqual([255,255,255,255]);
 const rounded=buildCanonicalScene(nativeShapeFixture({shape:'roundRect',adjust:{adj:10000}}),'native-slide');
 expect(rounded.status).toBe('ready');const roundContext=canvas();paintCanonicalScene(roundContext,rounded.scene,createCanonicalPaintEnvironment());
 // Pixel expectations derive from the fixture's white background, solid fill, and roundRect EMU geometry.
 expect(pixel(roundContext,10,10)).toEqual([255,255,255,255]);expect(pixel(roundContext,50,30)).toEqual([18,52,86,255]);
});
it.each([1,2])('paints fill from a real PPTX part after source projection at DPR %s',async dpr=>{
 const inner=shape(2,'rect',15,15,150,75,'<a:solidFill><a:srgbClr val="123456"/></a:solidFill><a:ln><a:noFill/></a:ln>');
 const {ctx,result}=await paintNativeFixture(inner,dpr);expect(result.scene.nodes[0].paint.fill).toBe('#123456');
 expect(devicePixel(ctx,50,30,dpr)).toEqual([18,52,86,255]);
});
it.each([[1,0.5],[1,1.5],[2,0.5],[2,1.5]])('keeps native EMU geometry stable at DPR %s and stage zoom %s',async(dpr,zoom)=>{
 const inner=shape(2,'rect',15,15,150,75,'<a:solidFill><a:srgbClr val="123456"/></a:solidFill><a:ln><a:noFill/></a:ln>');
 const {ctx,result}=await paintNativeFixture(inner,dpr,zoom);
 expect(result.scene.nodes[0].frame).toMatchObject({x:10,y:10,width:100,height:50,rotation:0});
 expect(devicePixel(ctx,60,30,dpr,zoom)).toEqual([18,52,86,255]);
 expect(devicePixel(ctx,0,30,dpr,zoom)).toEqual([255,255,255,255]);
});
it.each([1,2])('paints native OOXML rotation around the frame center at DPR %s',async dpr=>{
 const inner=shape(2,'rect',15,15,150,75,'<a:solidFill><a:srgbClr val="123456"/></a:solidFill><a:ln><a:noFill/></a:ln>').replace('<a:xfrm>','<a:xfrm rot="5400000">');
 const {ctx,result}=await paintNativeFixture(inner,dpr);
 expect(result.scene.nodes[0].frame.rotation).toBe(90);
 // Fixture EMU frame: x=10,y=10,w=100,h=50; a 90-degree turn about (60,35) covers x=35..85.
 expect(devicePixel(ctx,60,20,dpr)).toEqual([18,52,86,255]);
 expect(devicePixel(ctx,20,35,dpr)).toEqual([255,255,255,255]);
});
it.each([1,2])('paints an XML-projected outline with the OOXML EMU width at DPR %s',async dpr=>{
 const inner=shape(2,'rect',15,15,150,75,'<a:noFill/><a:ln w="19050"><a:solidFill><a:srgbClr val="654321"/></a:solidFill></a:ln>');
 const {ctx,result}=await paintNativeFixture(inner,dpr);expect(result.scene.nodes[0].paint.stroke).toEqual({kind:'solid',color:'#654321',widthEmu:19050});
 expect(withinPixel(devicePixel(ctx,9,35,dpr),[101,67,33,255],EDGE_CHANNEL_TOLERANCE)).toBe(true);
 expect(withinPixel(devicePixel(ctx,10,35,dpr),[101,67,33,255],EDGE_CHANNEL_TOLERANCE)).toBe(true);
 expect(withinPixel(devicePixel(ctx,11,35,dpr),[255,255,255,255],EDGE_CHANNEL_TOLERANCE)).toBe(true);
});
it.each([1,2])('paints the roundRect preset and avLst corner adjustment from PPTX XML at DPR %s',async dpr=>{
 const inner=shape(2,'roundRect',15,15,150,75,'<a:solidFill><a:srgbClr val="123456"/></a:solidFill><a:ln><a:noFill/></a:ln>').replace('<a:avLst/>','<a:avLst><a:gd name="adj" fmla="val 10000"/></a:avLst>');
 const {ctx,result}=await paintNativeFixture(inner,dpr);expect(result.scene.nodes[0].paint.adjust).toEqual({adj:10000});
 expect(devicePixel(ctx,50,30,dpr)).toEqual([18,52,86,255]);expect(withinPixel(devicePixel(ctx,10,10,dpr),[255,255,255,255],EDGE_CHANNEL_TOLERANCE)).toBe(true);
});
it.each([1,2])('paints XML-projected native text colour and East Asian font slot at DPR %s',async dpr=>{
 const object=textBox(2,15,15,600,300,para('漢字',{rPr:' sz="3000"',rKids:'<a:solidFill><a:srgbClr val="CC0000"/></a:solidFill><a:latin typeface="monospace"/><a:ea typeface="serif"/>'}),{bodyPr:'<a:bodyPr lIns="0" rIns="0" tIns="0" bIns="0"><a:noAutofit/></a:bodyPr>'});
 const {ctx,result}=await paintNativeFixture(object,dpr);const run=result.scene.nodes[0].paint.text.body.paragraphs[0].runs[0];
 expect(run.color).toBe('#cc0000');expect(run.fontFamilyEastAsia).toBe('serif');
 const ready=await waitForCanonicalFonts(result.scene,{fontAvailability:{isAvailable:()=>true}});expect(ready.status).toBe('ready');
 const calls=[],original=ctx.fillText.bind(ctx);vi.spyOn(ctx,'fillText').mockImplementation((...args)=>{calls.push(ctx.font);return original(...args);});
 paintCanonicalScene(ctx,result.scene,createCanonicalPaintEnvironment());expect(calls.some(font=>font.includes('serif'))).toBe(true);
 const data=ctx.getImageData(10*dpr,10*dpr,400*dpr,200*dpr).data;let redPixels=0;for(let i=0;i<data.length;i+=4)if(data[i]>150&&data[i+1]<100&&data[i+2]<100)redPixels++;
 expect(redPixels).toBeGreaterThan(5);
});
it.each([1,2])('paints the XML-stored native shrink fit at DPR %s',async dpr=>{
 const inner=textBox(2,15,15,180,90,para('Stored shrink fit display',{rPr:' sz="2400"',rKids:'<a:solidFill><a:srgbClr val="112233"/></a:solidFill><a:latin typeface="Arial"/>'}),{bodyPr:'<a:bodyPr wrap="square" lIns="0" rIns="0" tIns="0" bIns="0"><a:normAutofit fontScale="62500" lnSpcReduction="20000"/></a:bodyPr>'});
 const {ctx,result}=await paintNativeFixture(inner,dpr);const object=result.scene.nodes[0];
 expect(object.paint.text.body.paragraphs[0].runs[0].fontSizePt).toBe(15);
 expect(object.paint.text.body.paragraphs[0].lineSpacing).toEqual({kind:'percent',value:0.8});
 expect(result.scene.nodes[0].geometry).toMatchObject({width:1143000,height:571500});
 await waitForCanonicalFonts(result.scene,{fontAvailability:{isAvailable:()=>true}});paintCanonicalScene(ctx,result.scene,createCanonicalPaintEnvironment());
 const x0=20*dpr,y0=20*dpr,width=170*dpr,height=85*dpr,data=ctx.getImageData(x0,y0,width,height).data;let ink=0,top=height,bottom=0,left=width,right=0;
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=(y*width+x)*4;if(data[i]<80&&data[i+1]<90&&data[i+2]<110&&data[i+3]>0){ink++;top=Math.min(top,y);bottom=Math.max(bottom,y);left=Math.min(left,x);right=Math.max(right,x);}}
 expect(ink).toBeGreaterThan(100);expect(right-left).toBeGreaterThan(20*dpr);expect(bottom-top).toBeGreaterThan(8*dpr);
});
it('places the first native text baseline from the font ascent, not the ink bounds',async()=>{
 const inner=textBox(2,15,15,600,300,para('Baseline reference',{rPr:' sz="1800"',rKids:'<a:latin typeface="Arial"/>'}),{bodyPr:'<a:bodyPr wrap="square" lIns="0" tIns="76200" rIns="0" bIns="0"><a:spAutoFit/></a:bodyPr>'});
 const source=await openNativeFixture(inner);
 try {
  const result=buildCanonicalScene(source.document,source.document.slides[0].id);expect(result.status).toBe('ready');
  const node=result.scene.nodes[0],ctx=canvas(),baselines=[],original=ctx.fillText.bind(ctx);
  vi.spyOn(ctx,'fillText').mockImplementation((text,x,y,...rest)=>{if(text)baselines.push(y);return original(text,x,y,...rest);});
  const env=createCanonicalPaintEnvironment();
  try {paintCanonicalScene(ctx,result.scene,env);} finally {env.dispose();}
  const run=node.paint.text.body.paragraphs[0].runs[0];ctx.font=`${run.fontSizePt}pt "${run.fontFamily}"`;
  const metrics=ctx.measureText('Mg'),lineHeight=run.fontSizePt*96/72*1.2;
  const expected=8+metrics.fontBoundingBoxAscent
   +(lineHeight-metrics.fontBoundingBoxAscent-metrics.fontBoundingBoxDescent)/2;
  expect(baselines[0]).toBeCloseTo(expected,1);
 } finally {source.dispose();}
});
