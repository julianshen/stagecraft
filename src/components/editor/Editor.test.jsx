import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import Editor from './Editor.jsx';

// CanvasSlide (rendered deep inside Editor) needs ResizeObserver, which jsdom
// lacks. Stub it for this file and restore after.
const origRO = globalThis.ResizeObserver;
beforeAll(() => {
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
});
afterAll(() => { globalThis.ResizeObserver = origRO; });

const agendaDeck = () => ({
  theme: 'indigo', title: 'Deck',
  sections: [{ id: 'sec1', name: 'Sec', slides: ['ag'] }],
  slides: [{ id: 'ag', layout: 'agenda', title: 'Plan', items: [{ n: '01', t: 'A', d: 'B' }] }],
});

function renderEditor(deck, onDeckChange) {
  return render(
    <Editor deck={deck} onDeckChange={onDeckChange} accent="indigo" layoutVariant="standard"
      density="comfortable" onPresent={vi.fn()} onOpenExport={vi.fn()} />,
  );
}

describe('Editor changeLayout', () => {
  it('clears carried-over collections that don’t fit the new layout (agenda→list)', () => {
    // Switching layout must behave like the AI/inline patch path (mergeSlide
    // clears mismatched collections), so the slide never carries items the new
    // layout can't render or the inspector can't edit. Otherwise a list slide
    // keeps agenda object items, and every Data-tab edit is dropped by the gate.
    const onDeckChange = vi.fn();
    renderEditor(agendaDeck(), onDeckChange);

    // The Layout select button (class 'select') shows the current layout label;
    // 'Agenda' also appears as a DesignPanel preset, so target the select button.
    const layoutBtn = [...document.querySelectorAll('button.select')].find((b) => b.textContent.includes('Agenda'));
    fireEvent.click(layoutBtn); // open the Layout menu
    const popover = document.querySelector('.menu-pop');
    fireEvent.click(within(popover).getByText('List')); // pick the List layout

    expect(onDeckChange).toHaveBeenCalledTimes(1);
    const next = onDeckChange.mock.calls[0][0](agendaDeck()); // apply the updater
    const slide = next.slides.find((s) => s.id === 'ag');
    expect(slide.layout).toBe('list');
    expect(slide.items).toBeUndefined(); // agenda objects don't fit list → cleared
  });

  it('does not fire a deck update when the picked layout is already current', () => {
    // Re-selecting the active layout would otherwise churn a no-op deck update,
    // re-render, and a debounced PUT sync — guard it.
    const onDeckChange = vi.fn();
    renderEditor(agendaDeck(), onDeckChange);
    const layoutBtn = [...document.querySelectorAll('button.select')].find((b) => b.textContent.includes('Agenda'));
    fireEvent.click(layoutBtn);
    const popover = document.querySelector('.menu-pop');
    fireEvent.click(within(popover).getByText('Agenda')); // pick the CURRENT layout
    expect(onDeckChange).not.toHaveBeenCalled();
  });
});
