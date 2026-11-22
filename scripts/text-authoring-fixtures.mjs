import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { writePptx } from '../packages/pptx/src/index.js';
import { writeOdp } from '../packages/odp/src/index.js';
import { openPresentation } from '../packages/source/src/index.js';
import { createEditor } from '../packages/core/src/editor/index.js';
import { documentPlugin, presentationPlugin, validateDocument } from '../packages/core/src/document/index.js';

const authored = { stagecraftAuthored: true };
const pt = n => n * 12700;
const run = (id, text) => ({ id, text, editable: true, style: { sz: '2400' }, extensions: authored });
const paragraph = (id, texts) => ({ id, runs: texts.map((text, i) => run(`${id}-r${i}`, text)) });

/** Commands, not preformatted XML, are the acceptance fixture's public entry point. */
export async function createTextFixture(format, xml) {
  const deck = { title: 'Text editing acceptance', sections: [{ id: 'section', name: 'Slides', slides: ['slide'] }], slides: [{ id: 'slide', layout: 'blank', elements: [] }] };
  const source = await openPresentation(await (format === 'pptx' ? writePptx : writeOdp)(deck), { format, xml });
  const editor = createEditor({ document: source.document, validateDocument, plugins: [documentPlugin, presentationPlugin] });
  try {
    const slideId = source.document.slides[0].id;
    const add = (id, y, height, paragraphs, targetSlide = slideId) => editor.dispatch('presentation.addObject', { slideId: targetSlide, object: {
      id, type: 'text', geometry: { x: pt(48), y: pt(y), width: pt(600), height: pt(height) },
      text: { paragraphs }, extensions: authored,
    } });
    add('heading', 32, 60, [paragraph('title', ['Text editing acceptance'])]);
    editor.dispatch('document.setRunFormat', { runId: 'title-r0', format: { fontFamily: 'Arial', fontSize: 30, bold: true, color: '#224488' } });
    editor.dispatch('document.setParagraphFormat', { paragraphId: 'title', format: { alignment: 'center', spaceAfter: 12 } });
    add('range', 110, 70, [paragraph('range-p', ['Plain left ', 'middle right'])]);
    editor.dispatch('document.setRunRangeFormat', { objectId: 'range', range: {
      start: { paragraphId: 'range-p', runId: 'range-p-r0', offset: 6 },
      end: { paragraphId: 'range-p', runId: 'range-p-r1', offset: 6 },
    }, format: { bold: true, color: '#cc3300', fontFamily: 'Georgia' } });
    add('lists', 190, 170, [paragraph('bullet', ['Bullet item']), paragraph('number', ['Numbered item']), paragraph('space', ['Two  spaces\tand tab'])]);
    editor.dispatch('document.setParagraphFormat', { paragraphId: 'bullet', format: { bullet: { type: 'char', char: '•' }, spaceAfter: 8, lineSpacing: 150 } });
    editor.dispatch('document.setParagraphFormat', { paragraphId: 'number', format: { bullet: { type: 'number', format: 'arabicPeriod' }, spaceAfter: 8 } });
    editor.dispatch('document.setTextBodyLayout', { objectId: 'lists', layout: { autofit: 'resize' } });
    editor.dispatch('presentation.addSlide', { slideId: 'numbering-slide' });
    const numbered = ['First item', 'Nested first', 'Nested second', 'Second item'];
    add('numbering', 40, 300, numbered.map((value, i) => paragraph(`numbered-${i}`, [value])), 'numbering-slide');
    for (const [i, level] of [0, 1, 1, 0].entries()) {
      editor.dispatch('document.setParagraphFormat', { paragraphId: `numbered-${i}`, format: {
        bullet: { type: 'number', format: 'arabicPeriod' }, level, spaceAfter: 8,
        indentStart: pt(24 * (level + 1)), firstLineIndent: pt(-12),
      } });
    }
    const document = editor.getSnapshot().document;
    const result = await source.export(document);
    return { ...result, document };
  } finally { editor.dispose(); source.dispose(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const output = path.resolve(process.argv[2] ?? '/tmp/stagecraft-text-authoring');
  const window = new JSDOM('').window;
  const xml = { parse: value => new window.DOMParser().parseFromString(value, 'application/xml'), serialize: doc => new window.XMLSerializer().serializeToString(doc) };
  try {
    await mkdir(output, { recursive: true });
    for (const format of ['pptx', 'odp']) {
      const result = await createTextFixture(format, xml);
      await writeFile(path.join(output, `text.${format}`), result.bytes);
      await writeFile(path.join(output, `text-${format}.json`), JSON.stringify(result.document, null, 2));
    }
    console.log(`Wrote text acceptance fixtures to ${output}`);
  } finally { window.close(); }
}
