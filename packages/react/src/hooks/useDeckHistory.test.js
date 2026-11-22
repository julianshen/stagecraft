import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDeckHistory, MAX_HISTORY, COALESCE_MS } from './useDeckHistory.js';

// Date.now drives burst-coalescing; control it with fake timers + setSystemTime.
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
afterEach(() => vi.useRealTimers());

const A = { title: 'A' };
const B = { title: 'B' };
const C = { title: 'C' };

// Advance the clock past the coalesce window so the next commit is a new step.
function gap() { vi.setSystemTime(Date.now() + COALESCE_MS + 1); }

describe('useDeckHistory', () => {
  it('starts at the initial deck with nothing to undo or redo', () => {
    const { result } = renderHook(() => useDeckHistory(A));
    expect(result.current.deck).toBe(A);
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
  });

  it('accepts a lazy initializer (like useState)', () => {
    const { result } = renderHook(() => useDeckHistory(() => A));
    expect(result.current.deck).toBe(A);
  });

  it('commit(value) advances the deck and enables undo', () => {
    const { result } = renderHook(() => useDeckHistory(A));
    act(() => { result.current.commit(B); });
    expect(result.current.deck).toBe(B);
    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(false);
  });

  it('commit(updater) receives the current deck', () => {
    const { result } = renderHook(() => useDeckHistory({ n: 1 }));
    act(() => { result.current.commit((prev) => ({ n: prev.n + 1 })); });
    expect(result.current.deck).toEqual({ n: 2 });
  });

  it('a no-op commit (same ref) records no history step', () => {
    const { result } = renderHook(() => useDeckHistory(A));
    act(() => { result.current.commit((prev) => prev); }); // returns same ref
    expect(result.current.deck).toBe(A);
    expect(result.current.canUndo).toBe(false);
  });

  it('undo restores the previous deck and enables redo', () => {
    const { result } = renderHook(() => useDeckHistory(A));
    act(() => { result.current.commit(B); gap(); });
    act(() => { result.current.undo(); });
    expect(result.current.deck).toBe(A);
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(true);
  });

  it('redo re-applies the undone deck', () => {
    const { result } = renderHook(() => useDeckHistory(A));
    act(() => { result.current.commit(B); gap(); });
    act(() => { result.current.undo(); });
    act(() => { result.current.redo(); });
    expect(result.current.deck).toBe(B);
    expect(result.current.canRedo).toBe(false);
  });

  it('undo/redo are no-ops at the ends of the timeline', () => {
    const { result } = renderHook(() => useDeckHistory(A));
    act(() => { result.current.undo(); });   // nothing to undo
    expect(result.current.deck).toBe(A);
    act(() => { result.current.commit(B); gap(); });
    act(() => { result.current.redo(); });   // nothing to redo (no undo yet)
    expect(result.current.deck).toBe(B);
  });

  it('a new commit after undo clears the redo stack (branching)', () => {
    const { result } = renderHook(() => useDeckHistory(A));
    act(() => { result.current.commit(B); gap(); });
    act(() => { result.current.undo(); });          // back to A, redo→B available
    expect(result.current.canRedo).toBe(true);
    act(() => { result.current.commit(C); gap(); }); // new branch
    expect(result.current.deck).toBe(C);
    expect(result.current.canRedo).toBe(false);     // B is gone
  });

  it('walks back through several discrete steps', () => {
    const { result } = renderHook(() => useDeckHistory(A));
    act(() => { result.current.commit(B); gap(); });
    act(() => { result.current.commit(C); gap(); });
    act(() => { result.current.undo(); });
    expect(result.current.deck).toBe(B);
    act(() => { result.current.undo(); });
    expect(result.current.deck).toBe(A);
  });

  describe('burst coalescing', () => {
    it('edits within COALESCE_MS collapse into one undo step', () => {
      const { result } = renderHook(() => useDeckHistory(A));
      act(() => { result.current.commit(B); });               // new step (from A)
      vi.setSystemTime(Date.now() + COALESCE_MS);             // still within window
      act(() => { result.current.commit(C); });               // coalesces into the B step
      // One undo jumps past the whole burst, back to A.
      act(() => { result.current.undo(); });
      expect(result.current.deck).toBe(A);
      expect(result.current.canUndo).toBe(false);
    });

    it('an edit after a pause starts a new undo step', () => {
      const { result } = renderHook(() => useDeckHistory(A));
      act(() => { result.current.commit(B); });
      gap();
      act(() => { result.current.commit(C); });               // new step
      act(() => { result.current.undo(); });
      expect(result.current.deck).toBe(B);                    // only C undone
    });

    it('a commit immediately after undo is not coalesced into the undone burst', () => {
      const { result } = renderHook(() => useDeckHistory(A));
      act(() => { result.current.commit(B); gap(); });
      act(() => { result.current.undo(); });                  // back to A
      act(() => { result.current.commit(C); });               // no time gap, but distinct step
      act(() => { result.current.undo(); });
      expect(result.current.deck).toBe(A);                    // C undone, not coalesced away
    });
  });

  it('caps history at MAX_HISTORY, dropping the oldest steps', () => {
    const { result } = renderHook(() => useDeckHistory({ i: 0 }));
    act(() => {
      for (let i = 1; i <= MAX_HISTORY + 5; i++) { result.current.commit({ i }); gap(); }
    });
    // Undo as far as possible; we can only reach back MAX_HISTORY steps. Each
    // undo is its own act() so result.current refreshes between iterations.
    let undos = 0;
    while (result.current.canUndo && undos <= MAX_HISTORY + 10) {
      act(() => { result.current.undo(); });
      undos++;
    }
    expect(undos).toBe(MAX_HISTORY);
  });

  describe('reset (deck open / external adoption)', () => {
    it('replaces the deck without recording a history step', () => {
      const { result } = renderHook(() => useDeckHistory(A));
      act(() => { result.current.commit(B); gap(); });
      act(() => { result.current.reset(C); });
      expect(result.current.deck).toBe(C);
      expect(result.current.canUndo).toBe(false); // prior timeline cleared
      expect(result.current.canRedo).toBe(false);
    });

    it('clears a pending redo stack too', () => {
      const { result } = renderHook(() => useDeckHistory(A));
      act(() => { result.current.commit(B); gap(); });
      act(() => { result.current.undo(); });       // redo→B available
      act(() => { result.current.reset(C); });
      expect(result.current.canRedo).toBe(false);
    });
  });

  it('keeps stable callback identities across renders', () => {
    const { result, rerender } = renderHook(() => useDeckHistory(A));
    const { commit, undo, redo, reset } = result.current;
    rerender();
    expect(result.current.commit).toBe(commit);
    expect(result.current.undo).toBe(undo);
    expect(result.current.redo).toBe(redo);
    expect(result.current.reset).toBe(reset);
  });
});
