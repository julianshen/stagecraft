import React from 'react';
import { resolveNotes } from '../../../data/deck.js';

// Per-slide speaker notes. The textarea materializes resolveNotes(slide) — the
// authored slide.notes, else the bundled SPEAKER_NOTES starter — so what's shown
// is what the export (pptxExport addNotes) and the presenter side-panel actually
// use, the same "fallback as editable" pattern the chart/roadmap data editors
// follow. An edit commits { notes } through the shared patch gate (onApply →
// sanitizeSlidePatch); clearing to '' is an intentional "no notes" (resolveNotes
// honours an empty string rather than falling back).
export default function NotesPanel({ slide, onApply }) {
  return (
    <div className="pane-section">
      <h4>Speaker notes</h4>
      <textarea
        className="inspector-textarea"
        rows={8}
        aria-label="Speaker notes"
        placeholder="Add speaker notes for this slide…"
        value={resolveNotes(slide)}
        onChange={(e) => onApply?.({ notes: e.target.value })}
        disabled={!slide}
      />
    </div>
  );
}
