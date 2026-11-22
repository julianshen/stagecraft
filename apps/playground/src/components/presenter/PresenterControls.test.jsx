import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import PresenterControls from './PresenterControls.jsx';

function renderControls(overrides = {}) {
  const props = {
    idx: 0, total: 5, elapsed: 0,
    laser: false, setLaser: vi.fn(),
    blackout: false, setBlackout: vi.fn(),
    onPrev: vi.fn(), onNext: vi.fn(), onExit: vi.fn(), onResetClock: vi.fn(),
    ...overrides,
  };
  return { ...render(<PresenterControls {...props} />), props };
}

describe('PresenterControls', () => {
  it('toggles blackout when the Blackout button is clicked', () => {
    const { getByText, props } = renderControls();
    fireEvent.click(getByText(/Blackout/).closest('button'));
    expect(props.setBlackout).toHaveBeenCalledTimes(1);
    // a function updater so it flips relative to the latest state
    expect(props.setBlackout.mock.calls[0][0](false)).toBe(true);
  });

  it('marks the Blackout control active while blacked out', () => {
    const { getByText } = renderControls({ blackout: true });
    const btn = getByText(/Blackout/).closest('button');
    expect(btn.className).toContain('active');
  });

  it('toggles the laser when the Laser button is clicked', () => {
    const { getByText, props } = renderControls();
    fireEvent.click(getByText(/Laser/).closest('button'));
    expect(props.setLaser).toHaveBeenCalledTimes(1);
    expect(props.setLaser.mock.calls[0][0](false)).toBe(true);
  });

  it('shows the elapsed clock with no invented target when none is set', () => {
    const { getByText, queryByText } = renderControls({ elapsed: 65 });
    expect(getByText('01:05')).toBeInTheDocument();
    expect(queryByText(/target/)).toBeNull();
  });

  it('shows the talk target when one is set', () => {
    const { getByText } = renderControls({ elapsed: 0, target: 40 });
    expect(getByText(/target 40:00/)).toBeInTheDocument();
  });

  it('flags the clock once the target is exceeded', () => {
    const { getByText } = renderControls({ elapsed: 41 * 60, target: 40 });
    expect(getByText('41:00').className).toContain('over');
  });

  it('resets the clock from the Reset button', () => {
    const { getByRole, props } = renderControls({ elapsed: 30 });
    fireEvent.click(getByRole('button', { name: /reset/i }));
    expect(props.onResetClock).toHaveBeenCalledTimes(1);
  });
});
