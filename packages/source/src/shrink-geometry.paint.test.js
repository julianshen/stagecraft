import { it, expect } from 'vitest';
import JSZip from 'jszip';
import { openPresentation } from './index.js';
import { measureShrinkFits } from '@stagecraft/renderer';

// Native geometry must pass through the source reader before canvas eligibility is tested.
async function nativeShape(geometry) {
  const zip = new JSZip();
  const p = 'http://schemas.openxmlformats.org/presentationml/2006/main';
  const a = 'http://schemas.openxmlformats.org/drawingml/2006/main';
  const r = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const rel = 'http://schemas.openxmlformats.org/package/2006/relationships';
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/></Types>');
  zip.file('_rels/.rels', `<Relationships xmlns="${rel}"><Relationship Id="r1" Type="${r}/officeDocument" Target="ppt/presentation.xml"/></Relationships>`);
  zip.file('ppt/presentation.xml', `<p:presentation xmlns:p="${p}" xmlns:r="${r}"><p:sldIdLst><p:sldId id="256" r:id="r1"/></p:sldIdLst></p:presentation>`);
  zip.file('ppt/_rels/presentation.xml.rels', `<Relationships xmlns="${rel}"><Relationship Id="r1" Type="${r}/slide" Target="slides/slide1.xml"/></Relationships>`);
  zip.file('ppt/slides/slide1.xml', `<p:sld xmlns:p="${p}" xmlns:a="${a}"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="1" name="Shrink shape"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="2667000" cy="952500"/></a:xfrm>${geometry}</p:spPr><p:txBody><a:bodyPr><a:normAutofit/></a:bodyPr><a:lstStyle/><a:p><a:r><a:rPr sz="1800"><a:latin typeface="Arial"/></a:rPr><a:t>${'Long text that needs to shrink inside this frame. '.repeat(8)}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`);
  return openPresentation(await zip.generateAsync({ type: 'uint8array' }), { format: 'pptx' });
}

it.each([
  ['ellipse', '<a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom>', false],
  ['rounded rectangle', '<a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom>', false],
  ['custom geometry', '<a:custGeom><a:avLst/><a:rect l="10" t="10" r="20" b="20"/><a:pathLst/></a:custGeom>', false],
  ['adjusted rectangle', '<a:prstGeom prst="rect"><a:avLst><a:gd name="adj" fmla="val 25000"/></a:avLst></a:prstGeom>', false],
  ['rectangle', '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>', true],
  ['default text box', '', true],
])('only measures supported text rectangles: %s', async (_name, geometry, supported) => {
  await document.fonts.ready;
  const source = await nativeShape(geometry);
  try {
    const object = source.document.slides[0].objects[0];
    expect(measureShrinkFits(source.document, { fonts: document.fonts }).has(object.id)).toBe(supported);
    expect(object.extensions.pptxTextMetrics.supported).toBe(supported);
  } finally { source.dispose(); }
});
