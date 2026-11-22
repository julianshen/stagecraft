// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { writePptx } from '../../pptx/src/index.js';
import { writeOdp } from '../../odp/src/index.js';
import { openPresentation } from './index.js';

describe.each(['pptx', 'odp'])('%s source session in Node', format => {
  it('patches a text run using a local XML runtime with no browser globals', async () => {
    expect(typeof DOMParser).toBe('undefined');
    const window = new JSDOM('').window;
    const xml = { parse: text => new window.DOMParser().parseFromString(text, 'application/xml'), serialize: document => new window.XMLSerializer().serializeToString(document) };
    try {
      const deck = { sections: [{ id: 's', name: 'Slides', slides: ['one'] }], slides: [{ id: 'one', layout: 'blank', elements: [
        { id: 'text', type: 'text', x: 0, y: 0, w: 200, h: 100, content: 'Before' },
      ] }] };
      const bytes = format === 'pptx' ? await writePptx(deck, { xml }) : await writeOdp(deck);
      const session = await openPresentation(bytes, { format, xml });
      const next = structuredClone(session.document);
      const object = next.slides[0].objects.find(o => o.text?.paragraphs.some(p => p.runs.some(r => r.text === 'Before')));
      object.text.paragraphs.flatMap(p => p.runs).find(r => r.text === 'Before').text = 'After';
      const output = await session.export(next);
      const reopened = await openPresentation(output.bytes, { format, xml });
      expect(JSON.stringify(reopened.document)).toContain('After');
      expect(output.dirtyParts).toHaveLength(1);
      expect(typeof DOMParser).toBe('undefined');
      session.dispose(); reopened.dispose();
    } finally { window.close(); }
  });
});
