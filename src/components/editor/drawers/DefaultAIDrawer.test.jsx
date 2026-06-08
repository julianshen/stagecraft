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
    expect(onApplyPatch).toHaveBeenCalledWith({ title: 'Punchier', body: 'Tighter copy' }, 'a');
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
    expect(onApplyPatch).toHaveBeenCalledWith({ layout: 'list', items: ['a', 'b'] }, 'a');
  });

  it('does not claim success when there is no active slide', async () => {
    const onApplyPatch = vi.fn();
    render(<DefaultAIDrawer onClose={vi.fn()} slideNum={1} slide={undefined} onApplyPatch={onApplyPatch} />);
    await userEvent.type(screen.getByPlaceholderText(/Ask Co-pilot/i), 'do it');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(editSlideMock).not.toHaveBeenCalled();
    expect(onApplyPatch).not.toHaveBeenCalled();
    expect(await screen.findByText(/Select a slide to edit first/i)).toBeInTheDocument();
  });

  it('ignores an empty prompt', async () => {
    render(<DefaultAIDrawer onClose={vi.fn()} slideNum={1} slide={slide} onApplyPatch={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(editSlideMock).not.toHaveBeenCalled();
  });

  it('shows the fallback (no success) when every patch field is rejected', async () => {
    editSlideMock.mockResolvedValue({ title: { text: 'Q' } }); // object scalar → sanitized away
    const onApplyPatch = vi.fn();
    render(<DefaultAIDrawer onClose={vi.fn()} slideNum={1} slide={slide} onApplyPatch={onApplyPatch} />);
    await userEvent.type(screen.getByPlaceholderText(/Ask Co-pilot/i), 'go');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(onApplyPatch).not.toHaveBeenCalled();
    expect(await screen.findByText(/couldn't turn that into a slide edit/i)).toBeInTheDocument();
  });

  it('reports only the fields that survive sanitization', async () => {
    editSlideMock.mockResolvedValue({ title: 'Kept', items: 'bad-non-array' }); // items dropped
    const onApplyPatch = vi.fn();
    render(<DefaultAIDrawer onClose={vi.fn()} slideNum={1} slide={slide} onApplyPatch={onApplyPatch} />);
    await userEvent.type(screen.getByPlaceholderText(/Ask Co-pilot/i), 'go');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(onApplyPatch).toHaveBeenCalled();
    const msg = await screen.findByText(/Applied changes to:/);
    expect(msg.textContent).toMatch(/title/);
    expect(msg.textContent).not.toMatch(/items/);
  });

  it('sends on Cmd/Ctrl+Enter from the input', async () => {
    editSlideMock.mockResolvedValue({ title: 'Q' });
    const onApplyPatch = vi.fn();
    render(<DefaultAIDrawer onClose={vi.fn()} slideNum={1} slide={slide} onApplyPatch={onApplyPatch} />);
    const input = screen.getByPlaceholderText(/Ask Co-pilot/i);
    await userEvent.type(input, 'go{Control>}{Enter}{/Control}');
    expect(editSlideMock).toHaveBeenCalledWith(slide, 'go');
  });

  it('targets the slide the edit was generated for (not the live selection)', async () => {
    // Resolve editSlide only after the test lets it; meanwhile the prop "slide"
    // is what was captured at send time — its id must be the patch target.
    editSlideMock.mockResolvedValue({ title: 'Done' });
    const onApplyPatch = vi.fn();
    render(<DefaultAIDrawer onClose={vi.fn()} slideNum={1} slide={{ id: 'orig', layout: 'text' }} onApplyPatch={onApplyPatch} />);
    await userEvent.type(screen.getByPlaceholderText(/Ask Co-pilot/i), 'go');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(onApplyPatch).toHaveBeenCalledWith({ title: 'Done' }, 'orig');
  });
});
