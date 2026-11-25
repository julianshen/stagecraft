import { it, expect } from 'vitest';
import JSZip from 'jszip';
import { writePptx } from '@stagecraft/pptx';
import { writeOdp } from '@stagecraft/odp';
import { IMAGE_LIMITS, openPresentation } from './index.js';
import { NS } from './xml.js';

const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), c => c.charCodeAt(0));
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x01, 0xff, 0xd9]);
const deck = { sections: [{ id: 'section', slides: ['slide'] }], slides: [{ id: 'slide', layout: 'blank', elements: [] }] };
const textDeck = { sections: [{ id: 'section', slides: ['slide'] }], slides: [{ id: 'slide', layout: 'blank', elements: [{ id: 'text', type: 'text', x: 0, y: 0, w: 1000, h: 500, content: 'Editable' }] }] };
const parse = text => new DOMParser().parseFromString(text, 'application/xml');
const serialize = doc => new XMLSerializer().serializeToString(doc);

async function packageWithImages(images) {
  const zip = await JSZip.loadAsync(await writePptx(deck));
  const slidePart = 'ppt/slides/slide1.xml', relPart = 'ppt/slides/_rels/slide1.xml.rels';
  const slide = parse(await zip.file(slidePart).async('string'));
  const tree = slide.getElementsByTagNameNS(NS.p, 'spTree')[0];
  const relationships = parse(await zip.file(relPart).async('string')).documentElement;
  images.forEach(({ name, bytes }, index) => {
    const part = `ppt/media/${name}`, rid = `rIdBranch${index}`;
    zip.file(part, bytes);
    const relationship = relationships.ownerDocument.createElementNS(NS.rel, 'Relationship');
    for (const [key, value] of Object.entries({ Id: rid, Type: `${NS.r}/image`, Target: `../media/${name}` })) relationship.setAttribute(key, value);
    relationships.appendChild(relationship);
    const markup = `<p:pic xmlns:p="${NS.p}" xmlns:a="${NS.a}" xmlns:r="${NS.r}"><p:nvPicPr><p:cNvPr id="${1000 + index}" name="Picture ${index}"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="9525" cy="9525"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
    tree.appendChild(slide.importNode(parse(markup).documentElement, true));
  });
  zip.file(slidePart, serialize(slide));
  zip.file(relPart, serialize(relationships));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

it('rejects malformed host image inputs without consuming an asset id', async () => {
  const session = await openPresentation(await writePptx(deck), { format: 'pptx' });
  const oversized = new Uint8Array(IMAGE_LIMITS.maxBytes + 1);
  oversized.set(PNG);
  const cases = [
    [null, /Invalid image input/],
    ['image', /Invalid image input/],
    [{}, /Uint8Array/],
    [{ bytes: PNG.buffer }, /Uint8Array/],
    [{ bytes: new Uint8Array() }, /per-image byte limit/],
    [{ bytes: oversized }, /per-image byte limit/],
    [{ bytes: Uint8Array.from([0x89, 0x50, 0x4e, 0x47]) }, /Unsupported image/],
    [{ bytes: Uint8Array.from([0xff, 0xd8, 0xff, 0x00]) }, /Unsupported image/],
    [{ bytes: PNG, contentType: 'image/jpeg' }, /does not match/],
  ];
  try {
    for (const [input, message] of cases) expect(() => session.registerImage(input)).toThrow(message);
    expect(session.images).toEqual([]);
    expect(session.registerImage({ bytes: PNG }).assetId).toBe('image-asset-1');
  } finally { session.dispose(); }
});

it('accepts JPEG registrations and keeps a private immutable byte copy', async () => {
  const session = await openPresentation(await writePptx(deck), { format: 'pptx' });
  try {
    const bytes = JPEG.slice(), handle = session.registerImage({ bytes, contentType: 'image/jpeg' });
    bytes.fill(0);
    const preview = session.getImage(handle.assetId);
    expect(handle.contentType).toBe('image/jpeg');
    expect(preview.contentType).toBe('image/jpeg');
    expect(preview.bytes).toEqual(JPEG);
    preview.bytes.fill(0);
    expect(session.getImage(handle.assetId).bytes).toEqual(JPEG);
    expect(session.getImage('missing')).toBeNull();
  } finally { session.dispose(); }
});

it('previews only bounded PNG/JPEG package assets and diagnoses skipped entries', async () => {
  const oversized = new Uint8Array(IMAGE_LIMITS.maxBytes + 1);
  oversized.set(PNG);
  const bytes = await packageWithImages([
    { name: 'one.png', bytes: PNG },
    { name: 'two.jpg', bytes: JPEG },
    { name: 'notes.txt', bytes: new TextEncoder().encode('not an image') },
    { name: 'large.png', bytes: oversized },
  ]);
  const session = await openPresentation(bytes, { format: 'pptx' });
  try {
    const assets = session.document.assets;
    expect(session.getImage(assets.find(asset => asset.source.part.endsWith('one.png')).id)?.contentType).toBe('image/png');
    expect(session.getImage(assets.find(asset => asset.source.part.endsWith('two.jpg')).id)?.contentType).toBe('image/jpeg');
    expect(session.getImage(assets.find(asset => asset.source.part.endsWith('notes.txt')).id)).toBeNull();
    expect(session.getImage(assets.find(asset => asset.source.part.endsWith('large.png')).id)).toBeNull();
    expect(session.diagnostics.find(item => item.code === 'IMAGE_PREVIEW_UNAVAILABLE').message).toContain('1 embedded image');
    expect(session.images).toHaveLength(2);
  } finally { session.dispose(); }
});

it('caps native previews at the image-count limit and retains later package assets', async () => {
  const images = Array.from({ length: IMAGE_LIMITS.maxImages + 1 }, (_, index) => ({ name: `${index}.png`, bytes: PNG }));
  const session = await openPresentation(await packageWithImages(images), { format: 'pptx' });
  try {
    expect(session.document.assets).toHaveLength(IMAGE_LIMITS.maxImages + 1);
    expect(session.images).toHaveLength(IMAGE_LIMITS.maxImages);
    expect(session.getImage(session.document.assets.at(-1).id)).toBeNull();
    expect(session.diagnostics.find(item => item.code === 'IMAGE_PREVIEW_UNAVAILABLE').message).toContain('1 embedded image');
  } finally { session.dispose(); }
});

it.each([
  ['content type', async zip => {
    const doc = parse(await zip.file('[Content_Types].xml').async('string'));
    const override = doc.createElementNS(NS.ct, 'Override');
    override.setAttribute('PartName', '/_xmlsignatures/sig1.xml');
    override.setAttribute('ContentType', 'application/vnd.openxmlformats-package.digital-signature-xmlsignature+xml');
    doc.documentElement.appendChild(override);
    zip.file('[Content_Types].xml', serialize(doc));
  }],
  ['relationship', async zip => {
    const part = '_rels/.rels', doc = parse(await zip.file(part).async('string'));
    const relationship = doc.createElementNS(NS.rel, 'Relationship');
    for (const [key, value] of Object.entries({ Id: 'signature', Type: `${NS.r}/digital-signature/origin`, Target: '_xmlsignatures/sig1.xml', TargetMode: 'External' })) relationship.setAttribute(key, value);
    doc.documentElement.appendChild(relationship);
    zip.file(part, serialize(doc));
  }],
])('detects a signed source from its %s and preserves exact no-op bytes', async (_label, mutate) => {
  const zip = await JSZip.loadAsync(await writePptx(deck));
  await mutate(zip);
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  const session = await openPresentation(bytes, { format: 'pptx' });
  try {
    expect(session.capabilities.readOnly).toBe(true);
    expect(session.diagnostics.some(item => item.code === 'SIGNED_SOURCE')).toBe(true);
    expect((await session.export(session.document)).bytes).toEqual(bytes);
  } finally { session.dispose(); }
});

it.each([
  ['fit map', { fit: new Map([['object', { fontScale: 1, lnSpcReduction: 0 }]]) }],
  ['resize object', { resize: { object: { width: 1 } } }],
])('rejects signed-source authoring hints supplied as a %s', async (_label, options) => {
  const zip = await JSZip.loadAsync(await writePptx(deck));
  zip.file('[Content_Types].xml', (await zip.file('[Content_Types].xml').async('string')).replace('</Types>', '<Override PartName="/_xmlsignatures/sig1.xml" ContentType="application/vnd.openxmlformats-package.digital-signature-xmlsignature+xml"/></Types>'));
  const session = await openPresentation(await zip.generateAsync({ type: 'uint8array' }), { format: 'pptx' });
  try { await expect(session.export(session.document, options)).rejects.toThrow(/signed source/); }
  finally { session.dispose(); }
});

it.each([
  ['invalid colour', run => { run.style.color = 'red'; }, /Invalid direct run typography/],
  ['new opaque attribute', run => { run.style.u = 'sng'; }, /Unsupported run style/],
])('rejects %s instead of silently rewriting a native run', async (_label, mutate, message) => {
  const input = await writePptx(textDeck);
  const session = await openPresentation(input, { format: 'pptx' });
  try {
    const next = structuredClone(session.document);
    const run = next.slides[0].objects.flatMap(object => object.text?.paragraphs.flatMap(paragraph => paragraph.runs) ?? []).find(run => run.editable);
    mutate(run);
    await expect(session.export(next)).rejects.toThrow(message);
  } finally { session.dispose(); }
});

it('rejects an unsupported source format before reading package bytes', async () => {
  await expect(openPresentation(new Uint8Array(), { format: 'pdf' })).rejects.toThrow('Unsupported native format');
});

it('round-trips direct run colour changes and explicit colour resets', async () => {
  const session = await openPresentation(await writePptx(textDeck), { format: 'pptx' });
  let reopened;
  try {
    const next = structuredClone(session.document);
    const run = next.slides[0].objects[0].text.paragraphs[0].runs[0];
    run.style.color = '#ABCDEF';
    const coloured = await session.export(next);
    reopened = await openPresentation(coloured.bytes, { format: 'pptx' });
    expect(reopened.document.slides[0].objects[0].text.paragraphs[0].runs[0].style.color).toBe('#abcdef');
    reopened.dispose();
    reopened = null;
    delete run.style.color;
    const reset = await session.export(next);
    reopened = await openPresentation(reset.bytes, { format: 'pptx' });
    expect(reopened.document.slides[0].objects[0].text.paragraphs[0].runs[0].style.color).toBeUndefined();
  } finally { reopened?.dispose(); session.dispose(); }
});

it.each([null, 1, []])('rejects malformed autofit measurement %j before applying it', async value => {
  const session = await openPresentation(await writePptx(deck), { format: 'pptx' });
  try { await expect(session.export(session.document, { fit: new Map([['object', value]]) })).rejects.toThrow('Invalid autofit measurement'); }
  finally { session.dispose(); }
});

it('rejects autofit measurements for ODP sources', async () => {
  const session = await openPresentation(await writeOdp(deck), { format: 'odp' });
  try { await expect(session.export(session.document, { fit: new Map([['object', { fontScale: 1, lnSpcReduction: 0 }]]) })).rejects.toThrow('Invalid autofit measurement'); }
  finally { session.dispose(); }
});

it('keeps an unchanged ODP formatting override as an exact no-op', async () => {
  const bytes = await writeOdp(textDeck), session = await openPresentation(bytes, { format: 'odp' });
  try {
    const next = structuredClone(session.document);
    next.slides[0].objects[0].text.paragraphs[0].runs[0].style.overrides = {};
    expect((await session.export(next)).bytes).toEqual(bytes);
  } finally { session.dispose(); }
});

it('rejects forged PPTX preview appearance while allowing ignored display-proof metadata', async () => {
  const session = await openPresentation(await writePptx(textDeck), { format: 'pptx' });
  try {
    const forged = structuredClone(session.document);
    forged.slides[0].objects[0].text.paragraphs[0].runs[0].extensions.pptxAppearance.fontFamily = 'Forged';
    await expect(session.export(forged)).rejects.toThrow();
    const next = structuredClone(session.document), run = next.slides[0].objects[0].text.paragraphs[0].runs[0];
    run.text = 'Changed';
    run.extensions.stagecraftNativeAppearance = { forged: true };
    const output = await session.export(next);
    expect(output.dirtyParts).toEqual(['ppt/slides/slide1.xml']);
  } finally { session.dispose(); }
});
