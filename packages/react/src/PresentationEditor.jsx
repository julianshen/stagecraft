import { measureShrinkFits, measureResizeFits, resizeFallback, waitForAutofitFonts } from '@stagecraft/renderer';
import { createContext, useContext, useEffect, useLayoutEffect, useId, useRef, useState } from 'react';
import { useEditor, useEditorSnapshot } from './EditorProvider.jsx';
import { runStyle, RunFormatControls, formatFontSlotDisplay } from './CanonicalEditorSurface.jsx';
import { PresentationChart } from './PresentationChart.jsx';
import {
  usePresentationPlugins,
  mergePlugins,
  PluginErrorBoundary,
  PluginRenderSlot,
  usePluginErrorReporter,
  safePluginCall,
  collectToolbarActions,
  collectInspectorSections,
  resolveObjectRenderer,
} from './presentationPlugins.jsx';
export {
  PresentationPluginProvider,
  usePresentationPlugins,
  createPresentationPluginRegistry,
} from './presentationPlugins.jsx';
import { isParagraphFormatValue } from '@stagecraft/core/document';
import { canonicalRangeCodePointSpan, mapDisplaySelectionToCanonicalRange } from './textSelection.js';
import './PresentationEditor.css';
const Context = createContext(null);
const PT = 12700;
/** EMU → points as an input string (two decimals); undefined → ''. */
const emuToPt = emu => (emu === undefined ? '' : String(Math.round((emu / PT) * 100) / 100));
const authored = object => object?.extensions?.stagecraftAuthored === true;
const geometryEligible = object => !!object && ['text', 'shape', 'table', 'image', 'chart'].includes(object.type) && !!object.geometry && (authored(object) || object.extensions?.editableGeometry === true);
// Pointer resize uses screen axes; rotated objects retain explicit inspector sizing.
const pointerResizeEligible = object => geometryEligible(object) && (object.geometry.rotation ?? 0) % 360 === 0;
function uuid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
const capabilityCommands = {
  'existing-run-text': ['document.setRunText'],
  'existing-run-format': ['document.setRunFormat'],
  'paragraph-format': ['document.setParagraphFormat'],
  'text-body-layout': ['document.setTextBodyLayout'],
  'run-range-format': ['document.setRunRangeFormat'],
  'slide-structure': ['presentation.addSlide', 'presentation.removeSlide', 'presentation.moveSlide'],
  'slide-properties': ['presentation.setSlideProperties'],
  'object-structure': ['presentation.addObject', 'presentation.removeObject', 'presentation.moveObject'],
  'object-text': ['presentation.setText'],
  'object-table': ['presentation.addObject'],
  'object-image': ['presentation.addImage'],
  'object-chart': ['presentation.addObject'],
  'object-geometry': ['presentation.setGeometry'],
  'object-style': ['presentation.setPaint'],
};
export function usePresentationEditor() {
  const value = useContext(Context);
  if (!value) throw new Error('usePresentationEditor requires PresentationEditorProvider.');
  return value;
}
export function PresentationEditorProvider({
  children,
  source,
  readOnly = false,
  plugins: propPlugins,
  onExport,
  onError,
  onSelectionChange
}) {
  const editor = useEditor(),
    snapshot = useEditorSnapshot();
  const { plugins: contextPlugins } = usePresentationPlugins();
  const plugins = mergePlugins(contextPlugins, propPlugins);
  const [, setPluginRevision] = useState(0);
  useEffect(() => editor.on('plugin', () => setPluginRevision(value => value + 1)), [editor]);
  const [selected, setSelected] = useState({
    editor,
    source,
    slideId: null,
    objectId: null
  });
  const [zoom, setZoomState] = useState(100),
    [error, setError] = useState(null),
    [exporting, setExporting] = useState(false),
    [exportedRevision, setExportedRevision] = useState(null);
  const lifecycle = useRef(null),
    lock = useRef(null),
    canvasRef = useRef(null);
  useLayoutEffect(() => {
    const token = {
      source,
      editor
    };
    lifecycle.current = token;
    lock.current = null;
    setExporting(false);
    setExportedRevision(null);
    setError(null);
    setSelected({
      editor,
      source,
      slideId: null,
      objectId: null
    });
    return () => {
      if (lifecycle.current === token) lifecycle.current = null;
    };
  }, [source, editor]);
  const doc = snapshot.document;
  const canonical = doc?.schemaVersion === 1 && doc?.units === 'emu' && Array.isArray(doc.slides) && Number.isFinite(doc.size?.width) && doc.size.width > 0 && Number.isFinite(doc.size?.height) && doc.size.height > 0;
  const slides = canonical ? doc.slides : [];
  const activeSlide = slides.find(s => selected.editor === editor && selected.source === source && s.id === selected.slideId) ?? slides[0] ?? null;
  const selectedObject = activeSlide?.objects.find(o => selected.editor === editor && selected.source === source && activeSlide.id === selected.slideId && o.id === selected.objectId) ?? null;
  const selection = {
    slideId: activeSlide?.id ?? null,
    objectId: selectedObject?.id ?? null
  };
  useEffect(() => {
    try {
      onSelectionChange?.(selection);
    } catch (reason) {
      reportError(reason);
    }
  }, [selection.slideId, selection.objectId, editor, source]);
  const locked = readOnly || source?.capabilities.readOnly === true;
  const fitAllowed = useRef(false), resizeAllowed = useRef(false);
  useLayoutEffect(() => {
    fitAllowed.current = !locked && source?.capabilities.edits.includes('text-body-layout');
    resizeAllowed.current = fitAllowed.current && source?.capabilities.edits.includes('object-geometry');
  });
  const commandIds = new Set(editor.getCommands().map(command => command.id));
  function hasCommand(id) {
    return commandIds.has(id);
  }
  function can(capability) {
    return !locked && canonical && (capabilityCommands[capability]?.every(command => commandIds.has(command)) ?? false) && (!source || source.capabilities.edits.includes(capability));
  }
  function reportSecondaryError(code, cause) {
    setError(previous => [previous, `${code}: ${cause instanceof Error ? cause.message : String(cause)}`].filter(Boolean).join('; '));
  }
  function reportError(reason) {
    setError(reason instanceof Error ? reason.message : String(reason));
    const token = lifecycle.current;
    const callbackFailed = cause => {
      if (token && lifecycle.current === token) reportSecondaryError('ERROR_CALLBACK_FAILED', cause);
    };
    try {
      Promise.resolve(onError?.(reason)).catch(callbackFailed);
    } catch (cause) { callbackFailed(cause); }
  }
  function dispatch(command, payload, capability, revision = snapshot.revision) {
    if (!can(capability)) return false;
    try {
      editor.dispatch(command, payload, {
        expectedRevision: revision,
        origin: 'react'
      });
      setError(null);
      return true;
    } catch (reason) {
      reportError(reason);
      return false;
    }
  }
  function selectSlide(id) {
    if (slides.some(s => s.id === id)) setSelected({
      editor,
      source,
      slideId: id,
      objectId: null
    });
  }
  function selectObject(id) {
    if (id === null || activeSlide?.objects.some(o => o.id === id)) setSelected({
      editor,
      source,
      slideId: activeSlide?.id ?? null,
      objectId: id
    });
  }
  function addSlide() {
    const slideId = uuid();
    if (dispatch('presentation.addSlide', {
      slideId
    }, 'slide-structure')) setSelected({
      editor,
      source,
      slideId,
      objectId: null
    });
  }
  function removeSlide() {
    if (activeSlide && !(source && slides.length <= 1)) dispatch('presentation.removeSlide', {
      slideId: activeSlide.id
    }, 'slide-structure');
  }
  function moveSlide(index) {
    if (activeSlide) dispatch('presentation.moveSlide', {
      slideId: activeSlide.id,
      index
    }, 'slide-structure');
  }
  function addObject(kind) {
    if (!activeSlide || !['text', 'rect', 'ellipse'].includes(kind)) return;
    const id = uuid();
    const object = {
      id,
      type: kind === 'text' ? 'text' : 'shape',
      geometry: {
        x: 72 * PT,
        y: 72 * PT,
        width: 240 * PT,
        height: 100 * PT
      },
      extensions: {
        stagecraftAuthored: true
      }
    };
    if (kind === 'text') object.text = {
      paragraphs: [createAuthoredParagraph('Text')]
    };else {
      object.shape = kind;
      object.fill = '#4472C4';
    }
    if (dispatch('presentation.addObject', {
      slideId: activeSlide.id,
      object
    }, 'object-structure')) selectObjectAfterInsert(id);
  }
  function selectObjectAfterInsert(id) {
    setSelected({
      editor,
      source,
      slideId: activeSlide.id,
      objectId: id
    });
  }
  function removeObject() {
    if (selectedObject && dispatch('presentation.removeObject', {
      slideId: activeSlide.id,
      objectId: selectedObject.id
    }, 'object-structure')) {
      setSelected({
        editor,
        source,
        slideId: activeSlide.id,
        objectId: null
      });
      canvasRef.current?.focus();
    }
  }
  function moveObject(index) {
    if (selectedObject) dispatch('presentation.moveObject', {
      slideId: activeSlide.id,
      objectId: selectedObject.id,
      index
    }, 'object-structure');
  }
  function setGeometry(geometry, revision = snapshot.revision, objectId = selectedObject?.id, slideId = activeSlide?.id) {
    const object = slides.find(s => s.id === slideId)?.objects.find(o => o.id === objectId);
    if (geometryEligible(object)) return dispatch('presentation.setGeometry', {
      slideId,
      objectId,
      geometry: Object.fromEntries(['x', 'y', 'width', 'height', 'rotation'].filter(key => geometry[key] !== undefined).map(key => [key, geometry[key]]))
    }, 'object-geometry', revision);
    return false;
  }
  function setPaint(fill) {
    if ((authored(selectedObject) || selectedObject?.extensions?.editableFill === true) && selectedObject?.type === 'shape' && ['rect', 'ellipse'].includes(selectedObject.shape)) {
      dispatch('presentation.setPaint', {
        slideId: activeSlide.id,
        objectId: selectedObject.id,
        fill
      }, 'object-style');
    }
  }
  function addTable(rows = 2, cols = 2) {
    if (!activeSlide) return false;
    const rCount = Math.min(50, Math.max(1, Math.trunc(rows)));
    const cCount = Math.min(20, Math.max(1, Math.trunc(cols)));
    const colWidth = Math.floor((360 * PT) / cCount);
    const id = uuid();
    const columns = Array.from({ length: cCount }, () => ({ id: uuid(), width: colWidth }));
    const tableRows = Array.from({ length: rCount }, () => ({
      id: uuid(),
      cells: Array.from({ length: cCount }, () => ({
        id: uuid(),
        text: { paragraphs: [createAuthoredParagraph('Cell')] }
      }))
    }));
    const object = {
      id,
      type: 'table',
      geometry: { x: 72 * PT, y: 72 * PT, width: colWidth * cCount, height: 120 * PT },
      extensions: { stagecraftAuthored: true },
      table: { columns, rows: tableRows }
    };
    const ok = dispatch('presentation.addObject', { slideId: activeSlide.id, object }, 'object-table');
    if (ok) selectObjectAfterInsert(id);
    return ok;
  }
  function addImage(bytes, contentType, alt, slideId = activeSlide?.id) {
    if (!slideId || typeof source?.registerImage !== 'function' || !can('object-image')) return false;
    let registration = null;
    let commandSucceeded = false;
    try {
      registration = source.registerImage({ bytes, contentType });
      const { assetId } = registration;
      const id = uuid();
      const object = {
        id,
        type: 'image',
        geometry: { x: 72 * PT, y: 72 * PT, width: 240 * PT, height: 180 * PT },
        extensions: { stagecraftAuthored: true },
        image: { assetId, ...(alt ? { alt: String(alt).slice(0, 512) } : {}) }
      };
      const ok = dispatch('presentation.addImage', {
        slideId,
        object,
        asset: { id: assetId, contentType },
      }, 'object-image');
      if (ok) {
        commandSucceeded = true;
        try { registration.commit?.(); } catch (cause) { reportSecondaryError('Warning: Image inserted. IMAGE_COMMIT_FAILED', cause); }
        if (slideId === activeSlide?.id) selectObjectAfterInsert(id);
      }
      return ok;
    } catch (reason) {
      reportError(reason);
      return false;
    } finally {
      if (registration && !commandSucceeded) {
        try { registration.release?.(); } catch (cause) { reportSecondaryError('IMAGE_RELEASE_FAILED', cause); }
      }
    }
  }
  function addChart(kind = 'bar') {
    if (!activeSlide || !['bar', 'line', 'pie'].includes(kind)) return false;
    const id = uuid();
    const chart = kind === 'pie'
      ? { kind: 'pie', categories: ['Q1', 'Q2', 'Q3'], series: [{ name: 'Series 1', values: [30, 45, 25] }] }
      : { kind, categories: ['Q1', 'Q2', 'Q3'], series: [{ name: 'Series 1', values: [12, 18, 24] }] };
    const object = {
      id,
      type: 'chart',
      geometry: { x: 72 * PT, y: 72 * PT, width: 360 * PT, height: 220 * PT },
      extensions: { stagecraftAuthored: true },
      chart,
    };
    const ok = dispatch('presentation.addObject', { slideId: activeSlide.id, object }, 'object-chart');
    if (ok) selectObjectAfterInsert(id);
    return ok;
  }
  function setChart(chart, objectId = selectedObject?.id, slideId = activeSlide?.id) {
    const object = slides.find(s => s.id === slideId)?.objects.find(o => o.id === objectId);
    if (!authored(object) || object.type !== 'chart' || !hasCommand('presentation.setChart')) return false;
    return dispatch('presentation.setChart', { slideId, objectId, chart }, 'object-chart');
  }
  function setRunText(runId, text, revision = snapshot.revision) {
    return dispatch('document.setRunText', {
      runId,
      text
    }, 'existing-run-text', revision);
  }
  function setRunFormat(runId, format, revision = snapshot.revision) {
    dispatch('document.setRunFormat', {
      runId,
      format
    }, 'existing-run-format', revision);
  }
  function setParagraphFormat(paragraphId, format, revision = snapshot.revision) {
    if (!paragraphId || !format || typeof format !== 'object') return false;
    return dispatch('document.setParagraphFormat', {
      paragraphId,
      format,
    }, 'paragraph-format', revision);
  }
  function setTextBodyLayout(objectId, layout, revision = snapshot.revision) {
    if (!objectId || !layout || typeof layout !== 'object') return false;
    return dispatch('document.setTextBodyLayout', {
      objectId,
      layout,
    }, 'text-body-layout', revision);
  }
  function setRunRangeFormat(objectId, range, format, revision = snapshot.revision) {
    if (!objectId || !range?.start || !range?.end || !format || typeof format !== 'object') return false;
    return dispatch('document.setRunRangeFormat', {
      objectId,
      range,
      format,
    }, 'run-range-format', revision);
  }
  function setSlideProperties(properties, slideId = activeSlide?.id) {
    if (!slideId || !properties || typeof properties !== 'object') return false;
    const clean = {};
    if (properties.name !== undefined) clean.name = String(properties.name);
    if (properties.background !== undefined) clean.background = properties.background;
    if (properties.notes !== undefined) clean.notes = properties.notes === null ? null : String(properties.notes);
    return dispatch('presentation.setSlideProperties', {
      slideId,
      properties: clean
    }, 'slide-properties');
  }
  function setText(paragraphs, objectId = selectedObject?.id, slideId = activeSlide?.id) {
    const object = slides.find(s => s.id === slideId)?.objects.find(o => o.id === objectId);
    if (!authored(object) || !['text', 'shape'].includes(object.type)) return false;
    return dispatch('presentation.setText', {
      slideId,
      objectId,
      text: { paragraphs }
    }, 'object-text');
  }
  function setTableCell(cellId, paragraphs, objectId = selectedObject?.id, slideId = activeSlide?.id, revision = snapshot.revision) {
    const object = slides.find(s => s.id === slideId)?.objects.find(o => o.id === objectId);
    if (!authored(object) || object.type !== 'table' || !cellId) return false;
    return dispatch('presentation.setTableCell', {
      slideId,
      objectId,
      cellId,
      text: { paragraphs }
    }, 'object-table', revision);
  }
  function history(method) {
    if (locked) return;
    try {
      editor[method]({
        expectedRevision: snapshot.revision,
        origin: 'react'
      });
      setError(null);
    } catch (reason) {
      reportError(reason);
    }
  }
  async function exportSnapshot() {
    const token = lifecycle.current;
    if (!source || !onExport || !token || lock.current) return;
    const request = {
      token
    };
    lock.current = request;
    setExporting(true);
    setError(null);
    setExportedRevision(null);
    const current = () => lifecycle.current === token;
    try {
      let fit, resize;
      const excluded = snapshot.document.extensions?.sourceFormat !== 'pptx' ? 'not-pptx' : locked ? 'locked' : 'no-capability';
      let shrinkFit = { status: 'skipped', count: 0, reason: excluded };
      const resizeResult = (status, reason, message) => {
        const { resize: unused, ...outcome } = resizeFallback(snapshot.document, status, reason, message);
        return outcome;
      };
      let resizeFit = resizeResult('skipped', excluded);
      const shrinkEnabled = snapshot.document.extensions?.sourceFormat === 'pptx' && !locked && source.capabilities.edits.includes('text-body-layout');
      const resizeEnabled = shrinkEnabled && source.capabilities.edits.includes('object-geometry');
      if (shrinkEnabled) {
        const fonts = globalThis.document?.fonts;
        let readiness;
        try {
          readiness = await waitForAutofitFonts(snapshot.document, { fonts, kinds: resizeEnabled ? ['shrink', 'resize'] : ['shrink'], baseline: source.document });
        } catch {
          readiness = { shrink: {status:'failed',reason:'error',message:'Font readiness failed.'}, resize: {status:'failed',reason:'error',message:'Font readiness failed.'} };
        }
        if (!current()) return;
        if (!fitAllowed.current) shrinkFit = { status: 'skipped', reason: 'permission-revoked', count: 0 };
        else if (readiness.shrink.status !== 'ready') shrinkFit = { ...readiness.shrink, count: readiness.shrink.count ?? 0 };
        else {
          try { ({ fit, ...shrinkFit } = measureShrinkFits(snapshot.document, { fonts, baseline: source.document })); }
          catch { shrinkFit = { status:'failed',reason:'error',message:'Shrink measurement failed.',count:0 }; }
        }
        if (resizeEnabled) {
          if (!resizeAllowed.current) resizeFit = resizeResult('skipped','permission-revoked');
          else if (readiness.resize.status !== 'ready') resizeFit = resizeResult(readiness.resize.status,readiness.resize.reason,readiness.resize.message);
          else {
            try { ({resize,...resizeFit} = measureResizeFits(snapshot.document,{fonts,baseline:source.document})); }
            catch { resizeFit = resizeResult('failed','error','Resize measurement failed.'); }
          }
        }
      }
      const options = { ...(fit?.size ? {fit} : {}), ...(resize?.size ? {resize} : {}) };
      const result = await (Object.keys(options).length ? source.export(snapshot.document, options) : source.export(snapshot.document));
      if (!current()) return;
      await onExport(result, {
        revision: snapshot.revision,
        shrinkFit,
        resizeFit
      });
      if (current()) setExportedRevision(snapshot.revision);
    } catch (reason) {
      if (current()) reportError(reason);
    } finally {
      if (current() && lock.current === request) {
        lock.current = null;
        setExporting(false);
      }
    }
  }
  const value = {
    canvasRef,
    editor,
    snapshot,
    selection,
    activeSlide,
    selectedObject,
    zoom,
    readOnly: locked,
    source,
    canonical,
    error,
    exporting,
    exportedRevision,
    exportAvailable: !!source && !!onExport,
    canExport: !!source && !!onExport,
    plugins,
    hasCommand,
    can,
    selectSlide,
    selectObject,
    setZoom: number => {
      if (Number.isFinite(number)) setZoomState(Math.min(200, Math.max(25, number)));
    },
    reportError,
    addSlide,
    removeSlide,
    moveSlide,
    addObject,
    addTable,
    addImage,
    addChart,
    removeObject,
    moveObject,
    setGeometry,
    setPaint,
    setChart,
    setRunText,
    setRunFormat,
    setParagraphFormat,
    setTextBodyLayout,
    setRunRangeFormat,
    setSlideProperties,
    setText,
    setTableCell,
    undo: () => history('undo'),
    redo: () => history('redo'),
    exportSnapshot
  };
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function DeckList({
  items,
  activeId,
  onSelect,
  emptyMessage = 'No presentations',
  className = '',
  style
}) {
  return <nav aria-label="Presentations" className={`stagecraft-presentation-decks ${className}`} style={style}>{items.length ? items.map(item => <button key={item.id} disabled={item.disabled} aria-current={item.id === activeId ? 'page' : undefined} onClick={() => onSelect?.(item.id)}><strong>{item.title}</strong>{item.description && <small>{item.description}</small>}</button>) : <p>{emptyMessage}</p>}</nav>;
}
function ZoomControl({ value, onChange }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  function commit() {
    const parsed = Number(draft);
    if (draft.trim() !== '' && Number.isFinite(parsed)) {
      const next = Math.min(200, Math.max(25, parsed));
      onChange(next);
      setDraft(String(next));
    } else setDraft(String(value));
  }
  return <label>Zoom <input aria-label="Zoom" type="number" min="25" max="200" value={draft}
    onChange={event => setDraft(event.target.value)} onBlur={commit}
    onKeyDown={event => { if (event.key === 'Enter') { commit(); event.currentTarget.blur(); } }} />%</label>;
}
export function PresentationToolbar({
  className = '',
  style
}) {
  const ui = usePresentationEditor(),
    [tab, setTab] = useState('Home'),
    ribbonId = useId(),
    imageInputRef = useRef(null),
    imageLifecycleRef = useRef(null);
  const index = ui.activeSlide?.objects.findIndex(o => o.id === ui.selection.objectId) ?? -1;
  const reportPredicateError = usePluginErrorReporter(ui.reportError);
  const pluginActions = collectToolbarActions(ui.plugins ?? [], tab, ui, reportPredicateError);
  const canImage = !!ui.activeSlide && ui.can('object-image') && typeof ui.source?.registerImage === 'function';
  useEffect(() => {
    const token = canImage && !ui.readOnly ? { editor: ui.editor, source: ui.source, slideId: ui.selection.slideId } : null;
    imageLifecycleRef.current = token;
    return () => {
      if (token && imageLifecycleRef.current === token) imageLifecycleRef.current = null;
    };
  }, [ui.editor, ui.source, ui.selection.slideId, ui.readOnly, canImage]);
  async function onImagePicked(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    const token = imageLifecycleRef.current;
    if (!file || !token || !token.slideId) return;
    try {
      const contentType = file.type === 'image/png' ? 'image/png' : file.type === 'image/jpeg' ? 'image/jpeg' : null;
      if (!contentType) throw new Error('Only PNG and JPEG images are supported.');
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (imageLifecycleRef.current !== token) return;
      ui.addImage(bytes, contentType, file.name, token.slideId);
    } catch (reason) {
      if (imageLifecycleRef.current !== token) return;
      ui.reportError(reason);
    }
  }
  return <header className={`stagecraft-presentation-toolbar ${className}`} style={style}>
    <div role="tablist" aria-label="Ribbon tabs">{['Home', 'Insert', 'View'].map(name => <button role="tab" id={`${ribbonId}-${name}`} aria-controls={`${ribbonId}-panel`} tabIndex={tab === name ? 0 : -1} key={name} aria-selected={tab === name} onKeyDown={event => {
        const tabs = ['Home', 'Insert', 'View'];
        const next = event.key === 'ArrowRight' ? (tabs.indexOf(name) + 1) % 3 : event.key === 'ArrowLeft' ? (tabs.indexOf(name) + 2) % 3 : event.key === 'Home' ? 0 : event.key === 'End' ? 2 : -1;
        if (next >= 0) {
          event.preventDefault();
          setTab(tabs[next]);
          event.currentTarget.parentElement.children[next].focus();
        }
      }} onClick={() => setTab(name)}>{name}</button>)}</div>
    <div role="tabpanel" id={`${ribbonId}-panel`} aria-labelledby={`${ribbonId}-${tab}`}><div role="toolbar" aria-label={`${tab} toolbar`}>
      {tab === 'Home' && <><button disabled={ui.readOnly || !ui.snapshot.canUndo} onClick={ui.undo}>Undo</button><button disabled={ui.readOnly || !ui.snapshot.canRedo} onClick={ui.redo}>Redo</button><button disabled={!ui.can('object-structure') || !ui.selectedObject} onClick={ui.removeObject}>Delete object</button><button disabled={!ui.can('object-structure') || index < 0 || index >= ui.activeSlide.objects.length - 1} onClick={() => ui.moveObject(index + 1)}>Bring forward</button><button disabled={!ui.can('object-structure') || index <= 0} onClick={() => ui.moveObject(index - 1)}>Send backward</button></>}
      {tab === 'Insert' && <>
        {[['text', 'Text box'], ['rect', 'Rectangle'], ['ellipse', 'Ellipse']].map(([kind, label]) => <button key={kind} disabled={!ui.activeSlide || !ui.can('object-structure')} onClick={() => ui.addObject(kind)}>{label}</button>)}
        <button disabled={!ui.activeSlide || !ui.can('object-table')} onClick={() => ui.addTable(2, 2)}>Table</button>
        <button disabled={!ui.activeSlide || !ui.can('object-chart')} onClick={() => ui.addChart('bar')}>Chart</button>
        {typeof ui.source?.registerImage === 'function' && <>
          <button disabled={!canImage} onClick={() => imageInputRef.current?.click()}>Image</button>
          <input ref={imageInputRef} type="file" accept="image/png,image/jpeg" hidden aria-hidden="true" onChange={onImagePicked} />
        </>}
        <button disabled={!ui.can('slide-structure')} onClick={ui.addSlide}>Blank slide</button>
      </>}
      {tab === 'View' && <><ZoomControl value={ui.zoom} onChange={ui.setZoom} /><button onClick={() => ui.setZoom(100)}>100%</button></>}
      {pluginActions.map(({ pluginId, action }) => (
        <PluginErrorBoundary key={`${pluginId}:${action.id}`} resetKey={`${pluginId}:${action.id}:${tab}`} resetIdentity={action.render ?? action} onError={ui.reportError}>
          {action.render ? <PluginRenderSlot render={action.render} arg={ui} /> : (
            <button
              disabled={Boolean(safePluginCall(action.disabled, false, reportPredicateError, ui))}
              onClick={() => {
                try {
                  Promise.resolve(action.onAction?.(ui)).catch(ui.reportError);
                } catch (err) {
                  ui.reportError(err);
                }
              }}
            >
              {action.label}
            </button>
          )}
        </PluginErrorBoundary>
      ))}
      {ui.exportAvailable && <button disabled={!ui.canExport || ui.exporting} onClick={ui.exportSnapshot}>{ui.exporting ? 'Exporting…' : 'Export'}</button>}
      <span>Revision {ui.snapshot.revision}{ui.readOnly ? ' · Read only' : ''}</span>
    </div></div>
  </header>;
}
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
function ImagePreview({ assetId, alt, source }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    if (!assetId || typeof source?.getImage !== 'function' || typeof URL?.createObjectURL !== 'function') {
      setUrl(null);
      return undefined;
    }
    let img = null;
    try {
      img = source.getImage(assetId);
    } catch {
      img = null;
    }
    if (!img?.bytes) {
      setUrl(null);
      return undefined;
    }
    const objectUrl = URL.createObjectURL(new Blob([img.bytes], { type: img.contentType || 'application/octet-stream' }));
    setUrl(objectUrl);
    return () => {
      URL.revokeObjectURL?.(objectUrl);
    };
  }, [assetId, source]);
  if (!url) {
    return <span className="stagecraft-presentation-placeholder">Image: {alt || assetId}</span>;
  }
  return <img className="stagecraft-presentation-image" src={url} alt={alt || ''} />;
}

