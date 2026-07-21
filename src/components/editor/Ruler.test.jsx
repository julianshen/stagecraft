import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { stubLocalStorage } from '../../test/localStorage.js';
import Ruler from './Ruler.jsx';

const store = stubLocalStorage();

// AC-5.1: Settings→General "Show rulers" governs whether the canvas rulers
// render. The setting is read once per mount — Settings and the editor are
// different views, so the remount on view switch picks up a toggle flip.
describe('Ruler show/hide (AC-5.1)', () => {
  it('AC-5.1: renders both rulers when the setting is absent (default on)', () => {
    const { container } = render(<Ruler/>);
    expect(container.querySelector('.canvas-ruler-h')).toBeTruthy();
    expect(container.querySelector('.canvas-ruler-v')).toBeTruthy();
  });

  it('AC-5.1: renders both rulers when showRulers is stored true', () => {
    store.set('stagecraft.general', JSON.stringify({ snapToGrid: true, showRulers: true }));
    const { container } = render(<Ruler/>);
    expect(container.querySelector('.canvas-ruler-h')).toBeTruthy();
    expect(container.querySelector('.canvas-ruler-v')).toBeTruthy();
  });

  it('AC-5.1: renders nothing when showRulers is stored false', () => {
    store.set('stagecraft.general', JSON.stringify({ snapToGrid: true, showRulers: false }));
    const { container } = render(<Ruler/>);
    expect(container.querySelector('.canvas-ruler-h')).toBeNull();
    expect(container.querySelector('.canvas-ruler-v')).toBeNull();
  });
});
