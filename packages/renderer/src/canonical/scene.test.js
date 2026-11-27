import { expect, it } from 'vitest';
import { buildCanonicalScene } from './index.js';
import { rendererNativeAppearanceContext } from './scene.js';
import { nativeAppearanceContext } from '@stagecraft/core/lib/nativeAppearance.js';
import { box, deck } from '../../../../tests/helpers/canonicalScene.js';
it('builds an immutable canonical scene without mutating its input',()=>{
 const d=deck(),before=structuredClone(d),r=buildCanonicalScene(d,'s');expect(r.status).toBe('ready');expect(d).toEqual(before);
 expect(r.scene).toMatchObject({slideId:'s',width:960,height:540,background:'#ffffff'});expect(r.scene.nodes[0]).toMatchObject({id:'box',type:'text',hitShape:'rect',frame:{x:10,y:20,width:300,height:200,rotation:0},textIds:[{paragraphId:'p',runIds:['r']}]});
 expect(Object.isFrozen(r.scene.nodes[0].geometry)).toBe(true);d.slides[0].objects[0].geometry.x=1;expect(r.scene.nodes[0].geometry.x).toBe(95250);
});
it.each(['image','chart','table','group','opaque'])('refuses a whole slide containing %s',type=>{
 const r=buildCanonicalScene(deck([box(),box({id:'bad',type})]),'s');expect(r.status).toBe('unsupported');expect(r.reason).toBe('unsupported-content');expect(r.scene).toBeUndefined();expect(r.diagnostics).toContainEqual({code:'object-type',objectId:'bad'});
});
it('does not mistake supported native metrics for a full appearance model',()=>{
 const r=buildCanonicalScene(deck([box({source:{format:'pptx'},extensions:{pptxTextMetrics:{supported:true},editableGeometry:true}})]),'s');
 expect(r.reason).toBe('unresolved-appearance');expect(r.diagnostics).toContainEqual({code:'native-appearance-proof-missing',objectId:'box'});
});
it.each(['bullet','decoration','flip','paint','geometry','theme','native-slide','odp','missing'])('reports explicit unsupported %s',kind=>{
 const d=deck(),o=d.slides[0].objects[0];
 if(kind==='bullet')o.text.paragraphs[0].style={bullet:{type:'char',char:'•'}};
 if(kind==='decoration')o.text.paragraphs[0].runs[0].style.u='sng';
 if(kind==='flip')o.geometry.flipH=true;
 if(kind==='paint')o.shadow={blur:4};
 if(kind==='geometry')o.geometry.width=NaN;
 if(kind==='theme')o.text.paragraphs[0].runs[0].style.typeface='+mn-lt';
 if(kind==='native-slide')d.slides[0].source={format:'pptx'};
 if(kind==='odp')d.extensions.sourceFormat='odp';
 const r=buildCanonicalScene(d,kind==='missing'?'missing':'s');expect(r.status).toBe('unsupported');expect(r.diagnostics.length).toBeGreaterThan(0);
});
it('preserves supported colors, transparent text and ellipse order with rotation',()=>{
 const d=deck([box({id:'a',type:'shape',shape:'ellipse',text:undefined,fill:'#123456'}),box()]);d.slides[0].objects[0].geometry.rotation=90;
 const r=buildCanonicalScene(d,'s');expect(r.status).toBe('ready');expect(r.scene.nodes.map(n=>n.id)).toEqual(['a','box']);expect(r.scene.nodes[0].hitShape).toBe('ellipse');expect(r.scene.nodes[0].frame.rotation).toBe(90);
});
it('distinguishes inherited appearance and admits an explicit overriding background',()=>{
 const d=deck();d.layouts=[{id:'l',masterId:'m',background:{type:'solid',color:'#ff0000'}}];d.masters=[{id:'m'}];
 expect(buildCanonicalScene(d,'s')).toMatchObject({status:'unsupported',reason:'inherited-appearance',diagnostics:[{code:'inherited-background'}]});
 d.slides[0].background={type:'solid',color:'#ffffff'};expect(buildCanonicalScene(d,'s').status).toBe('ready');
 d.layouts[0].objects=[box()];expect(buildCanonicalScene(d,'s')).toMatchObject({reason:'inherited-appearance',diagnostics:[{code:'inherited-artwork'}]});
});
it.each([
 ['model',d=>{d.schemaVersion=2;},'not-canonical'],
 ['size',d=>{d.size.width=0;},'invalid-geometry'],
 ['duplicate',d=>{d.slides[0].objects.push(box());},'unsupported-content'],
 ['background',d=>{d.slides[0].background={type:'gradient'};},'unsupported-content'],
 ['shape',d=>{d.slides[0].objects[0].shape='triangle';},'unsupported-content'],
 ['fill',d=>{d.slides[0].objects[0].fill='red';},'unsupported-content'],
 ['unknown-layout',d=>{d.slides[0].objects[0].bodyLayout={vertical:true};},'unsupported-content'],
 ['unknown-inset',d=>{d.slides[0].objects[0].bodyLayout={insets:{start:2}};},'unsupported-content'],
 ['anchor',d=>{d.slides[0].objects[0].bodyLayout={anchor:'bad'};},'unsupported-content'],
 ['wrap',d=>{d.slides[0].objects[0].bodyLayout={wrap:'bad'};},'unsupported-content'],
 ['autofit',d=>{d.slides[0].objects[0].bodyLayout={autofit:'bad'};},'unsupported-content'],
 ['paragraph',d=>{d.slides[0].objects[0].text.paragraphs[0].style={alignment:'bad'};},'unsupported-content'],
 ['spacing',d=>{d.slides[0].objects[0].text.paragraphs[0].style={spaceBefore:Infinity};},'unsupported-content'],
 ['run-color',d=>{d.slides[0].objects[0].text.paragraphs[0].runs[0].style.color='red';},'unsupported-content'],
 ['run-weight',d=>{d.slides[0].objects[0].text.paragraphs[0].runs[0].style.b='600';},'unsupported-content'],
])('refuses %s without a partial scene',(_label,mutate,reason)=>{
 const d=deck();mutate(d);expect(buildCanonicalScene(d,'s')).toMatchObject({status:'unsupported',reason});expect(buildCanonicalScene(d,'s').scene).toBeUndefined();
});
it('resolves theme script font references without flattening them',()=>{
 const d=deck(),o=d.slides[0].objects[0];o.text.paragraphs[0].runs[0].style={sz:'2400',typeface:'+mn-lt',eastAsian:'+mn-ea',complexScript:'+mn-cs'};o.text.paragraphs[0].runs[0].text='A漢字العربية';
 d.layouts=[{id:'l',masterId:'m'}];d.masters=[{id:'m',themeId:'t'}];d.themes=[{id:'t',extensions:{pptxFontScheme:{minor:{latin:'Arial',eastAsian:'Courier New',complexScript:'Times New Roman'}}}}];
 const before=structuredClone(d);expect(buildCanonicalScene(d,'s').status).toBe('ready');expect(d).toEqual(before);
 d.themes[0].extensions.pptxObjectDefaults={txDef:true};expect(buildCanonicalScene(d,'s')).toMatchObject({reason:'inherited-appearance',diagnostics:[{code:'theme-object-defaults',objectId:'box'}]});
});
it('refuses a conflicting authored layout reference rather than hiding its artwork',()=>{
 const d=deck();d.layouts=[{id:'first',masterId:'m0'},{id:'second',masterId:'m1',objects:[box()]}];
 d.slides[0].layoutId='second';
 expect(buildCanonicalScene(d,'s')).toMatchObject({status:'unsupported',reason:'inherited-appearance',diagnostics:[{code:'authored-layout-mismatch'}]});
 d.slides[0].layoutId='first';expect(buildCanonicalScene(d,'s').status).toBe('ready');
 delete d.slides[0].layoutId;expect(buildCanonicalScene(d,'s').status).toBe('ready');
});
it('reports a missing native layout summary separately from a missing slide proof',()=>{
 const d=deck();d.extensions.sourceFormat='pptx';d.layouts=[{id:'layout',source:{format:'pptx'},objects:[]}];d.slides[0].layoutId='layout';
 expect(buildCanonicalScene(d,'s')).toMatchObject({status:'unsupported',reason:'inherited-appearance',diagnostics:[{code:'native-layout-summary-missing'}]});
});
it('uses the SVG default color for ordinary authored sz-only runs',()=>{
 const d=deck();d.slides[0].objects[0].text.paragraphs[0].runs[0].style={sz:'2400'};
 d.layouts=[{id:'l',masterId:'m'}];d.masters=[{id:'m',themeId:'t'}];d.themes=[{id:'t',extensions:{pptxFontScheme:{minor:{latin:'Arial'}}}}];
 const r=buildCanonicalScene(d,'s');expect(r.status).toBe('ready');expect(r.scene.nodes[0].paint.text.body.paragraphs[0].runs[0].color).toBe('#172033');
});
it.each(['fill','shape'])('refuses shape-only field %s on a text object',key=>{
 const d=deck();d.slides[0].objects[0][key]=key==='fill'?'#ff0000':'rect';expect(buildCanonicalScene(d,'s')).toMatchObject({status:'unsupported',reason:'unsupported-content'});
});
it.each([
 ['vertical text',(t)=>{t.direction='vert';}],['columns',(t)=>{t.columns=2;}],
 ['paragraph direction',(t)=>{t.paragraphs[0].direction='rtl';}],['paragraph tabs',(t)=>{t.paragraphs[0].tabs=[100];}],
 ['run baseline',(t)=>{t.paragraphs[0].runs[0].baseline=30000;}],['run hyperlink',(t)=>{t.paragraphs[0].runs[0].hyperlink='https://example.test';}],
])('refuses unsupported text envelope: %s',(_label,mutate)=>{
 const d=deck();mutate(d.slides[0].objects[0].text);const r=buildCanonicalScene(d,'s');expect(r).toMatchObject({status:'unsupported',reason:'unsupported-content'});expect(r.scene).toBeUndefined();
});
it('refuses extension envelopes that the core authored schema does not permit',()=>{
 const d=deck(),t=d.slides[0].objects[0].text;t.extensions={host:1};t.paragraphs[0].extensions={host:2};t.paragraphs[0].runs[0].extensions.host=3;expect(buildCanonicalScene(d,'s').status).toBe('unsupported');
});
it('selects the writer theme for new slides and the linked theme for native slides',async()=>{
 const {themeForSlide}=await import('../text/canonicalTextBody.js');const d=deck();
 d.layouts=[{id:'first',masterId:'m0'},{id:'second',masterId:'m1'}];d.masters=[{id:'m0',themeId:'t0'},{id:'m1',themeId:'t1'}];d.themes=[{id:'t0',extensions:{pptxFontScheme:{minor:{latin:'Arial'}}}},{id:'t1',extensions:{pptxFontScheme:{minor:{latin:'Georgia'}}}}];
 const s=d.slides[0];s.layoutId='second';expect(themeForSlide(d,s).fonts.minor.latin).toBe('Arial');expect(buildCanonicalScene(d,'s').reason).toBe('inherited-appearance');
 s.source={format:'pptx',part:'ppt/slides/slide1.xml',path:[]};expect(themeForSlide(d,s).fonts.minor.latin).toBe('Georgia');expect(buildCanonicalScene(d,'s').reason).toBe('unresolved-appearance');
});
it('uses the core native appearance context for inherited theme and colour-map overrides',()=>{
 const d=deck();
 d.layouts=[{id:'l',masterId:'m',extensions:{pptxColorMap:{tx1:'lt1'}}}];
 d.masters=[{id:'m',themeId:'t',extensions:{pptxColorMap:{bg1:'dk1',tx1:'dk1'}}}];
 d.themes=[{id:'t',name:'inherited-theme'}];
 const slide=d.slides[0];slide.source={format:'pptx',part:'ppt/slides/slide1.xml',path:[]};slide.layoutId='l';
 slide.extensions={pptxColorMapOverride:'master'};
 const expected=nativeAppearanceContext(d,slide);
 expect(rendererNativeAppearanceContext(d,slide)).toEqual(expected);
 expect(expected).toEqual({theme:d.themes[0],colorMap:{bg1:'dk1',tx1:'lt1',bg2:'lt2',tx2:'dk2'}});
});
it.each(['native-run','missing-body'])('refuses an object outside the core authored schema: %s',kind=>{
 const d=deck(),o=d.slides[0].objects[0];
 if(kind==='native-run') {const r=o.text.paragraphs[0].runs[0];r.style={sz:'1800',typeface:'Arial'};r.source={format:'pptx',part:'ppt/slides/slide1.xml',path:[0]};r.extensions={stagecraftAuthored:true,pptxAppearance:{color:'#0000ff'}};}
 else delete o.text;
 const result=buildCanonicalScene(d,'s');expect(result.status).toBe('unsupported');expect(result.scene).toBeUndefined();
});
it.each(['paragraph-source','run-source','appearance-only'])('refuses native provenance independently: %s',kind=>{
 const d=deck(),p=d.slides[0].objects[0].text.paragraphs[0],r=p.runs[0];
 const source={format:'pptx',part:'ppt/slides/slide1.xml',path:[0]};
 if(kind==='paragraph-source')p.source=source;
 else if(kind==='run-source')r.source=source;
 else r.extensions.pptxAppearance={color:'#0000ff'};
 expect(buildCanonicalScene(d,'s')).toMatchObject({status:'unsupported',reason:'unsupported-content',diagnostics:[{code:'authored-object-schema',objectId:'box'}]});
});
