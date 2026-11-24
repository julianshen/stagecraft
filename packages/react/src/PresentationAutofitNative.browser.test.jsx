import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createEditor } from '@stagecraft/core/editor';
import { documentPlugin, presentationPlugin, validateDocument } from '@stagecraft/core/document';
import { writePptx } from '@stagecraft/pptx';
import { openPresentation } from '@stagecraft/source';
import { EditorProvider } from './EditorProvider.jsx';
import { PresentationEditor } from './PresentationEditor.jsx';

const fontsDescriptor = Object.getOwnPropertyDescriptor(document, 'fonts');
beforeEach(() => {
  // CI must not spend the editor's 2000 ms font budget before this export-semantics test runs.
  Object.defineProperty(document, 'fonts', { configurable: true, value: {
    status: 'loaded', check: () => true, load: async () => [], ready: Promise.resolve(),
  } });
});
afterEach(() => {
  if (fontsDescriptor) Object.defineProperty(document, 'fonts', fontsDescriptor);
  else delete document.fonts;
  vi.restoreAllMocks();
  cleanup();
});

const overflowText = 'Native text that must not be remeasured while untouched. '.repeat(20);
const box = (id, autofit, y) => ({
  id,
  type: 'text',
  geometry: { x: 127000, y, width: 2540000, height: 635000, rotation: 0 },
  extensions: { stagecraftAuthored: true },
  bodyLayout: { autofit, anchor: 'top', wrap: 'square' },
  text: { paragraphs: [{ id: `${id}-p`, runs: [{
    id: `${id}-r`, text: overflowText, editable: true,
    style: { typeface: 'Arial', sz: '2400' }, extensions: { stagecraftAuthored: true },
  }] }] },
});

async function nativeFixture() {
  const seed = await writePptx({ title: 'Native autofit', sections: [{ id: 'sec', slides: ['s'] }], slides: [{ id: 's', layout: 'blank', elements: [] }] });
  const authoring = await openPresentation(seed, { format: 'pptx' });
  const snapshot = structuredClone(authoring.document);
  snapshot.slides[0].objects.push(box('native-shrink', 'shrink', 127000), box('native-resize', 'resize', 1270000));
  const bytes = (await authoring.export(snapshot)).bytes;
  authoring.dispose();
  return { source: await openPresentation(bytes, { format: 'pptx' }), bytes };
}

it('exports an untouched native PPTX byte-identically and reports both autofit kinds as unchanged-native', async () => {
  await document.fonts.ready;
  const { source, bytes } = await nativeFixture();
  const editor = createEditor({ document: source.document, validateDocument, plugins: [documentPlugin, presentationPlugin] });
  const onExport = vi.fn();
  let finish;
  const exported = new Promise(resolve => { finish = resolve; });
  onExport.mockImplementation((...args) => finish(args));
  try {
    render(<EditorProvider editor={editor}><PresentationEditor source={source} onExport={onExport} /></EditorProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Export', exact: true }));
    const [result, outcome] = await exported;
    expect(new Uint8Array(result.bytes)).toEqual(new Uint8Array(bytes));
    expect(result.dirtyParts).toEqual([]);
    expect(outcome.shrinkFit).toMatchObject({ status: 'skipped', reason: 'unchanged-native', count: 0, reasons: { 'unchanged-native': 1 } });
    expect(outcome.resizeFit).toMatchObject({ status: 'skipped', reason: 'unchanged-native', count: 0, reasons: { 'unchanged-native': 1 } });
  } finally {
    editor.dispose(); source.dispose(); cleanup();
  }
}, 30000);

it.each(['shrink', 'resize'])('emits a hint only for the edited native %s box', async kind => {
  await document.fonts.ready;
  const { source } = await nativeFixture();
  const editor = createEditor({ document: source.document, validateDocument, plugins: [documentPlugin, presentationPlugin] });
  const onExport = vi.fn();
  let finish;
  const exported = new Promise(resolve => { finish = resolve; });
  onExport.mockImplementation((...args) => finish(args));
  const exportSpy = vi.spyOn(source, 'export');
  try {
    render(<EditorProvider editor={editor}><PresentationEditor source={source} onExport={onExport} /></EditorProvider>);
    const object = editor.getSnapshot().document.slides[0].objects.find(o => o.bodyLayout.autofit === kind);
    act(() => editor.dispatch('document.setRunText', { runId: object.text.paragraphs[0].runs[0].id, text: `${overflowText} Edited` }));
    fireEvent.click(screen.getByRole('button', { name: 'Export', exact: true }));
    const [, outcome] = await exported;
    const options = exportSpy.mock.calls[0][1];
    const hintKey = kind === 'shrink' ? 'fit' : 'resize';
    const otherKey = kind === 'shrink' ? 'resize' : 'fit';
    expect(Object.keys(options)).toEqual([hintKey]);
    expect(options[hintKey].has(object.id)).toBe(true);
    expect(options[otherKey]).toBeUndefined();
    expect(outcome[`${kind}Fit`]).toMatchObject({ status: 'measured', count: 1 });
    expect(outcome[`${kind === 'shrink' ? 'resize' : 'shrink'}Fit`]).toMatchObject({ status: 'skipped', reason: 'unchanged-native', reasons: { 'unchanged-native': 1 } });
  } finally {
    editor.dispose(); source.dispose(); cleanup();
  }
}, 30000);
