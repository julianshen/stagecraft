import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import TopBar from './TopBar.jsx';

const base = { view: 'editor', setView: vi.fn(), deckTitle: 'My Deck' };

describe('view branches', () => {
  it('renders a search input in home view', () => {
    render(<TopBar {...base} view="home" searchQuery="q" onSearchChange={vi.fn()} />);
    expect(screen.getByPlaceholderText('Search decks and slides…')).toBeInTheDocument();
  });

  it('calls onSearchChange when the search input changes', () => {
    const onSearchChange = vi.fn();
    render(<TopBar {...base} view="home" searchQuery="" onSearchChange={onSearchChange} />);
    fireEvent.change(screen.getByPlaceholderText('Search decks and slides…'), { target: { value: 'foo' } });
    expect(onSearchChange).toHaveBeenCalledWith('foo');
  });

  it('renders the Settings label in settings view', () => {
    render(<TopBar {...base} view="settings" />);
    // topbar-title shows "Settings" (distinct from the nav button label)
    const title = document.querySelector('.topbar-title');
    expect(title.textContent).toMatch(/Settings/);
  });

  it('shows the deck title in editor view', () => {
    render(<TopBar {...base} view="editor" savedAt={null} />);
    expect(screen.getByText('My Deck')).toBeInTheDocument();
  });
});

describe('saved badge', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
  });
  afterEach(() => vi.useRealTimers());

  it('shows "Saved · just now" for a save under 5s ago', () => {
    render(<TopBar {...base} savedAt={998_000} />);
    expect(screen.getByText('Saved · just now')).toBeInTheDocument();
  });

  it('shows seconds for a save 5s–59s ago', () => {
    render(<TopBar {...base} savedAt={990_000} />); // 10s ago
    expect(screen.getByText('Saved · 10s ago')).toBeInTheDocument();
  });

  it('shows minutes for a save 60s–59m ago', () => {
    render(<TopBar {...base} savedAt={880_000} />); // 2m ago
    expect(screen.getByText('Saved · 2m ago')).toBeInTheDocument();
  });

  it('shows hours for a save >= 60m ago', () => {
    render(<TopBar {...base} savedAt={1_000_000 - 7200_000} />); // 2h ago
    expect(screen.getByText('Saved · 2h ago')).toBeInTheDocument();
  });

  it('ticks every second in editor view', () => {
    render(<TopBar {...base} savedAt={994_000} />); // 6s ago
    expect(screen.getByText('Saved · 6s ago')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(2000));
    expect(screen.getByText('Saved · 8s ago')).toBeInTheDocument();
  });

  it('ticks every second in sorter view', () => {
    render(<TopBar {...base} view="sorter" savedAt={994_000} />); // 6s ago
    expect(screen.getByText('Saved · 6s ago')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(2000));
    expect(screen.getByText('Saved · 8s ago')).toBeInTheDocument();
  });

  it('shows plain "Saved" when savedAt is null (no timestamp available)', () => {
    vi.useRealTimers();
    render(<TopBar {...base} savedAt={null} />);
    expect(screen.getByText('Saved')).toBeInTheDocument();
  });
});
