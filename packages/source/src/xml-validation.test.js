import { it, expect, vi } from 'vitest';
import JSZip from 'jszip';
import { runtime, validText, xmlPart, resolvePptxTarget, path, locate, source, id } from './xml.js';

it('rejects incomplete XML adapters and malformed adapter results',()=>{
  expect(()=>runtime({parse:42,serialize:()=>''})).toThrow('runtime with parse()');
  expect(()=>runtime({parse:()=>null,serialize:42})).toThrow('runtime with serialize()');
  const serialize=vi.fn();
  for(const parse of [()=>null,()=>({documentElement:{},doctype:{}}),()=>new DOMParser().parseFromString('<broken>','application/xml')])
    expect(()=>runtime({parse,serialize}).parse('<root/>')).toThrow('Invalid XML');
  expect(serialize).not.toHaveBeenCalled();
});
it('blocks DTDs before invoking a host parser',()=>{
 const parse=vi.fn();const xml=runtime({parse,serialize:()=>''});
 for(const text of ['<!DOCTYPE a><a/>','<!ENTITY name "secret">'])expect(()=>xml.parse(text)).toThrow('DTD and entity declarations are unsupported');
 expect(parse).not.toHaveBeenCalled();
});
it('rejects missing XML parts before parsing',async()=>{
 const parse=vi.fn();await expect(xmlPart(new JSZip(),'missing.xml',{parse})).rejects.toThrow('Missing package part: missing.xml');expect(parse).not.toHaveBeenCalled();
});
it('preserves valid Unicode boundaries but rejects XML-invalid controls and surrogates',()=>{
 expect(()=>validText('\t\n\r \ud7ff\ue000\ufffd😀')).not.toThrow();
 for(const value of ['\0','\u000b','\ud800','\udfff','\ufffe'])expect(()=>validText(value)).toThrow('XML-invalid text character');
});
it.each(['','a\\b','a?b','a#b','a b'])('rejects unsafe raw relationship target %j',raw=>expect(()=>resolvePptxTarget('ppt/main.xml',raw)).toThrow('Unsafe relationship target'));
it.each(['%zz','%E0%A4'])('rejects malformed URI encoding %j',raw=>expect(()=>resolvePptxTarget('ppt/main.xml',raw)).toThrow('Invalid relationship encoding'));
it.each(['a%23b','http%3Athing','a%2520b'])('rejects ambiguous decoded relationship target %j',raw=>expect(()=>resolvePptxTarget('ppt/main.xml',raw)).toThrow('Ambiguous relationship target'));
it('resolves package and owner-relative targets while rejecting escapes and empty segments',()=>{
 expect(resolvePptxTarget('[package]','ppt/main.xml')).toBe('ppt/main.xml');
 expect(resolvePptxTarget('ppt/slides/s.xml','../media/./a.png')).toBe('ppt/media/a.png');
 expect(resolvePptxTarget('ppt/main.xml','/media/a.png')).toBe('media/a.png');
 expect(()=>resolvePptxTarget('[package]','../a')).toThrow('escapes package');
 expect(()=>resolvePptxTarget('ppt/main.xml','a//b')).toThrow('Empty relationship segment');
});
it('locates retained text nodes without confusing comments and element positions',()=>{
 const doc=runtime().parse('<root><!--comment--><item>text</item></root>');const text=doc.documentElement.lastChild.firstChild;
 expect(locate(doc,path(text))).toBe(text);expect(source('pptx','slide.xml',text)).toEqual({format:'pptx',part:'slide.xml',path:[0,1,0]});
 expect(id('slide.xml',text)).toBe('node:slide.xml:0.1.0');expect(locate(doc,[99,0])).toBeUndefined();
});
