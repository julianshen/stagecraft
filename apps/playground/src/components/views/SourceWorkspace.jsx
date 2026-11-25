import { useEffect, useRef, useState } from 'react';
import { createEditor } from '@stagecraft/core/editor';
import { documentPlugin, presentationPlugin, validateDocument } from '@stagecraft/core/document';
import { EditorProvider } from '@stagecraft/react/editor';
import { PresentationEditor } from '@stagecraft/react/presentation';
import { createPresentation, openPresentation } from '@stagecraft/source';
import './SourceWorkspace.css';

export function downloadSource(result, { fileName, format }) {
  const mime = format === 'pptx'
    ? 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    : 'application/vnd.oasis.opendocument.presentation';
  const url = URL.createObjectURL(new Blob([result.bytes], { type: mime }));
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName.replace(/[\\/:\x00-\x1f]/g, '_');
    link.click();
  } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
}

const SHRINK_SKIP_MESSAGES = {
  'already-fits': 'Text already fits its frame.',
  'no-shrink': 'No shrink-to-fit text to measure.',
  'empty-text': 'Shrink-to-fit text boxes are empty.',
  'not-pptx': 'Shrink measurement is available for PowerPoint exports only.',
  locked: 'This document is read-only.',
  'no-capability': 'This source does not support text layout changes.',
  'permission-revoked': 'Editing permission changed during export.',
  'fonts-timeout': 'Fonts did not finish loading in time.',
  'fonts-unavailable': 'Required fonts are unavailable.',
  'canvas-unavailable': 'Text measurement is unavailable in this browser.',
  'unsupported-metrics': 'Some text layouts cannot be measured yet.',
};
const unchangedNativeCount = outcome => outcome?.reasons?.['unchanged-native']
  ?? (outcome?.reason === 'unchanged-native' ? 1 : 0);
function unchangedNativeMessage(shrinkFit, resizeFit) {
  const count = unchangedNativeCount(shrinkFit) + unchangedNativeCount(resizeFit);
  if (!count) return '';
  return `${count} text ${count === 1 ? 'box' : 'boxes'} unchanged since import ${count === 1 ? 'was' : 'were'} left as PowerPoint saved ${count === 1 ? 'it' : 'them'}.`;
}
function shrinkFitMessage(shrinkFit) {
  if (!shrinkFit) return '';
  if (shrinkFit.reason === 'unchanged-native') return '';
  if (shrinkFit.status === 'measured') return `Shrink-to-fit measured for ${shrinkFit.count} text ${shrinkFit.count === 1 ? 'box' : 'boxes'}.`;
  if (shrinkFit.status === 'failed') return `Shrink-to-fit measurement failed. Exported without measured fit.`;
  return `Shrink-to-fit skipped: ${SHRINK_SKIP_MESSAGES[shrinkFit.reason] ?? 'No measured fit was available.'}`;
}

function resizeFitMessage(outcome) {
  if (!outcome) return '';
  if (outcome.reason === 'unchanged-native') return '';
  const {status,count,reason,stats} = outcome;
  const partial = stats?.skipped ? ` ${stats.skipped} text ${stats.skipped === 1 ? 'box was' : 'boxes were'} skipped.` : '';
  if(status === 'failed') return `Resize measurement failed for ${stats?.failed ?? 0} text ${(stats?.failed ?? 0) === 1 ? 'box' : 'boxes'}. ${count} ${count === 1 ? 'box was' : 'boxes were'} sized for export.${partial}`;
  if(status === 'measured') return count ? `Sized ${count} text ${count === 1 ? 'box' : 'boxes'} for export; the canvas size is unchanged.${partial}` : `Resize text already fits; no growth was needed.${partial}`;
  const message = {'no-resize':'No resize text to measure.','empty-text':'Resize text boxes are empty.',grouped:'Grouped text is not supported yet.',rotated:'Rotated text is not supported yet.','wrap-none':'Text without wrapping is not supported yet.','unsupported-geometry':'Some box geometry cannot be resized.'}[reason] ?? SHRINK_SKIP_MESSAGES[reason] ?? 'No measured size was available.';
  return `Resize skipped: ${message}`;
}

