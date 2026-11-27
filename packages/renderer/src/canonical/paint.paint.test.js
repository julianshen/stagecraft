import { expect,it,vi } from 'vitest';
import { buildCanonicalScene,createCanonicalPaintEnvironment,paintCanonicalScene,paintCanonicalNode,waitForCanonicalFonts } from './index.js';
import { box,deck } from '../../../../tests/helpers/canonicalScene.js';
import { nativeShapeFixture } from './nativeShapeFixture.js';
const scene=objects=>{const r=buildCanonicalScene(deck(objects),'s');expect(r.status).toBe('ready');return r.scene;};
const canvas=()=>{const c=document.createElement('canvas');c.width=960;c.height=540;return c.getContext('2d');};
const pixel=(ctx,x,y)=>[...ctx.getImageData(x,y,1,1).data];
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
it('honors anchor and inset placement without applying export autofit',()=>{
 const bounds=o=>{const ctx=canvas();paintCanonicalScene(ctx,scene([o]),createCanonicalPaintEnvironment());const data=ctx.getImageData(0,0,400,300).data;let top=300,left=400,bottom=0;for(let y=0;y<300;y++)for(let x=0;x<400;x++){const i=(y*400+x)*4;if(data[i]>150&&data[i+1]<80&&data[i+2]<80){top=Math.min(top,y);left=Math.min(left,x);bottom=Math.max(bottom,y);}}return {top,left,bottom};};
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
