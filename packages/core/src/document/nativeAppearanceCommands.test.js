import { describe, expect, it } from 'vitest';
import { createEditor } from '@stagecraft/core/editor';
import { createDocument, documentPlugin, presentationPlugin, validateAuthoredObject, validateDocument } from '@stagecraft/core/document';
import { nativeObjectAppearanceInput, nativeSlideAppearanceInput, isNativeObjectAppearanceValid } from '@stagecraft/core/lib/nativeAppearance.js';

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
    text: { paragraphs: [{ id: 'p1', source, style: {}, extensions: { pptxEndRunAppearance: { ...resolved } }, runs: [{
      id: 'r1', text: 'Native', editable: true, source, style: { sz: '1800', typeface: 'Arial' },
      extensions: { pptxAppearance: { resolved: { ...resolved } } },
    }] }] },
  };
}

function proveObject(object) {
  object.extensions.stagecraftNativeAppearance = {
    version: 1, sourceFormat: 'pptx', appearanceResolved: true,
    input: nativeObjectAppearanceInput(object), fill: { kind: 'none' }, stroke: { kind: 'none' },
    text: { paragraphs: [{ id: 'p1', runIds: ['r1'], alignment: 'left', spaceBeforePt: 0, spaceAfterPt: 0, lineSpacingPct: 100, indentStartEmu: 0, indentEndEmu: 0, firstLineIndentEmu: 0, endRun: { ...resolved } }] },
  };
}

function makeEditor(object = textObject(), slide = {}, documentOverrides = {}, editorOptions = {}) {
  proveObject(object);
  const document = createDocument({
    ...documentOverrides,
    slides: [{
      id: 's1', source, objects: [object], ...slide,
      extensions: {
        ...slide.extensions,
        stagecraftSlideAppearance: {
          version: 1, appearanceResolved: true, input: '', background: { kind: 'solid', color: '#FFFFFF' }, inheritedArtworkCount: 0,
        },
      },
    }],
  });
  document.slides[0].extensions.stagecraftSlideAppearance.input = nativeSlideAppearanceInput(document.slides[0], document);
  return createEditor({ document, validateDocument, plugins: [documentPlugin, presentationPlugin], ...editorOptions });
}

const proof = editor => editor.getSnapshot().document.slides[0].objects[0].extensions.stagecraftNativeAppearance;
const objectProofValid = editor => isNativeObjectAppearanceValid(editor.getSnapshot().document.slides[0].objects[0]);
const geometry = (overrides = {}) => ({ x: 100, y: 200, width: 300, height: 400, rotation: 0, ...overrides });
const completeFit = { fontScale: 85000, lnSpcReduction: 10000 };

function makeAutofitEditor(autofit, editorOptions = {}) {
  const object = textObject();
  object.bodyLayout = autofit === 'shrink' ? { autofit, fit: { ...completeFit } } : { autofit };
  return makeEditor(object, {}, {}, editorOptions);
}

describe('authored native autofit rejection', () => {
  it('accepts fit-free authored shrink layout but rejects source-owned fit', () => {
    const object = {
      id: 'authored-text', type: 'text',
      geometry: { x: 100, y: 200, width: 300, height: 400 },
      extensions: { stagecraftAuthored: true },
      text: { paragraphs: [{ id: 'p1', runs: [{
        id: 'r1', text: 'Authored', editable: true, style: {}, extensions: { stagecraftAuthored: true },
      }] }] },
      bodyLayout: { autofit: 'shrink' },
    };
    expect(validateAuthoredObject(object)).toBe(true);
    expect(() => validateAuthoredObject({ ...object, bodyLayout: { autofit: 'shrink', fit: {} } }))
      .toThrowError(expect.objectContaining({ code: 'INVALID_AUTHORED_SCHEMA' }));
  });
});

