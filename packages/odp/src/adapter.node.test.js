// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { importDocument, exportDocument } from '@stagecraft/io';
import { odpAdapter } from './index.js';

const document = { title: 'Server', sections: [{ id: 's', name: 'Slides', slides: ['one'] }], slides: [{
  id: 'one', layout: 'blank', elements: [{ id: 'text', type: 'text', x: 10, y: 20, w: 400, h: 100, content: 'Headless ODP' }],
}] };

describe('Node ODP adapter', () => {
  it('exports without DOM and imports using only an injected local XML parser', async () => {
    expect(typeof globalThis.document).toBe('undefined');
    expect(typeof DOMParser).toBe('undefined');
    const { bytes, metadata } = await exportDocument(document, { adapter: odpAdapter });
    expect(metadata.fileName).toBe('Server.odp');
    await expect(importDocument(bytes, { adapter: odpAdapter })).rejects.toThrow('XML runtime');
    const window = new JSDOM('').window;
    try {
      const xml = { parse: text => new window.DOMParser().parseFromString(text, 'application/xml') };
      const imported = await importDocument(bytes, { adapter: odpAdapter, xml });
      expect(imported.document.slides[0].elements[0].content).toBe('Headless ODP');
      expect(typeof DOMParser).toBe('undefined');
      expect(typeof globalThis.document).toBe('undefined');
    } finally { window.close(); }
  });
});
