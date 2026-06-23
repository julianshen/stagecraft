import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import ExportModal from './ExportModal.jsx';

// vi.hoisted so the mock fn is initialized before the hoisted vi.mock factory
// references it (matches pptxExport.test.js) — no reliance on a deferred-arrow
// closure to dodge the hoist-order TDZ.
const exportToPPTX = vi.hoisted(() => vi.fn(() => Promise.resolve('ok.pptx')));
vi.mock('../../lib/pptxExport.js', () => ({ exportToPPTX }));

const deck = { title: 'D', slides: [{ id: 'a' }, { id: 'b' }], sections: [{ id: 's', name: 'S', slides: ['a', 'b'] }] };

beforeEach(() => { exportToPPTX.mockClear(); });

describe('ExportModal', () => {
  it('exports PPTX with notes included by default', async () => {
    const onClose = vi.fn();
    const { getByText } = render(<ExportModal deck={deck} onClose={onClose} />);
    fireEvent.click(getByText(/Export PPTX/));
    await waitFor(() => expect(exportToPPTX).toHaveBeenCalledWith(deck, { includeNotes: true }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('passes includeNotes:false when the NOTES option is set to exclude', async () => {
    const { getByText, getByLabelText } = render(<ExportModal deck={deck} onClose={vi.fn()} />);
    fireEvent.change(getByLabelText('Speaker notes'), { target: { value: 'exclude' } });
    fireEvent.click(getByText(/Export PPTX/));
    await waitFor(() => expect(exportToPPTX).toHaveBeenCalledWith(deck, { includeNotes: false }));
  });

  it('closes gracefully if the export throws (failure is logged, not surfaced)', async () => {
    const onClose = vi.fn();
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    exportToPPTX.mockRejectedValueOnce(new Error('boom'));
    const { getByText } = render(<ExportModal deck={deck} onClose={onClose} />);
    fireEvent.click(getByText(/Export PPTX/));
    await waitFor(() => expect(onClose).toHaveBeenCalled()); // finally still runs
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('renders with a bare deck (no title/slides) using safe fallbacks', () => {
    const { getByText, getByLabelText } = render(<ExportModal deck={{}} onClose={vi.fn()} />);
    expect(getByText(/Export · Presentation/)).toBeTruthy();   // title fallback
    expect(getByLabelText('Range to')).toBeTruthy();           // range control renders (0 slides, no crash)
  });

  it('passes a narrowed slide range to the export (only when it narrows the deck)', async () => {
    const { getByText, getByLabelText } = render(<ExportModal deck={deck} onClose={vi.fn()} />);
    fireEvent.change(getByLabelText('Range from'), { target: { value: '2' } });
    fireEvent.change(getByLabelText('Range to'), { target: { value: '2' } }); // 2..2 of 2 → last slide only
    fireEvent.click(getByText(/Export PPTX/));
    await waitFor(() => expect(exportToPPTX).toHaveBeenCalledWith(deck, { includeNotes: true, range: { from: 2, to: 2 } }));
  });

  it('treats a cleared range input as the full bound — no spurious narrowing', async () => {
    const { getByText, getByLabelText } = render(<ExportModal deck={deck} onClose={vi.fn()} />);
    fireEvent.change(getByLabelText('Range to'), { target: { value: '' } }); // cleared → defaults back to `total`
    fireEvent.click(getByText(/Export PPTX/));
    await waitFor(() => expect(exportToPPTX).toHaveBeenCalledWith(deck, { includeNotes: true })); // no range key
  });

  it('keeps the export full when the deck grows while the modal is open (untouched range tracks the live total)', async () => {
    const small = { title: 'D', slides: [{ id: 'a' }, { id: 'b' }], sections: [{ id: 's', name: 'S', slides: ['a', 'b'] }] };
    const grown = { title: 'D', slides: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }], sections: [{ id: 's', name: 'S', slides: ['a', 'b', 'c', 'd'] }] };
    const { getByText, rerender } = render(<ExportModal deck={small} onClose={vi.fn()} />);
    rerender(<ExportModal deck={grown} onClose={vi.fn()} />); // a live MCP/co-pilot edit adopts a larger deck
    fireEvent.click(getByText(/Export PPTX/));
    await waitFor(() => expect(exportToPPTX).toHaveBeenCalledWith(grown, { includeNotes: true })); // all 4, no stale narrowing
  });

  it('clamps a To value of 0 to the first slide rather than expanding to the whole deck', async () => {
    const { getByText, getByLabelText } = render(<ExportModal deck={deck} onClose={vi.fn()} />);
    fireEvent.change(getByLabelText('Range to'), { target: { value: '0' } }); // below min → clamp to 1, not the falsy-→total trap
    fireEvent.click(getByText(/Export PPTX/));
    await waitFor(() => expect(exportToPPTX).toHaveBeenCalledWith(deck, { includeNotes: true, range: { from: 1, to: 1 } }));
  });

  it('does not run the PPTX export for a non-pptx format — just closes (placeholder)', async () => {
    const onClose = vi.fn();
    const { getByText } = render(<ExportModal deck={deck} onClose={onClose} />);
    fireEvent.click(getByText('One page per slide, hi-res').closest('.export-opt')); // the PDF option
    fireEvent.click(getByText(/Export PDF/));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(exportToPPTX).not.toHaveBeenCalled();
  });
});
