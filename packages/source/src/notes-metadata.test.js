import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { writePptx } from '@stagecraft/pptx';
import { openPresentation } from './index.js';
import { NS } from './xml.js';

const parse = text => new DOMParser().parseFromString(text, 'application/xml');
const serialize = document => new XMLSerializer().serializeToString(document);
const main = 'ppt/presentation.xml';
const relPart = 'ppt/_rels/presentation.xml.rels';
const slideRels = 'ppt/slides/_rels/slide1.xml.rels';

async function withoutNotes(removeMaster, removeSlideRels) {
  const zip = await JSZip.loadAsync(await writePptx({
    title: 'Notes metadata', sections: [{ id: 'section', slides: ['slide'] }],
    slides: [{ id: 'slide', layout: 'blank', elements: [], notes: 'Original notes' }],
  }));
  zip.remove('ppt/notesSlides');
  if (removeMaster) zip.remove('ppt/notesMasters');
  for (const part of [slideRels, relPart]) {
    const doc = parse(await zip.file(part).async('string'));
    for (const relationship of Array.from(doc.documentElement.children)) {
      const type = relationship.getAttribute('Type');
      if (type === `${NS.r}/notesSlide` || removeMaster && type === `${NS.r}/notesMaster`) relationship.remove();
    }
    zip.file(part, serialize(doc));
  }
  const types = parse(await zip.file('[Content_Types].xml').async('string'));
  for (const override of Array.from(types.getElementsByTagNameNS(NS.ct, 'Override'))) {
    const part = override.getAttribute('PartName');
    if (part.startsWith('/ppt/notesSlides/') || removeMaster && part.startsWith('/ppt/notesMasters/')) override.remove();
  }
  zip.file('[Content_Types].xml', serialize(types));
  if (removeMaster) {
    const presentation = parse(await zip.file(main).async('string'));
    for (const list of Array.from(presentation.getElementsByTagNameNS(NS.p, 'notesMasterIdLst'))) list.remove();
    zip.file(main, serialize(presentation));
  }
  if (removeSlideRels) zip.remove(slideRels);
  return zip.generateAsync({ type: 'uint8array' });
}

describe.each([[false, false], [true, false], [true, true]])('PPTX notes-only creation (create master: %s, create slide rels: %s)', (removeMaster, removeSlideRels) => {
  it('serializes required package metadata and reports exactly the changed parts', async () => {
    const bytes = await withoutNotes(removeMaster, removeSlideRels);
    const session = await openPresentation(bytes, { format: 'pptx' });
    expect(session.document.slides[0].notes).toBeUndefined();
    const next = structuredClone(session.document);
    next.slides[0].notes = 'New notes\nSecond line';
    const result = await session.export(next);
    const after = await JSZip.loadAsync(result.bytes);
    const slideRelationships = parse(await after.file(slideRels).async('string'));
    expect.soft(Array.from(slideRelationships.documentElement.children).find(node => node.getAttribute('Type') === `${NS.r}/notesSlide`)?.getAttribute('Target')).toBe('../notesSlides/notesSlide1.xml');
    const types = parse(await after.file('[Content_Types].xml').async('string'));
    const overrides = Array.from(types.getElementsByTagNameNS(NS.ct, 'Override'));
    expect.soft(overrides.find(node => node.getAttribute('PartName') === '/ppt/notesSlides/notesSlide1.xml')?.getAttribute('ContentType'))
      .toBe('application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml');
    expect.soft(overrides.find(node => node.getAttribute('PartName') === '/ppt/notesMasters/notesMaster1.xml')?.getAttribute('ContentType'))
      .toBe('application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml');
    const relationships = parse(await after.file(relPart).async('string'));
    const master = Array.from(relationships.documentElement.children).find(node => node.getAttribute('Type') === `${NS.r}/notesMaster`);
    expect.soft(master?.getAttribute('Target')).toBe('notesMasters/notesMaster1.xml');
    const presentation = parse(await after.file(main).async('string'));
    expect.soft(presentation.getElementsByTagNameNS(NS.p, 'notesMasterId')[0]?.getAttributeNS(NS.r, 'id')).toBe(master?.getAttribute('Id'));
    expect.soft(result.dirtyParts).toEqual([
      '[Content_Types].xml', slideRels,
      'ppt/notesSlides/notesSlide1.xml', 'ppt/notesSlides/_rels/notesSlide1.xml.rels',
      ...(removeMaster ? [main, relPart, 'ppt/notesMasters/notesMaster1.xml', 'ppt/notesMasters/_rels/notesMaster1.xml.rels'] : []),
    ].sort());
    const reopened = await openPresentation(result.bytes, { format: 'pptx' });
    expect(reopened.document.slides[0].notes).toBe('New notes\nSecond line');
    const before = await JSZip.loadAsync(bytes);
    for (const [name, entry] of Object.entries(before.files)) {
      if (!entry.dir && !result.dirtyParts.includes(name)) {
        expect(await after.file(name).async('uint8array'), name).toEqual(await entry.async('uint8array'));
      }
    }
  });
});

