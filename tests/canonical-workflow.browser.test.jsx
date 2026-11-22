import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import JSZip from 'jszip';
import SourceWorkspace from '../apps/playground/src/components/views/SourceWorkspace.jsx';
import { writePptx } from '@stagecraft/pptx';
import { writeOdp } from '@stagecraft/odp';
import { openPresentation } from '@stagecraft/source';

afterEach(cleanup);
const deck = { title: 'Browser workflow', sections: [{ id: 'section', name: 'Slides', slides: ['one', 'two'] }], slides: [
  { id: 'one', layout: 'blank', elements: [{ id: 'title', type: 'text', x: 140, y: 150, w: 1500, h: 160, content: 'Original', fontFamily: 'Arial', fontSize: 72, bold: true }] },
  { id: 'two', layout: 'blank', elements: [{ id: 'body', type: 'text', x: 140, y: 150, w: 1500, h: 160, content: 'Untouched', fontFamily: 'Arial', fontSize: 40, italic: true }] },
] };

describe('local canonical workflow in Chromium', () => {
  it.each(['pptx', 'odp'])('opens, edits, undoes, exports and reimports %s', async format => {
    const bytes = format === 'pptx' ? await writePptx(deck) : await writeOdp(deck);
    const save = vi.fn();
    render(<SourceWorkspace save={save} />);
    fireEvent.change(screen.getByLabelText('Open PPTX or ODP'), { target: { files: [new File([bytes], `original.${format}`)] } });
    const canvas = await screen.findByRole('region', { name: 'Slide canvas' });
    await waitFor(() => expect(canvas.querySelector('[data-object-id]')).toBeTruthy());
    fireEvent.click(canvas.querySelector('[data-object-id]'));
    const field = await screen.findByRole('textbox', { name: 'Text run 1' });
    expect(field.value).toBe('Original');
    fireEvent.change(field, { target: { value: 'Updated' } });
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(field.value).toBe('Original');
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0][0].bytes).toEqual(bytes);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Export' }).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Redo' }));
    expect(field.value).toBe('Updated');
    fireEvent.change(screen.getByLabelText('Bold run 1'), { target: { value: 'false' } });
    fireEvent.change(screen.getByLabelText('Italic run 1'), { target: { value: 'true' } });
    const size = screen.getByLabelText('Font size run 1');
    fireEvent.change(size, { target: { value: '36' } }); fireEvent.blur(size);
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    const result = save.mock.calls[1][0];
    const before = await JSZip.loadAsync(bytes), after = await JSZip.loadAsync(result.bytes);
    expect(Object.keys(after.files).sort()).toEqual(Object.keys(before.files).sort());
    for (const [name, entry] of Object.entries(before.files)) {
      if (!entry.dir && !result.dirtyParts.includes(name)) expect(await after.file(name).async('uint8array')).toEqual(await entry.async('uint8array'));
    }
    const reopened = await openPresentation(result.bytes, { format });
    expect(reopened.document.slides[0].objects[0].text.paragraphs[0].runs[0].text).toBe('Updated');
    if (format === 'pptx') expect(reopened.document.slides[0].objects[0].text.paragraphs[0].runs[0].style).toMatchObject({ b: '0', i: '1', sz: '3600' });
    else expect(reopened.document.slides[0].objects[0].text.paragraphs[0].runs[0].extensions.odpAppearance).toMatchObject({ bold: false, italic: true, fontSize: 36 });
    expect(reopened.document.slides[1].objects[0].text.paragraphs[0].runs[0].text).toBe('Untouched');
    reopened.dispose();
    fireEvent.change(screen.getByLabelText('Open PPTX or ODP'), { target: { files: [new File([result.bytes], `edited.${format}`)] } });
    await waitFor(() => expect(screen.getByLabelText(`edited.${format}`)).toBeTruthy());
    fireEvent.click(screen.getByRole('region', { name: 'Slide canvas' }).querySelector('[data-object-id]'));
    expect(screen.getByRole('textbox', { name: 'Text run 1' }).value).toBe('Updated');
  });
});
