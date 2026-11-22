import JSZip from 'jszip';
import { writePptx } from '@stagecraft/pptx';
import { writeOdp } from '@stagecraft/odp';
import { openPresentation } from './index.js';
import { all } from './xml.js';

async function fixture(format, signed, empty = true) {
  const bytes = await (format === 'pptx' ? writePptx : writeOdp)({ sections: [{ id: 'sec', slides: ['s'] }], slides: [{ id: 's', layout: 'blank', elements: [] }] });
  const zip = await JSZip.loadAsync(bytes);
  if (empty) {
    const part = format === 'pptx' ? 'ppt/presentation.xml' : 'content.xml';
    const doc = new DOMParser().parseFromString(await zip.file(part).async('string'), 'application/xml');
    for (const node of all(doc, format === 'pptx' ? 'p' : 'draw', format === 'pptx' ? 'sldId' : 'page')) node.remove();
    zip.file(part, new XMLSerializer().serializeToString(doc));
  }
  if (signed) zip.file(format === 'pptx' ? '_xmlsignatures/sig1.xml' : 'META-INF/documentsignatures.xml', '<signatures/>');
  return zip.generateAsync({ type: 'uint8array' });
}

it.each([['pptx', false], ['pptx', true], ['odp', false], ['odp', true]])('preserves empty %s signed=%s exactly while enforcing export checks', async (format, signed) => {
  const bytes = await fixture(format, signed), session = await openPresentation(bytes, { format });
  try {
    expect(session.document.slides).toEqual([]);
    expect(session.capabilities.readOnly).toBe(signed);
    const output = await session.export(session.document);
    expect(output.bytes).toEqual(bytes);
    expect(output.bytes).not.toBe(bytes);
    expect(output.dirtyParts).toEqual([]);
    await expect(session.export(session.document, { maxBytes: bytes.length - 1 })).rejects.toThrow();
    const controller = new AbortController(); controller.abort();
    await expect(session.export(session.document, { signal: controller.signal })).rejects.toThrow();
    const tampered = structuredClone(session.document);
    tampered.extensions.sourceFormat = 'changed';
    await expect(session.export(tampered)).rejects.toThrow();
    const invalid = structuredClone(session.document); invalid.slides = null;
    await expect(session.export(invalid)).rejects.toThrow();
    const changed = structuredClone(session.document);
    changed.assets.push({ id: 'new-asset', extensions: { stagecraftAuthored: true, contentType: 'image/png' } });
    await expect(session.export(changed)).rejects.toThrow('Native export requires at least one slide');
  } finally { session.dispose(); }
});

it.each(['pptx', 'odp'])('still rejects deleting the final %s slide', async format => {
  const session = await openPresentation(await fixture(format, false, false), { format });
  try {
    const changed = structuredClone(session.document); changed.slides = [];
    await expect(session.export(changed)).rejects.toThrow('Native export requires at least one slide');
  } finally { session.dispose(); }
});
