import { useState } from 'react';
import Icon from '../ui/Icon.jsx';
import { Button, IconButton, FieldRow } from '../ui/Primitives.jsx';
import { exportToPPTX } from '../../lib/pptxExport.js';
import { flattenDeck } from '../../lib/deckOrder.js';

export default function ExportModal({ onClose, deck }) {
  const [fmt, setFmt] = useState('pptx');
  const [includeNotes, setIncludeNotes] = useState(true);
  const [exporting, setExporting] = useState(false);
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
    { id: 'key',   title: 'Keynote · .key',       sub: 'Native Keynote package',               ext: 'KEY' },
    { id: 'pdf',   title: 'PDF',                  sub: 'One page per slide, hi-res',           ext: 'PDF' },
    { id: 'png',   title: 'PNG sequence',         sub: '1920×1080, one file per slide',        ext: 'PNG' },
    { id: 'video', title: 'MP4 video',            sub: 'Renders transitions & animations',     ext: 'MP4' },
    { id: 'link',  title: 'Shareable link',       sub: 'Web viewer with access controls',      ext: 'URL' },
  ];

  async function handleExport() {
    if (fmt === 'pptx') {
      setExporting(true);
      try {
        // Parse each field (empty/invalid → the full bound; a typed 0 clamps to 1
        // rather than falling through), clamp to [1, total], then normalise start≤end;
        // send a range only when it actually narrows the deck (a full range stays unranged).
        const bound = (s, full) => { const n = parseInt(s, 10); return Number.isNaN(n) ? full : n; };
        const lo = Math.max(1, Math.min(total, bound(from, 1)));
        const hi = Math.max(1, Math.min(total, bound(to, total)));
        const start = Math.min(lo, hi), end = Math.max(lo, hi);
        const exportOpts = { includeNotes };
        if (start > 1 || end < total) exportOpts.range = { from: start, to: end };
        await exportToPPTX(deck, exportOpts);
      } catch (err) {
        console.error('PPTX export failed:', err);
      } finally {
        setExporting(false);
        onClose();
      }
    } else {
      // Other formats: just close for now (placeholder)
      onClose();
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal medium" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Export · {deck?.title || 'Presentation'}</h3>
          <IconButton name="x" onClick={onClose}/>
        </div>
        <div className="modal-body">
          {opts.map(o => (
            <div key={o.id} className={`export-opt ${fmt === o.id ? 'selected' : ''}`} onClick={() => setFmt(o.id)}>
              <div className="icon-box">{o.ext}</div>
              <div>
                <div className="et">{o.title}</div>
                <div className="es">{o.sub}</div>
              </div>
              <div className="radio"/>
            </div>
          ))}
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
          <span style={{ flex: 1, fontSize: 12, color: 'var(--ink-3)', fontFamily: 'var(--f-mono)' }}>
            {fmt.toUpperCase()} · ~6.4 MB · est 4s
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
