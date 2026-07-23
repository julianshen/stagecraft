import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ExportModal from './ExportModal.jsx';

// vi.hoisted so the mock fn is initialized before the hoisted vi.mock factory
// references it (matches pptxExport.test.js) — no reliance on a deferred-arrow
// closure to dodge the hoist-order TDZ.
const exportToPPTX = vi.hoisted(() => vi.fn(() => Promise.resolve('ok.pptx')));
vi.mock('../../lib/pptxExport.js', () => ({ exportToPPTX }));
const exportToPDF = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock('../../lib/pdfExport.js', () => ({ exportToPDF }));

const deck = { title: 'D', slides: [{ id: 'a' }, { id: 'b' }], sections: [{ id: 's', name: 'S', slides: ['a', 'b'] }] };

beforeEach(() => { exportToPPTX.mockClear(); exportToPDF.mockClear(); });

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

  // AC-6.1: Keynote/PDF/PNG/MP4/Link options are disabled with a Soon affordance
  // and clicking one does NOT select it — pptx remains the selected format.
  it('AC-6.1: non-PPTX options are marked Soon, aria-disabled, and unselectable', () => {
    const { getByText, getAllByLabelText } = render(<ExportModal deck={deck} onClose={vi.fn()} />);
    // query by the sub-line ("PDF" as a title collides with the PDF icon-box text)
    const soonSubs = [
      'Native Keynote package',            // key
      '1920×1080, one file per slide',     // png
      'Renders transitions & animations',  // video
      'Web viewer with access controls',   // link
    ]; // PDF is now a real, selectable format (pdf-export) — no longer Soon
    for (const sub of soonSubs) {
      const opt = getByText(sub).closest('.export-opt');
      expect(opt.className).toContain('is-soon');
      expect(opt.getAttribute('aria-disabled')).toBe('true');
      expect(opt.querySelector('.soon-tag')).toBeTruthy();
      fireEvent.click(opt); // must NOT select it
      expect(opt.className).not.toContain('selected');
    }
    expect(getAllByLabelText('Coming soon')).toHaveLength(soonSubs.length);
    // pptx stays selected and default-selected throughout
    const pptx = getByText('PowerPoint · .pptx').closest('.export-opt');
    expect(pptx.className).toContain('selected');
    expect(pptx.className).not.toContain('is-soon');
    expect(getByText(/Export PPTX/)).toBeTruthy(); // footer still offers the pptx export
  });

  // AC-6.2: with PPTX selected, Export calls exportToPPTX with the current
  // notes/range options — and there is no path where a non-PPTX format closes
  // the modal with no output (clicking a soon option then Export still runs pptx).
  it('AC-6.2: Export after clicking a soon option still runs the PPTX path with current options', async () => {
    const onClose = vi.fn();
    const { getByText, getByLabelText } = render(<ExportModal deck={deck} onClose={onClose} />);
    fireEvent.click(getByText('Native Keynote package').closest('.export-opt')); // a soon option (Keynote) — never becomes selected
    fireEvent.change(getByLabelText('Speaker notes'), { target: { value: 'exclude' } });
    fireEvent.change(getByLabelText('Range from'), { target: { value: '2' } });
    fireEvent.click(getByText(/Export PPTX/));
    await waitFor(() => expect(exportToPPTX).toHaveBeenCalledWith(deck, { includeNotes: false, range: { from: 2, to: 2 } }));
    await waitFor(() => expect(onClose).toHaveBeenCalled()); // closes only after producing output
  });
});

