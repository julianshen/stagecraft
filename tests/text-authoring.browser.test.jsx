import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import SourceWorkspace from '../apps/playground/src/components/views/SourceWorkspace.jsx';
import { openPresentation } from '@stagecraft/source';

afterEach(cleanup);
it.each(['pptx', 'odp'])('edits text typography and paragraph controls then exports %s', async format => {
  const save = vi.fn();
  render(<SourceWorkspace save={save} />);
  fireEvent.click(screen.getByRole('button', { name: `New ${format.toUpperCase()}` }));
  await screen.findByRole('region', { name: 'Presentation editor' });
  fireEvent.click(screen.getByRole('tab', { name: 'Insert' }));
  fireEvent.click(screen.getByRole('button', { name: 'Text box' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Text run 1', exact: true }), { target: { value: 'Quarterly update' } });
  const family = screen.getByRole('textbox', { name: 'Font family run 1' });
  fireEvent.change(family, { target: { value: 'Georgia' } }); fireEvent.blur(family);
  fireEvent.change(screen.getByLabelText('Color run 1'), { target: { value: '#cc3300' } });
  fireEvent.change(screen.getByLabelText('Paragraph 1 alignment'), { target: { value: 'center' } });
  const spacing = screen.getByLabelText('Paragraph 1 space after');
  fireEvent.change(spacing, { target: { value: '12' } }); fireEvent.blur(spacing);
  fireEvent.change(screen.getByLabelText('Text autofit'), { target: { value: 'resize' } });
  expect(screen.getByLabelText('Text autofit')).toHaveValue('resize');
  fireEvent.click(screen.getByRole('button', { name: 'Export', exact: true }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  const source = await openPresentation(save.mock.calls[0][0].bytes, { format });
  try {
    const object = source.document.slides[0].objects.find(o => o.text?.paragraphs.some(p => p.runs.map(r => r.text).join('') === 'Quarterly update'));
    expect(object).toBeDefined();
    const run = object.text.paragraphs[0].runs.find(r => r.text.startsWith('Quarterly'));
    const appearance = format === 'odp' ? run.extensions?.odpAppearance : run.style;
    expect(appearance?.fontFamily ?? appearance?.typeface).toBe('Georgia');
    expect(appearance?.color?.toLowerCase()).toBe('#cc3300');
    expect(object.text.paragraphs[0].style).toMatchObject({ alignment: 'center', spaceAfter: 12 });
    expect(object.bodyLayout).toMatchObject({ autofit: 'resize' });
  } finally { source.dispose(); }
});
