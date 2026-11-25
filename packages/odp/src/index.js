import JSZip from 'jszip';
import { cloneJson } from '@stagecraft/core';
import { readBytes, throwIfAborted, safeXmlParse } from '@stagecraft/io';
import { inspectZip } from '@stagecraft/io/zip';
import { lengthEmu } from './vendor/officeview/units.js';

export const ODP_MIME = 'application/vnd.oasis.opendocument.presentation';
const NS = Object.freeze({
  office: 'urn:oasis:names:tc:opendocument:xmlns:office:1.0',
  draw: 'urn:oasis:names:tc:opendocument:xmlns:drawing:1.0',
  text: 'urn:oasis:names:tc:opendocument:xmlns:text:1.0',
  svg: 'urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0',
  style: 'urn:oasis:names:tc:opendocument:xmlns:style:1.0',
  fo: 'urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0',
  presentation: 'urn:oasis:names:tc:opendocument:xmlns:presentation:1.0',
  manifest: 'urn:oasis:names:tc:opendocument:xmlns:manifest:1.0',
  dc: 'http://purl.org/dc/elements/1.1/',
  meta: 'urn:oasis:names:tc:opendocument:xmlns:meta:1.0',
});
const namespaces = Object.entries(NS).map(([key, uri]) => `xmlns:${key}="${uri}"`).join(' ');
const is = (node, prefix, name) => node?.namespaceURI === NS[prefix] && node.localName === name;
const children = node => Array.from(node?.childNodes ?? []).filter(n => n.nodeType === 1);
const child = (node, prefix, name) => children(node).find(n => is(n, prefix, name));
const all = (node, prefix, name) => Array.from(node.getElementsByTagNameNS(NS[prefix], name));
const attr = (node, prefix, name) => node?.getAttributeNS(NS[prefix], name) || undefined;
const warning = (code, message) => ({ code, severity: 'warning', message });
const escape = value => {
  const text = String(value);
  for (const char of text) {
    const code = char.codePointAt(0);
    if (![9, 10, 13].includes(code) && !(code >= 32 && code <= 0xd7ff) && !(code >= 0xe000 && code <= 0xfffd) && code < 0x10000) throw new Error('Invalid XML character in ODP export');
  }
  return text.replace(/[&<>"'\r]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;', '\r': '&#13;' })[c]);
};
const hex = value => typeof value === 'string' && /^#[\da-f]{6}$/i.test(value);
const IDENTITY_FIELD = 'stagecraft.identity';
const IDENTITY_OMITTED_FIELD = 'stagecraft.identity.omitted';
const IDENTITY_OMIT_REASONS = new Set(['duplicate-id', 'invalid-id', 'invalid-section-name', 'invalid-theme', 'invalid-geometry', 'limit-exceeded']);
const MAX_IDENTITY_BYTES = 256 * 1024;
const MAX_IDENTITY_SECTIONS = 1024;
const MAX_IDENTITY_SLIDES = 10000;
const MAX_IDENTITY_ELEMENTS = 100000;
const MAX_IDENTITY_ID = 512;
const IDENTITY_FINGERPRINT_TEXT_BUDGET = 64 * 1024;
const validXmlScalar = (value, min, max) => {
  if (typeof value !== 'string' || value.length < min || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) return false;
  for (const char of value) {
    const code = char.codePointAt(0);
    if ((code >= 0xd800 && code <= 0xdfff) || code === 0xfffe || code === 0xffff) return false;
  }
  return true;
};
const validIdentityId = value => validXmlScalar(value, 1, MAX_IDENTITY_ID);
const validMetadataText = (value, max = 4096) => validXmlScalar(value, 0, max);
const textBytes = value => new TextEncoder().encode(value).byteLength;

function parse(text, runtime) {
  return safeXmlParse(text, runtime);
}
function plainText(node, budget) {
  const consume = text => {
    budget.remaining -= text.length;
    if (budget.remaining < 0) throw new Error('ODP expanded text exceeds character limit');
    return text;
  };
  return Array.from(node.childNodes).map(n => {
    if (n.nodeType === 3 || n.nodeType === 4) return consume(n.nodeValue);
    if (is(n, 'text', 's')) {
      const count = Number(attr(n, 'text', 'c') ?? 1);
      if (!Number.isSafeInteger(count) || count < 1 || count > 1000) throw new Error('ODP repeated spaces exceed supported limit');
      return consume(' '.repeat(count));
    }
    if (is(n, 'text', 'line-break')) return consume('\n');
    if (is(n, 'text', 'tab')) return consume('\t');
    return n.nodeType === 1 ? plainText(n, budget) : '';
  }).join('');
}
function paragraphs(node, budget) {
  const nodes = all(node, 'text', 'p');
  budget.remaining -= Math.max(0, nodes.length - 1);
  if (budget.remaining < 0) throw new Error('ODP expanded text exceeds character limit');
  return nodes.map(n => plainText(n, budget)).join('\n');
}

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const onlyKeys = (value, keys) => record(value) && Object.keys(value).every(key => keys.includes(key));
const hashText = text => {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
  return hash >>> 0;
};
const slideName = (title, index) => title === undefined || title === null || title === '' ? `Slide ${index + 1}` : String(title);
function fingerprintText(textBox, budget) {
  let remaining = budget.remaining, length = 0, hash = 2166136261;
  const addCode = code => {
    if (remaining <= 0) throw new Error('Identity fingerprint text exceeds budget');
    remaining -= 1;
    length += 1;
    hash = Math.imul(hash ^ code, 16777619);
  };
  const addText = text => {
    for (let index = 0; index < text.length; index += 1) addCode(text.charCodeAt(index));
  };
  const walk = node => {
    if (node.nodeType === 3 || node.nodeType === 4) { addText(node.nodeValue); return; }
    if (is(node, 'text', 's')) {
      const count = Number(attr(node, 'text', 'c') ?? 1);
      if (!Number.isSafeInteger(count) || count < 1 || count > 1000) throw new Error('Invalid repeated spaces in identity fingerprint');
      for (let index = 0; index < count; index += 1) addCode(32);
      return;
    }
    if (is(node, 'text', 'line-break')) { addCode(10); return; }
    if (is(node, 'text', 'tab')) { addCode(9); return; }
    for (const childNode of node.childNodes ?? []) walk(childNode);
  };
  const paragraphs = all(textBox, 'text', 'p');
  for (let index = 0; index < paragraphs.length; index += 1) {
    if (index > 0) addCode(10);
    walk(paragraphs[index]);
  }
  budget.remaining = remaining;
  return [length, hash >>> 0];
}
function pageFingerprint(pages, budget = { remaining: IDENTITY_FINGERPRINT_TEXT_BUDGET }) {
  return pages.map((page, index) => ({
    name: slideName(attr(page, 'draw', 'name'), index),
    elements: children(page).filter(node => !is(node, 'presentation', 'notes')).map(node => {
      const textBox = child(node, 'draw', 'text-box');
      return [
        node.localName,
        textBox ? attr(all(textBox, 'text', 'p')[0], 'text', 'style-name') : attr(node, 'draw', 'style-name'),
        attr(node, 'draw', 'transform'),
        attr(node, 'svg', 'x'),
        attr(node, 'svg', 'y'),
        attr(node, 'svg', 'width'),
        attr(node, 'svg', 'height'),
        textBox ? fingerprintText(textBox, budget) : null,
      ];
    }),
  }));
}
function validateIdentity(raw) {
  const invalid = { status: 'invalid', identity: null };
  if (!onlyKeys(raw, ['version', 'document', 'sections', 'slides', 'fingerprint']) || raw.version !== 1) return invalid;
  if (!onlyKeys(raw.document, ['id', 'theme'])) return invalid;
  if (raw.document.id !== undefined && !validIdentityId(raw.document.id)) return invalid;
  if (raw.document.theme !== undefined && !validMetadataText(raw.document.theme, MAX_IDENTITY_ID)) return invalid;
  if (!Array.isArray(raw.sections) || raw.sections.length > MAX_IDENTITY_SECTIONS) return invalid;
  if (!Array.isArray(raw.slides) || raw.slides.length > MAX_IDENTITY_SLIDES) return invalid;
  const sectionIds = new Set(), slideIds = new Set(), orderedSlideIds = [];
  for (const section of raw.sections) {
    if (!onlyKeys(section, ['id', 'name', 'slides']) || !validIdentityId(section.id) || sectionIds.has(section.id)
      || !validMetadataText(section.name) || !Array.isArray(section.slides)) return invalid;
    sectionIds.add(section.id);
    for (const id of section.slides) {
      if (!validIdentityId(id)) return invalid;
      orderedSlideIds.push(id);
    }
  }
  let elementCount = 0;
  for (const slide of raw.slides) {
    if (!onlyKeys(slide, ['id', 'elements']) || !validIdentityId(slide.id) || slideIds.has(slide.id) || !Array.isArray(slide.elements)) return invalid;
    slideIds.add(slide.id);
    elementCount += slide.elements.length;
    if (elementCount > MAX_IDENTITY_ELEMENTS) return invalid;
    const elementIds = new Set();
    for (const id of slide.elements) {
      if (!validIdentityId(id) || elementIds.has(id)) return invalid;
      elementIds.add(id);
    }
  }
  if (orderedSlideIds.length !== raw.slides.length || orderedSlideIds.some((id, index) => id !== raw.slides[index].id)) return invalid;
  const fingerprintPages = raw.fingerprint?.pages;
  if (!Array.isArray(fingerprintPages) || fingerprintPages.length !== raw.slides.length
    || fingerprintPages.some((page, index) => !onlyKeys(page, ['name', 'elements']) || typeof page.name !== 'string'
      || !Array.isArray(page.elements) || page.elements.length !== raw.slides[index].elements.length)) return invalid;
  return { status: 'valid', identity: raw };
}

export async function importOdp(source, options = {}) {
  const { zip } = await inspectZip(source, options);
  const textBudget = { remaining: 1024 * 1024 };
  const mimetype = zip.file('mimetype');
  if (!mimetype || mimetype._data.uncompressedSize > 1024 || (await mimetype.async('string')) !== ODP_MIME) throw new Error('Invalid ODP MIME type');
  const readXml = async (name, limit = Infinity) => {
    const file = zip.file(name);
    if (!file) return null;
    if (file._data.uncompressedSize > limit) throw new Error(`${name} exceeds XML limit`);
    throwIfAborted(options.signal);
    return parse(await file.async('string'), options.xml);
  };
  const manifest = await readXml('META-INF/manifest.xml', 4 * 1024 * 1024);
  if (!manifest || !is(manifest.documentElement, 'manifest', 'manifest')) throw new Error('Missing or invalid ODP manifest');
  if (all(manifest, 'manifest', 'encryption-data').length) throw new Error('Encrypted ODP packages are unsupported');
  const content = await readXml('content.xml');
  if (!content || !is(content.documentElement, 'office', 'document-content')) throw new Error('Missing or invalid ODP content XML');
  const presentation = child(child(content.documentElement, 'office', 'body'), 'office', 'presentation');
  if (!presentation) throw new Error('ODP presentation body is missing');
  const stylesDoc = await readXml('styles.xml');
  const roots = [stylesDoc, content].filter(Boolean);
  const styles = new Map(), layouts = new Map(), masters = new Map();
  for (const root of roots) {
    for (const style of all(root, 'style', 'style')) styles.set(`${attr(style, 'style', 'family')}:${attr(style, 'style', 'name')}`, style);
    for (const layout of all(root, 'style', 'page-layout')) layouts.set(attr(layout, 'style', 'name'), child(layout, 'style', 'page-layout-properties'));
    for (const master of all(root, 'style', 'master-page')) masters.set(attr(master, 'style', 'name'), attr(master, 'style', 'page-layout-name'));
  }
  const diagnostics = [warning('subset-import', 'ODP subset import: masters, backgrounds, rich text, animations, embedded objects and unsupported styles are not preserved. Original package bytes are not retained.')];
  function properties(name, family, kind, seen = new Set()) {
    if (!name) return [];
    if (seen.has(name)) throw new Error('Cyclic ODP style inheritance');
    seen.add(name);
    const style = styles.get(`${family}:${name}`);
    if (!style) return [];
    return [...properties(attr(style, 'style', 'parent-style-name'), family, kind, seen), child(style, 'style', kind)].filter(Boolean);
  }
  const prop = (nodes, prefix, name) => nodes.reduce((value, n) => attr(n, prefix, name) ?? value, undefined);
  const pages = children(presentation).filter(n => is(n, 'draw', 'page'));
  let documentHeight;
  let identity = null, identityStatus = 'regenerated', omittedReason, documentTitle;
  try {
    const metaDoc = await readXml('meta.xml', 4 * 1024 * 1024);
    if (metaDoc) {
      if (!is(metaDoc.documentElement, 'office', 'document-meta')) throw new Error('Invalid metadata document');
      documentTitle = all(metaDoc, 'dc', 'title')[0]?.textContent?.trim() || undefined;
      const fields = all(metaDoc, 'meta', 'user-defined').filter(node => attr(node, 'meta', 'name') === IDENTITY_FIELD);
      if (fields.length === 0) {
        const omitted = all(metaDoc, 'meta', 'user-defined').filter(node => attr(node, 'meta', 'name') === IDENTITY_OMITTED_FIELD);
        if (omitted.length > 1) throw new Error('Invalid identity omission metadata');
        if (omitted.length === 1 && IDENTITY_OMIT_REASONS.has(omitted[0].textContent)) {
          identityStatus = 'omitted';
          omittedReason = omitted[0].textContent;
        }
      } else {
        if (fields.length !== 1 || textBytes(fields[0].textContent) > MAX_IDENTITY_BYTES) throw new Error('Invalid identity metadata');
        const raw = JSON.parse(fields[0].textContent);
        const validation = validateIdentity(raw);
        let candidate = validation.identity;
        identityStatus = validation.status;
        if (identityStatus === 'valid') {
          if (candidate.slides.length !== pages.length) {
            identityStatus = 'stale';
            candidate = null;
          } else {
            const currentFingerprint = pageFingerprint(pages, { remaining: IDENTITY_FINGERPRINT_TEXT_BUDGET });
            if (JSON.stringify(candidate.fingerprint) !== JSON.stringify({ pages: currentFingerprint })) {
              identityStatus = 'stale';
              candidate = null;
            }
          }
        }
        identity = candidate;
      }
    }
  } catch {
    identityStatus = 'invalid';
    identity = null;
  }
  if (identityStatus === 'invalid') diagnostics.push(warning('identity-invalid', 'Stagecraft identity metadata was invalid and ignored; document, section, slide and object ids were regenerated.'));
  else if (identityStatus === 'stale') diagnostics.push(warning('identity-stale', 'Stagecraft identity metadata did not match the current ODP page/object structure; ids were regenerated rather than assigned to the wrong objects.'));
  else if (identityStatus === 'omitted') diagnostics.push(warning('identity-omitted', `Stagecraft identity metadata was omitted during export (${omittedReason}); document, section, slide and object ids were regenerated.`));
  else if (identityStatus === 'regenerated') diagnostics.push(warning('identity-regenerated', 'This ODP has no usable Stagecraft identity metadata; document, section, slide and object ids were regenerated.'));
  const slides = pages.map((page, index) => {
    const layout = layouts.get(masters.get(attr(page, 'draw', 'master-page-name')));
    const widthValue = attr(layout, 'fo', 'page-width'), heightValue = attr(layout, 'fo', 'page-height');
    const width = widthValue === undefined ? 18288000 : lengthEmu(widthValue);
    const height = heightValue === undefined ? 10287000 : lengthEmu(heightValue);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new Error('Invalid ODP page dimensions');
    const scale = 1920 / width, normalizedHeight = height * scale;
    if (!Number.isFinite(scale) || !Number.isFinite(normalizedHeight)) throw new Error('Invalid ODP page dimensions');
    if (documentHeight !== undefined && Math.abs(normalizedHeight - documentHeight) > 0.01) throw new Error('Mixed ODP page sizes are unsupported');
    documentHeight = normalizedHeight;
    const elements = [];
    let objectIndex = 0;
    for (const node of children(page)) {
      if (is(node, 'presentation', 'notes')) continue;
      const identityIndex = objectIndex++;
      const textBox = child(node, 'draw', 'text-box');
      const type = is(node, 'draw', 'rect') ? 'rect' : is(node, 'draw', 'ellipse') ? 'ellipse' : is(node, 'draw', 'frame') && textBox ? 'text' : null;
      if (!type || attr(node, 'draw', 'transform')) {
        diagnostics.push(warning('unsupported-object', `Slide ${index + 1}: skipped ${node.localName}${attr(node, 'draw', 'transform') ? ' with transform' : ''}.`));
        continue;
      }
      const geometry = ['x', 'y', 'width', 'height'].map(key => lengthEmu(attr(node, 'svg', key)));
      if (geometry.some(v => !Number.isFinite(v)) || geometry[2] <= 0 || geometry[3] <= 0) {
        diagnostics.push(warning('invalid-geometry', `Slide ${index + 1}: skipped object with missing or invalid geometry.`)); continue;
      }
      const [x, y, w, h] = geometry.map(v => v * scale);
      if (![x, y, w, h].every(Number.isFinite)) throw new Error('Invalid ODP scaled geometry');
      const el = { id: identity?.slides[index]?.elements[identityIndex] ?? `odp-${index + 1}-${elements.length + 1}`, type, x, y, w, h };
      const graphicName = attr(node, 'draw', 'style-name');
      if (type === 'text') {
        const p = all(textBox, 'text', 'p')[0];
        const textProps = [...properties(graphicName, 'graphic', 'text-properties'), ...properties(attr(p, 'text', 'style-name'), 'paragraph', 'text-properties')];
        const paragraphProps = properties(attr(p, 'text', 'style-name'), 'paragraph', 'paragraph-properties');
        el.content = paragraphs(textBox, textBudget);
        el.color = prop(textProps, 'fo', 'color') ?? '#15171c';
        if (!hex(el.color)) el.color = '#15171c';
        const fontSize = prop(textProps, 'fo', 'font-size');
        el.fontSize = (fontSize === undefined ? 457200 : lengthEmu(fontSize)) * scale;
        if (!Number.isFinite(el.fontSize) || el.fontSize <= 0) {
          el.fontSize = 48;
          diagnostics.push(warning('invalid-font-size', `Slide ${index + 1}: invalid font size replaced by 48px.`));
        }
        el.bold = prop(textProps, 'fo', 'font-weight') === 'bold';
        el.italic = prop(textProps, 'fo', 'font-style') === 'italic';
        el.align = ({ start: 'left', end: 'right', left: 'left', right: 'right', center: 'center' })[prop(paragraphProps, 'fo', 'text-align')] ?? 'left';
        const font = prop(textProps, 'fo', 'font-family');
        if (font) el.fontFamily = font;
        if (all(textBox, 'text', 'span').length || all(textBox, 'text', 'p').length > 1) diagnostics.push(warning('flattened-text', `Slide ${index + 1}: paragraph and run styles use the first paragraph style.`));
      } else {
        const graphic = properties(graphicName, 'graphic', 'graphic-properties');
        const fill = prop(graphic, 'draw', 'fill-color');
        el.fill = hex(fill) ? fill : '#4f46e5';
        if (prop(graphic, 'draw', 'fill') && prop(graphic, 'draw', 'fill') !== 'solid') diagnostics.push(warning('unsupported-fill', `Slide ${index + 1}: non-solid fill replaced by a solid fill.`));
        if (all(node, 'text', 'p').length) diagnostics.push(warning('unsupported-shape-text', `Slide ${index + 1}: text inside a shape was omitted.`));
      }
      elements.push(el);
    }
    const notes = child(page, 'presentation', 'notes');
    return { id: identity?.slides[index]?.id ?? `slide-${index + 1}`, title: slideName(attr(page, 'draw', 'name'), index), layout: 'blank', elements, notes: notes ? paragraphs(notes, textBudget) : '' };
  });
  throwIfAborted(options.signal);
  const sections = identity?.sections ?? [{ id: 'odp-section', name: 'Slides', slides: slides.map(s => s.id) }];
  return { document: {
    ...(identity?.document?.id !== undefined ? { id: identity.document.id } : {}),
    title: documentTitle || options.fileName?.replace(/\.odp$/i, '') || 'Imported presentation',
    theme: identity?.document?.theme ?? 'indigo',
    size: { w: 1920, h: documentHeight ?? 1080 },
    sections,
    slides,
  }, diagnostics };
}

function allowedKeys(value, keys, label) {
  for (const key of Object.keys(value)) if (!keys.includes(key)) throw new Error(`Unsupported ODP export ${label}: ${key}`);
}
function finite(value, label, positive = false) {
  if (!Number.isFinite(value) || (positive && value <= 0)) throw new Error(`Invalid ODP export ${label}`);
  return value;
}
const px = n => `${Number((n / 96).toFixed(10))}in`;
const textXml = text => escape(text).replace(/ {1,1000}/g, spaces => `<text:s text:c="${spaces.length}"/>`).replace(/\t/g, '<text:tab/>').replace(/\n/g, '<text:line-break/>');

function identityMetadata(document, order) {
  const omitted = reason => ({ json: null, reason });
  if (document.id !== undefined && !validIdentityId(document.id)) return omitted('invalid-id');
  if (document.theme !== undefined && !validMetadataText(document.theme, MAX_IDENTITY_ID)) return omitted('invalid-theme');
  if (document.sections.length > MAX_IDENTITY_SECTIONS || order.length > MAX_IDENTITY_SLIDES) return omitted('limit-exceeded');
  const sectionIds = new Set();
  for (const section of document.sections) {
    if (!validIdentityId(section.id)) return omitted('invalid-id');
    if (sectionIds.has(section.id)) return omitted('duplicate-id');
    if (section.name !== undefined && !validMetadataText(section.name)) return omitted('invalid-section-name');
    sectionIds.add(section.id);
  }
  const slideIds = new Set(), orderedSlides = [];
  let elementCount = 0;
  for (const id of order) {
    const slide = document.slides.find(item => item.id === id);
    if (!slide) throw new Error('ODP export section references missing slide');
    if (!validIdentityId(slide.id)) return omitted('invalid-id');
    if (slideIds.has(slide.id)) return omitted('duplicate-id');
    slideIds.add(slide.id);
    const elementIds = new Set();
    for (const element of slide.elements) {
      if (!validIdentityId(element.id)) return omitted('invalid-id');
      if (elementIds.has(element.id)) return omitted('duplicate-id');
      const lengths = ['x', 'y', 'w', 'h'].map(key => px(element[key]));
      if (!lengths.every(value => Number.isFinite(lengthEmu(value))) || !lengths.slice(2).every(value => lengthEmu(value) > 0)) return omitted('invalid-geometry');
      elementIds.add(element.id);
      elementCount += 1;
      if (elementCount > MAX_IDENTITY_ELEMENTS) return omitted('limit-exceeded');
    }
    orderedSlides.push(slide);
  }
  const identity = {
    version: 1,
    document: {
      ...(document.id !== undefined ? { id: document.id } : {}),
      ...(document.theme !== undefined ? { theme: document.theme } : {}),
    },
    sections: document.sections.map(section => ({ id: section.id, name: section.name ?? 'Slides', slides: [...section.slides] })),
    slides: orderedSlides.map(slide => ({ id: slide.id, elements: slide.elements.map(element => element.id) })),
    fingerprint: {
      pages: orderedSlides.map((slide, slideIndex) => ({
        name: slideName(slide.title, slideIndex),
        elements: slide.elements.map((element, elementIndex) => [
          element.type === 'text' ? 'frame' : element.type,
          `s${slideIndex}e${elementIndex}`,
          null,
          px(element.x),
          px(element.y),
          px(element.w),
          px(element.h),
          element.type === 'text' ? [element.content.length, hashText(element.content)] : null,
        ]),
      })),
    },
  };
  const json = JSON.stringify(identity);
  if (textBytes(json) > MAX_IDENTITY_BYTES) return omitted('limit-exceeded');
  return { json, reason: null };
}

async function writeOdpPackage(input, options = {}) {
  throwIfAborted(options.signal);
  const document = cloneJson(input);
  allowedKeys(document, ['id', 'title', 'theme', 'size', 'sections', 'slides'], 'document');
  if (!Array.isArray(document.slides) || !Array.isArray(document.sections)) throw new Error('ODP export requires slides and sections');
  const order = document.sections.flatMap(section => {
    allowedKeys(section, ['id', 'name', 'slides'], 'section');
    if (!Array.isArray(section.slides)) throw new Error('ODP export section slides must be an array');
    return section.slides;
  });
  if (order.length !== document.slides.length || new Set(order).size !== order.length) throw new Error('ODP export requires each slide exactly once in section order');
  const height = finite(document.size?.h ?? 1080, 'page height', true);
  if (document.size) allowedKeys(document.size, ['w', 'h'], 'size');
  if (document.size?.w !== undefined && document.size.w !== 1920) throw new Error('ODP export requires 1920 authoring width');
  let styles = '', pages = '';
  for (const [index, id] of order.entries()) {
    const slide = document.slides.find(s => s.id === id);
    if (!slide) throw new Error('ODP export section references missing slide');
    allowedKeys(slide, ['id', 'title', 'layout', 'elements', 'notes'], 'slide');
    if (slide.layout !== 'blank') throw new Error(`Unsupported ODP export layout: ${slide.layout}`);
    if (typeof (slide.notes ?? '') !== 'string') throw new Error('ODP export notes must be plain text');
    if (!Array.isArray(slide.elements)) throw new Error('ODP export requires elements');
    let shapes = '';
    for (const [ei, el] of slide.elements.entries()) {
      if (!['rect', 'ellipse', 'text'].includes(el.type)) throw new Error(`Unsupported ODP export element: ${el.type}`);
      const isText = el.type === 'text';
      allowedKeys(el, ['id', 'type', 'x', 'y', 'w', 'h', ...(isText ? ['content', 'color', 'fontSize', 'fontFamily', 'bold', 'italic', 'align'] : ['fill'])], 'element');
      for (const key of ['x', 'y', 'w', 'h']) finite(el[key], key, key === 'w' || key === 'h');
      const lengths = ['x', 'y', 'w', 'h'].map(key => px(el[key]));
      const name = `s${index}e${ei}`;
      const geometry = `svg:x="${lengths[0]}" svg:y="${lengths[1]}" svg:width="${lengths[2]}" svg:height="${lengths[3]}"`;
      if (isText) {
        if (typeof el.content !== 'string' || (el.fontFamily !== undefined && typeof el.fontFamily !== 'string')) throw new Error('ODP export text must be a string');
        if (!hex(el.color ?? '#15171c')) throw new Error('Invalid ODP text color');
        if (el.align !== undefined && !['left', 'center', 'right'].includes(el.align)) throw new Error('Unsupported ODP text alignment');
        for (const key of ['bold', 'italic']) if (el[key] !== undefined && typeof el[key] !== 'boolean') throw new Error(`Invalid ODP ${key}`);
        const size = finite(el.fontSize ?? 48, 'font size', true);
        styles += `<style:style style:name="${name}" style:family="paragraph"><style:paragraph-properties fo:text-align="${el.align ?? 'left'}"/><style:text-properties fo:font-size="${size * 0.75}pt" fo:color="${el.color ?? '#15171c'}" fo:font-weight="${el.bold ? 'bold' : 'normal'}" fo:font-style="${el.italic ? 'italic' : 'normal'}"${el.fontFamily ? ` fo:font-family="${escape(el.fontFamily)}"` : ''}/></style:style>`;
        shapes += `<draw:frame ${geometry}><draw:text-box><text:p text:style-name="${name}">${textXml(el.content)}</text:p></draw:text-box></draw:frame>`;
      } else {
        if (!hex(el.fill ?? '#4f46e5')) throw new Error('Invalid ODP shape fill');
        styles += `<style:style style:name="${name}" style:family="graphic"><style:graphic-properties draw:fill="solid" draw:fill-color="${el.fill ?? '#4f46e5'}" draw:stroke="none"/></style:style>`;
        shapes += `<draw:${el.type} draw:style-name="${name}" ${geometry}/>`;
      }
    }
    const notes = slide.notes ? `<presentation:notes><draw:frame presentation:class="notes" svg:x="0in" svg:y="0in" svg:width="20in" svg:height="1in"><draw:text-box><text:p>${textXml(slide.notes)}</text:p></draw:text-box></draw:frame></presentation:notes>` : '';
    pages += `<draw:page draw:name="${escape(slideName(slide.title, index))}" draw:master-page-name="Default">${shapes}${notes}</draw:page>`;
  }
  const identity = identityMetadata(document, order);
  const identityDiagnostics = identity.reason
    ? [warning('identity-omitted', `Stagecraft identity metadata was omitted (${identity.reason}); ids will be regenerated on import.`)]
    : [];
  const zip = new JSZip();
  zip.file('mimetype', ODP_MIME, { compression: 'STORE' });
  zip.file('content.xml', `<?xml version="1.0" encoding="UTF-8"?><office:document-content ${namespaces} office:version="1.3"><office:automatic-styles>${styles}</office:automatic-styles><office:body><office:presentation>${pages}</office:presentation></office:body></office:document-content>`);
  const identityMeta = identity.json
    ? `<meta:user-defined meta:name="${IDENTITY_FIELD}" meta:value-type="string">${escape(identity.json)}</meta:user-defined>`
    : `<meta:user-defined meta:name="${IDENTITY_OMITTED_FIELD}" meta:value-type="string">${escape(identity.reason)}</meta:user-defined>`;
  zip.file('meta.xml', `<?xml version="1.0" encoding="UTF-8"?><office:document-meta ${namespaces} office:version="1.3"><office:meta>${document.title !== undefined ? `<dc:title>${escape(document.title)}</dc:title>` : ''}${identityMeta}</office:meta></office:document-meta>`);
  zip.file('styles.xml', `<?xml version="1.0" encoding="UTF-8"?><office:document-styles ${namespaces} office:version="1.3"><office:styles/><office:automatic-styles><style:page-layout style:name="Page"><style:page-layout-properties fo:page-width="20in" fo:page-height="${px(height)}" style:print-orientation="landscape"/></style:page-layout></office:automatic-styles><office:master-styles><style:master-page style:name="Default" style:page-layout-name="Page"/></office:master-styles></office:document-styles>`);
  zip.file('META-INF/manifest.xml', `<?xml version="1.0" encoding="UTF-8"?><manifest:manifest xmlns:manifest="${NS.manifest}" manifest:version="1.3"><manifest:file-entry manifest:full-path="/" manifest:media-type="${ODP_MIME}"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/></manifest:manifest>`);
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  return { bytes: await readBytes(bytes, options), diagnostics: identityDiagnostics };
}

/** Returns bytes without downloading. Unsafe identities are omitted with a diagnostic available through odpAdapter.export/import. */
export async function writeOdp(input, options = {}) {
  return (await writeOdpPackage(input, options)).bytes;
}

export const odpAdapter = Object.freeze({
  id: 'odp', extensions: ['odp'], mimeType: ODP_MIME,
  import: importOdp,
  async export(document, options) {
    const output = await writeOdpPackage(document, options);
    return { ...output, diagnostics: [warning('subset-export', 'Native ODP subset export; Stagecraft identity metadata is preserved when safe, but desktop Office/LibreOffice fidelity is not certified.'), ...output.diagnostics] };
  },
});
