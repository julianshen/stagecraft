import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { stubLocalStorage } from '../../test/localStorage.js';
import { GENERAL_STORAGE_KEY } from '../../lib/generalSettings.js';
import StatusBar from './StatusBar.jsx';

const store = stubLocalStorage();
const renderBar = (props = {}) => render(<StatusBar zoom={62} setZoom={vi.fn()} {...props} />);

describe('StatusBar', () => {
  it('reports the real snapping and ruler settings (defaults on)', () => {
    renderBar();
    expect(screen.getByText('Snap: 8px grid + guides')).toBeInTheDocument();
    expect(screen.getByText('Rulers: on')).toBeInTheDocument();
  });

  it('reflects settings turned off in Settings → General', () => {
    store.set(GENERAL_STORAGE_KEY, JSON.stringify({ snapToGrid: false, showRulers: false }));
    renderBar();
    expect(screen.getByText('Snap: off')).toBeInTheDocument();
    expect(screen.getByText('Rulers: off')).toBeInTheDocument();
  });

  it('shows no static save badge or language (the top bar owns save state; language is not supported)', () => {
    const { container } = renderBar();
    expect(container.textContent).not.toMatch(/autosave|Saved|en-US/);
  });

  it('shows the slide size and the selection geometry', () => {
    renderBar({ selected: { label: 'Box', x: 10, y: 20, w: 30, h: 40 } });
    expect(screen.getByText('1920×1080')).toBeInTheDocument();
    expect(screen.getByText(/Box · x 10 y 20 · w 30 h 40/)).toBeInTheDocument();
  });
});
