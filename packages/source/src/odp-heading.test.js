import { expect, it } from 'vitest';
import JSZip from 'jszip';
import { openPresentation } from './index.js';
import { NS } from './xml.js';

const mime = 'application/vnd.oasis.opendocument.presentation';
const namespaces = `xmlns:office="${NS.office}" xmlns:draw="${NS.draw}" xmlns:text="${NS.text}" xmlns:style="${NS.style}" xmlns:fo="${NS.fo}" xmlns:presentation="${NS.presentation}" xmlns:svg="http://www.w3.org/2000/svg"`;

async function fixture(paragraphs) {
  const zip = new JSZip();
  zip.file('mimetype', mime);
  zip.file('META-INF/manifest.xml', `<manifest:manifest xmlns:manifest="${NS.manifest}"><manifest:file-entry manifest:full-path="/" manifest:media-type="${mime}"/></manifest:manifest>`);
  zip.file('content.xml', `<office:document-content ${namespaces}><office:automatic-styles/><office:body><office:presentation><draw:page draw:name="Slide" draw:master-page-name="Master"><draw:frame svg:x="1in" svg:y="1in" svg:width="8in" svg:height="2in"><draw:text-box>${paragraphs}</draw:text-box></draw:frame><presentation:notes><draw:frame presentation:class="notes" svg:x="0in" svg:y="0in" svg:width="8in" svg:height="1in"><draw:text-box><text:h>Note heading</text:h><text:p>Note body</text:p></draw:text-box></draw:frame></presentation:notes></draw:page></office:presentation></office:body></office:document-content>`);
  zip.file('styles.xml', `<office:document-styles ${namespaces}><office:styles><style:style style:name="Heading" style:family="paragraph"><style:paragraph-properties fo:text-align="center"/><style:text-properties fo:font-size="24pt" fo:font-weight="bold" fo:color="#123456"/></style:style></office:styles><office:automatic-styles><style:page-layout style:name="Layout"><style:page-layout-properties fo:page-width="10in" fo:page-height="7.5in"/></style:page-layout></office:automatic-styles><office:master-styles><style:master-page style:name="Master" style:page-layout-name="Layout"/></office:master-styles></office:document-styles>`);
  return openPresentation(await zip.generateAsync({ type: 'uint8array' }), { format: 'odp' });
}

it('replaces and clears ODP notes containing headings', async () => {
  const source = await fixture('<text:p>Body</text:p>');
  try {
    const replaced = structuredClone(source.document);
    replaced.slides[0].notes = 'Replacement';
    const reopened = await openPresentation((await source.export(replaced)).bytes, { format: 'odp' });
    try {
      expect(reopened.document.slides[0].notes).toBe('Replacement');
      const cleared = structuredClone(reopened.document);
      delete cleared.slides[0].notes;
      const final = await openPresentation((await reopened.export(cleared)).bytes, { format: 'odp' });
      try { expect(final.document.slides[0].notes).toBeUndefined(); }
      finally { final.dispose(); }
    } finally { reopened.dispose(); }
  } finally { source.dispose(); }
});

it.each([
  ['heading-only', '<text:h text:style-name="Heading">Heading</text:h>', ['Heading']],
  ['mixed', '<text:h text:style-name="Heading">Heading</text:h><text:p>Body</text:p>', ['Heading', 'Body']],
])('reads and round-trips %s ODP text containers', async (_label, paragraphs, expected) => {
  const source = await fixture(paragraphs);
  try {
    const object = source.document.slides[0].objects[0];
    expect(source.document.slides[0].notes).toBe('Note heading\nNote body');
    expect(object.text.paragraphs.map(p => p.runs.map(r => r.text).join(''))).toEqual(expected);
    expect(object.text.paragraphs[0].style.alignment).toBe('center');
    expect(object.text.paragraphs[0].runs[0].style.attributes['text:style-name']).toBe('Heading');
    expect(object.text.paragraphs[0].runs[0].extensions.odpAppearance).toMatchObject({ fontSize: 24, bold: true, color: '#123456' });

    const next = structuredClone(source.document);
    next.slides[0].objects[0].text.paragraphs[0].runs[0].text = 'Edited heading';
    const reopened = await openPresentation((await source.export(next)).bytes, { format: 'odp' });
    try {
      const edited = reopened.document.slides[0].objects[0].text.paragraphs;
      expect(reopened.document.slides[0].notes).toBe('Note heading\nNote body');
      expect(edited.map(p => p.runs.map(r => r.text).join(''))).toEqual(['Edited heading', ...expected.slice(1)]);
      expect(edited[0].style.alignment).toBe('center');
      expect(edited[0].runs[0].style.attributes['text:style-name']).toBe('Heading');
      expect(edited[0].runs[0].extensions.odpAppearance).toMatchObject({ fontSize: 24, bold: true, color: '#123456' });
    } finally { reopened.dispose(); }
  } finally { source.dispose(); }
});