function formatNumberBullet(index, format) {
  const n = index + 1;
  if (format === 'arabicParenR') return `${n}) `;
  if (format === 'lowerAlphaPeriod') return `${String.fromCharCode(97 + (index % 26))}. `;
  if (format === 'upperAlphaPeriod') return `${String.fromCharCode(65 + (index % 26))}. `;
  if (format === 'lowerRomanPeriod' || format === 'upperRomanPeriod') {
    const numerals = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
    let rem = n;
    let out = '';
    for (const [val, sym] of numerals) {
      while (rem >= val) { out += sym; rem -= val; }
    }
    return `${format === 'upperRomanPeriod' ? out.toUpperCase() : out}. `;
  }
  return `${n}. `;
}

function computeNumberedIndices(paragraphs) {
  const counts = new Map();
  const formats = new Map();
  return paragraphs.map(p => {
    const bullet = p.style?.bullet;
    const lvl = Number.isInteger(p.style?.level) ? p.style.level : 0;
    for (const k of [...counts.keys()]) {
      if (k > lvl) {
        counts.delete(k);
        formats.delete(k);
      }
    }
    if (bullet?.type === 'number') {
      const prevFmt = formats.get(lvl);
      const nextIdx = prevFmt === bullet.format ? (counts.get(lvl) ?? -1) + 1 : 0;
      counts.set(lvl, nextIdx);
      formats.set(lvl, bullet.format);
      return nextIdx;
    }
    counts.delete(lvl);
    formats.delete(lvl);
    return 0;
  });
}

