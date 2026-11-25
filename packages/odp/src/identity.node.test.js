// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import JSZip from 'jszip';
import { importOdp, odpAdapter, writeOdp } from './index.js';

const OFFICE = 'urn:oasis:names:tc:opendocument:xmlns:office:1.0';
const DRAW = 'urn:oasis:names:tc:opendocument:xmlns:drawing:1.0';
const META = 'urn:oasis:names:tc:opendocument:xmlns:meta:1.0';
const IDENTITY_FIELD = 'stagecraft.identity';

function xmlRuntime() {
  const window = new JSDOM('').window;
  return {
    window,
    xml: {
      parse: text => new window.DOMParser().parseFromString(text, 'application/xml'),
      serialize: document => new window.XMLSerializer().serializeToString(document),
    },
  };
}

function identityDocument() {
  return {
    id: 'deck&"雪',
    theme: 'amber',
    title: 'Board "One"',
    size: { w: 1920, h: 1080 },
    sections: [
      { id: 'sec&1', name: 'First "Section"', slides: ['slide-b'] },
      { id: 'sec2', name: 'Second', slides: ['slide-a'] },
    ],
    slides: [
      { id: 'slide-a', title: 'Alpha', layout: 'blank', elements: [
        { id: 'el&1', type: 'text', x: 10, y: 20, w: 100, h: 30, content: 'A' },
      ] },
      { id: 'slide-b', title: 'Beta', layout: 'blank', elements: [
        { id: 'el"2', type: 'rect', x: 40, y: 50, w: 80, h: 60, fill: '#112233' },
      ] },
    ],
  };
}

async function editPackage(bytes, edit) {
  const zip = await JSZip.loadAsync(bytes);
  await edit(zip);
  return zip.generateAsync({ type: 'uint8array' });
}

