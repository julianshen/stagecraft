import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import { openPresentation } from './index.js';
import { NS } from './xml.js';
import { createEditor } from '@stagecraft/core/editor';
import { documentPlugin, validateDocument } from '@stagecraft/core/document';
const fixture = () => readFile('packages/source/test-fixtures/powerpoint-16.115-font-slots.odp').then(bytes => new Uint8Array(bytes));
const parse = text => new DOMParser().parseFromString(text, 'application/xml');
const serialize = d => new XMLSerializer().serializeToString(d);
const presentation = d => d.getElementsByTagNameNS(NS.office, 'presentation')[0];
const shape = n => ({ ns: n.namespaceURI, name: n.localName, attrs: [...n.attributes].filter(a => a.namespaceURI !== 'http://www.w3.org/2000/xmlns/').map(a => [a.namespaceURI, a.localName, a.value]).sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b))), children: [...n.childNodes].map(c => c.nodeType === 1 ? shape(c) : [c.nodeType,c.nodeValue]) });
const retained = d => [...presentation(d).children].filter(n => n.namespaceURI !== NS.draw || n.localName !== 'page').map(shape);
async function mutate(change) {
  const zip = await JSZip.loadAsync(await fixture()), doc = parse(await zip.file('content.xml').async('string'));
  change(doc, presentation(doc)); zip.file('content.xml', serialize(doc)); return zip.generateAsync({ type: 'uint8array' });
}
async function roundTrip(bytes) {
  const source = await openPresentation(bytes, { format: 'odp' });
  const editor = createEditor({ document: source.document, validateDocument, plugins: [documentPlugin] });
  try {
    expect(source.document.slides).toHaveLength(6);
    expect((await source.export(editor.getSnapshot().document)).bytes).toEqual(new Uint8Array(bytes));
    const run = source.document.slides.flatMap(s => s.objects.flatMap(o => o.text?.paragraphs.flatMap(p => p.runs) ?? [])).find(r => r.editable && r.text === 'Control');
    expect(run).toBeDefined();
    editor.dispatch('document.setRunText', { runId: run.id, text: 'Changed' });
    const out = await source.export(editor.getSnapshot().document);
    expect(out.dirtyParts).toEqual(['content.xml']);
    const before = await JSZip.loadAsync(bytes), after = await JSZip.loadAsync(out.bytes);
    expect(retained(parse(await after.file('content.xml').async('string')))).toEqual(retained(parse(await before.file('content.xml').async('string'))));
    for (const name of Object.keys(before.files).filter(n => !before.files[n].dir && n !== 'content.xml'))
      expect(await after.file(name).async('uint8array'), name).toEqual(await before.file(name).async('uint8array'));
    const reopened = await openPresentation(out.bytes, { format: 'odp' });
    expect(reopened.document.slides.flatMap(s => s.objects.flatMap(o => o.text?.paragraphs.flatMap(p => p.runs) ?? [])).some(r => r.text === 'Changed')).toBe(true); reopened.dispose();
    editor.undo(); expect((await source.export(editor.getSnapshot().document)).bytes).toEqual(new Uint8Array(bytes));
  } finally { editor.dispose(); source.dispose(); }
}
it('opens and edits the real PowerPoint 16.115-saved ODP while retaining its settings', async () => {
  const bytes = await fixture();
  expect(createHash('sha256').update(bytes).digest('hex')).toBe('8387fd09e7e33efe21c25b3f38f776e885235b9d31b585327b61e2d04e5f212a');
  const metadata = parse(await (await JSZip.loadAsync(bytes)).file('meta.xml').async('string'));
  const authors = [...metadata.getElementsByTagName('*')].filter(n => ['creator', 'initial-creator', 'printed-by', 'lastModifiedBy'].includes(n.localName));
  expect(authors.length).toBeGreaterThan(0);
  for (const author of authors) expect(author.textContent).toBe('Stagecraft Test');
  await roundTrip(bytes);
}, 30000);
it('retains settings/custom shows and unused field declarations before, between and after pages', async () => {
  await roundTrip(await mutate((doc, body) => {
    const settings = body.getElementsByTagNameNS(NS.presentation, 'settings')[0];
    settings.setAttributeNS(NS.presentation, 'presentation:endless', 'true');
    const show = doc.createElementNS(NS.presentation, 'pres:show'); show.setAttributeNS(NS.presentation, 'pres:name', 'Custom'); show.setAttributeNS(NS.presentation, 'pres:pages', body.children[0].getAttributeNS(NS.draw, 'name'));settings.appendChild(show);
    for (const [i,name] of ['header-decl','footer-decl','date-time-decl'].entries()) {
      const n = doc.createElementNS(NS.presentation, 'pres:'+name);n.setAttributeNS(NS.presentation, 'pres:name', 'unused'+i); n.textContent = 'Retained declaration';
      body.insertBefore(n, i === 2 ? settings : body.children[i]);
    }
  }));
}, 30000);
it.each(['header','footer','date-time'])('rejects referenced %s declarations instead of hiding unresolved visible fields', async kind => {
  const bytes = await mutate((doc, body) => {
    const decl = doc.createElementNS(NS.presentation, 'presentation:'+kind+'-decl'); decl.setAttributeNS(NS.presentation, 'presentation:name', 'Used');decl.textContent='Visible field';body.appendChild(decl);
    body.children[0].setAttributeNS(NS.presentation, `presentation:use-${kind}-name`, 'Used');
  });
  await expect(openPresentation(bytes, { format: 'odp' })).rejects.toThrow(/Referenced ODP presentation declaration.*not supported/);
});
it.each([
  ['presentation','show'], ['table','named-expressions'], ['text','variable-decls'], ['draw','frame'], ['text','p'], ['draw','settings'],
])('rejects unsupported direct child %s:%s with an identifying message', async (ns, name) => {
  const bytes = await mutate((doc, body) => body.appendChild(doc.createElementNS(NS[ns], `${ns}:${name}`)));
  await expect(openPresentation(bytes, { format: 'odp' })).rejects.toThrow(`Unsupported ODP presentation child {${NS[ns]}}${name}`);
});
it.each(['settings', 'header-decl', 'show'])('does not swallow slide content hidden under allowed %s', async kind => {
  const bytes = await mutate((doc, body) => {
    let parent = body.getElementsByTagNameNS(NS.presentation, 'settings')[0];
    if (kind !== 'settings') {const n = doc.createElementNS(NS.presentation, 'presentation:'+kind);(kind === 'show' ? parent : body).appendChild(n);parent=n;}
    parent.appendChild(doc.createElementNS(NS.draw, 'draw:page'));
  });
  await expect(openPresentation(bytes, { format: 'odp' })).rejects.toThrow(/Unsupported ODP presentation metadata content/);
});
it('rejects a declaration referenced from styles.xml (master/handout context)', async () => {
  const bytes = await mutate((doc, body) => {
    const decl = doc.createElementNS(NS.presentation, 'presentation:footer-decl'); decl.setAttributeNS(NS.presentation, 'presentation:name', 'MasterFooter'); decl.textContent = 'Visible footer'; body.appendChild(decl);
  });
  const zip = await JSZip.loadAsync(bytes), styles = parse(await zip.file('styles.xml').async('string'));
  styles.getElementsByTagNameNS(NS.style, 'master-page')[0].setAttributeNS(NS.presentation, 'presentation:use-footer-name', 'MasterFooter');
  zip.file('styles.xml', serialize(styles));
  await expect(openPresentation(await zip.generateAsync({ type: 'uint8array' }), { format: 'odp' })).rejects.toThrow(/Referenced ODP presentation declaration footer-decl/);
});
it.each(['settings', 'show'])('rejects non-whitespace character data in %s', async kind => {
  const bytes = await mutate((doc, body) => {
    let parent = body.getElementsByTagNameNS(NS.presentation, 'settings')[0];
    if (kind === 'show') { const show = doc.createElementNS(NS.presentation, 'presentation:show');parent.appendChild(show);parent=show; }
    parent.appendChild(doc.createCDATASection('unrepresented text'));
  });
  await expect(openPresentation(bytes, { format: 'odp' })).rejects.toThrow(/Unsupported ODP presentation metadata content/);
});
it('retains whitespace/comments but rejects a wrong-namespace settings child', async () => {
  await roundTrip(await mutate((doc, body) => {
    const settings=body.getElementsByTagNameNS(NS.presentation,'settings')[0]; settings.appendChild(doc.createTextNode('\n '));settings.appendChild(doc.createComment('retained'));
  }));
  const bytes=await mutate((doc,body)=>body.getElementsByTagNameNS(NS.presentation,'settings')[0].appendChild(doc.createElementNS(NS.draw,'draw:show')));
  await expect(openPresentation(bytes, { format: 'odp' })).rejects.toThrow(/Unsupported ODP presentation metadata content/);
}, 30000);