function bulletMarker(bullet, index) {
  if (!bullet) return null;
  if (bullet.type === 'char' && typeof bullet.char === 'string') return `${bullet.char} `;
  if (bullet.type === 'number') return formatNumberBullet(index, bullet.format);
  return null;
}

function paragraphStyleCss(style, scale) {
  if (!style) return undefined;
  const css = {};
  if (['left', 'center', 'right', 'justify'].includes(style.alignment)) css.textAlign = style.alignment;
  if (Number.isFinite(style.spaceBefore)) css.marginTop = `${style.spaceBefore * PT * scale}px`;
  if (Number.isFinite(style.spaceAfter)) css.marginBottom = `${style.spaceAfter * PT * scale}px`;
  if (Number.isFinite(style.lineSpacing)) css.lineHeight = `${style.lineSpacing / 100}`;
  if (Number.isFinite(style.indentStart)) css.paddingLeft = `${Math.max(0, style.indentStart * scale)}px`;
  if (Number.isFinite(style.indentEnd)) css.paddingRight = `${Math.max(0, style.indentEnd * scale)}px`;
  if (Number.isFinite(style.firstLineIndent)) css.textIndent = `${style.firstLineIndent * scale}px`;
  return Object.keys(css).length ? css : undefined;
}

function textBodyCss(object, scale) {
  const layout = object?.bodyLayout;
  if (!layout) return undefined;
  const css = {};
  if (layout.anchor === 'middle') { css.display = 'flex'; css.flexDirection = 'column'; css.justifyContent = 'center'; }
  else if (layout.anchor === 'bottom') { css.display = 'flex'; css.flexDirection = 'column'; css.justifyContent = 'flex-end'; }
  if (layout.wrap === 'none') css.whiteSpace = 'nowrap';
  if (layout.insets) {
    const ins = layout.insets;
    if (Number.isFinite(ins.top)) css.paddingTop = `${ins.top * scale}px`;
    if (Number.isFinite(ins.right)) css.paddingRight = `${ins.right * scale}px`;
    if (Number.isFinite(ins.bottom)) css.paddingBottom = `${ins.bottom * scale}px`;
    if (Number.isFinite(ins.left)) css.paddingLeft = `${ins.left * scale}px`;
  }
  return Object.keys(css).length ? css : undefined;
}

