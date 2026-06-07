import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { editSlideMock } = vi.hoisted(() => ({ editSlideMock: vi.fn() }));
vi.mock('../../../lib/llmClient.js', () => ({ editSlide: editSlideMock }));

import DefaultAIDrawer from './DefaultAIDrawer.jsx';

const slide = { id: 'a', layout: 'text', title: 'Old' };

beforeEach(() => editSlideMock.mockReset());

describe('DefaultAIDrawer', () => {
  it('clears the prompt input after sending a typed message', async () => {
    editSlideMock.mockResolvedValue({ title: 'New' });
    render(<DefaultAIDrawer onClose={vi.fn()} slideNum={1} slide={slide} onApplyPatch={vi.fn()} />);
    const input = screen.getByPlaceholderText(/Ask Co-pilot/i);
    await userEvent.type(input, 'rewrite this');
    expect(input).toHaveValue('rewrite this');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(input).toHaveValue('');
  });

  it('applies the AI patch to the current slide and confirms', async () => {
    editSlideMock.mockResolvedValue({ title: 'Punchier', body: 'Tighter copy' });
    const onApplyPatch = vi.fn();
    render(<DefaultAIDrawer onClose={vi.fn()} slideNum={1} slide={slide} onApplyPatch={onApplyPatch} />);
    await userEvent.type(screen.getByPlaceholderText(/Ask Co-pilot/i), 'make it punchier');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(editSlideMock).toHaveBeenCalledWith(slide, 'make it punchier');
    expect(onApplyPatch).toHaveBeenCalledWith({ title: 'Punchier', body: 'Tighter copy' });
    expect(await screen.findByText(/Applied changes to: title, body/)).toBeInTheDocument();
  });

  it('shows a fallback message when the model returns no usable patch', async () => {
    editSlideMock.mockResolvedValue(null);
    const onApplyPatch = vi.fn();
    render(<DefaultAIDrawer onClose={vi.fn()} slideNum={1} slide={slide} onApplyPatch={onApplyPatch} />);
    await userEvent.type(screen.getByPlaceholderText(/Ask Co-pilot/i), 'do something weird');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(onApplyPatch).not.toHaveBeenCalled();
    expect(await screen.findByText(/couldn't turn that into a slide edit/i)).toBeInTheDocument();
  });

  it('applies a suggestion chip as an instruction', async () => {
    editSlideMock.mockResolvedValue({ layout: 'list', items: ['a', 'b'] });
    const onApplyPatch = vi.fn();
    render(<DefaultAIDrawer onClose={vi.fn()} slideNum={1} slide={slide} onApplyPatch={onApplyPatch} />);
    await userEvent.click(screen.getByText('Turn into a bulleted list'));
    expect(editSlideMock).toHaveBeenCalledWith(slide, 'Turn into a bulleted list');
    expect(onApplyPatch).toHaveBeenCalledWith({ layout: 'list', items: ['a', 'b'] });
  });
});
