import { useState } from 'react';
import Icon from '../ui/Icon.jsx';
import { Button, IconButton, FieldRow } from '../ui/Primitives.jsx';
import { exportToPPTX } from '../../lib/pptxExport.js';
import { SAMPLE_DECK } from '../../data/deck.js';

export default function ExportModal({ onClose, deck }) {
  const [fmt, setFmt] = useState('pptx');
  const [exporting, setExporting] = useState(false);

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
        await exportToPPTX(deck || SAMPLE_DECK);
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
          <h3>Export · {(deck || SAMPLE_DECK).title || 'Presentation'}</h3>
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
                <div className="input-group"><input value={`All · ${(deck || SAMPLE_DECK).slides?.length || 0} slides`} readOnly/><Icon name="chevron-down" size={11}/></div>
              </FieldRow>
              <FieldRow label="QUALITY">
                <div className="input-group"><input value="High" readOnly/><Icon name="chevron-down" size={11}/></div>
              </FieldRow>
              <FieldRow label="NOTES">
                <div className="input-group"><input value="Include speaker notes" readOnly/></div>
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
