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

  it('does not flicker blackout while the B key auto-repeats (held down)', () => {
    const { container } = render(<PresenterView deck={deck} onExit={vi.fn()} />);
    fireEvent.keyDown(window, { key: 'b' });               // intentional press → on
    fireEvent.keyDown(window, { key: 'b', repeat: true });  // OS auto-repeat → ignored (else it toggles off)
    expect(container.querySelector('.presenter-blackout')).toBeTruthy(); // still on, no flicker
  });

  it('clears the laser dot when toggled off, so re-enabling does not flash the old position', () => {
    const rect = { left: 0, top: 0, width: 800, height: 400, right: 800, bottom: 400 };
    const spy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(rect);
    try {
      const { container, getByText } = render(<PresenterView deck={deck} onExit={vi.fn()} />);
      const laserBtn = getByText(/Laser/).closest('button');
      fireEvent.click(laserBtn); // laser on
      const layer = container.querySelector('.laser-layer');
      fireEvent.pointerEnter(layer, { clientX: 400, clientY: 200 });
      fireEvent.pointerMove(layer, { clientX: 400, clientY: 200 });
      expect(container.querySelector('.laser-dot')).toBeTruthy(); // dot shows where the pointer is
      fireEvent.click(laserBtn); // laser off
      fireEvent.click(laserBtn); // laser on again — must start clean, no stale dot
      expect(container.querySelector('.laser-dot')).toBeNull();
    } finally {
      spy.mockRestore();
    }
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

  it('stops laser tracking while blacked out (no capture layer behind the black)', () => {
    const { container, getByText } = render(<PresenterView deck={deck} onExit={vi.fn()} />);
    fireEvent.click(getByText(/Laser/).closest('button'));
    expect(container.querySelector('.laser-layer')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'b' }); // blackout on
    expect(container.querySelector('.laser-layer')).toBeNull(); // nothing to track under black
  });

  it('toggles the laser from the control button', () => {
    const { getByText } = render(<PresenterView deck={deck} onExit={vi.fn()} />);
    const laserBtn = getByText(/Laser/).closest('button');
    expect(laserBtn.className).not.toContain('active');
    fireEvent.click(laserBtn);
    expect(laserBtn.className).toContain('active');
  });
});
