import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { AiDeckModal } from './AiDeckModal.jsx';

const draftOutline = vi.hoisted(() => vi.fn());
const buildDeck = vi.hoisted(() => vi.fn());
vi.mock('../../lib/aiDeck.js', () => ({ draftOutline, buildDeck }));

const outline = {
  title: 'Q3 Review',
  slides: [
    { layout: 'cover', title: 'Q3 Review', brief: 'Opening' },
    { layout: 'kpi', title: 'Numbers', brief: 'KPIs' },
    { layout: 'thanks', title: 'Thanks', brief: '' },
  ],
};

beforeEach(() => { draftOutline.mockReset(); buildDeck.mockReset(); });

function typeTopic(value = 'our Q3 results') {
  fireEvent.change(screen.getByLabelText('Deck topic'), { target: { value } });
}

describe('AiDeckModal', () => {
  it('drafts an outline from the topic and shows it for review', async () => {
    draftOutline.mockResolvedValue(outline);
    render(<AiDeckModal onClose={vi.fn()} onCreate={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Draft outline/ })).toBeDisabled();
    typeTopic();
    fireEvent.click(screen.getByRole('button', { name: /Draft outline/ }));
    expect(draftOutline).toHaveBeenCalledWith('our Q3 results');
    expect(await screen.findByText('Numbers')).toBeInTheDocument();
    expect(screen.getByText('Q3 Review', { selector: 'h4' })).toBeInTheDocument();
  });

  it('lets the user drop outline slides before generating', async () => {
    draftOutline.mockResolvedValue(outline);
    buildDeck.mockResolvedValue({ slides: [] });
    render(<AiDeckModal onClose={vi.fn()} onCreate={vi.fn()} />);
    typeTopic();
    fireEvent.click(screen.getByRole('button', { name: /Draft outline/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Numbers' }));
    fireEvent.click(screen.getByRole('button', { name: /Generate 2 slides/ }));
    await waitFor(() => expect(buildDeck).toHaveBeenCalled());
    expect(buildDeck.mock.calls[0][0].slides.map((s) => s.title)).toEqual(['Q3 Review', 'Thanks']);
  });

  it('generates the slides with live progress and hands the deck to onCreate', async () => {
    draftOutline.mockResolvedValue(outline);
    let progress;
    let finish;
    buildDeck.mockImplementation((o, { onProgress }) => { progress = onProgress; return new Promise((r) => { finish = r; }); });
    const onCreate = vi.fn(async () => {});
    render(<AiDeckModal onClose={vi.fn()} onCreate={onCreate} />);
    typeTopic();
    fireEvent.click(screen.getByRole('button', { name: /Draft outline/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Generate 3 slides/ }));
    await waitFor(() => expect(buildDeck).toHaveBeenCalled());
    act(() => progress(1, 3));
    expect(await screen.findByText(/Generating slide 2 of 3/)).toBeInTheDocument();
    const deck = { title: 'Q3 Review', slides: [] };
    act(() => finish(deck));
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith(deck));
  });

  it('shows a readable error and stays open when the AI call fails', async () => {
    draftOutline.mockRejectedValue(Object.assign(new Error('x'), { reason: 'unconfigured' }));
    const onClose = vi.fn();
    render(<AiDeckModal onClose={onClose} onCreate={vi.fn()} />);
    typeTopic();
    fireEvent.click(screen.getByRole('button', { name: /Draft outline/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/No API key configured/);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Draft outline/ })).toBeEnabled(); // can retry
  });

  it('reports an unusable outline in words', async () => {
    draftOutline.mockRejectedValue(Object.assign(new Error('x'), { reason: 'outline' }));
    render(<AiDeckModal onClose={vi.fn()} onCreate={vi.fn()} />);
    typeTopic();
    fireEvent.click(screen.getByRole('button', { name: /Draft outline/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('usable outline');
  });

  it('returns to the outline with an error when generation fails', async () => {
    draftOutline.mockResolvedValue(outline);
    buildDeck.mockRejectedValue(Object.assign(new Error('x'), { reason: 'rate-limit' }));
    render(<AiDeckModal onClose={vi.fn()} onCreate={vi.fn()} />);
    typeTopic();
    fireEvent.click(screen.getByRole('button', { name: /Draft outline/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Generate 3 slides/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/rate-limiting/);
    expect(screen.getByRole('button', { name: /Generate 3 slides/ })).toBeEnabled();
  });

  it('goes back from the outline to edit the topic, and closes on Cancel', async () => {
    draftOutline.mockResolvedValue(outline);
    const onClose = vi.fn();
    render(<AiDeckModal onClose={onClose} onCreate={vi.fn()} />);
    typeTopic('launch plan');
    fireEvent.click(screen.getByRole('button', { name: /Draft outline/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Back' }));
    expect(screen.getByLabelText('Deck topic')).toHaveValue('launch plan');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('keeps the generated deck when saving fails, and retries only the save', async () => {
    draftOutline.mockResolvedValue(outline);
    const deck = { title: 'Q3 Review', slides: [] };
    buildDeck.mockResolvedValue(deck);
    const onCreate = vi.fn().mockRejectedValueOnce(new Error('The deck library did not accept the new deck.')).mockResolvedValueOnce();
    render(<AiDeckModal onClose={vi.fn()} onCreate={onCreate} />);
    typeTopic();
    fireEvent.click(screen.getByRole('button', { name: /Draft outline/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Generate 3 slides/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('did not accept the new deck');
    fireEvent.click(screen.getByRole('button', { name: 'Retry save' }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(2));
    expect(buildDeck).toHaveBeenCalledTimes(1);
    expect(onCreate).toHaveBeenLastCalledWith(deck);
  });

  it('resumes generation from the slides that already succeeded', async () => {
    draftOutline.mockResolvedValue(outline);
    const done = [{ id: 'a' }, { id: 'b' }];
    buildDeck
      .mockRejectedValueOnce(Object.assign(new Error('x'), { reason: 'rate-limit', partial: done }))
      .mockResolvedValueOnce({ slides: [] });
    render(<AiDeckModal onClose={vi.fn()} onCreate={vi.fn(async () => {})} />);
    typeTopic();
    fireEvent.click(screen.getByRole('button', { name: /Draft outline/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Generate 3 slides/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/rate-limiting/);
    // the outline is frozen once slides exist, so the resume stays aligned
    expect(screen.queryByRole('button', { name: /^Remove / })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Resume (2 of 3 done)' }));
    await waitFor(() => expect(buildDeck).toHaveBeenCalledTimes(2));
    expect(buildDeck.mock.calls[1][1].done).toBe(done);
  });

  it('does not discard a drafted outline on a stray backdrop click', async () => {
    draftOutline.mockResolvedValue(outline);
    const onClose = vi.fn();
    const { container } = render(<AiDeckModal onClose={onClose} onCreate={vi.fn()} />);
    fireEvent.click(container.querySelector('.modal-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(1); // an empty topic step may close on backdrop
    onClose.mockClear();
    typeTopic();
    fireEvent.click(screen.getByRole('button', { name: /Draft outline/ }));
    await screen.findByText('Numbers');
    fireEvent.click(container.querySelector('.modal-backdrop'));
    expect(onClose).not.toHaveBeenCalled();
  });
});