describe('ODP identity metadata', () => {
  it('round-trips document, section, slide and element identities through writeOdp/importOdp', async () => {
    const { window, xml } = xmlRuntime();
    try {
      const input = identityDocument();
      const bytes = await writeOdp(input);
      const result = await importOdp(bytes, { xml, fileName: 'Fallback.odp' });
      expect(result.document).toMatchObject({
        id: input.id,
        theme: input.theme,
        title: input.title,
        sections: input.sections,
      });
      expect(result.document.slides.map(slide => [slide.id, slide.title, slide.elements.map(element => element.id)])).toEqual([
        ['slide-b', 'Beta', ['el"2']],
        ['slide-a', 'Alpha', ['el&1']],
      ]);
      expect(result.diagnostics.some(item => item.code === 'identity-regenerated' || item.code === 'identity-stale' || item.code === 'identity-invalid')).toBe(false);
    } finally { window.close(); }
  });

  it('round-trips identities through odpAdapter.export/import', async () => {
    const { window, xml } = xmlRuntime();
    try {
      const input = identityDocument();
      const output = await odpAdapter.export(input);
      expect(output.diagnostics.find(item => item.code === 'subset-export')?.message).not.toMatch(/section names are not preserved/i);
      const result = await odpAdapter.import(output.bytes, { xml, fileName: 'Fallback.odp' });
      expect(result.document.id).toBe(input.id);
      expect(result.document.theme).toBe(input.theme);
      expect(result.document.sections).toEqual(input.sections);
      expect(result.document.slides.map(slide => slide.id)).toEqual(['slide-b', 'slide-a']);
    } finally { window.close(); }
  });

  it('regenerates legacy identities with a diagnostic when meta.xml is absent', async () => {
    const { window, xml } = xmlRuntime();
    try {
      const bytes = await writeOdp(identityDocument());
      const legacy = await editPackage(bytes, zip => zip.remove('meta.xml'));
      const result = await importOdp(legacy, { xml, fileName: 'Legacy.odp' });
      expect(result.document).toMatchObject({ title: 'Legacy', theme: 'indigo', sections: [{ id: 'odp-section', name: 'Slides', slides: ['slide-1', 'slide-2'] }] });
      expect(result.document.slides.map(slide => slide.id)).toEqual(['slide-1', 'slide-2']);
      expect(result.document.slides[0].elements[0].id).toBe('odp-1-1');
      expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'identity-regenerated', severity: 'warning' }));
    } finally { window.close(); }
  });

  it('regenerates instead of misapplying slide ids after a native-style page reorder', async () => {
    const { window, xml } = xmlRuntime();
    try {
      const bytes = await writeOdp(identityDocument());
      const edited = await editPackage(bytes, async zip => {
        const doc = xml.parse(await zip.file('content.xml').async('string'));
        const presentation = doc.getElementsByTagNameNS(OFFICE, 'presentation')[0];
        const pages = [...presentation.children].filter(node => node.namespaceURI === DRAW && node.localName === 'page');
        presentation.appendChild(pages[0]);
        zip.file('content.xml', xml.serialize(doc));
      });
      const result = await importOdp(edited, { xml, fileName: 'Edited.odp' });
      expect(result.document.slides.map(slide => [slide.id, slide.title])).toEqual([
        ['slide-1', 'Alpha'],
        ['slide-2', 'Beta'],
      ]);
      expect(result.document.sections).toEqual([{ id: 'odp-section', name: 'Slides', slides: ['slide-1', 'slide-2'] }]);
      expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'identity-stale', severity: 'warning' }));
    } finally { window.close(); }
  });

  it('regenerates element ids when same-count objects are reordered within a page', async () => {
    const { window, xml } = xmlRuntime();
    try {
      const doc = identityDocument();
      doc.sections = [{ id: 'sec', name: 'Slides', slides: ['slide-a'] }];
      doc.slides = [doc.slides[0]];
      doc.slides[0].elements.push({ id: 'second', type: 'rect', x: 150, y: 20, w: 40, h: 40, fill: '#445566' });
      const bytes = await writeOdp(doc);
      const edited = await editPackage(bytes, async zip => {
        const content = xml.parse(await zip.file('content.xml').async('string'));
        const page = content.getElementsByTagNameNS(DRAW, 'page')[0];
        const objects = [...page.children].filter(node => node.namespaceURI === DRAW);
        page.insertBefore(objects[1], objects[0]);
        zip.file('content.xml', xml.serialize(content));
      });
      const result = await importOdp(edited, { xml, fileName: 'Edited.odp' });
      expect(result.document.slides[0].elements.map(element => element.id)).toEqual(['odp-1-1', 'odp-1-2']);
      expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'identity-stale', severity: 'warning' }));
    } finally { window.close(); }
  });

  it('regenerates slide ids after a native-style page deletion', async () => {
    const { window, xml } = xmlRuntime();
    try {
      const bytes = await writeOdp(identityDocument());
      const edited = await editPackage(bytes, async zip => {
        const doc = xml.parse(await zip.file('content.xml').async('string'));
        const presentation = doc.getElementsByTagNameNS(OFFICE, 'presentation')[0];
        const pages = [...presentation.children].filter(node => node.namespaceURI === DRAW && node.localName === 'page');
        pages[0].remove();
        zip.file('content.xml', xml.serialize(doc));
      });
      const result = await importOdp(edited, { xml, fileName: 'Edited.odp' });
      expect(result.document.slides.map(slide => [slide.id, slide.title])).toEqual([['slide-1', 'Alpha']]);
      expect(result.document.sections).toEqual([{ id: 'odp-section', name: 'Slides', slides: ['slide-1'] }]);
      expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'identity-stale', severity: 'warning' }));
    } finally { window.close(); }
  });

  it('regenerates ids when same-geometry text frames with different content are reordered', async () => {
    const { window, xml } = xmlRuntime();
    try {
      const doc = identityDocument();
      doc.sections = [{ id: 'sec', name: 'Slides', slides: ['slide-a'] }];
      doc.slides = [doc.slides[0]];
      doc.slides[0].elements.push({ id: 'second-text', type: 'text', x: 10, y: 20, w: 100, h: 30, content: 'Second' });
      const bytes = await writeOdp(doc);
      const edited = await editPackage(bytes, async zip => {
        const content = xml.parse(await zip.file('content.xml').async('string'));
        const page = content.getElementsByTagNameNS(DRAW, 'page')[0];
        const objects = [...page.children].filter(node => node.namespaceURI === DRAW);
        page.insertBefore(objects[1], objects[0]);
        zip.file('content.xml', xml.serialize(content));
      });
      const result = await importOdp(edited, { xml, fileName: 'Edited.odp' });
      expect(result.document.slides[0].elements.map(element => [element.id, element.content])).toEqual([
        ['odp-1-1', 'Second'],
        ['odp-1-2', 'A'],
      ]);
      expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'identity-stale', severity: 'warning' }));
    } finally { window.close(); }
  });

  it.each(['malformed', 'oversize', 'duplicate', 'too-many-sections', 'partial-ids', 'invalid-id'])('ignores %s identity metadata without throwing', async kind => {
    const { window, xml } = xmlRuntime();
    try {
      const bytes = await writeOdp(identityDocument());
      const edited = await editPackage(bytes, async zip => {
        const meta = xml.parse(await zip.file('meta.xml').async('string'));
        const field = [...meta.getElementsByTagNameNS(META, 'user-defined')]
          .find(node => node.getAttributeNS(META, 'name') === IDENTITY_FIELD);
        if (kind === 'malformed') field.textContent = '{bad json';
        else if (kind === 'oversize') field.textContent = 'x'.repeat(256 * 1024 + 1);
        else {
          const identity = JSON.parse(field.textContent);
          if (kind === 'duplicate') identity.slides[1].id = identity.slides[0].id;
          else if (kind === 'partial-ids') identity.slides[0].elements.pop();
          else if (kind === 'invalid-id') identity.document.id = 'bad\u0000id';
          else identity.sections = Array.from({ length: 1025 }, (_, index) => ({ id: `section-${index}`, name: 'Section', slides: [] }));
          field.textContent = JSON.stringify(identity);
        }
        zip.file('meta.xml', xml.serialize(meta));
      });
      const result = await importOdp(edited, { xml, fileName: 'Fallback.odp' });
      expect(result.document.id).toBeUndefined();
      expect(result.document.slides.map(slide => slide.id)).toEqual(['slide-1', 'slide-2']);
      expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'identity-invalid', severity: 'warning' }));
    } finally { window.close(); }
  });

  it('ignores malformed meta.xml without throwing while keeping content import safe', async () => {
    const { window, xml } = xmlRuntime();
    try {
      const bytes = await writeOdp(identityDocument());
      const edited = await editPackage(bytes, zip => zip.file('meta.xml', '<office:document-meta>'));
      const result = await importOdp(edited, { xml, fileName: 'Fallback.odp' });
      expect(result.document.slides.map(slide => slide.id)).toEqual(['slide-1', 'slide-2']);
      expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'identity-invalid', severity: 'warning' }));
    } finally { window.close(); }
  });

  it('regenerates instead of shifting ids when a native transform makes the first object unsupported', async () => {
    const { window, xml } = xmlRuntime();
    try {
      const doc = identityDocument();
      doc.sections = [{ id: 'sec', name: 'Slides', slides: ['slide-a'] }];
      doc.slides = [doc.slides[0]];
      doc.slides[0].elements = [
        { id: 'first-id', type: 'rect', x: 10, y: 20, w: 40, h: 40, fill: '#112233' },
        { id: 'second-id', type: 'rect', x: 80, y: 20, w: 40, h: 40, fill: '#445566' },
      ];
      const bytes = await writeOdp(doc);
      const edited = await editPackage(bytes, async zip => {
        const content = xml.parse(await zip.file('content.xml').async('string'));
        const page = content.getElementsByTagNameNS(DRAW, 'page')[0];
        const objects = [...page.children].filter(node => node.namespaceURI === DRAW);
        objects[0].setAttributeNS(DRAW, 'transform', 'rotate(1)');
        zip.file('content.xml', xml.serialize(content));
      });
      const result = await importOdp(edited, { xml, fileName: 'Edited.odp' });
      expect(result.document.slides[0].elements.map(element => [element.id, element.fill])).toEqual([['odp-1-1', '#445566']]);
      expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'identity-stale', severity: 'warning' }));
    } finally { window.close(); }
  });

  it('regenerates instead of shifting ids when native edits make the first object geometry invalid', async () => {
    const { window, xml } = xmlRuntime();
    try {
      const doc = identityDocument();
      doc.sections = [{ id: 'sec', name: 'Slides', slides: ['slide-a'] }];
      doc.slides = [doc.slides[0]];
      doc.slides[0].elements = [
        { id: 'first-id', type: 'rect', x: 10, y: 20, w: 40, h: 40, fill: '#112233' },
        { id: 'second-id', type: 'rect', x: 80, y: 20, w: 40, h: 40, fill: '#445566' },
      ];
      const bytes = await writeOdp(doc);
      const edited = await editPackage(bytes, async zip => {
        const content = xml.parse(await zip.file('content.xml').async('string'));
        const page = content.getElementsByTagNameNS(DRAW, 'page')[0];
        const objects = [...page.children].filter(node => node.namespaceURI === DRAW);
        objects[0].setAttributeNS('urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0', 'width', '0in');
        zip.file('content.xml', xml.serialize(content));
      });
      const result = await importOdp(edited, { xml, fileName: 'Edited.odp' });
      expect(result.document.slides[0].elements.map(element => [element.id, element.fill])).toEqual([['odp-1-1', '#445566']]);
      expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'identity-stale', severity: 'warning' }));
    } finally { window.close(); }
  });

  it('rejects geometry that cannot round-trip through ODF length serialization', async () => {
    const doc = identityDocument();
    doc.sections = [{ id: 'sec', name: 'Slides', slides: ['slide-a'] }];
    doc.slides = [doc.slides[0]];
    doc.slides[0].elements = [{ id: 'rect', type: 'rect', x: 0, y: 0, w: 40, h: 40, fill: '#112233' }];
    doc.slides[0].elements[0].w = 1e-8;
    await expect(writeOdp(doc)).rejects.toThrow(/invalid.*geometry/i);
    doc.slides[0].elements[0].w = 40;
    doc.slides[0].elements[0].x = 1e24;
    await expect(writeOdp(doc)).rejects.toThrow(/invalid.*geometry/i);
  });

  it('rejects invalid or duplicate element ids on export instead of writing unusable metadata', async () => {
    const doc = identityDocument();
    doc.sections = [{ id: 'sec', name: 'Slides', slides: ['slide-a'] }];
    doc.slides = [doc.slides[0]];
    doc.slides[0].elements.push({ ...doc.slides[0].elements[0] });
    await expect(writeOdp(doc)).rejects.toThrow(/duplicate.*id/i);
    doc.slides[0].elements[1].id = 'bad\u0000id';
    await expect(writeOdp(doc)).rejects.toThrow(/invalid.*id/i);
  });
});