const slideBackground = slide => (
  slide?.background?.type === 'solid' && HEX_COLOR.test(slide.background.color ?? '')
    ? slide.background.color
    : undefined
);
function Artwork({
  slide,
  size,
  selectedId,
  preview,
  editorCtx,
  inlineEdit,
  onStartInlineEdit,
  onInlineDraftChange,
  onInlineCommit,
  onInlineCancel,
  onPointerDown,
  onSelect,
  onResize
}) {
  const scale = 960 / size.width,
    height = size.height * scale;
  const reportPredicateError = usePluginErrorReporter(editorCtx?.reportError);
  if (![scale, height].every(Number.isFinite) || height <= 0 || slide.objects.some(o => o.geometry && ![o.geometry.x * scale, o.geometry.y * scale, o.geometry.width * scale, (o.geometry.x + o.geometry.width / 2) * scale, (o.geometry.y + o.geometry.height / 2) * scale, o.geometry.height * scale].every(Number.isFinite))) return <p role="alert">Preview unavailable: document geometry exceeds the supported display range.</p>;
  const bg = slideBackground(slide);
  return <svg viewBox={`0 0 960 ${height}`} aria-label="Slide artwork" style={bg ? { background: bg } : undefined} onPointerDown={event => {
    if (event.target === event.currentTarget) onSelect?.(null);
  }}>
    {slide.objects.map((object, index) => {
      const g = preview?.id === object.id ? preview.geometry : object.geometry;
      const x = g ? g.x * scale : 10,
        y = g ? g.y * scale : 10 + index * 40,
        width = g ? Math.max(1, g.width * scale) : 400,
        h = g ? Math.max(1, g.height * scale) : 40;
      const customRenderer = editorCtx?.plugins?.length
        ? resolveObjectRenderer(editorCtx.plugins, object, editorCtx, reportPredicateError)
        : null;
      const primitive = ['text', 'shape'].includes(object.type) && ['rect', 'ellipse'].includes(object.shape);
      const text = ['text', 'shape'].includes(object.type) && object.text;
      const selected = object.id === selectedId,
        fill = HEX_COLOR.test(object.fill ?? '') ? object.fill : '#e5e7eb';
      const firstEditableRun = text
        ? object.text.paragraphs.flatMap(p => p.runs).find(r => r.editable !== false)
        : null;
      const isEditingThis = inlineEdit && inlineEdit.objectId === object.id && inlineEdit.slideId === slide.id;
      return <g key={object.id} role={onSelect ? 'button' : undefined} tabIndex={onSelect ? 0 : undefined} aria-pressed={onSelect ? selected : undefined} onKeyDown={event => {
        if (isEditingThis) return;
        if (selected && event.key === 'Enter' && firstEditableRun && onStartInlineEdit) {
          event.preventDefault();
          event.stopPropagation();
          onStartInlineEdit(object, firstEditableRun);
          return;
        }
        if (onSelect && ['Enter', ' '].includes(event.key)) {
          event.preventDefault();
          event.stopPropagation();
          onSelect(object.id);
        }
      }} onDoubleClick={event => {
        if (!firstEditableRun || !onStartInlineEdit) return;
        event.stopPropagation();
        onStartInlineEdit(object, firstEditableRun);
      }} data-object-id={object.id} aria-label={onSelect ? `Select object ${object.id}` : undefined} onPointerDown={event => {
        if (isEditingThis) return;
        onPointerDown?.(event, object);
      }} onClick={event => {
        if (isEditingThis) return;
        event.stopPropagation();
        onSelect?.(object.id);
      }} transform={Number.isFinite(g?.rotation) && g.rotation ? `rotate(${g.rotation} ${x + width / 2} ${y + h / 2})` : undefined}>
        {customRenderer ? (
          <PluginErrorBoundary resetKey={`${customRenderer.pluginId}:${customRenderer.renderer.id}:${object.id}`} resetIdentity={customRenderer.renderer.render} onError={editorCtx.reportError}>
            <PluginRenderSlot
              render={customRenderer.renderer.render}
              arg={{
                object,
                slide,
                scale,
                selected,
                geometry: { x, y, width, height: h, rotation: g?.rotation },
                editor: editorCtx,
              }}
            />
          </PluginErrorBoundary>
        ) : (
          <>
            {primitive && (object.shape === 'ellipse'
              ? <ellipse cx={x + width / 2} cy={y + h / 2} rx={width / 2} ry={h / 2} fill={fill} />
              : <rect x={x} y={y} width={width} height={h} fill={fill} />)}
            {(!primitive || text) && <foreignObject x={x} y={y} width={width} height={h}>
              <div className="stagecraft-presentation-object" style={text ? textBodyCss(object, scale) : undefined}>{text
                ? (() => {
                  const numIndices = computeNumberedIndices(object.text.paragraphs);
                  return object.text.paragraphs.map((p, pIdx) => {
                    const marker = bulletMarker(p.style?.bullet, numIndices[pIdx]);
                    return (
                      <p key={p.id} style={paragraphStyleCss(p.style, scale)}>
                        {marker && <span className="stagecraft-presentation-bullet" aria-hidden="true">{marker}</span>}
                        {p.runs.map(run => (
                          <span
                            key={run.id}
                            data-run-id={run.id}
                            style={runStyle(run, scale)}
                            onDoubleClick={event => {
                              if (run.editable === false || !onStartInlineEdit) return;
                              event.stopPropagation();
                              onStartInlineEdit(object, run);
                            }}
                          >
                            {run.text}
                          </span>
                        ))}
                      </p>
                    );
                  });
                })()
                : object.type === 'table' && object.table
                  ? <table className="stagecraft-presentation-table"><tbody>{object.table.rows.map(row => <tr key={row.id}>{row.cells.map(cell => <td key={cell.id}>{(cell.text?.paragraphs ?? []).map(p => <p key={p.id}>{p.runs.map(run => <span key={run.id} style={runStyle(run, scale)}>{run.text}</span>)}</p>)}</td>)}</tr>)}</tbody></table>
                  : object.type === 'image' && object.image
                    ? <ImagePreview assetId={object.image.assetId} alt={object.image.alt} source={editorCtx?.source} />
                    : object.type === 'chart' && object.chart
                      ? <PresentationChart chart={object.chart} />
                      : <span className="stagecraft-presentation-placeholder">Unsupported preview: {object.type}</span>}
              </div>
            </foreignObject>}
          </>
        )}
        {isEditingThis && (
          <foreignObject x={x} y={y} width={width} height={h}>
            <InlineRunEditor
              draft={inlineEdit.draft}
              onChange={onInlineDraftChange}
              onCommit={onInlineCommit}
              onCancel={onInlineCancel}
            />
          </foreignObject>
        )}
        {selected && <><rect x={x} y={y} width={width} height={h} fill="none" stroke="#2563eb" strokeWidth="2" pointerEvents="none" />{onResize && pointerResizeEligible(object) && <rect aria-label="Resize object" x={x + width - 5} y={y + h - 5} width="10" height="10" fill="#2563eb" onPointerDown={event => {
            event.stopPropagation();
            onResize(event, object);
          }} />}</>}
      </g>;
    })}
  </svg>;
}
function InlineRunEditor({ draft, onChange, onCommit, onCancel }) {
  const ref = useRef(null);
  const composingRef = useRef(false);
  const skipNextBlurRef = useRef(false);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  return (
    <textarea
      ref={ref}
      aria-label="Edit run text"
      className="stagecraft-presentation-inline-editor"
      value={draft}
      onPointerDown={event => event.stopPropagation()}
      onClick={event => event.stopPropagation()}
      onDoubleClick={event => event.stopPropagation()}
      onCompositionStart={() => { composingRef.current = true; }}
      onCompositionEnd={() => { composingRef.current = false; }}
      onChange={event => onChange(event.target.value)}
      onBlur={() => {
        if (skipNextBlurRef.current) {
          skipNextBlurRef.current = false;
          return;
        }
        onCommit();
      }}
      onKeyDown={event => {
        event.stopPropagation();
        if (composingRef.current || event.nativeEvent?.isComposing || event.keyCode === 229) return;
        if (event.key === 'Escape') {
          event.preventDefault();
          skipNextBlurRef.current = true;
          onCancel();
        } else if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
          event.preventDefault();
          skipNextBlurRef.current = true;
          onCommit();
        }
      }}
    />
  );
}

export function SlideList({
  className = '',
  style
}) {
  const ui = usePresentationEditor(),
    slides = ui.canonical ? ui.snapshot.document.slides : [],
    index = slides.findIndex(s => s.id === ui.selection.slideId);
  return <nav aria-label="Slides" className={`stagecraft-presentation-slides ${className}`} style={style}><div className="stagecraft-presentation-slide-actions"><button disabled={!ui.can('slide-structure')} onClick={ui.addSlide}>Add slide</button><button disabled={!ui.can('slide-structure') || !ui.activeSlide || (!!ui.source && slides.length <= 1)} onClick={ui.removeSlide}>Remove slide</button><button disabled={!ui.can('slide-structure') || index <= 0} onClick={() => ui.moveSlide(index - 1)}>Move slide up</button><button disabled={!ui.can('slide-structure') || index < 0 || index >= slides.length - 1} onClick={() => ui.moveSlide(index + 1)}>Move slide down</button></div>{slides.map((slide, i) => <button className="stagecraft-presentation-thumbnail" key={slide.id} aria-label={`Slide ${i + 1}`} aria-current={slide.id === ui.selection.slideId ? 'page' : undefined} onClick={() => ui.selectSlide(slide.id)}><Artwork slide={slide} size={ui.snapshot.document.size} editorCtx={ui} /><span>{i + 1}{slide.name ? ` · ${slide.name}` : ''}</span></button>)}</nav>;
}
export function PresentationCanvas({
  className = '',
  style
}) {
  const ui = usePresentationEditor(),
    gesture = useRef(null),
    [preview, setPreview] = useState(null),
    [inlineEdit, setInlineEdit] = useState(null);
  function startInlineEdit(object, run) {
    if (!ui.can('existing-run-text') || !object || !run || run.editable === false) return;
    cancel();
    ui.selectObject(object.id);
    setInlineEdit({
      objectId: object.id,
      slideId: ui.selection.slideId,
      runId: run.id,
      initialText: run.text ?? '',
      draft: run.text ?? '',
      startRevision: ui.snapshot.revision,
      editor: ui.editor,
      source: ui.source,
    });
  }
  function commitInlineEdit() {
    if (!inlineEdit) return;
    if (inlineEdit.editor === ui.editor && inlineEdit.source === ui.source && inlineEdit.draft !== inlineEdit.initialText) {
      ui.setRunText(inlineEdit.runId, inlineEdit.draft, inlineEdit.startRevision);
    }
    setInlineEdit(null);
    ui.canvasRef.current?.focus();
  }
  function cancelInlineEdit() {
    setInlineEdit(null);
    ui.canvasRef.current?.focus();
  }
  useEffect(() => {
    setInlineEdit(prev => (
      prev && (
        prev.editor !== ui.editor ||
        prev.source !== ui.source ||
        prev.slideId !== ui.selection.slideId ||
        prev.objectId !== ui.selection.objectId ||
        ui.readOnly
      ) ? null : prev
    ));
  }, [ui.editor, ui.source, ui.selection.slideId, ui.selection.objectId, ui.readOnly]);
  function cancel() {
    const active = gesture.current;
    gesture.current = null;
    setPreview(null);
    if (active?.target.hasPointerCapture?.(active.pointerId)) active.target.releasePointerCapture(active.pointerId);
  }
  useEffect(() => {
    cancel();
    return () => {
      const active = gesture.current;
      gesture.current = null;
      if (active?.target.hasPointerCapture?.(active.pointerId)) active.target.releasePointerCapture(active.pointerId);
    };
  }, [ui.editor, ui.source, ui.selection.slideId, ui.readOnly]);
  useEffect(() => {
    const onBlur = () => cancel();
    window.addEventListener('blur', onBlur);
    return () => window.removeEventListener('blur', onBlur);
  }, []);
  function start(event, object, resize = false) {
    event.stopPropagation();
    event.currentTarget.closest('[aria-label="Slide canvas"]')?.focus();
    ui.selectObject(object.id);
    if (event.button !== 0 || !ui.can('object-geometry') || !geometryEligible(object) || (resize && !pointerResizeEligible(object))) return;
    const svg = event.currentTarget.ownerSVGElement,
      width = svg.getBoundingClientRect().width;
    if (!(width > 0)) return;
    const target = event.currentTarget;
    target.setPointerCapture?.(event.pointerId);
    gesture.current = {
      id: object.id,
      slideId: ui.selection.slideId,
      editor: ui.editor,
      source: ui.source,
      revision: ui.snapshot.revision,
      geometry: {
        ...object.geometry
      },
      x: event.clientX,
      y: event.clientY,
      scale: ui.snapshot.document.size.width / width,
      resize,
      target,
      pointerId: event.pointerId
    };
    event.preventDefault();
  }
  function move(event) {
    const g = gesture.current;
    if (!g || event.pointerId !== g.pointerId) return;
    const dx = Math.round((event.clientX - g.x) * g.scale),
      dy = Math.round((event.clientY - g.y) * g.scale);
    const geometry = g.resize ? {
      ...g.geometry,
      width: Math.max(PT, g.geometry.width + dx),
      height: Math.max(PT, g.geometry.height + dy)
    } : {
      ...g.geometry,
      x: g.geometry.x + dx,
      y: g.geometry.y + dy
    };
    g.next = geometry;
    setPreview({
      id: g.id,
      geometry
    });
  }
  function finish(event) {
    const g = gesture.current;
    if (!g || event.pointerId !== g.pointerId) return;
    if (g.next && g.editor === ui.editor && g.source === ui.source) ui.setGeometry(g.next, g.revision, g.id, g.slideId);
    cancel();
  }
  function keyboard(event) {
    if (event.target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"])')) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      event.shiftKey ? ui.redo() : ui.undo();
      return;
    }
    if (event.key === 'Escape') {
      cancel();
      ui.selectObject(null);
      return;
    }
    if (['Delete', 'Backspace'].includes(event.key) && ui.selectedObject) {
      event.preventDefault();
      ui.removeObject();
      return;
    }
    const direction = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1]
    }[event.key];
    if (direction && geometryEligible(ui.selectedObject) && ui.can('object-geometry')) {
      event.preventDefault();
      const g = ui.selectedObject.geometry,
        step = PT * (event.shiftKey ? 10 : 1);
      ui.setGeometry({
        ...g,
        x: g.x + direction[0] * step,
        y: g.y + direction[1] * step
      });
    }
  }
  return <section ref={ui.canvasRef} aria-label="Slide canvas" tabIndex="0" className={`stagecraft-presentation-canvas ${className}`} style={style} onKeyDown={keyboard} onPointerMove={move} onPointerUp={finish} onPointerCancel={cancel} onLostPointerCapture={cancel}>
    {!ui.canonical ? <p role="alert">PresentationEditor requires a canonical v1 document (schemaVersion 1, emu units).</p> : ui.activeSlide ? <div className="stagecraft-presentation-paper" style={{
      width: `${960 * ui.zoom / 100}px`,
      ...(slideBackground(ui.activeSlide) ? { background: slideBackground(ui.activeSlide) } : {})
    }}><Artwork slide={ui.activeSlide} size={ui.snapshot.document.size} selectedId={ui.selection.objectId} preview={preview} editorCtx={ui} inlineEdit={inlineEdit} onStartInlineEdit={ui.can('existing-run-text') ? startInlineEdit : undefined} onInlineDraftChange={draft => setInlineEdit(prev => (prev ? { ...prev, draft } : prev))} onInlineCommit={commitInlineEdit} onInlineCancel={cancelInlineEdit} onSelect={ui.selectObject} onPointerDown={start} onResize={ui.can('object-geometry') ? (event, object) => start(event, object, true) : undefined} /></div> : <p>No slides. Add a slide to begin.</p>}
    {ui.source && <p className="stagecraft-presentation-notice">Simplified preview: native themes, masters, assets and group transforms may not be shown. This is not an Office fidelity preview.</p>}
    {ui.error && <p role="alert">{ui.error}</p>}{ui.exportedRevision !== null && <p role="status">Exported revision {ui.exportedRevision}</p>}
  </section>;
}
function GeometryField({
  name,
  value,
  disabled,
  commit
}) {
  const shown = String(value / PT),
    [draft, setDraft] = useState(shown);
  useEffect(() => setDraft(shown), [shown, disabled]);
  return <label>{name} (pt)<input aria-label={`${name} (pt)`} type="number" step="0.1" disabled={disabled} value={draft} onChange={event => setDraft(event.target.value)} onBlur={() => {
      if (draft !== shown) commit(draft.trim() === '' ? NaN : Math.round(Number(draft) * PT));
      setDraft(shown);
    }} onKeyDown={event => {
      if (event.key === 'Enter') event.currentTarget.blur();
    }} /></label>;
}
function SlidePropertiesFields({ slide, editor, source, disabled, onCommit }) {
  const shownName = slide.name ?? '';
  const [nameDraft, setNameDraft] = useState(shownName);
  useEffect(() => setNameDraft(shownName), [editor, source, slide.id, shownName, disabled]);
  const bg = slideBackground(slide) ?? '#ffffff';
  return (
    <fieldset className="stagecraft-presentation-slide-props">
      <legend>Slide properties</legend>
      <label>
        Slide name
        <input
          aria-label="Slide name"
          type="text"
          disabled={disabled}
          value={nameDraft}
          onChange={event => setNameDraft(event.target.value)}
          onBlur={() => {
            if (nameDraft !== shownName) onCommit({ name: nameDraft });
          }}
          onKeyDown={event => {
            if (event.key === 'Enter') event.currentTarget.blur();
          }}
        />
      </label>
      <label>
        Slide background
        <input
          aria-label="Slide background"
          type="color"
          disabled={disabled}
          value={bg}
          onChange={event => onCommit({ background: { type: 'solid', color: event.target.value } })}
        />
      </label>
      {slide.background && (
        <button type="button" disabled={disabled} onClick={() => onCommit({ background: null })}>
          Clear background
        </button>
      )}
    </fieldset>
  );
}