/** Local-only reference host. These retained source sessions are never sent to a backend. */
export default function SourceWorkspace({ openSource = openPresentation, createSource = createPresentation, save = downloadSource }) {
  const [resource, setResource] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [exportStatus, setExportStatus] = useState('');
  const [canvasSurface, setCanvasSurface] = useState(false);
  const active = useRef(null);
  const pending = useRef(null);
  const generation = useRef(0);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current++;
      pending.current?.abort();
      pending.current = null;
      active.current?.source.dispose();
      active.current?.editor.dispose();
      active.current = null;
    };
  }, []);

  async function loadSession({ fileName, format, load }) {
    const request = ++generation.current;
    setExportStatus('');
    pending.current?.abort();
    pending.current = null;
    if (!format) { setError('Choose a .pptx or .odp file.'); setLoading(false); return; }
    const controller = new AbortController();
    pending.current = controller;
    setLoading(true); setError('');
    let source, editor;
    const current = () => mounted.current && request === generation.current;
    try {
      source = await load(controller.signal);
      if (!current()) { source.dispose(); return; }
      editor = createEditor({ document: source.document, validateDocument, plugins: [documentPlugin, presentationPlugin] });
      const next = { source, editor, fileName, format, id: request };
      const previous = active.current;
      active.current = next;
      setResource(next);
      setExportStatus('');
      setCanvasSurface(false);
      previous?.source.dispose();
      previous?.editor.dispose();
    } catch (cause) {
      source?.dispose();
      editor?.dispose();
      if (current()) setError(cause instanceof Error ? cause.message : 'Could not open this presentation.');
    } finally {
      if (current()) { pending.current = null; setLoading(false); }
    }
  }

  async function openFile(file) {
    if (!file) return;
    const format = /\.(pptx|odp)$/i.exec(file.name)?.[1].toLowerCase();
    await loadSession({
      fileName: file.name,
      format,
      load: signal => openSource(file, { format, signal }),
    });
  }

  function newFile(format) {
    void loadSession({
      fileName: `Untitled.${format}`,
      format,
      load: signal => createSource({ format, title: 'Untitled', signal }),
    });
  }

  return <main className="stagecraft-source-workspace">
    <header>
      <div><h1>Presentation editor</h1><p>Create a deck or open a local PPTX/ODP file.</p></div>
      <a href="/">Back to playground</a>
      <button onClick={() => newFile('pptx')}>New PPTX</button>
      <button onClick={() => newFile('odp')}>New ODP</button>
      <label className="source-open">Open PPTX or ODP
        <input aria-label="Open PPTX or ODP" type="file" accept=".pptx,.odp" onChange={event => {
          const file = event.target.files?.[0]; event.target.value = ''; void openFile(file);
        }} />
      </label>
    </header>
    {loading && <p role="status">Opening presentation…</p>}
    {error && <p role="alert">{error}</p>}
    {resource ? <section aria-label={resource.fileName}>
      <p className="source-file-name">
        {resource.fileName} · Local file · Export creates a copy
        {' · '}
        <label className="source-surface-toggle">
          <input type="checkbox" aria-label="Canvas view" checked={canvasSurface} onChange={e => setCanvasSurface(e.target.checked)} />
          Canvas view
        </label>
      </p>
      {exportStatus && <p role="status" aria-label="Export result">{exportStatus}</p>}
      <EditorProvider key={resource.id} editor={resource.editor}>
        <PresentationEditor source={resource.source} surface={canvasSurface ? 'konva' : 'svg'} onExport={async (result, { revision, shrinkFit, resizeFit }) => {
          const request = generation.current;
          await save(result, { fileName: resource.fileName, format: resource.format, revision, ...(shrinkFit ? { shrinkFit } : {}), ...(resizeFit ? { resizeFit } : {}) });
          if (mounted.current && !pending.current && active.current === resource && generation.current === request) setExportStatus([unchangedNativeMessage(shrinkFit, resizeFit), shrinkFitMessage(shrinkFit), resizeFitMessage(resizeFit)].filter(Boolean).join(' '));
        }} />
      </EditorProvider>
    </section> : <section className="source-empty">
      <h2>Your presentation stays local</h2>
      <p>Create slides, add text and shapes, or edit supported native content. The preview is simplified; unsupported native content is retained.</p>
      <p>Signed documents open read-only. This workspace does not use the playground’s deck storage.</p>
    </section>}
  </main>;
}
