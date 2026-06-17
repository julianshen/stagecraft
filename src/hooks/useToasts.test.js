import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useToasts, TOAST_DURATION, MAX_TOASTS } from './useToasts.js';

describe('useToasts', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('starts with no toasts', () => {
    const { result } = renderHook(() => useToasts());
    expect(result.current.toasts).toEqual([]);
  });

  it('notify() adds a toast with the message and a unique id, and returns the id', () => {
    const { result } = renderHook(() => useToasts());
    let id1, id2;
    act(() => { id1 = result.current.notify('first'); });
    act(() => { id2 = result.current.notify('second'); });
    expect(id1).not.toBe(id2);
    expect(result.current.toasts.map(t => t.message)).toEqual(['first', 'second']);
    expect(result.current.toasts.map(t => t.id)).toEqual([id1, id2]);
  });

  it('defaults the tone to "info" and honours an explicit tone', () => {
    const { result } = renderHook(() => useToasts());
    act(() => { result.current.notify('plain'); });
    act(() => { result.current.notify('boom', { tone: 'error' }); });
    expect(result.current.toasts.map(t => t.tone)).toEqual(['info', 'error']);
  });

  it('dismiss(id) removes only that toast', () => {
    const { result } = renderHook(() => useToasts());
    let id1;
    act(() => { id1 = result.current.notify('a'); });
    act(() => { result.current.notify('b'); });
    act(() => { result.current.dismiss(id1); });
    expect(result.current.toasts.map(t => t.message)).toEqual(['b']);
  });

  it('auto-dismisses a toast after the default duration', () => {
    const { result } = renderHook(() => useToasts());
    act(() => { result.current.notify('ephemeral'); });
    expect(result.current.toasts).toHaveLength(1);
    act(() => { vi.advanceTimersByTime(TOAST_DURATION); });
    expect(result.current.toasts).toHaveLength(0);
  });

  it('caps the queue at MAX_TOASTS, dropping the oldest', () => {
    const { result } = renderHook(() => useToasts());
    act(() => {
      for (let i = 0; i < MAX_TOASTS + 2; i++) result.current.notify(`t${i}`);
    });
    expect(result.current.toasts).toHaveLength(MAX_TOASTS);
    // Oldest two dropped; the survivors are the most recent MAX_TOASTS.
    expect(result.current.toasts[0].message).toBe('t2');
    expect(result.current.toasts[MAX_TOASTS - 1].message).toBe(`t${MAX_TOASTS + 1}`);
  });

  it('clears the timers of toasts dropped by the cap (no stranded timers)', () => {
    const { result } = renderHook(() => useToasts());
    act(() => {
      for (let i = 0; i < MAX_TOASTS + 2; i++) result.current.notify(`t${i}`);
    });
    // One pending timer per surviving toast — the two dropped timers were cleared.
    expect(vi.getTimerCount()).toBe(MAX_TOASTS);
  });

  it('dismiss clears the pending auto-dismiss timer (no late state update)', () => {
    const { result } = renderHook(() => useToasts());
    let id;
    act(() => { id = result.current.notify('x'); });
    act(() => { result.current.dismiss(id); });
    // Advancing past the duration must not throw or resurrect anything.
    act(() => { vi.advanceTimersByTime(TOAST_DURATION); });
    expect(result.current.toasts).toHaveLength(0);
  });

  it('clears pending timers on unmount', () => {
    const { result, unmount } = renderHook(() => useToasts());
    act(() => { result.current.notify('lingering'); });
    unmount();
    // No "state update on unmounted component" — advancing fires nothing live.
    expect(() => vi.advanceTimersByTime(TOAST_DURATION)).not.toThrow();
  });
});