function createAuthoredRun(text = 'Text') {
  return {
    id: uuid(),
    text,
    editable: true,
    style: { sz: '2400' },
    extensions: { stagecraftAuthored: true },
  };
}

function createAuthoredParagraph(text = 'Paragraph') {
  return {
    id: uuid(),
    runs: [createAuthoredRun(text)],
  };
}

export function NotesPanel({
  className = '',
  style,
}) {
  const ui = usePresentationEditor();
  const slide = ui.activeSlide;
  const shown = slide?.notes ?? '';
  const [draft, setDraft] = useState(shown);
  const skipNextBlurRef = useRef(false);
  const canEdit = ui.can('slide-properties');
  useEffect(() => {
    skipNextBlurRef.current = false;
    setDraft(shown);
  }, [ui.editor, ui.source, slide?.id, shown, canEdit]);
  function commit() {
    if (slide && canEdit && draft !== shown) {
      ui.setSlideProperties({ notes: draft }, slide.id);
    }
  }
  return (
    <section aria-label="Speaker notes" className={`stagecraft-presentation-notes ${className}`} style={style}>
      {!slide ? (
        <p>No active slide.</p>
      ) : (
        <label>
          Speaker notes
          <textarea
            aria-label="Speaker notes"
            value={draft}
            readOnly={!canEdit}
            onChange={event => setDraft(event.target.value)}
            onBlur={() => {
              if (skipNextBlurRef.current) {
                skipNextBlurRef.current = false;
                return;
              }
              commit();
            }}
            onKeyDown={event => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                commit();
                skipNextBlurRef.current = true;
                event.currentTarget.blur();
              }
            }}
          />
        </label>
      )}
    </section>
  );
}

function validateChartDraft(draft, reportError) {
  if (!draft || !['bar', 'line', 'pie'].includes(draft.kind)) {
    reportError(new Error('Chart kind must be bar, line, or pie.'));
    return null;
  }
  if (!Array.isArray(draft.categories) || draft.categories.length < 1 || draft.categories.length > 100) {
    reportError(new Error('Chart must have 1 to 100 categories.'));
    return null;
  }
  const categories = draft.categories.map(c => String(c));
  if (categories.some(c => c.length > 1000)) {
    reportError(new Error('Chart category names must be at most 1000 characters.'));
    return null;
  }
  if (!Array.isArray(draft.series) || draft.series.length < 1 || draft.series.length > 20) {
    reportError(new Error('Chart must have 1 to 20 series.'));
    return null;
  }
  if (draft.kind === 'pie' && draft.series.length !== 1) {
    reportError(new Error('Pie charts support exactly 1 series.'));
    return null;
  }
  const series = [];
  for (const s of draft.series) {
    const name = String(s?.name ?? '');
    if (name.length > 1000) {
      reportError(new Error('Chart series names must be at most 1000 characters.'));
      return null;
    }
    const rawValues = Array.isArray(s?.values) ? s.values : [];
    if (rawValues.length !== categories.length) {
      reportError(new Error('Chart series values must match category count.'));
      return null;
    }
    const values = rawValues.map(v => Number(v));
    if (values.some(v => !Number.isFinite(v))) {
      reportError(new Error('Chart values must be finite numbers.'));
      return null;
    }
    if (draft.kind === 'pie' && values.some(v => v < 0)) {
      reportError(new Error('Pie chart values must be non-negative.'));
      return null;
    }
    series.push({ name, values });
  }
  return { kind: draft.kind, categories, series };
}

function chartDraft(chart) {
  return {
    kind: chart?.kind ?? 'bar',
    categories: [...(chart?.categories ?? ['Q1'])],
    series: (chart?.series ?? [{ name: 'Series 1', values: [0] }]).map(s => ({
      name: s.name ?? '',
      values: (s.values ?? []).map(v => String(v)),
    })),
  };
}

function ChartPropertiesFields({ object, editor, source, canEdit, onCommit, onError }) {
  const isAuthored = authored(object);
  const chart = object.chart;
  const [draft, setDraft] = useState(() => chartDraft(chart));

  useEffect(() => {
    setDraft(chartDraft(chart));
  }, [editor, source, object.id, chart, canEdit]);

  if (!isAuthored) {
    return (
      <fieldset className="stagecraft-presentation-chart-readonly">
        <legend>Chart (read-only)</legend>
        <p>Kind: {chart.kind}</p>
        <p>Categories: {(chart.categories ?? []).join(', ')}</p>
        {(chart.series ?? []).map((s, idx) => (
          <p key={idx}>{s.name}: {(s.values ?? []).join(', ')}</p>
        ))}
      </fieldset>
    );
  }

  function tryCommit(nextDraft) {
    const validated = validateChartDraft(nextDraft, onError);
    if (validated) onCommit(validated);
  }

  return (
    <fieldset className="stagecraft-presentation-chart-editor">
      <legend>Chart</legend>
      <label>
        Chart kind
        <select
          aria-label="Chart kind"
          value={draft.kind}
          disabled={!canEdit}
          onChange={event => {
            const nextKind = event.target.value;
            const nextSeries = nextKind === 'pie'
              ? draft.series.slice(0, 1).map(s => ({
                  ...s,
                  values: s.values.map(v => {
                    const n = Number(v);
                    return Number.isFinite(n) ? String(Math.max(0, n)) : '0';
                  }),
                }))
              : draft.series;
            const nextDraft = { ...draft, kind: nextKind, series: nextSeries };
            setDraft(nextDraft);
            tryCommit(nextDraft);
          }}
        >
          <option value="bar">Bar</option>
          <option value="line">Line</option>
          <option value="pie">Pie</option>
        </select>
      </label>

      <div className="stagecraft-presentation-chart-group">
        <strong>Categories</strong>
        {draft.categories.map((cat, cIdx) => (
          <div key={cIdx} className="stagecraft-presentation-chart-row">
            <input
              aria-label={`Category ${cIdx + 1}`}
              type="text"
              maxLength={1000}
              disabled={!canEdit}
              value={cat}
              onChange={event => {
                const categories = draft.categories.map((c, i) => (i === cIdx ? event.target.value : c));
                setDraft({ ...draft, categories });
              }}
              onBlur={() => tryCommit(draft)}
              onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }}
            />
            <button
              type="button"
              aria-label={`Remove category ${cIdx + 1}`}
              disabled={!canEdit || draft.categories.length <= 1}
              onClick={() => {
                const nextDraft = {
                  ...draft,
                  categories: draft.categories.filter((_, i) => i !== cIdx),
                  series: draft.series.map(s => ({ ...s, values: s.values.filter((_, i) => i !== cIdx) })),
                };
                setDraft(nextDraft);
                tryCommit(nextDraft);
              }}
            >
              Remove
            </button>
          </div>
        ))}
        <button
          type="button"
          disabled={!canEdit || draft.categories.length >= 100}
          onClick={() => {
            const nextDraft = {
              ...draft,
              categories: [...draft.categories, `Category ${draft.categories.length + 1}`],
              series: draft.series.map(s => ({ ...s, values: [...s.values, '0'] })),
            };
            setDraft(nextDraft);
            tryCommit(nextDraft);
          }}
        >
          Add category
        </button>
      </div>

      <div className="stagecraft-presentation-chart-group">
        <strong>Series</strong>
        {draft.series.map((s, sIdx) => (
          <div key={sIdx} className="stagecraft-presentation-chart-series">
            <div className="stagecraft-presentation-chart-row">
              <input
                aria-label={`Series ${sIdx + 1} name`}
                type="text"
                maxLength={1000}
                disabled={!canEdit}
                value={s.name}
                onChange={event => {
                  const series = draft.series.map((item, i) => (i === sIdx ? { ...item, name: event.target.value } : item));
                  setDraft({ ...draft, series });
                }}
                onBlur={() => tryCommit(draft)}
                onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }}
              />
              <button
                type="button"
                aria-label={`Remove series ${sIdx + 1}`}
                disabled={!canEdit || draft.kind === 'pie' || draft.series.length <= 1}
                onClick={() => {
                  const nextDraft = { ...draft, series: draft.series.filter((_, i) => i !== sIdx) };
                  setDraft(nextDraft);
                  tryCommit(nextDraft);
                }}
              >
                Remove series
              </button>
            </div>
            {s.values.map((val, vIdx) => (
              <label key={vIdx}>
                {draft.categories[vIdx] || `Category ${vIdx + 1}`}
                <input
                  aria-label={`Series ${sIdx + 1} value ${vIdx + 1}`}
                  type="number"
                  step="any"
                  disabled={!canEdit}
                  value={val}
                  onChange={event => {
                    const series = draft.series.map((item, i) => (
                      i === sIdx
                        ? { ...item, values: item.values.map((v, j) => (j === vIdx ? event.target.value : v)) }
                        : item
                    ));
                    setDraft({ ...draft, series });
                  }}
                  onBlur={() => tryCommit(draft)}
                  onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }}
                />
              </label>
            ))}
          </div>
        ))}
        <button
          type="button"
          disabled={!canEdit || draft.kind === 'pie' || draft.series.length >= 20}
          onClick={() => {
            const nextDraft = {
              ...draft,
              series: [...draft.series, { name: `Series ${draft.series.length + 1}`, values: draft.categories.map(() => '0') }],
            };
            setDraft(nextDraft);
            tryCommit(nextDraft);
          }}
        >
          Add series
        </button>
      </div>
    </fieldset>
  );
}

