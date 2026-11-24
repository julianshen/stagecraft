import { expect, it } from 'vitest';
import { buildCanonicalScene } from './index.js';
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
 expect(r.reason).toBe('unresolved-appearance');expect(r.diagnostics).toContainEqual({code:'native-object-appearance',objectId:'box'});
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
it('ignores non-rendering extension data and resolves theme script font references without flattening them',()=>{
 const d=deck(),o=d.slides[0].objects[0];o.extensions.hostMetadata={id:42};o.text.paragraphs[0].runs[0].style={sz:'2400',typeface:'+mn-lt',eastAsian:'+mn-ea',complexScript:'+mn-cs'};o.text.paragraphs[0].runs[0].text='A漢字العربية';
 d.layouts=[{id:'l',masterId:'m'}];d.masters=[{id:'m',themeId:'t'}];d.themes=[{id:'t',extensions:{pptxFontScheme:{minor:{latin:'Arial',eastAsian:'Courier New',complexScript:'Times New Roman'}}}}];
 const before=structuredClone(d);expect(buildCanonicalScene(d,'s').status).toBe('ready');expect(d).toEqual(before);
 d.themes[0].extensions.pptxObjectDefaults={txDef:true};expect(buildCanonicalScene(d,'s')).toMatchObject({reason:'inherited-appearance',diagnostics:[{code:'theme-object-defaults',objectId:'box'}]});
});