describe.each(['placeholder', 'text body'])('PPTX notes missing %s', missing => {
  it('initializes a DrawingML text body in schema order when adding notes', async () => {
    const zip = await JSZip.loadAsync(await writePptx({
      title: 'Notes body', sections: [{ id: 'section', slides: ['slide'] }],
      slides: [{ id: 'slide', layout: 'blank', elements: [], notes: 'Old notes' }],
    }));
    const notesPart = 'ppt/notesSlides/notesSlide1.xml';
    const notes = parse(await zip.file(notesPart).async('string'));
    const findBody = doc => Array.from(doc.getElementsByTagNameNS(NS.p, 'sp')).find(shape =>
      Array.from(shape.getElementsByTagNameNS(NS.p, 'ph')).some(placeholder => placeholder.getAttribute('type') === 'body'));
    const body = findBody(notes);
    expect(body).toBeTruthy();
    if (missing === 'placeholder') body.remove();
    else body.getElementsByTagNameNS(NS.p, 'txBody')[0].remove();
    const otherShapes = Array.from(notes.getElementsByTagNameNS(NS.p, 'sp')).filter(shape => shape !== body).map(serialize);
    zip.file(notesPart, serialize(notes));
    const session = await openPresentation(await zip.generateAsync({ type: 'uint8array' }), { format: 'pptx' });
    const next = structuredClone(session.document);
    next.slides[0].notes = 'New first line\nNew second line';
    const result = await session.export(next);
    const output = await JSZip.loadAsync(result.bytes);
    const patched = parse(await output.file(notesPart).async('string'));
    const patchedBody = findBody(patched);
    expect(patchedBody).toBeTruthy();
    const textBody = patchedBody.getElementsByTagNameNS(NS.p, 'txBody')[0];
    expect(Array.from(textBody.children).map(node => [node.namespaceURI, node.localName])).toEqual([
      [NS.a, 'bodyPr'], [NS.a, 'lstStyle'], [NS.a, 'p'], [NS.a, 'p'],
    ]);
    expect(Array.from(patched.getElementsByTagNameNS(NS.p, 'sp')).filter(shape => shape !== patchedBody).map(serialize)).toEqual(otherShapes);
    expect((await openPresentation(result.bytes, { format: 'pptx' })).document.slides[0].notes).toBe('New first line\nNew second line');
    expect(result.dirtyParts).toEqual([notesPart]);
  });
});

describe.each([false, true])('notes relationship target resolution (create master: %s)', createMaster => {
  it.each(['absolute', 'encoded-root', 'encoded-relative', 'encoded-space'])('reuses %s targets with the reader path semantics', async variant => {
    const zip = await JSZip.loadAsync(await withoutNotes(createMaster, false));
    if (variant === 'encoded-space') {
      const directory = createMaster ? 'theme' : 'notesMasters';
      const oldName = createMaster ? 'theme1.xml' : 'notesMaster1.xml';
      const newName = createMaster ? 'theme one.xml' : 'notes Master1.xml';
      const oldPart = `ppt/${directory}/${oldName}`, newPart = `ppt/${directory}/${newName}`;
      zip.file(newPart, await zip.file(oldPart).async('uint8array'));
      zip.remove(oldPart);
      const oldOwnerRels = `ppt/${directory}/_rels/${oldName}.rels`;
      if (zip.file(oldOwnerRels)) {
        zip.file(`ppt/${directory}/_rels/${newName}.rels`, await zip.file(oldOwnerRels).async('uint8array'));
        zip.remove(oldOwnerRels);
      }
      for (const name of Object.keys(zip.files).filter(name => name.endsWith('.rels'))) {
        const rels = parse(await zip.file(name).async('string'));
        for (const relation of Array.from(rels.documentElement.children)) {
          const target = relation.getAttribute('Target');
          if (target?.endsWith(oldName)) relation.setAttribute('Target', target.slice(0, -oldName.length) + encodeURIComponent(newName));
        }
        zip.file(name, serialize(rels));
      }
      const types = parse(await zip.file('[Content_Types].xml').async('string'));
      for (const override of Array.from(types.getElementsByTagNameNS(NS.ct, 'Override'))) {
        if (override.getAttribute('PartName') === '/' + oldPart) override.setAttribute('PartName', '/' + newPart);
      }
      zip.file('[Content_Types].xml', serialize(types));
    }
    const relationships = parse(await zip.file(relPart).async('string'));
    const type = `${NS.r}/${createMaster ? 'theme' : 'notesMaster'}`;
    const relation = Array.from(relationships.documentElement.children).find(node => node.getAttribute('Type') === type);
    const relativeTarget = relation.getAttribute('Target');
    const encodedTarget = relativeTarget.replace(/notesMasters|theme/, name => `%${name.charCodeAt(0).toString(16)}${name.slice(1)}`);
    relation.setAttribute('Target', variant === 'absolute' ? `/ppt/${relativeTarget}`
      : variant === 'encoded-root' ? `%2Fppt%2F${encodedTarget}` : encodedTarget);
    zip.file(relPart, serialize(relationships));
    const session = await openPresentation(await zip.generateAsync({ type: 'uint8array' }), { format: 'pptx' });
    const next = structuredClone(session.document);
    next.slides[0].notes = 'Notes with a resolved relationship';
    const result = await session.export(next);
    const reopened = await openPresentation(result.bytes, { format: 'pptx' });
    expect(reopened.document.slides[0].notes).toBe(next.slides[0].notes);
    const resultZip = await JSZip.loadAsync(result.bytes);
    const generatedRelsPath = createMaster ? 'ppt/notesMasters/_rels/notesMaster1.xml.rels' : 'ppt/notesSlides/_rels/notesSlide1.xml.rels';
    const generatedRels = parse(await resultZip.file(generatedRelsPath).async('string'));
    const generatedRelation = Array.from(generatedRels.documentElement.children).find(node => node.getAttribute('Type') === type);
    expect(generatedRelation.getAttribute('Target')).toBe(`../${relativeTarget}`);
  });
});