describe('ExportModal format picker accessibility (ARIA radio group)', () => {
  // AC-1.1: the whole export flow is drivable from the keyboard alone — tab into
  // the format group (roving tabindex lands on the selected pptx option), Enter
  // explicitly selects it, tab onward to the Export button, Enter exports.
  it('AC-1.1: full keyboard export flow with no pointer events', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<ExportModal deck={deck} onClose={onClose} />);
    // Tab until focus enters the radio group. Roving tabindex means the FIRST
    // radio reached must be the selected pptx option (soon radios aren't tabbable).
    let guard = 0;
    while (document.activeElement?.getAttribute('role') !== 'radio' && guard++ < 10) await user.tab();
    const pptx = screen.getByRole('radio', { name: /PowerPoint/ });
    expect(pptx).toHaveFocus();
    await user.keyboard('{Enter}'); // explicit select of the focused option
    expect(pptx).toHaveAttribute('aria-checked', 'true');
    // Tab onward, out of the group and through the options fields, to Export.
    const exportBtn = screen.getByRole('button', { name: /Export PPTX/ });
    guard = 0;
    while (document.activeElement !== exportBtn && guard++ < 20) await user.tab();
    expect(exportBtn).toHaveFocus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(exportToPPTX).toHaveBeenCalledWith(deck, { includeNotes: true }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  // AC-1.2: canonical single-select semantics — one radiogroup with an accessible
  // name, every option a radio, exactly one checked and exactly one tabbable.
  it('AC-1.2: radiogroup with 6 radios, aria-checked and tabIndex 0 only on pptx', () => {
    render(<ExportModal deck={deck} onClose={vi.fn()} />);
    const group = screen.getByRole('radiogroup', { name: 'Export format' });
    const radios = within(group).getAllByRole('radio');
    expect(radios).toHaveLength(6);
    const checked = radios.filter(r => r.getAttribute('aria-checked') === 'true');
    expect(checked).toHaveLength(1);
    expect(checked[0]).toHaveTextContent('PowerPoint · .pptx');
    const tabbable = radios.filter(r => r.tabIndex === 0);
    expect(tabbable).toHaveLength(1);
    expect(tabbable[0]).toBe(checked[0]); // roving tabindex rides the selection
  });

  // AC-1.3: arrows move to the next/previous ENABLED option with wrap-around,
  // skipping soon options. With pptx + pdf now both enabled (pdf-export), arrows
  // move focus+selection between the two and wrap; the 4 soon radios never focus.
  it('AC-1.3: arrow keys move between the enabled options (pptx↔pdf), skipping soon', async () => {
    const user = userEvent.setup();
    render(<ExportModal deck={deck} onClose={vi.fn()} />);
    const pptx = screen.getByRole('radio', { name: /PowerPoint/ });
    const pdf = screen.getByRole('radio', { name: /PDF/ });
    pptx.focus();
    await user.keyboard('{ArrowDown}');           // next enabled → pdf (soon options skipped)
    expect(pdf).toHaveFocus();
    expect(pdf).toHaveAttribute('aria-checked', 'true');   // selection follows focus
    await user.keyboard('{ArrowDown}');           // wrap forward past the soon tail → back to pptx
    expect(pptx).toHaveFocus();
    expect(pptx).toHaveAttribute('aria-checked', 'true');
    await user.keyboard('{ArrowUp}');             // wrap backward → pdf
    expect(pdf).toHaveFocus();
    // the 4 soon options never receive focus or selection and stay disabled
    for (const r of screen.getAllByRole('radio')) {
      if (r !== pptx && r !== pdf) {
        expect(r).toHaveAttribute('aria-checked', 'false');
        expect(r).toHaveAttribute('aria-disabled', 'true');
      }
    }
  });

  // AC-1.4: no pointer or key path can activate a soon option — click, Enter,
  // Space, and arrows dispatched straight at it all leave it unchecked.
  it('AC-1.4: click/Enter/Space/arrows on a soon option never select it', () => {
    render(<ExportModal deck={deck} onClose={vi.fn()} />);
    const pptx = screen.getByRole('radio', { name: /PowerPoint/ });
    const keynote = screen.getByRole('radio', { name: /Keynote/ });
    fireEvent.click(keynote);
    fireEvent.keyDown(keynote, { key: 'Enter' });
    fireEvent.keyDown(keynote, { key: ' ' });
    fireEvent.keyDown(keynote, { key: 'ArrowDown' });
    expect(keynote).toHaveAttribute('aria-checked', 'false');
    expect(keynote).toHaveAttribute('aria-disabled', 'true');
    expect(pptx).toHaveAttribute('aria-checked', 'true');
  });
});

describe('ExportModal — PDF export (pdf-export)', () => {
  it('PDF is a selectable radio (no Soon); other formats stay disabled+Soon [AC-2.1]', () => {
    render(<ExportModal deck={deck} onClose={vi.fn()} />);
    const pdf = screen.getByRole('radio', { name: /PDF/ });
    expect(pdf).not.toHaveAttribute('aria-disabled', 'true');
    expect(within(pdf).queryByText('Soon')).toBeNull();
    // the previously-shipped disabled formats are unchanged
    for (const name of [/Keynote/, /PNG sequence/, /MP4/, /Shareable link/]) {
      expect(screen.getByRole('radio', { name })).toHaveAttribute('aria-disabled', 'true');
    }
  });

  it('selecting PDF + a range dispatches exportToPDF with the range (not PPTX) [AC-2.2]', async () => {
    const onClose = vi.fn();
    render(<ExportModal deck={deck} onClose={onClose} />);
    fireEvent.click(screen.getByRole('radio', { name: /PDF/ }));       // select PDF
    fireEvent.change(screen.getByLabelText('Range from'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Range to'), { target: { value: '2' } });
    fireEvent.click(screen.getByText(/Export PDF/));
    await waitFor(() => expect(exportToPDF).toHaveBeenCalledWith(deck, { range: { from: 2, to: 2 } }));
    expect(exportToPPTX).not.toHaveBeenCalled();
    await waitFor(() => expect(onClose).toHaveBeenCalled());           // success closes
  });

  it('shows a busy state while exporting and a visible error (no silent close) on PDF failure [AC-2.3]', async () => {
    const onClose = vi.fn();
    let reject;
    exportToPDF.mockReturnValueOnce(new Promise((_, rej) => { reject = rej; }));
    render(<ExportModal deck={deck} onClose={onClose} />);
    fireEvent.click(screen.getByRole('radio', { name: /PDF/ }));
    fireEvent.click(screen.getByText(/Export PDF/));
    await waitFor(() => expect(screen.getByText(/Exporting/)).toBeTruthy()); // busy
    reject(new Error('pdf boom'));
    await waitFor(() => expect(screen.getByText(/failed/i)).toBeTruthy());   // visible error
    expect(onClose).not.toHaveBeenCalled();                                  // NOT a silent close
  });
});

