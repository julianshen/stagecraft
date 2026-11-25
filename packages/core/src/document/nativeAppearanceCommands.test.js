import { describe, expect, it } from 'vitest';
import { createEditor } from '@stagecraft/core/editor';
import { createDocument, documentPlugin, presentationPlugin, validateDocument } from '@stagecraft/core/document';
import { nativeObjectAppearanceInput, nativeSlideAppearanceInput } from '@stagecraft/core/lib/nativeAppearance.js';

const source = { format: 'pptx', part: 'ppt/slides/slide1.xml', path: [] };
const resolved = {
  color: '#112233', fontFamily: 'Arial', fontFamilyEastAsia: 'Arial', fontFamilyComplexScript: 'Arial',
  fontSizePt: 18, bold: false, italic: false,
};

function textObject() {
  return {
    id: 'o1', type: 'text', source,
    geometry: { x: 100, y: 200, width: 300, height: 400, rotation: 0 },
    extensions: { editableGeometry: true },
    text: { paragraphs: [{ id: 'p1', source, style: {}, runs: [{
      id: 'r1', text: 'Native', editable: true, source, style: { sz: '1800', typeface: 'Arial' },
      extensions: { pptxAppearance: { resolved: { ...resolved } } },
    }] }] },
  };
}

function proveObject(object) {
  object.extensions.stagecraftNativeAppearance = {
    version: 1, sourceFormat: 'pptx', appearanceResolved: true,
    input: nativeObjectAppearanceInput(object), fill: { kind: 'none' }, stroke: { kind: 'none' },
    text: { paragraphs: [{ id: 'p1', runIds: ['r1'], alignment: 'left', endRun: { ...resolved } }] },
  };
}

function makeEditor(object = textObject()) {
  proveObject(object);
  const document = createDocument({
    slides: [{
      id: 's1', source, objects: [object],
      extensions: {
        stagecraftSlideAppearance: {
          version: 1, appearanceResolved: true, input: '', background: { kind: 'solid', color: '#FFFFFF' }, inheritedArtworkCount: 0,
        },
      },
    }],
  });
  document.slides[0].extensions.stagecraftSlideAppearance.input = nativeSlideAppearanceInput(document.slides[0]);
  return createEditor({ document, validateDocument, plugins: [documentPlugin, presentationPlugin] });
}

const proof = editor => editor.getSnapshot().document.slides[0].objects[0].extensions.stagecraftNativeAppearance;

describe('native appearance command invalidation', () => {
  it('keeps the proof through geometry moves and same-id text edits', () => {
    const editor = makeEditor();
    expect(editor.dispatch('presentation.setGeometry', {
      slideId: 's1', objectId: 'o1', geometry: { x: 500, y: 600, width: 300, height: 400, rotation: 0 },
    }).changed).toBe(true);
    expect(proof(editor)).toBeTruthy();
    expect(editor.dispatch('document.setRunText', { runId: 'r1', text: 'Edited native text' }).changed).toBe(true);
    expect(proof(editor)).toBeTruthy();
  });

  it.each([
    ['document.setRunFormat', { runId: 'r1', format: { color: '#445566' } }],
    ['document.setParagraphFormat', { paragraphId: 'p1', format: { alignment: 'center' } }],
    ['document.setTextBodyLayout', { objectId: 'o1', layout: { insets: { left: 0 } } }],
  ])('invalidates the object proof for %s', (command, payload) => {
    const editor = makeEditor();
    expect(editor.dispatch(command, payload).changed).toBe(true);
    expect(proof(editor)).toBeUndefined();
  });

  it('invalidates native fill and slide-background proofs only for appearance edits', () => {
    const shape = {
      id: 'shape', type: 'shape', shape: 'rect', source, fill: '#112233',
      geometry: { x: 0, y: 0, width: 100, height: 100, rotation: 0 },
      extensions: { editableGeometry: true, editableFill: true },
    };
    proveObject(shape);
    delete shape.extensions.stagecraftNativeAppearance.text;
    shape.extensions.stagecraftNativeAppearance.input = nativeObjectAppearanceInput(shape);
    const editor = makeEditor(shape);
    expect(editor.dispatch('presentation.setPaint', { slideId: 's1', objectId: 'shape', fill: '#445566' }).changed).toBe(true);
    expect(proof(editor)).toBeUndefined();

    const slideEditor = makeEditor();
    expect(slideEditor.dispatch('presentation.setSlideProperties', { slideId: 's1', properties: { name: 'Renamed' } }).changed).toBe(true);
    expect(slideEditor.getSnapshot().document.slides[0].extensions.stagecraftSlideAppearance).toBeTruthy();
    expect(slideEditor.dispatch('presentation.setSlideProperties', {
      slideId: 's1', properties: { background: { type: 'solid', color: '#000000' } },
    }).changed).toBe(true);
    expect(slideEditor.getSnapshot().document.slides[0].extensions.stagecraftSlideAppearance).toBeUndefined();
  });

  it('restores proof state through undo and redo', () => {
    const editor = makeEditor();
    editor.dispatch('document.setRunFormat', { runId: 'r1', format: { color: '#445566' } });
    expect(proof(editor)).toBeUndefined();
    editor.undo();
    expect(proof(editor)).toBeTruthy();
    editor.redo();
    expect(proof(editor)).toBeUndefined();
  });
});
