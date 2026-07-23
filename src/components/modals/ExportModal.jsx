import { useRef, useState } from 'react';
import Icon from '../ui/Icon.jsx';
import { Button, IconButton, FieldRow } from '../ui/Primitives.jsx';
import SoonTag from '../ui/SoonTag.jsx';
import { exportToPPTX } from '../../lib/pptxExport.js';
import { exportToPDF } from '../../lib/pdfExport.js';
import { flattenDeck } from '../../lib/deckOrder.js';

export default function ExportModal({ onClose, deck }) {
  const [fmt, setFmt] = useState('pptx');
  const [includeNotes, setIncludeNotes] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState(null);
  // The range is 1-indexed over the FLATTENED slides (the order + count the export
  // actually emits — single-sourced via flattenDeck so the bounds can't drift).
  const total = flattenDeck(deck).length;
  // Empty = "the live bound" (1 / total): an untouched field tracks `total` as it
  // recomputes, so a deck that grows under an open modal (live MCP/co-pilot edits)
  // can't be silently truncated by a stale snapshot. Placeholders show the bounds.
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const opts = [
    { id: 'pptx',  title: 'PowerPoint · .pptx',  sub: 'Editable, preserves type & shapes',    ext: 'PPT' },
    { id: 'key',   title: 'Keynote · .key',       sub: 'Native Keynote package',               ext: 'KEY', soon: true },
    { id: 'pdf',   title: 'PDF',                  sub: 'One page per slide, hi-res',           ext: 'PDF' },
    { id: 'png',   title: 'PNG sequence',         sub: '1920×1080, one file per slide',        ext: 'PNG', soon: true },
    { id: 'video', title: 'MP4 video',            sub: 'Renders transitions & animations',     ext: 'MP4', soon: true },
    { id: 'link',  title: 'Shareable link',       sub: 'Web viewer with access controls',      ext: 'URL', soon: true },
  ];

  // ARIA radio-group keyboard support (roving tabindex). Selection follows
  // focus on arrows, per the radio convention: arrows wrap around the ENABLED
  // options only (soon formats are skipped entirely), so no key path can land
  // on — let alone activate — a soon option. With one live format today the
  // arrows simply stay put, but the wrap/skip logic is generic for when more
  // formats go live.
  const optionRefs = useRef({});
  function onOptionKeyDown(e, o) {
    const isArrow = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key);
    if (isArrow || e.key === ' ') e.preventDefault(); // arrows/Space must not scroll the modal
    if (o.soon) return; // a soon option (even if keyed directly) never selects
    if (isArrow) {
      const enabled = opts.filter(x => !x.soon);
      const dir = (e.key === 'ArrowDown' || e.key === 'ArrowRight') ? 1 : -1;
      const idx = enabled.findIndex(x => x.id === o.id);
      const next = enabled[(idx + dir + enabled.length) % enabled.length];
      setFmt(next.id);
      optionRefs.current[next.id]?.focus();
    } else if (e.key === 'Enter' || e.key === ' ') {
      setFmt(o.id);
    }
  }

  async function handleExport() {
    // Only PPTX + PDF are implemented; soon options can't be selected, but guard
    // anyway so no format silently no-ops.
    if (fmt !== 'pptx' && fmt !== 'pdf') return;
    setExporting(true);
    setError(null);
    // Parse each field (empty/invalid → the full bound; a typed 0 clamps to 1
    // rather than falling through), clamp to [1, total], then normalise start≤end;
    // send a range only when it actually narrows the deck (a full range stays unranged).
    const bound = (s, full) => { const n = parseInt(s, 10); return Number.isNaN(n) ? full : n; };
    const lo = Math.max(1, Math.min(total, bound(from, 1)));
    const hi = Math.max(1, Math.min(total, bound(to, total)));
    const start = Math.min(lo, hi), end = Math.max(lo, hi);
    const range = (start > 1 || end < total) ? { from: start, to: end } : undefined;
    try {
      if (fmt === 'pdf') {
        await exportToPDF(deck, range ? { range } : {});
      } else {
        const exportOpts = { includeNotes };
        if (range) exportOpts.range = range;
        await exportToPPTX(deck, exportOpts);
      }
    } catch (err) {
      // PDF: surface the failure inline and keep the modal open so the user can
      // retry — a silent close on the most portable export would hide data loss.
      if (fmt === 'pdf') {
        setExporting(false);
        setError('PDF export failed — please try again.');
        return;
      }
      // PPTX behaviour is unchanged (log + close); upgrading it is Ask-first (SPEC).
      console.error('PPTX export failed:', err);
    }
    setExporting(false);
    onClose();
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal medium" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Export · {deck?.title || 'Presentation'}</h3>
          <IconButton name="x" onClick={onClose}/>
        </div>
        <div className="modal-body">
          <div role="radiogroup" aria-label="Export format">
            {opts.map(o => (
              <div
                key={o.id}
                ref={el => { optionRefs.current[o.id] = el; }}
                role="radio"
                aria-checked={fmt === o.id}
                tabIndex={fmt === o.id ? 0 : -1}
                className={`export-opt ${fmt === o.id ? 'selected' : ''} ${o.soon ? 'is-soon' : ''}`}
                aria-disabled={o.soon || undefined}
                onClick={o.soon ? undefined : () => setFmt(o.id)}
                onKeyDown={e => onOptionKeyDown(e, o)}
              >
                <div className="icon-box">{o.ext}</div>
                <div>
                  <div className="et">{o.title}</div>
                  <div className="es">{o.sub}</div>
                </div>
                {o.soon ? <SoonTag/> : <div className="radio"/>}
              </div>
            ))}
          </div>
          <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--line)' }}>
            <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10.5, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 10 }}>Options</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <FieldRow label="RANGE">
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input type="number" min={1} max={total || 1} value={from} placeholder="1" aria-label="Range from" onChange={(e) => setFrom(e.target.value)} style={{ width: 52 }}/>
                  <span style={{ color: 'var(--ink-3)' }}>–</span>
                  <input type="number" min={1} max={total || 1} value={to} placeholder={String(total)} aria-label="Range to" onChange={(e) => setTo(e.target.value)} style={{ width: 52 }}/>
                  <span style={{ fontSize: 11, color: 'var(--ink-3)', whiteSpace: 'nowrap' }}>of {total}</span>
                </div>
              </FieldRow>
              <FieldRow label="QUALITY">
                <div className="input-group"><input value="High" readOnly/><Icon name="chevron-down" size={11}/></div>
              </FieldRow>
              <FieldRow label="NOTES">
                <div className="input-group">
                  <select value={includeNotes ? 'include' : 'exclude'} onChange={(e) => setIncludeNotes(e.target.value === 'include')} aria-label="Speaker notes">
                    <option value="include">Include speaker notes</option>
                    <option value="exclude">Exclude speaker notes</option>
                  </select>
                  <Icon name="chevron-down" size={11}/>
                </div>
              </FieldRow>
              <FieldRow label="COMMENTS">
                <div className="input-group"><input value="Exclude" readOnly/></div>
              </FieldRow>
            </div>
          </div>
        </div>
        <div className="modal-foot">
          <span style={{ flex: 1, fontSize: 12, fontFamily: 'var(--f-mono)', color: error ? 'var(--danger)' : 'var(--ink-3)' }} role={error ? 'alert' : undefined}>
            {error || `${fmt.toUpperCase()} · ~6.4 MB · est 4s`}
          </span>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="accent" icon="download" onClick={handleExport} disabled={exporting}>
            {exporting ? 'Exporting…' : `Export ${fmt.toUpperCase()}`}
          </Button>
        </div>
      </div>
    </div>
  );
}
