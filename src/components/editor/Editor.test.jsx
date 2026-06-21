import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { render, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Editor from './Editor.jsx';

// Interactions use user-event. The Layout menu is queried by class (.select /
// .menu-pop): LayoutMenu has no ARIA roles, and its 'Agenda' label collides with
// a DesignPanel preset, so role/text queries can't uniquely target it without
// adding ARIA to LayoutMenu (out of scope for this changeLayout fix).

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
  const openLayoutMenu = async () => {
    const layoutBtn = [...document.querySelectorAll('button.select')].find((b) => b.textContent.includes('Agenda'));
    await userEvent.click(layoutBtn); // open the Layout menu
    return document.querySelector('.menu-pop');
  };

  it('clears carried-over collections that don’t fit the new layout (agenda→list)', async () => {
    // Switching layout must behave like the AI/inline patch path (mergeSlide
    // clears mismatched collections), so the slide never carries items the new
    // layout can't render or the inspector can't edit. Otherwise a list slide
    // keeps agenda object items, and every Data-tab edit is dropped by the gate.
    const onDeckChange = vi.fn();
    renderEditor(agendaDeck(), onDeckChange);

    const popover = await openLayoutMenu();
    await userEvent.click(within(popover).getByText('List')); // pick the List layout

    expect(onDeckChange).toHaveBeenCalledTimes(1);
    const next = onDeckChange.mock.calls[0][0](agendaDeck()); // apply the updater
    const slide = next.slides.find((s) => s.id === 'ag');
    expect(slide.layout).toBe('list');
    expect(slide.items).toBeUndefined(); // agenda objects don't fit list → cleared
  });

  it('does not fire a deck update when the picked layout is already current', async () => {
    // Re-selecting the active layout would otherwise churn a no-op deck update,
    // re-render, and a debounced PUT sync — guard it.
    const onDeckChange = vi.fn();
    renderEditor(agendaDeck(), onDeckChange);
    const popover = await openLayoutMenu();
    await userEvent.click(within(popover).getByText('Agenda')); // pick the CURRENT layout
    expect(onDeckChange).not.toHaveBeenCalled();
  });
});

describe('Editor element grouping', () => {
  // jsdom drops shiftKey on PointerEvent; a MouseEvent typed as a pointer event
  // carries it and still triggers CanvasSlide's onPointerDown (see CanvasSlide.test).
  const fire = (node, type, init) => fireEvent(node, new MouseEvent(type, { bubbles: true, cancelable: true, ...init }));
  const click = (node, shiftKey = false) => { fire(node, 'pointerdown', { clientX: 0, clientY: 0, shiftKey }); fire(window, 'pointerup', {}); };
  const deckWith = (elements) => ({
    theme: 'indigo', title: 'D',
    sections: [{ id: 's', name: 'S', slides: ['c1'] }],
    slides: [{ id: 'c1', layout: 'text', title: 'T', body: '', elements }],
  });
  const E = (id, x, groupId) => ({ id, type: 'rect', x, y: 100, w: 100, h: 100, fill: '#aabbcc', ...(groupId ? { groupId } : {}) });

  it('clicking one grouped element selects the whole group (Delete removes every member)', () => {
    const deck = deckWith([E('a', 100, 'g1'), E('b', 400, 'g1'), E('z', 800)]);
    const onDeckChange = vi.fn();
    const { container } = renderEditor(deck, onDeckChange);
    click(container.querySelectorAll('.el-hit')[0]); // element a → expands to the group
    fireEvent.keyDown(document.body, { key: 'Delete' });
    const next = onDeckChange.mock.calls.at(-1)[0](deck);
    expect(next.slides[0].elements.map((e) => e.id)).toEqual(['z']); // a + b (the group) gone
  });

  it('⌘G stamps a single shared groupId onto the multi-selection', () => {
    const deck = deckWith([E('a', 100), E('b', 400), E('z', 800)]); // all ungrouped
    const onDeckChange = vi.fn();
    const { container } = renderEditor(deck, onDeckChange);
    const [hitA, hitB] = container.querySelectorAll('.el-hit');
    click(hitA); click(hitB, true); // select a, shift-add b
    fireEvent.keyDown(document.body, { key: 'g', metaKey: true });
    const next = onDeckChange.mock.calls.at(-1)[0](deck);
    const byId = Object.fromEntries(next.slides[0].elements.map((e) => [e.id, e]));
    expect(byId.a.groupId).toBeTruthy();
    expect(byId.a.groupId).toBe(byId.b.groupId); // shared
    expect('groupId' in byId.z).toBe(false);      // unselected, untouched
  });

  it('⌘⇧G ungroups (clicking a member selects the group, then strips the groupId)', () => {
    const deck = deckWith([E('a', 100, 'g1'), E('b', 400, 'g1'), E('z', 800)]);
    const onDeckChange = vi.fn();
    const { container } = renderEditor(deck, onDeckChange);
    click(container.querySelectorAll('.el-hit')[0]); // selects the group a,b
    fireEvent.keyDown(document.body, { key: 'G', metaKey: true, shiftKey: true });
    const next = onDeckChange.mock.calls.at(-1)[0](deck);
    const byId = Object.fromEntries(next.slides[0].elements.map((e) => [e.id, e]));
    expect('groupId' in byId.a).toBe(false);
    expect('groupId' in byId.b).toBe(false);
  });
});
