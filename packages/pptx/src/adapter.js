import { importPptx } from './lib/pptxImport.js';
import { writePptx, PPTX_MIME } from './lib/pptxExport.js';

/** Adapter translates the existing editable deck subset; it does not preserve source package parts. */
export const pptxAdapter = Object.freeze({
  id: 'pptx',
  extensions: ['pptx'],
  mimeType: PPTX_MIME,
  async import(bytes, options) {
    const { deck, warnings } = await importPptx(bytes, options);
    return { document: deck, diagnostics: [
      { code: 'conversion-subset', severity: 'warning', message: 'PPTX import converts supported content into an editable Stagecraft deck. Original package parts and unsupported features are not preserved.' },
      ...warnings.map(message => ({ code: 'unsupported-content', severity: 'warning', message })),
    ] };
  },
  async export(document, options) {
    return { bytes: await writePptx(document, options), diagnostics: [
      { code: 'source-not-preserved', severity: 'warning', message: 'PPTX export rebuilds supported Stagecraft content. Original package parts, unsupported features and source fidelity are not preserved.' },
    ] };
  },
});
