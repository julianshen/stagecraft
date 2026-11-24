import { beforeAll, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import { writePptx } from '@stagecraft/pptx';
import { writeOdp } from '@stagecraft/odp';
import { importPptx } from '@stagecraft/pptx';
import { importOdp } from '@stagecraft/odp';
import { openPresentation } from '@stagecraft/source';

const declarationError = 'DTD and entity declarations are unsupported';
const invalidError = 'Invalid XML';
const templates = new Map();
const entrypoints = [
  { name: 'source', format: 'pptx', part: 'ppt/presentation.xml', run: (bytes, xml) => openPresentation(bytes, { format: 'pptx', xml }) },
  { name: 'pptx', format: 'pptx', part: 'ppt/presentation.xml', run: (bytes, xml) => importPptx(bytes, { xml }) },
  { name: 'odp', format: 'odp', part: 'content.xml', run: (bytes, xml) => importOdp(bytes, { xml }) },
];

beforeAll(async () => {
  templates.set('pptx', await writePptx({ title: 'Safe XML', sections: [{ id: 's', slides: ['one'] }], slides: [{ id: 'one', layout: 'blank', elements: [] }] }));
  templates.set('odp', await writeOdp({ title: 'Safe XML', sections: [{ id: 's', name: 'Slides', slides: ['one'] }], slides: [{ id: 'one', layout: 'blank', elements: [] }] }));
});

async function rejection(promise) {
  try { await promise; } catch (error) { return error; }
  throw new Error('Expected malicious XML to be rejected');
}

const cases = [
  ['simple doctype', '<!DOCTYPE root><root/>', declarationError, false],
  ['internal subset', '<!DOCTYPE root [<!ENTITY x "SECRET_DOCUMENT_TEXT">]><root/>', declarationError, false],
  ['external doctype', '<!DOCTYPE root SYSTEM "file:///SECRET_DOCUMENT_TEXT"><root/>', declarationError, false],
  ['entity', '<!ENTITY x "SECRET_DOCUMENT_TEXT"><root/>', declarationError, false],
  ['nul doctype', '<!DO\0CTYPE root><root/>', declarationError, false],
  ['nul entity', '<!ENT\0ITY x "SECRET_DOCUMENT_TEXT"><root/>', declarationError, false],
  ['comment false positive', '<root><!-- <!doctype SECRET_DOCUMENT_TEXT> --></root>', declarationError, false],
  ['CDATA false positive', '<root><![CDATA[<!ENTITY SECRET_DOCUMENT_TEXT>]]></root>', declarationError, false],
  ['BOM and whitespace', '\uFEFF \n\t<!doctype root><root/>', declarationError, false],
  ['nul elsewhere', '<root>\0SECRET_DOCUMENT_TEXT</root>', invalidError, true],
  ['malformed XML', '<root>SECRET_DOCUMENT_TEXT', invalidError, true],
  ['throwing host parser', '<root>SECRET_DOCUMENT_TEXT</root>', invalidError, true],
];

describe.each(cases)('%s', (_label, malicious, message, parses) => {
  it.each(entrypoints)('is rejected by the $name public entrypoint with a fixed message', async entry => {
    const zip = await JSZip.loadAsync(templates.get(entry.format));
    zip.file(entry.part, malicious);
    const bytes = await zip.generateAsync({ type: 'uint8array' });
    const parse = vi.fn(text => {
      if (_label === 'throwing host parser' && text.includes('SECRET_DOCUMENT_TEXT')) throw new Error('SECRET_DOCUMENT_TEXT');
      return new DOMParser().parseFromString(text, 'application/xml');
    });
    const xml = { parse, serialize: doc => new XMLSerializer().serializeToString(doc) };
    const error = await rejection(entry.run(bytes, xml));
    expect(error.message).toBe(message);
    expect(error.message).not.toContain('SECRET_DOCUMENT_TEXT');
    if (parses) expect(parse).toHaveBeenCalledWith(malicious);
    else expect(parse).not.toHaveBeenCalled();
  });
});