describe('native appearance command invalidation', () => {
  it('keeps the non-autofit proof through geometry moves and same-id text edits', () => {
    const editor = makeEditor();
    expect(editor.dispatch('presentation.setGeometry', {
      slideId: 's1', objectId: 'o1', geometry: { x: 500, y: 600, width: 300, height: 400, rotation: 0 },
    }).changed).toBe(true);
    expect(proof(editor)).toBeTruthy();
    expect(editor.dispatch('document.setRunText', { runId: 'r1', text: 'Edited native text' }).changed).toBe(true);
    expect(proof(editor)).toBeTruthy();
  });

  it('does not invalidate proofs or create history for no-op formatting', () => {
    const runObject = textObject();
    runObject.text.paragraphs[0].runs[0].style.b = '1';
    runObject.text.paragraphs[0].style = { alignment: 'center' };
    runObject.bodyLayout = { insets: { left: 91440 } };
    const editor = makeEditor(runObject, { background: { type: 'solid', color: '#FFFFFF' } });
    const revision = editor.getSnapshot().revision;
    for (const [command, payload] of [
      ['document.setRunFormat', { runId: 'r1', format: { bold: true } }],
      ['document.setParagraphFormat', { paragraphId: 'p1', format: { alignment: 'center' } }],
      ['document.setTextBodyLayout', { objectId: 'o1', layout: { insets: { left: 91440 } } }],
      ['presentation.setSlideProperties', { slideId: 's1', properties: { background: { type: 'solid', color: '#ffffff' } } }],
    ]) {
      expect(editor.dispatch(command, payload).changed).toBe(false);
      expect(editor.getSnapshot().revision).toBe(revision);
      expect(editor.getSnapshot().canUndo).toBe(false);
      expect(proof(editor)).toBeTruthy();
      expect(editor.getSnapshot().document.slides[0].extensions.stagecraftSlideAppearance).toBeTruthy();
    }
  });

  it('does not create history for a no-op native paint command', () => {
    const object = { id: 'o1', type: 'shape', shape: 'rect', fill: '#112233', source, geometry: { x: 0, y: 0, width: 100, height: 100 }, extensions: { editableFill: true } };
    proveObject(object);
    delete object.text;
    object.extensions.stagecraftNativeAppearance.text = undefined;
    object.extensions.stagecraftNativeAppearance.input = nativeObjectAppearanceInput(object);
    const editor = makeEditor(object);
    expect(editor.dispatch('presentation.setPaint', { slideId: 's1', objectId: 'o1', fill: '#112233' }).changed).toBe(false);
    expect(editor.getSnapshot().revision).toBe(0);
    expect(editor.getSnapshot().canUndo).toBe(false);
    expect(proof(editor)).toBeTruthy();
  });

  it('preserves absent paragraph style when clearing unset formatting', () => {
    const object = textObject();
    delete object.text.paragraphs[0].style;
    const editor = makeEditor(object);
    expect(editor.dispatch('document.setParagraphFormat', { paragraphId: 'p1', format: { alignment: null } }).changed).toBe(false);
    expect(editor.getSnapshot().document.slides[0].objects[0].text.paragraphs[0].style).toBeUndefined();
    expect(editor.getSnapshot().canUndo).toBe(false);
    expect(proof(editor)).toBeTruthy();
  });

  it('allows ODP no-op formatting when paragraph style is absent', () => {
    const object = textObject();
    object.extensions.stagecraftAuthored = true;
    object.source = { format: 'odp', part: 'content.xml', path: [] };
    delete object.text.paragraphs[0].style;
    const editor = makeEditor(object, {}, { extensions: { sourceFormat: 'odp' } });
    expect(editor.dispatch('document.setParagraphFormat', { paragraphId: 'p1', format: { alignment: null } }).changed).toBe(false);
    expect(editor.getSnapshot().document.slides[0].objects[0].text.paragraphs[0].style).toBeUndefined();
    expect(editor.getSnapshot().canUndo).toBe(false);
  });

  it('clears retained legacy backgrounds even when canonical background is absent', () => {
    const editor = makeEditor(textObject(), { extensions: { legacy: { bgColor: 'url(secret)' } } });
    expect(editor.dispatch('presentation.setSlideProperties', { slideId: 's1', properties: { background: null } }).changed).toBe(true);
    expect(editor.getSnapshot().document.slides[0].extensions.legacy.bgColor).toBeUndefined();
    expect(editor.getSnapshot().document.slides[0].extensions.stagecraftSlideAppearance).toBeUndefined();
  });

  it('invalidates the proof when a text edit changes the resolved script', () => {
    const object = textObject();
    object.text.paragraphs[0].runs[0].extensions.pptxAppearance.script = 'Latn';
    const editor = makeEditor(object);
    expect(editor.dispatch('document.setRunText', { runId: 'r1', text: 'مرحبا' }).changed).toBe(true);
    expect(proof(editor)).toBeUndefined();

    const mixed = textObject();
    mixed.text.paragraphs[0].runs[0].text = 'مرحبا Native';
    mixed.text.paragraphs[0].runs[0].extensions.pptxAppearance.script = 'Arab';
    const mixedEditor = makeEditor(mixed);
    expect(mixedEditor.dispatch('document.setRunText', { runId: 'r1', text: 'مرحبا नमस्ते' }).changed).toBe(true);
    expect(proof(mixedEditor)).toBeUndefined();

    const cyrillic = textObject();
    cyrillic.text.paragraphs[0].runs[0].extensions.pptxAppearance.script = 'Latn';
    const cyrillicEditor = makeEditor(cyrillic);
    expect(cyrillicEditor.dispatch('document.setRunText', { runId: 'r1', text: 'Привет' }).changed).toBe(true);
    expect(proof(cyrillicEditor)).toBeUndefined();
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

describe('native autofit command invalidation', () => {
  it.each(['shrink', 'resize'])('starts with a valid %s proof', autofit => {
    expect(objectProofValid(makeAutofitEditor(autofit))).toBe(true);
  });

  it.each(['shrink', 'resize'])('invalidates the %s proof on same-script text changes', autofit => {
    const editor = makeAutofitEditor(autofit);
    expect(editor.dispatch('document.setRunText', { runId: 'r1', text: 'Edited native text' }).changed).toBe(true);
    expect(proof(editor)).toBeUndefined();
  });

  it.each(['shrink', 'resize'])('preserves the %s proof, revision and history for no-op text', autofit => {
    const editor = makeAutofitEditor(autofit);
    editor.dispatch('presentation.setGeometry', { slideId: 's1', objectId: 'o1', geometry: geometry({ x: 500 }) });
    const before = editor.getSnapshot();
    expect(editor.dispatch('document.setRunText', { runId: 'r1', text: 'Native' }).changed).toBe(false);
    expect(editor.getSnapshot()).toBe(before);
    expect(objectProofValid(editor)).toBe(true);
    editor.undo();
    expect(editor.getSnapshot().document.slides[0].objects[0].geometry.x).toBe(100);
    expect(objectProofValid(editor)).toBe(true);
  });

  it.each(['shrink', 'resize'].flatMap(autofit => ['width', 'height'].map(dimension => [autofit, dimension])))(
    'invalidates the %s proof on %s-only changes', (autofit, dimension) => {
      const editor = makeAutofitEditor(autofit);
      const value = dimension === 'width' ? 350 : 450;
      expect(editor.dispatch('presentation.setGeometry', {
        slideId: 's1', objectId: 'o1', geometry: geometry({ [dimension]: value }),
      }).changed).toBe(true);
      expect(proof(editor)).toBeUndefined();
    }
  );

  it.each(['shrink', 'resize'].flatMap(autofit => ['x', 'y', 'rotation'].map(field => [autofit, field])))(
    'preserves the valid %s proof for %s-only changes', (autofit, field) => {
      const editor = makeAutofitEditor(autofit);
      const value = field === 'rotation' ? 15 : field === 'x' ? 500 : 600;
      expect(editor.dispatch('presentation.setGeometry', {
        slideId: 's1', objectId: 'o1', geometry: geometry({ [field]: value }),
      }).changed).toBe(true);
      expect(objectProofValid(editor)).toBe(true);
    }
  );

  it.each(['shrink', 'resize'])('preserves the %s proof, revision and undo state for no-op geometry', autofit => {
    const editor = makeAutofitEditor(autofit);
    editor.dispatch('presentation.setGeometry', { slideId: 's1', objectId: 'o1', geometry: geometry({ x: 500 }) });
    const before = editor.getSnapshot();
    expect(editor.dispatch('presentation.setGeometry', {
      slideId: 's1', objectId: 'o1', geometry: geometry({ x: 500 }),
    }).changed).toBe(false);
    expect(editor.getSnapshot()).toBe(before);
    expect(objectProofValid(editor)).toBe(true);
    editor.undo();
    expect(editor.getSnapshot().document.slides[0].objects[0].geometry.x).toBe(100);
    expect(objectProofValid(editor)).toBe(true);
  });

  it.each([undefined, 'none'].flatMap(autofit => ['width', 'height'].map(dimension => [autofit, dimension])))(
    'preserves the valid non-autofit (%s) proof for %s-only changes', (autofit, dimension) => {
      const object = textObject();
      if (autofit !== undefined) object.bodyLayout = { autofit };
      const editor = makeEditor(object);
      const value = dimension === 'width' ? 350 : 450;
      expect(editor.dispatch('presentation.setGeometry', {
        slideId: 's1', objectId: 'o1', geometry: geometry({ [dimension]: value }),
      }).changed).toBe(true);
      expect(objectProofValid(editor)).toBe(true);
    }
  );

  it.each(['shrink', 'resize'])('keeps font, paragraph and body-layout invalidation for %s proofs', autofit => {
    for (const [command, payload] of [
      ['document.setRunFormat', { runId: 'r1', format: { color: '#445566' } }],
      ['document.setParagraphFormat', { paragraphId: 'p1', format: { alignment: 'center' } }],
      ['document.setTextBodyLayout', { objectId: 'o1', layout: { insets: { left: 0 } } }],
    ]) {
      const editor = makeAutofitEditor(autofit);
      expect(editor.dispatch(command, payload).changed).toBe(true);
      expect(proof(editor)).toBeUndefined();
    }
  });

  it.each(['shrink', 'resize'].flatMap(autofit => ['text', 'size'].map(edit => [autofit, edit])))(
    'restores %s proof presence through undo and redo of %s edits', (autofit, edit) => {
      const editor = makeAutofitEditor(autofit);
      const before = editor.getSnapshot().document.slides[0].objects[0];
      if (edit === 'text') editor.dispatch('document.setRunText', { runId: 'r1', text: 'Edited native text' });
      else editor.dispatch('presentation.setGeometry', { slideId: 's1', objectId: 'o1', geometry: geometry({ width: 350 }) });
      expect(proof(editor)).toBeUndefined();
      editor.undo();
      expect(objectProofValid(editor)).toBe(true);
      expect(editor.getSnapshot().document.slides[0].objects[0]).toEqual(before);
      editor.redo();
      expect(proof(editor)).toBeUndefined();
    }
  );

  it.each(['shrink', 'resize'].flatMap(autofit => [
    ['text', 'document.setRunText', { runId: 'r1', text: 'Edited native text' }],
    ['size', 'presentation.setGeometry', { slideId: 's1', objectId: 'o1', geometry: geometry({ width: 350 }) }],
  ].map(([edit, command, payload]) => [autofit, edit, command, payload])))(
    'applies %s %s invalidation through remote/headless dispatch', (autofit, edit, command, payload) => {
      const origins = [];
      const editor = makeAutofitEditor(autofit, {
        authorize: ({ meta }) => { origins.push(meta.origin); return meta.origin === 'remote'; },
      });
      expect(editor.dispatch(command, payload, { origin: 'remote' }).changed).toBe(true);
      expect(origins).toEqual(['remote']);
      expect(proof(editor)).toBeUndefined();
    }
  );

  it.each(['shrink', 'resize'])('leaves no stale %s proof after a multi-command transaction', autofit => {
    const editor = makeAutofitEditor(autofit);
    const before = editor.getSnapshot().document.slides[0].objects[0];
    const result = editor.transact([
      { type: 'document.setRunText', payload: { runId: 'r1', text: 'Edited native text' } },
      { type: 'document.setRunText', payload: { runId: 'r1', text: 'Native' } },
      { type: 'presentation.setGeometry', payload: { slideId: 's1', objectId: 'o1', geometry: geometry({ width: 350 }) } },
      { type: 'presentation.setGeometry', payload: { slideId: 's1', objectId: 'o1', geometry: geometry() } },
    ], { origin: 'remote' });
    expect(result.changed).toBe(true);
    expect(result.revision).toBe(1);
    expect(proof(editor)).toBeUndefined();
    const object = editor.getSnapshot().document.slides[0].objects[0];
    expect(object.text).toEqual(before.text);
    expect(object.geometry).toEqual(before.geometry);
    editor.undo();
    expect(objectProofValid(editor)).toBe(true);
    editor.redo();
    expect(proof(editor)).toBeUndefined();
  });
});
