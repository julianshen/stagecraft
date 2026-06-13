import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import PresenterView from './PresenterView.jsx';

const origRO = globalThis.ResizeObserver;
beforeAll(() => { globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }; });
afterAll(() => { globalThis.ResizeObserver = origRO; });

const deck = {
  title: 'D',
  sections: [{ id: 's1', name: 'Main', slides: ['a', 'b', 'c', 'd', 'e'] }],
  slides: [
    { id: 'a', layout: 'cover', title: 'Cover' },
    { id: 'b', layout: 'text', title: 'B' },
    { id: 'c', layout: 'text', title: 'C' },
    { id: 'd', layout: 'text', title: 'D4' },
    { id: 'e', layout: 'thanks', title: 'Thanks' },
  ],
};

describe('PresenterView', () => {
  it('starts on the first slide (the cover), not the demo deep-link', () => {
    const { getByText } = render(<PresenterView deck={deck} onExit={vi.fn()} />);
    expect(getByText(/slide 1 of 5/)).toBeTruthy();
  });

  it('renders nothing for an empty deck', () => {
    const { container } = render(<PresenterView deck={null} onExit={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('toggles a blackout overlay with the B key', () => {
    const { container } = render(<PresenterView deck={deck} onExit={vi.fn()} />);
    expect(container.querySelector('.presenter-blackout')).toBeNull();
    fireEvent.keyDown(window, { key: 'b' });
    expect(container.querySelector('.presenter-blackout')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'b' });
    expect(container.querySelector('.presenter-blackout')).toBeNull();
  });

  it('does not blackout on a modifier+B chord (e.g. Ctrl+Shift+B toggles the browser bookmarks bar)', () => {
    const { container } = render(<PresenterView deck={deck} onExit={vi.fn()} />);
    fireEvent.keyDown(window, { key: 'b', metaKey: true });        // a single chord — must be ignored
    expect(container.querySelector('.presenter-blackout')).toBeNull();
    fireEvent.keyDown(window, { key: 'B', ctrlKey: true, shiftKey: true }); // Ctrl+Shift+B too
    expect(container.querySelector('.presenter-blackout')).toBeNull();
    fireEvent.keyDown(window, { key: 'b' });                       // bare b still works
    expect(container.querySelector('.presenter-blackout')).toBeTruthy();
  });

  it('toggles blackout from the control button too', () => {
    const { container, getByText } = render(<PresenterView deck={deck} onExit={vi.fn()} />);
    fireEvent.click(getByText(/Blackout/).closest('button'));
    expect(container.querySelector('.presenter-blackout')).toBeTruthy();
  });

  it('does not exit when blackout is dismissed — Esc still exits', () => {
    const onExit = vi.fn();
    render(<PresenterView deck={deck} onExit={onExit} />);
    fireEvent.keyDown(window, { key: 'b' }); // blackout on
    expect(onExit).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('toggles the laser from the control button', () => {
    const { getByText } = render(<PresenterView deck={deck} onExit={vi.fn()} />);
    const laserBtn = getByText(/Laser/).closest('button');
    expect(laserBtn.className).not.toContain('active');
    fireEvent.click(laserBtn);
    expect(laserBtn.className).toContain('active');
  });
});