const RUN_STYLE_KEYS = { bold: 'b', italic: 'i', fontSize: 'sz', fontFamily: 'typeface', eastAsian: 'eastAsian', complexScript: 'complexScript', color: 'color' };
function applyAuthoredRunFormat(run, format) {
  const nextStyle = { ...(run.style ?? {}) };
  for (const [key, value] of Object.entries(format)) {
    const styleKey = RUN_STYLE_KEYS[key];
    if (!styleKey) continue;
    if (value === null) delete nextStyle[styleKey];
    else if (['fontFamily', 'eastAsian', 'complexScript'].includes(key)) nextStyle[styleKey] = value;
    else if (key === 'color') nextStyle.color = value.toLowerCase();
    else if (key === 'fontSize') nextStyle.sz = String(Math.round(value * 100));
    else nextStyle[styleKey] = value ? '1' : '0';
  }
  return { ...run, style: nextStyle };
}

function bulletValue(bullet) {
  if (!bullet) return '';
  if (bullet.type === 'none') return 'none';
  if (bullet.type === 'char') return `char:${bullet.char}`;
  if (bullet.type === 'number') return `number:${bullet.format}`;
  return '';
}

function parseBulletValue(value) {
  if (!value) return null;
  if (value === 'none') return { type: 'none' };
  if (value.startsWith('char:')) return { type: 'char', char: value.slice(5) };
  if (value.startsWith('number:')) return { type: 'number', format: value.slice(7) };
  return null;
}

// Numeric paragraph fields. `emu` fields are edited in points and stored as EMU; limits come
// from core's isParagraphFormatValue so the UI and the command gate cannot drift.
const PARAGRAPH_NUMBER_FIELDS = [
  { key: 'spaceBefore', label: 'Space before (pt)', aria: 'space before', min: '0', max: '1000', step: '0.01', error: 'Space before must be 0..1000 pt.' },
  { key: 'spaceAfter', label: 'Space after (pt)', aria: 'space after', min: '0', max: '1000', step: '0.01', error: 'Space after must be 0..1000 pt.' },
  { key: 'lineSpacing', label: 'Line spacing (%)', aria: 'line spacing', min: '50', max: '500', step: '1', error: 'Line spacing must be an integer 50..500%.' },
  { key: 'level', label: 'Level', aria: 'level', min: '0', max: '8', step: '1', error: 'Level must be an integer 0..8.' },
  { key: 'indentStart', label: 'Indent start (pt)', aria: 'indentStart', step: '0.1', emu: true, error: 'indentStart must be within -10000000..10000000 EMU.' },
  { key: 'indentEnd', label: 'Indent end (pt)', aria: 'indentEnd', step: '0.1', emu: true, error: 'indentEnd must be within -10000000..10000000 EMU.' },
  { key: 'firstLineIndent', label: 'First line indent (pt)', aria: 'firstLineIndent', step: '0.1', emu: true, error: 'firstLineIndent must be within -10000000..10000000 EMU.' },
];
const paragraphDraft = (field, style) => (field.emu ? emuToPt(style[field.key]) : style[field.key] === undefined ? '' : String(style[field.key]));
const paragraphDrafts = style => Object.fromEntries(PARAGRAPH_NUMBER_FIELDS.map(field => [field.key, paragraphDraft(field, style)]));

const BULLET_OPTIONS = [
  ['', 'Reset / Inherit'],
  ['none', 'None (disable)'],
  ['char:•', 'Bullet (•)'],
  ['number:arabicPeriod', '1. 2. 3.'],
  ['number:arabicParenR', '1) 2) 3)'],
  ['number:lowerAlphaPeriod', 'a. b. c.'],
  ['number:upperAlphaPeriod', 'A. B. C.'],
  ['number:lowerRomanPeriod', 'i. ii. iii.'],
  ['number:upperRomanPeriod', 'I. II. III.'],
];

function ParagraphFormatFields({ paragraph, index, editor, source, revision, disabled, isOdpNative = false, isReadOnlyNative = isOdpNative, isOdpDoc, onCommit, onError }) {
  const s = paragraph.style ?? {};
  const [drafts, setDrafts] = useState(() => paragraphDrafts(s));
  const startRevRef = useRef(revision);

  useEffect(() => {
    startRevRef.current = revision;
    setDrafts(paragraphDrafts(s));
  }, [editor, source, paragraph.id, revision, s.spaceBefore, s.spaceAfter, s.lineSpacing, s.level, s.indentStart, s.indentEnd, s.firstLineIndent, disabled]);

  const effectiveDisabled = disabled || isReadOnlyNative;
  const captureRev = () => { startRevRef.current = revision; };
  const commit = format => onCommit(format, startRevRef.current);
  const currentBullet = bulletValue(s.bullet);
  const hasKnownBullet = BULLET_OPTIONS.some(([val]) => val === currentBullet);

  function commitField(field) {
    const draft = drafts[field.key];
    const orig = paragraphDraft(field, s);
    if (draft === orig) return;
    if (draft.trim() === '') { commit({ [field.key]: null }); return; }
    const value = field.emu ? Math.round(Number(draft) * PT) : Number(draft);
    if (!isParagraphFormatValue(field.key, value)) {
      onError(new Error(field.error));
      setDrafts(current => ({ ...current, [field.key]: orig }));
      return;
    }
    commit({ [field.key]: value });
  }

  return (
    <fieldset className="stagecraft-presentation-para-format" disabled={effectiveDisabled}>
      <legend>Paragraph {index + 1} format</legend>
      {isReadOnlyNative && <small>{isOdpNative ? 'Native ODP paragraph formatting is read-only.' : 'Native paragraph formatting is read-only.'}</small>}
      <label>
        Alignment
        <select
          aria-label={`Paragraph ${index + 1} alignment`}
          value={s.alignment ?? ''}
          onChange={e => commit({ alignment: e.target.value || null })}
        >
          <option value="">Reset / Inherit</option>
          <option value="left">Left</option>
          <option value="center">Center</option>
          <option value="right">Right</option>
          <option value="justify">Justify</option>
        </select>
      </label>
      <label>
        Bullet
        <select
          aria-label={`Paragraph ${index + 1} bullet`}
          value={currentBullet}
          onChange={e => {
            const nextBullet = parseBulletValue(e.target.value);
            const clearsOdpLevel = isOdpDoc && (s.level ?? 0) > 0 && (nextBullet === null || nextBullet.type === 'none');
            commit(clearsOdpLevel ? { bullet: nextBullet, level: null } : { bullet: nextBullet });
          }}
        >
          {BULLET_OPTIONS.map(([val, label]) => <option key={val || 'reset'} value={val}>{label}</option>)}
          {currentBullet && !hasKnownBullet && (
            <option value={currentBullet}>
              {s.bullet?.type === 'char'
                ? `Bullet (${s.bullet.char})`
                : s.bullet?.type === 'number'
                  ? `Number (${s.bullet.format})`
                  : currentBullet}
            </option>
          )}
        </select>
      </label>
      {PARAGRAPH_NUMBER_FIELDS.map(field => (
        <label key={field.key}>
          {field.label}
          <input
            aria-label={`Paragraph ${index + 1} ${field.aria}`}
            type="number"
            min={field.min}
            max={field.max}
            step={field.step}
            value={drafts[field.key]}
            onFocus={captureRev}
            onChange={e => { const value = e.target.value; setDrafts(current => ({ ...current, [field.key]: value })); }}
            onBlur={() => commitField(field)}
            onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
          />
        </label>
      ))}
    </fieldset>
  );
}

function TextBodyLayoutFields({ object, editor, source, revision, isOdpDoc, disabled, onCommit, onError }) {
  const layout = object.bodyLayout ?? {};
  const autofitVal = layout.autofit ?? '';
  const ins = layout.insets ?? {};
  const [insets, setInsets] = useState({
    left: emuToPt(ins.left),
    top: emuToPt(ins.top),
    right: emuToPt(ins.right),
    bottom: emuToPt(ins.bottom),
  });
  const startRevRef = useRef(revision);

  useEffect(() => {
    startRevRef.current = revision;
    setInsets({
      left: emuToPt(ins.left),
      top: emuToPt(ins.top),
      right: emuToPt(ins.right),
      bottom: emuToPt(ins.bottom),
    });
  }, [editor, source, object.id, revision, ins.left, ins.top, ins.right, ins.bottom, disabled]);

  return (
    <fieldset className="stagecraft-presentation-body-layout" disabled={disabled}>
      <legend>Text body layout</legend>
      <label>
        Autofit
        <select
          aria-label="Text autofit"
          value={autofitVal}
          onChange={e => onCommit({ autofit: e.target.value || null }, revision)}
        >
          <option value="">Reset / Inherit</option>
          <option value="none">None</option>
          {!isOdpDoc ? <option value="shrink">Shrink text</option> : autofitVal === 'shrink' ? <option value="shrink" disabled>Shrink (unsupported)</option> : null}
          <option value="resize">Resize shape</option>
        </select>
      </label>
      {!isOdpDoc && (autofitVal === 'shrink' || autofitVal === 'resize') ? (
        <small className="stagecraft-autofit-note">
          {autofitVal === 'shrink'
            ? 'PowerPoint applies shrink-to-fit when the text is next edited there. Exports from this editor include a measured fit; files exported elsewhere may overflow when first opened.'
            : 'Exports from this editor size the box to fit, growing from its anchor. The canvas shows the drawn size; files exported elsewhere may overflow until edited in PowerPoint.'}
        </small>
      ) : null}
      {isOdpDoc ? (
        <small>ODP supports autofit (none/resize) only.</small>
      ) : (
        <>
          <label>
            Wrap
            <select
              aria-label="Text wrap"
              value={layout.wrap ?? ''}
              onChange={e => onCommit({ wrap: e.target.value || null }, revision)}
            >
              <option value="">Reset / Inherit</option>
              <option value="square">Square</option>
              <option value="none">None</option>
            </select>
          </label>
          <label>
            Vertical anchor
            <select
              aria-label="Text vertical anchor"
              value={layout.anchor ?? ''}
              onChange={e => onCommit({ anchor: e.target.value || null }, revision)}
            >
              <option value="">Reset / Inherit</option>
              <option value="top">Top</option>
              <option value="middle">Middle</option>
              <option value="bottom">Bottom</option>
            </select>
          </label>
          {['left', 'top', 'right', 'bottom'].map(side => (
            <label key={side}>
              Inset {side} (pt)
              <input
                aria-label={`Text inset ${side}`}
                type="number"
                min="0"
                step="0.1"
                value={insets[side]}
                onFocus={() => { startRevRef.current = revision; }}
                onChange={e => setInsets(prev => ({ ...prev, [side]: e.target.value }))}
                onBlur={() => {
                  const orig = emuToPt(ins[side]);
                  if (insets[side] === orig) return;
                  if (insets[side].trim() === '') { onCommit({ insets: { [side]: null } }, startRevRef.current); return; }
                  const emu = Math.round(Number(insets[side]) * PT);
                  if (!Number.isSafeInteger(emu) || emu < 0 || emu > 10000000) {
                    onError(new Error(`Inset ${side} must be 0..10000000 EMU.`));
                    setInsets(prev => ({ ...prev, [side]: orig }));
                    return;
                  }
                  onCommit({ insets: { [side]: emu } }, startRevRef.current);
                }}
                onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
              />
            </label>
          ))}
        </>
      )}
      <small>Autofit settings are saved for export; canvas preview does not measure or shrink text.</small>
    </fieldset>
  );
}

