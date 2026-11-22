import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useEditor, useEditorSnapshot } from './EditorProvider.jsx';
import './styles/canonical.css';

const supported = type => ['text', 'shape', 'group'].includes(type);
function collect(objects, blocked = false) {
  return objects.flatMap(object => {
    const opaque = blocked || !supported(object.type);
    return [{ object, blocked: opaque }, ...collect(object.children ?? [], opaque)];
  });
}
export function runStyle(run, scale) {
  const odp = run.source?.format === 'odp';
  const appearance = odp ? { ...run.extensions?.odpAppearance, ...run.style?.overrides } : run.extensions?.pptxAppearance;
  const attrs = odp ? { b: appearance.bold, i: appearance.italic, sz: appearance.fontSize === undefined ? undefined : appearance.fontSize * 100 } : run.style ?? {};
  const size = Number(attrs.sz);
  const pixels = size / 100 * 12700 * scale;
  const fontFamilyRaw = (!odp ? run.style?.typeface : undefined) ?? appearance?.fontFamily;
  const colorRaw = (!odp ? run.style?.color : undefined) ?? appearance?.color;
  return {
    fontWeight: ['1', 'true', true].includes(attrs.b) ? 'bold' : ['0', 'false', false].includes(attrs.b) ? 'normal' : undefined,
    fontStyle: ['1', 'true', true].includes(attrs.i) ? 'italic' : ['0', 'false', false].includes(attrs.i) ? 'normal' : undefined,
    fontSize: Number.isFinite(pixels) && pixels > 0 ? `${pixels}px` : undefined,
    fontFamily: typeof fontFamilyRaw === 'string' && fontFamilyRaw ? (odp ? fontFamilyRaw : JSON.stringify(fontFamilyRaw)) : undefined,
    color: /^#[0-9a-f]{6}$/i.test(colorRaw ?? '') ? colorRaw : undefined,
  };
}
const alignment = style => ({ l: 'left', ctr: 'center', r: 'right', just: 'justify' })[style?.algn];
const directBoolean = value => ['1', 'true', true].includes(value) ? 'true' : ['0', 'false', false].includes(value) ? 'false' : '';
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
export function RunFormatControls({ run, index, disabled, onFormat, editor, source, revision }) {
  const odp = run.source?.format === 'odp';
  const original = odp ? 'Original' : 'Inherit';
  const direct = odp
    ? run.style?.overrides ?? {}
    : {
        bold: run.style?.b,
        italic: run.style?.i,
        fontSize: run.style?.sz === undefined ? undefined : Number(run.style.sz) / 100,
        fontFamily: run.style?.typeface,
        color: run.style?.color,
      };
  const hasColor = odp
    ? Object.hasOwn(run.style?.overrides ?? {}, 'color')
    : Object.hasOwn(run.style ?? {}, 'color');
  const nativeSize = direct.fontSize === undefined ? '' : String(direct.fontSize);
  const nativeFont = typeof direct.fontFamily === 'string' ? direct.fontFamily : '';
  const [size, setSize] = useState(nativeSize);
  const [fontFamily, setFontFamily] = useState(nativeFont);
  const startRevRef = useRef(revision);
  useEffect(() => {
    startRevRef.current = revision;
    setSize(nativeSize);
  }, [editor, source, revision, run.id, nativeSize, disabled]);
  useEffect(() => {
    startRevRef.current = revision;
    setFontFamily(nativeFont);
  }, [editor, source, revision, run.id, nativeFont, disabled]);
  const captureRev = () => { startRevRef.current = revision; };
  return <fieldset disabled={disabled} className="stagecraft-canonical-format">
    <legend>{odp ? 'Formatting overrides' : 'Direct formatting'} · run {index + 1}</legend>
    {['bold', 'italic'].map(name => <label key={name}>{name === 'bold' ? 'Bold' : 'Italic'}
      <select aria-label={`${name === 'bold' ? 'Bold' : 'Italic'} run ${index + 1}`} value={directBoolean(direct[name])} onChange={event => onFormat({ [name]: event.target.value === '' ? null : event.target.value === 'true' }, revision)}>
        <option value="">{original}</option><option value="true">On</option><option value="false">Off</option>
      </select>
    </label>)}
    <label>Size (pt)<input aria-label={`Font size run ${index + 1}`} type="number" min="1" max="4000" step="0.01" placeholder={original} value={size}
      onFocus={captureRev}
      onChange={event => setSize(event.target.value)} onBlur={() => {
        if (size !== nativeSize) onFormat({ fontSize: size === '' ? null : Number(size) }, startRevRef.current);
        setSize(nativeSize);
      }} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} /></label>
    <label>Font<input aria-label={`Font family run ${index + 1}`} type="text" maxLength={64} placeholder={original} value={fontFamily}
      onFocus={captureRev}
      onChange={event => setFontFamily(event.target.value)} onBlur={() => {
        const trimmed = fontFamily.trim();
        if (trimmed !== nativeFont) onFormat({ fontFamily: trimmed === '' ? null : trimmed }, startRevRef.current);
        setFontFamily(nativeFont);
      }} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} /></label>
    <label>Color<input aria-label={`Color run ${index + 1}`} type="color" value={HEX_COLOR.test(direct.color ?? '') ? direct.color : '#000000'}
      onChange={event => onFormat({ color: event.target.value.toLowerCase() }, revision)} /></label>
    {hasColor && <button type="button" aria-label={`Reset color run ${index + 1}`} onClick={() => onFormat({ color: null }, revision)}>{original}</button>}
    {odp && <small>Original restores this file’s imported style.</small>}
  </fieldset>;
}

