import { it, expect } from 'vitest';
import { createDocument, validateDocument, validateAuthoredSlide } from './index.js';
const fixture=()=>createDocument({slides:[{id:'s',objects:[{id:'t',type:'text',text:{paragraphs:[{id:'p',runs:[{id:'r',text:'original',editable:true}]}]}}]}]});
it.each([
 ['background not a record',d=>{d.slides[0].background='red';}],
 ['invalid solid background',d=>{d.slides[0].background={type:'solid',color:'#xyz'};}],
 ['empty object id',d=>{d.slides[0].objects[0].id='';}],
 ['empty object type',d=>{d.slides[0].objects[0].type='';}],
 ['invalid editable flag',d=>{d.slides[0].objects[0].text.paragraphs[0].runs[0].editable='yes';}],
 ['invalid source kind',d=>{d.slides[0].objects[0].source={format:'pptx',part:'ppt/s.xml',path:[],kind:''};}],
 ['notes control character',d=>{d.slides[0].extensions={stagecraftAuthored:true};d.slides[0].notes='bad\0';}],
])('rejects %s without mutating the submitted document',(_label,mutate)=>{
 const doc=fixture();mutate(doc);const before=structuredClone(doc);expect(()=>validateDocument(doc)).toThrow();expect(doc).toEqual(before);
});

it.each([['overlong notes', {notes:'x'.repeat(20001)}], ['unknown background property', {background:{type:'solid',color:'#123456',extra:true}}]])('strict authored slides reject %s while native metadata can be retained', (_label, properties) => {
 const slide={id:'s',objects:[],extensions:{stagecraftAuthored:true},...properties};
 expect(()=>validateAuthoredSlide(slide)).toThrow('INVALID_SLIDE_PROPERTY');
 const doc=createDocument({slides:[slide]});
 expect(validateDocument(doc)).toBe(true);
 expect(doc.slides[0]).toMatchObject(properties);
});