function inspectRangeFontSlot(paragraphs, range, styleKey) {
  if (!range) return { mixed: false, value: '' };
  const values = new Set();
  const startP = paragraphs.findIndex(p => p.id === range.start.paragraphId);
  const endP = paragraphs.findIndex(p => p.id === range.end.paragraphId);
  if (startP === -1 || endP === -1) return { mixed: false, value: '' };
  for (let pi = startP; pi <= endP; pi++) {
    const runs = paragraphs[pi].runs ?? [];
    const startR = pi === startP ? runs.findIndex(r => r.id === range.start.runId) : 0;
    const endR = pi === endP ? runs.findIndex(r => r.id === range.end.runId) : runs.length - 1;
    if (startR === -1 || endR === -1) continue;
    for (let ri = startR; ri <= endR; ri++) {
      const run = runs[ri];
      const len = [...(run.text ?? '')].length;
      const from = pi === startP && ri === startR ? range.start.offset : 0;
      const to = pi === endP && ri === endR ? range.end.offset : len;
      if (Math.min(to, len) > Math.max(from, 0)) values.add(typeof run.style?.[styleKey] === 'string' ? run.style[styleKey] : '');
    }
  }
  if (values.size === 0) return { mixed: false, value: '' };
  if (values.size > 1) return { mixed: true, value: '' };
  return { mixed: false, value: [...values][0] };
}

function CrossRunRangeFormatFields({ object, editor, source, slideId, revision, disabled, onApply }) {
  const paragraphs = object.text?.paragraphs ?? [];
  const fullText = paragraphs.map(p => (p.runs ?? []).map(r => r.text ?? '').join('')).join('\n');
  const [rangeState, setRangeState] = useState(null);
  const [rangeSize, setRangeSize] = useState('');
  const [rangeFont, setRangeFont] = useState('');
  const [rangeEastAsian, setRangeEastAsian] = useState('');
  const [rangeComplexScript, setRangeComplexScript] = useState('');
  const [rangeColor, setRangeColor] = useState('#000000');
  const textareaRef = useRef(null);
  const ownerRef = useRef({ editor, source, slideId, objectId: object.id, disabled, fullText });
  const activeSelectionRef = useRef(false);

  function mapSelection(selStart, selEnd, rev) {
    const mapped = mapDisplaySelectionToCanonicalRange(paragraphs, selStart, selEnd);
    const span = mapped ? canonicalRangeCodePointSpan(paragraphs, mapped) : null;
    return mapped && span ? { range: mapped, startCp: span.startCp, endCp: span.endCp, startRevision: rev } : null;
  }

  useEffect(() => {
    const prev = ownerRef.current;
    const ownerChanged = prev.editor !== editor
      || prev.source !== source
      || prev.slideId !== slideId
      || prev.objectId !== object.id
      || prev.disabled !== disabled
      || disabled;
    const textChanged = prev.fullText !== fullText;
    ownerRef.current = { editor, source, slideId, objectId: object.id, disabled, fullText };
    setRangeSize('');
    setRangeFont('');
    if (ownerChanged || textChanged) {
      activeSelectionRef.current = false;
      if (textareaRef.current) {
        textareaRef.current.selectionStart = 0;
        textareaRef.current.selectionEnd = 0;
      }
      setRangeState(null);
      setRangeColor('#000000');
      setRangeEastAsian('');
      setRangeComplexScript('');
      return;
    }
    if (!activeSelectionRef.current) {
      setRangeState(null);
      setRangeEastAsian('');
      setRangeComplexScript('');
      return;
    }
    const el = textareaRef.current;
    const remapped = el ? mapSelection(el.selectionStart ?? 0, el.selectionEnd ?? 0, revision) : null;
    activeSelectionRef.current = Boolean(remapped);
    setRangeState(remapped);
    setRangeEastAsian(inspectRangeFontSlot(paragraphs, remapped?.range, 'eastAsian').value);
    setRangeComplexScript(inspectRangeFontSlot(paragraphs, remapped?.range, 'complexScript').value);
  }, [editor, source, slideId, object.id, object.text, fullText, revision, disabled]);

  function handleSelect(event) {
    if (disabled) return;
    const el = event.currentTarget;
    const next = mapSelection(el.selectionStart ?? 0, el.selectionEnd ?? 0, revision);
    activeSelectionRef.current = Boolean(next);
    setRangeState(next);
    setRangeColor('#000000');
    setRangeEastAsian(inspectRangeFontSlot(paragraphs, next?.range, 'eastAsian').value);
    setRangeComplexScript(inspectRangeFontSlot(paragraphs, next?.range, 'complexScript').value);
  }

  const eaInfo = inspectRangeFontSlot(paragraphs, rangeState?.range, 'eastAsian');
  const csInfo = inspectRangeFontSlot(paragraphs, rangeState?.range, 'complexScript');

  const hasRange = Boolean(rangeState?.range) && !disabled;
  const applyRange = format => onApply(rangeState.range, format, rangeState.startRevision);

  return (
    <fieldset className="stagecraft-presentation-range-format" disabled={disabled}>
      <legend>Format selection range</legend>
      <label>
        Select text range
        <textarea
          ref={textareaRef}
          aria-label="Select text range"
          readOnly
          value={fullText}
          onSelect={handleSelect}
        />
      </label>
      <small>
        {rangeState?.range
          ? `Selected code points ${rangeState.startCp}–${rangeState.endCp}`
          : 'Select a range above to format across runs.'}
      </small>
      <div className="stagecraft-presentation-range-actions">
        <button type="button" aria-label="Range bold" disabled={!hasRange} onClick={() => applyRange({ bold: true })}>Bold</button>
        <button type="button" aria-label="Range unbold" disabled={!hasRange} onClick={() => applyRange({ bold: false })}>Unbold</button>
        <button type="button" aria-label="Range reset bold" disabled={!hasRange} onClick={() => applyRange({ bold: null })}>Reset bold</button>
        <button type="button" aria-label="Range italic" disabled={!hasRange} onClick={() => applyRange({ italic: true })}>Italic</button>
        <button type="button" aria-label="Range unitalic" disabled={!hasRange} onClick={() => applyRange({ italic: false })}>Unitalic</button>
        <button type="button" aria-label="Range reset italic" disabled={!hasRange} onClick={() => applyRange({ italic: null })}>Reset italic</button>
        <label>
          Range size (pt)
          <input
            aria-label="Range font size"
            type="number"
            min="1"
            max="4000"
            step="0.01"
            disabled={!hasRange}
            value={rangeSize}
            onChange={e => setRangeSize(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && hasRange && rangeSize.trim() !== '') {
                applyRange({ fontSize: Number(rangeSize) });
              }
            }}
          />
        </label>
        <label>
          Range font
          <input
            aria-label="Range font family"
            type="text"
            maxLength={64}
            disabled={!hasRange}
            value={rangeFont}
            onChange={e => setRangeFont(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && hasRange) {
                const t = rangeFont.trim();
                applyRange({ fontFamily: t === '' ? null : t });
              }
            }}
          />
        </label>
        <label>
          Range color
          <input
            aria-label="Range color"
            type="color"
            disabled={!hasRange}
            value={rangeColor}
            onChange={e => setRangeColor(e.target.value.toLowerCase())}
          />
        </label>
        <button
          type="button"
          aria-label="Range apply colour"
          disabled={!hasRange}
          onClick={() => applyRange({ color: rangeColor.toLowerCase() })}
        >
          Apply colour
        </button>
      </div>
      <details className="stagecraft-font-details">
        <summary>Font details</summary>
        {[
          ['eastAsian', 'East Asian text font', eaInfo, rangeEastAsian, setRangeEastAsian],
          ['complexScript', 'Complex script font', csInfo, rangeComplexScript, setRangeComplexScript],
        ].map(([slot, label, info, draft, setDraft]) => (
          <div key={slot} className="stagecraft-font-slot">
            <label>
              Range {label}
              <input
                aria-label={`Range ${label}`}
                type="text"
                maxLength={64}
                disabled={!hasRange}
                placeholder={info.mixed ? 'Mixed' : undefined}
                value={draft}
                onChange={e => setDraft(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && hasRange) {
                    const t = draft.trim();
                    if (t !== '' && (info.mixed || t !== info.value)) applyRange({ [slot]: t });
                  }
                }}
              />
            </label>
            <button
              type="button"
              aria-label={`Range reset ${label}`}
              disabled={!hasRange}
              onClick={() => applyRange({ [slot]: null })}
            >
              Reset
            </button>
            {!info.mixed && info.value.startsWith('+') && <small className="stagecraft-font-token">{formatFontSlotDisplay(info.value)}</small>}
          </div>
        ))}
      </details>
      <small>Range font sets Latin text; use Font details for East Asian and complex-script text.</small>
    </fieldset>
  );
}


