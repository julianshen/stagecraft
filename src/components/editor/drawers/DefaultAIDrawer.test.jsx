import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { editSlideMock } = vi.hoisted(() => ({ editSlideMock: vi.fn() }));
vi.mock('../../../lib/llmClient.js', () => ({ editSlide: editSlideMock }));

import DefaultAIDrawer from './DefaultAIDrawer.jsx';

const slide = { id: 'a', layout: 'text', title: 'Old' };

beforeEach(() => editSlideMock.mockReset());

// onApplyPatch is the source of truth: it returns the patch keys that actually
// applied against the latest deck (or [] when nothing applied).
describe('DefaultAIDrawer', () => {
  it('clears the prompt input after sending a typed message', async () => {
    editSlideMock.mockResolvedValue({ title: 'New' });
    render(<DefaultAIDrawer onClose={vi.fn()} slideNum={1} slide={slide} onApplyPatch={vi.fn().mockReturnValue(['title'])} />);
    const input = screen.getByPlaceholderText(/Ask Co-pilot/i);
    await userEvent.type(input, 'rewrite this');
    expect(input).toHaveValue('rewrite this');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(input).toHaveValue('');
  });

  it('applies the AI patch and confirms the applied fields', async () => {
    editSlideMock.mockResolvedValue({ title: 'Punchier', body: 'Tighter copy' });
    const onApplyPatch = vi.fn().mockReturnValue(['title', 'body']);
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
    const onApplyPatch = vi.fn().mockReturnValue(['layout', 'items']);
    render(<DefaultAIDrawer onClose={vi.fn()} slideNum={1} slide={slide} onApplyPatch={onApplyPatch} />);
    await userEvent.click(screen.getByText('Turn into a bulleted list'));
    expect(editSlideMock).toHaveBeenCalledWith(slide, 'Turn into a bulleted list');
    expect(onApplyPatch).toHaveBeenCalledWith({ layout: 'list', items: ['a', 'b'] }, 'a');
  });

  it('does not send when there is no active slide', async () => {
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

  it('shows the fallback when nothing applied (every field rejected or slide gone)', async () => {
    editSlideMock.mockResolvedValue({ title: { text: 'Q' } });
    const onApplyPatch = vi.fn().mockReturnValue([]); // latest-deck sanitization dropped everything
    render(<DefaultAIDrawer onClose={vi.fn()} slideNum={1} slide={slide} onApplyPatch={onApplyPatch} />);
    await userEvent.type(screen.getByPlaceholderText(/Ask Co-pilot/i), 'go');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(onApplyPatch).toHaveBeenCalled();
    expect(await screen.findByText(/couldn't turn that into a slide edit/i)).toBeInTheDocument();
  });

  it('reports only the fields the callback says applied', async () => {
    editSlideMock.mockResolvedValue({ title: 'Kept', items: 'bad-non-array' });
    const onApplyPatch = vi.fn().mockReturnValue(['title']); // items dropped by latest-deck sanitize
    render(<DefaultAIDrawer onClose={vi.fn()} slideNum={1} slide={slide} onApplyPatch={onApplyPatch} />);
    await userEvent.type(screen.getByPlaceholderText(/Ask Co-pilot/i), 'go');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    const msg = await screen.findByText(/Applied changes to:/);
    expect(msg.textContent).toMatch(/title/);
    expect(msg.textContent).not.toMatch(/items/);
  });

  it('sends on Cmd/Ctrl+Enter from the input', async () => {
    editSlideMock.mockResolvedValue({ title: 'Q' });
    render(<DefaultAIDrawer onClose={vi.fn()} slideNum={1} slide={slide} onApplyPatch={vi.fn().mockReturnValue(['title'])} />);
    const input = screen.getByPlaceholderText(/Ask Co-pilot/i);
    await userEvent.type(input, 'go{Control>}{Enter}{/Control}');
    expect(editSlideMock).toHaveBeenCalledWith(slide, 'go');
  });

  it('targets the slide the edit was generated for (not the live selection)', async () => {
    editSlideMock.mockResolvedValue({ title: 'Done' });
    const onApplyPatch = vi.fn().mockReturnValue(['title']);
    render(<DefaultAIDrawer onClose={vi.fn()} slideNum={1} slide={{ id: 'orig', layout: 'text' }} onApplyPatch={onApplyPatch} />);
    await userEvent.type(screen.getByPlaceholderText(/Ask Co-pilot/i), 'go');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(onApplyPatch).toHaveBeenCalledWith({ title: 'Done' }, 'orig');
  });
});
