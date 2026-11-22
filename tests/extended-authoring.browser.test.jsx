import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import SourceWorkspace from '../apps/playground/src/components/views/SourceWorkspace.jsx';
import { openPresentation } from '@stagecraft/source';
afterEach(cleanup);
const change = (label, value, blur = false) => {
  const input = screen.getByRole('textbox', { name: label });
  fireEvent.change(input, { target: { value } }); if (blur) fireEvent.blur(input);
};
const textOf = text => text.paragraphs.map(p => p.runs.map(r => r.text).join('')).join('\n');
it.each(['pptx', 'odp'])('round trips a new slide with rich text, notes, background, table, image and chart through %s UI', async format => {
  const save = vi.fn(); const { container } = render(<SourceWorkspace save={save} />);
  fireEvent.click(screen.getByRole('button', { name: `New ${format.toUpperCase()}` }));
  await screen.findByRole('region', { name: 'Presentation editor' });
  fireEvent.click(screen.getByRole('button', { name: 'Add slide', exact: true }));
  change('Slide name', 'Quarterly plan', true);
  change('Speaker notes', 'Mention the forecast', true);
  fireEvent.change(screen.getByLabelText('Slide background'), { target: { value: '#ddeeff' } });
  fireEvent.click(screen.getByRole('tab', { name: 'Insert' }));
  fireEvent.click(screen.getByRole('button', { name: 'Text box' }));
  change('Text run 1', 'First paragraph');
  fireEvent.click(screen.getByRole('button', { name: 'Add paragraph', exact: true }));
  change('Text run 2', 'Second paragraph');
  fireEvent.click(screen.getByRole('button', { name: 'Table', exact: true }));
  change('Cell 1.1 run 1', 'Revenue');
  const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII='), c => c.charCodeAt(0));
  fireEvent.change(container.querySelector('input[type="file"][accept="image/png,image/jpeg"]'), { target: { files: [new File([png], 'pixel.png', { type: 'image/png' })] } });
  await waitFor(() => expect(screen.getAllByRole('img', { name: 'pixel.png' }).length).toBeGreaterThan(0));
  fireEvent.click(screen.getByRole('button', { name: 'Chart', exact: true }));
  change('Category 1', 'January', true);
  fireEvent.change(screen.getByLabelText('Chart kind'), { target: { value: 'line' } });
  fireEvent.click(screen.getByRole('button', { name: 'Export', exact: true }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  const reopened = await openPresentation(save.mock.calls[0][0].bytes, { format });
  try {
    expect(reopened.document.slides).toHaveLength(2);
    const slide = reopened.document.slides[1];
    expect(slide.name).toBe('Quarterly plan');
    expect(slide.notes).toBe('Mention the forecast');
    expect(slide.background).toEqual({ type: 'solid', color: '#ddeeff' });
    expect(slide.objects.some(o => o.text && textOf(o.text) === 'First paragraph\nSecond paragraph')).toBe(true);
    const table = slide.objects.find(o => o.type === 'table');
    expect(textOf(table.table.rows[0].cells[0].text)).toBe('Revenue');
    expect(slide.objects.some(o => o.type === 'image')).toBe(true);
    const chart = slide.objects.find(o => o.type === 'chart');
    expect(chart.chart.kind).toBe('line');
    expect(chart.chart.categories[0]).toBe('January');
  } finally { reopened.dispose(); }
});