export function AttributePanel({
  className = '',
  style
}) {
  const ui = usePresentationEditor(),
    object = ui.selectedObject,
    eligible = geometryEligible(object),
    isAuthoredText = authored(object) && ['text', 'shape'].includes(object?.type) && Array.isArray(object.text?.paragraphs),
    paragraphs = isAuthoredText ? object.text.paragraphs : [],
    runs = ['text', 'shape'].includes(object?.type) ? (object.text?.paragraphs ?? []).flatMap(p => p.runs) : [],
    canRichText = isAuthoredText && ui.can('object-text'),
    canSlideProps = ui.can('slide-properties'),
    canFill = (authored(object) || object?.extensions?.editableFill === true) && object?.type === 'shape' && ['rect', 'ellipse'].includes(object.shape),
    isOdpDoc = (object?.source?.format ?? ui.snapshot.document?.extensions?.sourceFormat) === 'odp',
    hasTextBody = ['text', 'shape'].includes(object?.type) && !!object?.text,
    canBodyLayout = hasTextBody && ui.can('text-body-layout'),
    canParaFormat = ui.can('paragraph-format'),
    canRangeFormat = isAuthoredText && ui.can('run-range-format'),
    reportPredicateError = usePluginErrorReporter(ui.reportError),
    pluginSections = collectInspectorSections(ui.plugins ?? [], ui, reportPredicateError);

  let runCounter = 0;

  return <aside aria-label="Attribute panel" className={`stagecraft-presentation-attributes ${className}`} style={style}>
    {!object ? <p>Select an object to inspect its properties.</p> : <>
      <h2>Object properties</h2>
      <p>{object.type}</p>
      {object.geometry && <fieldset><legend>Geometry</legend>{[['x', 'X'], ['y', 'Y'], ['width', 'Width'], ['height', 'Height']].map(([key, name]) => <GeometryField key={`${object.id}-${key}`} name={name} value={object.geometry[key]} disabled={!eligible || !ui.can('object-geometry')} commit={value => {
          if (!Number.isSafeInteger(value) || ['width', 'height'].includes(key) && value <= 0) {
            ui.reportError(new Error('Geometry must be finite with positive sizes and fit within safe integer EMU coordinates.'));
            return;
          }
          ui.setGeometry({
            ...object.geometry,
            [key]: value
          });
        }} />)}</fieldset>}
      {!eligible && <small>Native geometry is read only for this object.</small>}
      {canFill && <label>Fill<input aria-label="Fill" type="color" value={HEX_COLOR.test(object.fill ?? '') ? object.fill : '#4472c4'} disabled={!ui.can('object-style')} onChange={event => ui.setPaint(event.target.value)} /></label>}
      {object.type === 'table' && object.table && (
        <fieldset className="stagecraft-presentation-table-editor">
          <legend>Table cells</legend>
          {object.table.rows.map((row, rIdx) => row.cells.map((cell, cIdx) => {
            const cellParagraphs = cell.text?.paragraphs ?? [];
            const canCellEdit = authored(object) && ui.can('object-table') && ui.hasCommand('presentation.setTableCell');
            return (
              <div key={cell.id} className="stagecraft-presentation-table-cell">
                <small>Row {rIdx + 1}, Column {cIdx + 1}</small>
                {cellParagraphs.map(p => p.runs.map((run, idx) => {
                  const cellFormatDisabled = canCellEdit ? run.editable === false : (!ui.can('existing-run-format') || run.editable === false);
                  return (
                  <div key={run.id}>
                    <label>
                      Cell text {rIdx + 1}.{cIdx + 1}
                      <textarea
                        aria-label={`Cell ${rIdx + 1}.${cIdx + 1} run ${idx + 1}`}
                        value={run.text}
                        readOnly={!canCellEdit && (!ui.can('existing-run-text') || run.editable === false)}
                        onChange={event => {
                          if (canCellEdit) {
                            const nextText = event.target.value;
                            ui.setTableCell(
                              cell.id,
                              cellParagraphs.map(cp => (
                                cp.id === p.id
                                  ? { ...cp, runs: cp.runs.map(cr => (cr.id === run.id ? { ...cr, text: nextText } : cr)) }
                                  : cp
                              )),
                              object.id,
                              ui.activeSlide.id,
                            );
                          } else if (run.editable !== false) {
                            ui.setRunText(run.id, event.target.value);
                          }
                        }}
                      />
                    </label>
                    <RunFormatControls
                      key={`${run.id}-${!cellFormatDisabled}-${run.editable}`}
                      run={run}
                      index={idx}
                      editor={ui.editor}
                      source={ui.source}
                      revision={ui.snapshot.revision}
                      disabled={cellFormatDisabled}
                      onFormat={(format, rev) => (
                        canCellEdit
                          ? ui.setTableCell(
                              cell.id,
                              cellParagraphs.map(cp => (
                                cp.id === p.id
                                  ? { ...cp, runs: cp.runs.map(cr => (cr.id === run.id ? applyAuthoredRunFormat(cr, format) : cr)) }
                                  : cp
                              )),
                              object.id,
                              ui.activeSlide.id,
                              rev,
                            )
                          : ui.setRunFormat(run.id, format, rev)
                      )}
                    />
                  </div>
                  );
                }))}
              </div>
            );
          }))}
        </fieldset>
      )}
      {object.type === 'image' && object.image && (
        <div className="stagecraft-presentation-image-meta">
          <small>Asset: {object.image.assetId}</small>
          {object.image.alt && <small>Alt: {object.image.alt}</small>}
        </div>
      )}
      {object.type === 'chart' && object.chart && (
        <ChartPropertiesFields
          object={object}
          editor={ui.editor}
          source={ui.source}
          canEdit={ui.can('object-chart') && ui.hasCommand('presentation.setChart')}
          onCommit={chart => ui.setChart(chart, object.id, ui.activeSlide.id)}
          onError={ui.reportError}
        />
      )}
      {hasTextBody && ui.hasCommand('document.setTextBodyLayout') && (
        <TextBodyLayoutFields
          object={object}
          editor={ui.editor}
          source={ui.source}
          revision={ui.snapshot.revision}
          isOdpDoc={isOdpDoc}
          disabled={!canBodyLayout}
          onCommit={(layout, rev) => ui.setTextBodyLayout(object.id, layout, rev)}
          onError={ui.reportError}
        />
      )}
      {isAuthoredText && ui.hasCommand('document.setRunRangeFormat') && (
        <CrossRunRangeFormatFields
          object={object}
          editor={ui.editor}
          source={ui.source}
          slideId={ui.activeSlide?.id}
          revision={ui.snapshot.revision}
          disabled={!canRangeFormat}
          onApply={(range, format, rev) => ui.setRunRangeFormat(object.id, range, format, rev)}
        />
      )}
      {isAuthoredText ? (
        <fieldset className="stagecraft-presentation-paragraphs">
          <legend>Text paragraphs</legend>
          {paragraphs.map((paragraph, pIndex) => (
            <div key={paragraph.id} className="stagecraft-presentation-paragraph">
              <div className="stagecraft-presentation-paragraph-head">
                <span>Paragraph {pIndex + 1}</span>
              {ui.hasCommand('presentation.setText') && (
                  <button
                    type="button"
                    aria-label={`Remove paragraph ${pIndex + 1}`}
                    disabled={!canRichText || paragraphs.length <= 1}
                    onClick={() => ui.setText(paragraphs.filter(p => p.id !== paragraph.id))}
                  >
                    Remove paragraph
                  </button>
                )}
              </div>
              {paragraph.runs.map(run => {
                const idx = runCounter++;
                return (
                  <div key={run.id} className="stagecraft-presentation-run">
                    <label>
                      Text run {idx + 1}
                      <textarea
                        aria-label={`Text run ${idx + 1}`}
                        value={run.text}
                        readOnly={!ui.can('existing-run-text') || run.editable === false}
                        onChange={event => {
                          if (run.editable !== false) ui.setRunText(run.id, event.target.value);
                        }}
                      />
                    </label>
                    <RunFormatControls
                      key={`${run.id}-${ui.can('existing-run-format')}-${run.editable}`}
                      run={run}
                      index={idx}
                      editor={ui.editor}
                      source={ui.source}
                      revision={ui.snapshot.revision}
                      disabled={!ui.can('existing-run-format') || run.editable === false}
                      onFormat={(format, rev) => ui.setRunFormat(run.id, format, rev)}
                    />
              {ui.hasCommand('presentation.setText') && (
                      <button
                        type="button"
                        aria-label={`Remove run ${idx + 1}`}
                        disabled={!canRichText || paragraph.runs.length <= 1}
                        onClick={() => ui.setText(paragraphs.map(p => (
                          p.id === paragraph.id
                            ? { ...p, runs: p.runs.filter(r => r.id !== run.id) }
                            : p
                        )))}
                      >
                        Remove run
                      </button>
                    )}
                  </div>
                );
              })}
              {ui.hasCommand('document.setParagraphFormat') && (
                <ParagraphFormatFields
                  paragraph={paragraph}
                  index={pIndex}
                  editor={ui.editor}
                  source={ui.source}
                  revision={ui.snapshot.revision}
                  disabled={!canParaFormat}
                  isOdpDoc={isOdpDoc}
                  onCommit={(format, rev) => ui.setParagraphFormat(paragraph.id, format, rev)}
                  onError={ui.reportError}
                />
              )}
              {ui.hasCommand('presentation.setText') && (
                <button
                  type="button"
                  aria-label={`Add run to paragraph ${pIndex + 1}`}
                  disabled={!canRichText}
                  onClick={() => ui.setText(paragraphs.map(p => (
                    p.id === paragraph.id
                      ? { ...p, runs: [...p.runs, createAuthoredRun()] }
                      : p
                  )))}
                >
                  Add run
                </button>
              )}
            </div>
          ))}
          {ui.hasCommand('presentation.setText') && (
            <button
              type="button"
              disabled={!canRichText}
              onClick={() => ui.setText([...paragraphs, createAuthoredParagraph()])}
            >
              Add paragraph
            </button>
          )}
        </fieldset>
      ) : (
        (object.text?.paragraphs ?? []).map((paragraph, pIndex) => (
          <div key={paragraph.id} className="stagecraft-presentation-native-paragraph">
            {ui.hasCommand('document.setParagraphFormat') && (
              <ParagraphFormatFields
                paragraph={paragraph}
                index={pIndex}
                editor={ui.editor}
                source={ui.source}
                revision={ui.snapshot.revision}
                disabled={!canParaFormat}
                isOdpNative={paragraph.source?.format === 'odp' || isOdpDoc}
                isReadOnlyNative={paragraph.extensions?.stagecraftAuthored !== true && paragraph.source?.format !== 'pptx'}
                isOdpDoc={isOdpDoc}
                onCommit={(format, rev) => ui.setParagraphFormat(paragraph.id, format, rev)}
                onError={ui.reportError}
              />
            )}
            {paragraph.runs.map(run => {
              const index = runCounter++;
              return (
                <div key={run.id}>
                  <label>
                    Text run {index + 1}
                    <textarea
                      aria-label={`Text run ${index + 1}`}
                      value={run.text}
                      readOnly={!ui.can('existing-run-text') || run.editable === false}
                      onChange={event => {
                        if (run.editable !== false) ui.setRunText(run.id, event.target.value);
                      }}
                    />
                  </label>
                  {(authored(run) || ['pptx', 'odp'].includes(run.source?.format)) && (
                    <RunFormatControls
                      key={`${run.id}-${ui.can('existing-run-format')}-${run.editable}`}
                      run={run}
                      index={index}
                      editor={ui.editor}
                      source={ui.source}
                      revision={ui.snapshot.revision}
                      disabled={!ui.can('existing-run-format') || run.editable === false}
                      onFormat={(format, rev) => ui.setRunFormat(run.id, format, rev)}
                    />
                  )}
                </div>
              );
            })}
          </div>
        ))
      )}
    </>}
    {ui.activeSlide && ui.hasCommand('presentation.setSlideProperties') && (
      <SlidePropertiesFields
        slide={ui.activeSlide}
        editor={ui.editor}
        source={ui.source}
        disabled={!canSlideProps}
        onCommit={props => ui.setSlideProperties(props, ui.activeSlide.id)}
      />
    )}
    {pluginSections.map(({ pluginId, section }) => (
      <PluginErrorBoundary
        key={`${pluginId}:${section.id}`}
        resetKey={`${pluginId}:${section.id}:${ui.selection.slideId}:${ui.selection.objectId}`}
        resetIdentity={section.render}
        onError={ui.reportError}
      >
        <section className="stagecraft-presentation-plugin-section" aria-label={section.title}>
          <h3>{section.title}</h3>
          <PluginRenderSlot render={section.render} arg={ui} />
        </section>
      </PluginErrorBoundary>
    ))}
  </aside>;
}

export function PresentationEditor({
  showToolbar = true,
  showSlideList = true,
  showAttributePanel = true,
  showNotesPanel = true,
  showDeckList = false,
  decks = [],
  activeDeckId,
  onDeckSelect,
  renderToolbar,
  className = '',
  style,
  ...providerProps
}) {
  return <PresentationEditorProvider {...providerProps}><section aria-label="Presentation editor" className={`stagecraft-presentation ${className}`} style={style}>{showToolbar && (renderToolbar ? renderToolbar() : <PresentationToolbar />)}<div className="stagecraft-presentation-workspace">{showDeckList && <DeckList items={decks} activeId={activeDeckId} onSelect={onDeckSelect} />} {showSlideList && <SlideList />}<PresentationCanvas />{showAttributePanel && <AttributePanel />}</div>{showNotesPanel && <NotesPanel />}</section></PresentationEditorProvider>;
}
