import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import ExportModal from './ExportModal.jsx';

const exportToPPTX = vi.fn(() => Promise.resolve('ok.pptx'));
vi.mock('../../lib/pptxExport.js', () => ({ exportToPPTX: (...a) => exportToPPTX(...a) }));

const deck = { title: 'D', slides: [{ id: 'a' }, { id: 'b' }], sections: [] };

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
    const { getByText, getByDisplayValue } = render(<ExportModal deck={{}} onClose={vi.fn()} />);
    expect(getByText(/Export · Presentation/)).toBeTruthy();       // title fallback
    expect(getByDisplayValue('All · 0 slides')).toBeTruthy();      // slide-count fallback (input value)
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