/** Existing-run text and supported native formatting. Host owns editor and source. */
export function CanonicalEditorSurface({ source, readOnly = false, onExport, onError, className = '', style }) {
  const editor = useEditor();
  const snapshot = useEditorSnapshot();
  const [selected, select] = useState(null);
  const [error, setError] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState(null);
  const lifecycle = useRef(null);
  const lock = useRef(null);
  // A separate token for every committed source/editor lifetime also handles
  // StrictMode's setup-cleanup-setup cycle and A -> B -> A replacements.
  useLayoutEffect(() => {
    const token = { source, editor };
    lifecycle.current = token;
    lock.current = null;
    setExporting(false); setExported(null); setError(null);
    return () => { if (lifecycle.current === token) lifecycle.current = null; };
  }, [source, editor]);

  const doc = snapshot.document;
  const canonical = doc?.schemaVersion === 1 && doc?.units === 'emu' && Array.isArray(doc.slides)
    && Number.isFinite(doc.size?.width) && doc.size.width > 0 && Number.isFinite(doc.size?.height) && doc.size.height > 0;
  const slide = canonical ? (doc.slides.find(item => item.id === selected) ?? doc.slides[0]) : undefined;
  useEffect(() => { select(slide?.id ?? null); }, [slide?.id]);
  const entries = collect(slide?.objects ?? []);
  const runs = entries.flatMap(({ object, blocked }) => (object.text?.paragraphs ?? []).flatMap(p => p.runs.map(run => ({ run, blocked: blocked || !['text', 'shape'].includes(object.type) }))));
  const locked = readOnly || (source != null && (source.capabilities.readOnly === true || !source.capabilities.edits.includes('existing-run-text')));
  const scale = canonical ? 1920 / doc.size.width : NaN;
  const previewHeight = canonical ? doc.size.height * scale : NaN;
  const previewAvailable = Number.isFinite(scale) && Number.isFinite(previewHeight) && previewHeight > 0
    && entries.every(({ object }) => {
      const g = object.geometry;
      return !g || [g.x * scale, g.y * scale, g.width * scale, g.height * scale,
        (g.x + g.width / 2) * scale, (g.y + g.height / 2) * scale, g.rotation ?? 0].every(Number.isFinite);
    });
  function report(reason) {
    setError(reason instanceof Error ? reason.message : String(reason));
    try { const result = onError?.(reason); Promise.resolve(result).catch(() => {}); } catch { /* Host callbacks cannot break the surface. */ }
  }
  function mutate(operation) {
    if (locked) return;
    try { operation({ expectedRevision: snapshot.revision, origin: 'react' }); setError(null); }
    catch (reason) { report(reason); }
  }
  async function exportSnapshot() {
    const token = lifecycle.current;
    if (!source || !onExport || !token || lock.current) return;
    const request = { token };
    lock.current = request;
    setExporting(true); setError(null); setExported(null);
    const current = () => lifecycle.current === token;
    try {
      const result = await source.export(snapshot.document);
      if (!current()) return;
      await onExport(result, { revision: snapshot.revision });
      if (current()) setExported(snapshot.revision);
    } catch (reason) { if (current()) report(reason); }
    finally {
      if (current() && lock.current === request) { lock.current = null; setExporting(false); }
    }
  }
  if (!canonical) return <section className={`stagecraft-canonical ${className}`} style={style} aria-label="Canonical slide editor"><p role="alert">CanonicalEditorSurface requires a canonical v1 document (schemaVersion 1, emu units) in EditorProvider.</p></section>;
  return <section className={`stagecraft-canonical ${className}`} style={style} aria-label="Canonical slide editor">
    <header className="stagecraft-canonical-toolbar">
      <button disabled={locked || !snapshot.canUndo} onClick={() => mutate(meta => editor.undo(meta))}>Undo</button>
      <button disabled={locked || !snapshot.canRedo} onClick={() => mutate(meta => editor.redo(meta))}>Redo</button>
      <span>Revision {snapshot.revision}{locked ? ' · Read only' : ''}</span>
      {source && onExport && <button disabled={exporting} onClick={exportSnapshot}>{exporting ? 'Exporting…' : 'Export'}</button>}
      {exported !== null && <span role="status">Exported revision {exported}</span>}
    </header>
    {error && <p role="alert">{error}</p>}
    <p className="stagecraft-canonical-notice">Simplified preview: native styles, ODP style references, themes, masters, assets and group transforms may not be shown. Original source data is retained; this is not an Office fidelity preview.</p>
    <div className="stagecraft-canonical-workspace">
      <nav aria-label="Slides">{doc.slides.map((item, index) => <button key={item.id} aria-current={item.id === slide?.id ? 'page' : undefined} onClick={() => select(item.id)}>Slide {index + 1}{item.name ? ` · ${item.name}` : ''}</button>)}</nav>
      <div className="stagecraft-canonical-preview">
        {!previewAvailable ? <p role="alert">Preview unavailable: document geometry exceeds the supported display range.</p> : slide ? <svg role="img" aria-label={`Preview of ${slide.name || 'selected slide'}`} viewBox={`0 0 1920 ${previewHeight}`}>
          <rect width="1920" height={previewHeight} fill="white" />
          {entries.map(({ object, blocked }, index) => {
            const g = object.geometry;
            const x = g ? g.x * scale : 20, y = g ? g.y * scale : 20 + index * 65;
            const width = g ? Math.max(1, g.width * scale) : 600, height = g ? Math.max(1, g.height * scale) : 60;
            const text = !blocked && object.text && object.type !== 'group';
            return <foreignObject key={object.id} x={x} y={y} width={width} height={height} transform={g?.rotation ? `rotate(${g.rotation} ${x + width / 2} ${y + height / 2})` : undefined}>
              <div className={text ? 'stagecraft-canonical-text' : 'stagecraft-canonical-placeholder'}>
                {text ? object.text.paragraphs.map(p => <p key={p.id} style={{ textAlign: alignment(p.style) }}>{p.runs.map(run => <span key={run.id} style={runStyle(run, scale)}>{run.text}</span>)}</p>) : `${object.type === 'group' ? 'Group (transform omitted)' : `Unsupported preview: ${object.type}`} · ${object.id}`}
              </div>
            </foreignObject>;
          })}
        </svg> : <p>No slides</p>}
      </div>
      <aside aria-label="Text inspector">{runs.length ? runs.map(({ run, blocked }, index) => <div key={run.id}><label>Text run {index + 1}
        <textarea aria-label={`Text run ${index + 1}`} value={run.text} readOnly={locked || blocked || run.editable === false} onChange={event => {
          if (blocked || run.editable === false) return;
          mutate(meta => editor.dispatch('document.setRunText', { runId: run.id, text: event.target.value }, meta));
        }} />
        {(blocked || run.editable === false) && <small>Unsupported text — read only</small>}
      </label>
        {['pptx', 'odp'].includes(run.source?.format) && <RunFormatControls run={run} index={index}
          editor={editor} source={source} revision={snapshot.revision}
          disabled={locked || blocked || run.editable === false || (source != null && !source.capabilities.edits.includes('existing-run-format'))}
          onFormat={(format, rev) => mutate(meta => editor.dispatch('document.setRunFormat', { runId: run.id, format }, { ...meta, expectedRevision: rev ?? meta.expectedRevision }))} />}
      </div>) : <p>No text runs on this slide</p>}</aside>
    </div>
  </section>;
}
