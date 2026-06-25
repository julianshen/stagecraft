import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ElementsLayer, Slide, ChartByType, RoadmapGraphic, LineChart, DECK_CHROME_FIELDS } from './SlideRenderer.jsx';
import { CANVAS_BASELINE_PX } from '../../lib/fontBaselines.js';

describe('DECK_CHROME_FIELDS', () => {
  it('is frozen — it is shared across every thumbnail comparison and must not be mutated', () => {
    expect(Object.isFrozen(DECK_CHROME_FIELDS)).toBe(true);
  });
});

describe('ElementsLayer', () => {
  it('renders nothing when there are no elements', () => {
    const { container } = render(<ElementsLayer elements={[]} />);
    expect(container).toBeEmptyDOMElement();
    const { container: c2 } = render(<ElementsLayer elements={undefined} />);
    expect(c2).toBeEmptyDOMElement();
  });

  it('renders a text element with its content and a positioned shape', () => {
    const { container } = render(
      <ElementsLayer
        elements={[
          { id: 'e1', type: 'text', x: 100, y: 80, w: 300, h: 120, content: 'Hello' },
          { id: 'e2', type: 'rect', x: 0, y: 0, w: 200, h: 100 },
        ]}
      />
    );
    expect(screen.getByText('Hello')).toBeInTheDocument();
    // two positioned boxes inside the overlay layer
    expect(container.querySelector('div > div')).toBeTruthy();
    const textEl = screen.getByText('Hello');
    expect(textEl.style.left).toBe('100px');
    expect(textEl.style.width).toBe('300px');
  });

  it('applies rotation, opacity, and fill to elements', () => {
    const { container } = render(
      <ElementsLayer
        elements={[
          { id: 's', type: 'rect', x: 0, y: 0, w: 100, h: 100, rot: 45, opacity: 50, fill: '#ff0000' },
          { id: 't', type: 'text', x: 0, y: 0, w: 100, h: 40, content: 'Hi', fill: '#00ff00' },
        ]}
      />
    );
    const rect = container.querySelector('[style*="rotate"]');
    expect(rect.style.transform).toBe('rotate(45deg)');
    expect(rect.style.opacity).toBe('0.5');
    expect(rect.style.background).toContain('rgb(255, 0, 0)');
    const text = screen.getByText('Hi');
    expect(text.style.color).toContain('rgb(0, 255, 0)');
  });

  it('renders an image element as a positioned <img> with its src', () => {
    const { container } = render(
      <ElementsLayer elements={[{ id: 'im', type: 'image', x: 40, y: 20, w: 300, h: 200, src: 'data:image/png;base64,AAA' }]} />,
    );
    const img = container.querySelector('img');
    expect(img).toBeTruthy();
    expect(img.getAttribute('src')).toBe('data:image/png;base64,AAA');
    expect(img.style.left).toBe('40px');
    expect(img.style.width).toBe('300px');
    expect(img.style.objectFit).toBe('cover');
  });

  it('renders a placeholder (no <img>) for an image element with no src', () => {
    const { container } = render(
      <ElementsLayer elements={[{ id: 'im', type: 'image', x: 0, y: 0, w: 300, h: 200, src: '' }]} />,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText(/image/i)).toBeInTheDocument(); // a "No image" placeholder
  });

  it('renders a path element as an SVG polyline of its normalized points, stroked not filled', () => {
    const { container } = render(
      <ElementsLayer elements={[{ id: 'p', type: 'path', x: 100, y: 50, w: 200, h: 160, points: [[0, 0], [1, 0.5], [0.5, 1]], stroke: '#112233', strokeWidth: 3 }]} />,
    );
    const poly = container.querySelector('polyline');
    expect(poly).toBeTruthy();
    expect(poly.getAttribute('points')).toBe('0,0 1,0.5 0.5,1'); // 0..1, scaled into the box by the viewBox
    expect(poly.getAttribute('fill')).toBe('none');              // a freehand stroke, not a filled shape
    expect(poly.getAttribute('stroke')).toBe('#112233');
    const svg = poly.closest('svg');
    expect(svg.style.left).toBe('100px');  // positioned at the element box
    expect(svg.style.width).toBe('200px');
  });

  it('skips malformed points in a path instead of crashing the canvas', () => {
    // The renderer also draws non-gated decks (SAMPLE_DECK / manual edits / server PUT),
    // so a malformed inner point must not throw (it would unmount the whole canvas).
    const { container } = render(
      <ElementsLayer elements={[{ id: 'p', type: 'path', x: 0, y: 0, w: 100, h: 100, points: [[0, 0], null, [1, 1], [0.5]], stroke: '#111', strokeWidth: 2 }]} />,
    );
    const poly = container.querySelector('polyline');
    expect(poly.getAttribute('points')).toBe('0,0 1,1'); // null + the 1-coord point dropped, valid ones kept
  });

  it('renders distinct shape types (preserves the picked shape)', () => {
    const { container } = render(
      <ElementsLayer
        elements={[
          { id: 'c', type: 'circle', x: 0, y: 0, w: 100, h: 100 },
          { id: 't', type: 'triangle', x: 0, y: 0, w: 100, h: 100 },
          { id: 'l', type: 'line', x: 0, y: 0, w: 200, h: 100 },
        ]}
      />
    );
    const boxes = container.querySelectorAll('div > div');
    const circle = [...boxes].find(b => b.style.borderRadius === '50%');
    const triangle = [...boxes].find(b => b.style.clipPath.includes('polygon'));
    expect(circle).toBeTruthy();   // circle → 50% radius, not a plain rect
    expect(triangle).toBeTruthy(); // triangle → clip-path polygon, not a rect
    // A line renders at its real model height (its adjustable thickness), not a hard 8px cap.
    const line = [...boxes].find(b => b.style.height === '100px' && b.style.width === '200px');
    expect(line).toBeTruthy();
  });

  it('renders a stroke as a CSS border on box shapes (inset so the footprint holds), not on clip shapes', () => {
    const { container } = render(
      <ElementsLayer
        elements={[
          { id: 'r', type: 'rect', x: 0, y: 0, w: 100, h: 100, fill: '#fff', stroke: '#112233', strokeWidth: 4 },
          { id: 't', type: 'triangle', x: 0, y: 0, w: 100, h: 100, fill: '#fff', stroke: '#112233', strokeWidth: 4 },
        ]}
      />
    );
    const boxes = container.querySelectorAll('div > div');
    const rect = [...boxes].find(b => b.style.borderRadius && b.style.borderRadius !== '50%'); // rect → 8px radius
    expect(rect.style.border).toContain('4px');
    expect(rect.style.border).toContain('rgb(17, 34, 51)');  // #112233
    expect(rect.style.boxSizing).toBe('border-box');          // border inset, w/h footprint preserved
    const triangle = [...boxes].find(b => b.style.clipPath.includes('polygon'));
    expect(triangle.style.border).toBe('');                   // a clip-path border would be clipped away — not applied
  });

  it('applies the stroke dash style to a box-shape border (solid by default)', () => {
    const { container } = render(
      <ElementsLayer
        elements={[
          { id: 'd', type: 'rect', x: 0, y: 0, w: 100, h: 100, fill: '#fff', stroke: '#112233', strokeWidth: 4, strokeDash: 'dashed' },
          { id: 's', type: 'rect', x: 0, y: 0, w: 100, h: 100, fill: '#fff', stroke: '#112233', strokeWidth: 4 },
        ]}
      />
    );
    const boxes = [...container.querySelectorAll('div > div')];
    expect(boxes.find(b => b.style.border.includes('dashed'))).toBeTruthy(); // strokeDash → dashed border-style
    expect(boxes.find(b => b.style.border.includes('solid'))).toBeTruthy();  // absent → solid (default)
  });

  it('clamps a malformed strokeDash to a solid border (no vanished outline, parity with the export)', () => {
    // A gate-bypassing write (PUT /api/deck / manual) could set an unknown dash;
    // an invalid CSS border-style would drop the entire `border` shorthand.
    const { container } = render(
      <ElementsLayer elements={[{ id: 'r', type: 'rect', x: 0, y: 0, w: 100, h: 100, fill: '#fff', stroke: '#112233', strokeWidth: 4, strokeDash: 'wavy' }]} />,
    );
    const rect = [...container.querySelectorAll('div > div')].find(b => b.style.border.includes('4px'));
    expect(rect).toBeTruthy();                      // the outline survives (shorthand not invalidated)
    expect(rect.style.border).toContain('solid');   // unknown dash → solid, matching dashType's fallback
  });

  it('strokes a clip-path polygon via an SVG <polygon> outline overlay (a CSS border would be clipped)', () => {
    const { container } = render(
      <ElementsLayer elements={[{ id: 't', type: 'triangle', x: 0, y: 0, w: 100, h: 100, fill: '#abc', stroke: '#ff0000', strokeWidth: 3 }]} />,
    );
    const poly = container.querySelector('svg polygon');
    expect(poly).toBeTruthy();
    expect(poly.getAttribute('stroke')).toBe('#ff0000');
    expect(poly.getAttribute('fill')).toBe('none');            // outline only; the fill stays the clip-path div
    expect(poly.getAttribute('points')).toBe('0.5,0 1,1 0,1');  // triangle clip → 0..1 points
  });

  it('renders nothing for a stroke with fewer than two valid points', () => {
    const { container } = render(
      <ElementsLayer elements={[{ id: 'p', type: 'path', x: 0, y: 0, w: 100, h: 100, points: [[0, 0], null], stroke: '#111', strokeWidth: 2 }]} />,
    );
    expect(container.querySelector('polyline')).toBeNull(); // 1 valid point → no line to draw
  });

  it('renders a stroke-less clip polygon as a plain clip-path div (no SVG overlay)', () => {
    const { container } = render(
      <ElementsLayer elements={[{ id: 't', type: 'triangle', x: 0, y: 0, w: 100, h: 100, fill: '#abc' }]} />,
    );
    expect(container.querySelector('svg polygon')).toBeNull();
  });

  it('applies a text element line spacing to line-height (default 1.2)', () => {
    render(
      <ElementsLayer elements={[
        { id: 't', type: 'text', x: 0, y: 0, w: 200, h: 80, content: 'Spaced', lineSpacing: 1.8 },
        { id: 'd', type: 'text', x: 0, y: 0, w: 200, h: 80, content: 'Default' },
      ]} />,
    );
    expect(screen.getByText('Spaced').style.lineHeight).toBe('1.8');
    expect(screen.getByText('Default').style.lineHeight).toBe('1.2'); // absent → default
  });

  it('applies a dash array to a dashed pen path polyline (none when solid)', () => {
    const dashed = render(
      <ElementsLayer elements={[{ id: 'p', type: 'path', x: 0, y: 0, w: 100, h: 100, points: [[0, 0], [1, 1]], stroke: '#111', strokeWidth: 2, strokeDash: 'dashed' }]} />,
    );
    expect(dashed.container.querySelector('polyline').getAttribute('stroke-dasharray')).toBe('6 4'); // dashArray('dashed', 2)
    const solid = render(
      <ElementsLayer elements={[{ id: 'p', type: 'path', x: 0, y: 0, w: 100, h: 100, points: [[0, 0], [1, 1]], stroke: '#111', strokeWidth: 2 }]} />,
    );
    expect(solid.container.querySelector('polyline').getAttribute('stroke-dasharray')).toBeNull(); // solid → no dasharray
  });

  it('applies a drop-shadow filter to any element with a shadow — including clip shapes (filter follows the clip)', () => {
    const shadow = { color: '#112233', blur: 16, x: 4, y: 8 };
    const { container } = render(
      <ElementsLayer elements={[
        { id: 'r', type: 'rect', x: 0, y: 0, w: 100, h: 100, fill: '#fff', shadow },
        { id: 't', type: 'triangle', x: 0, y: 0, w: 100, h: 100, fill: '#fff', shadow },
        { id: 'p', type: 'rect', x: 0, y: 0, w: 100, h: 100, fill: '#fff' }, // no shadow
      ]} />
    );
    const boxes = [...container.querySelectorAll('div > div')];
    expect(boxes.filter(b => b.style.filter.includes('drop-shadow'))).toHaveLength(2); // rect + triangle
    expect(boxes.find(b => b.style.clipPath.includes('polygon')).style.filter).toContain('drop-shadow'); // clip shape too
    expect(boxes.find(b => b.style.borderRadius === '8px' && !b.style.filter)).toBeTruthy(); // the plain rect has none
  });

  it('skips a non-hex-colour shadow so the canvas matches the export (no indigo-fallback divergence)', () => {
    // A gate-bypassing write can persist `shadow: { color: 'red', … }`. dropShadowCss
    // would render it as a *valid* indigo drop-shadow (toHex falls back to #4f46e5),
    // but the export skips it (isHexColor rejects 'red'). Gate the canvas on the same
    // isRenderableShadow predicate so both surfaces agree — no shadow on either.
    const { container } = render(
      <ElementsLayer elements={[{ id: 'r', type: 'rect', x: 0, y: 0, w: 100, h: 100, fill: '#fff', shadow: { color: 'red', blur: 16, x: 5, y: 8 } }]} />
    );
    const boxes = [...container.querySelectorAll('div > div')];
    expect(boxes.some((b) => b.style.filter.includes('drop-shadow'))).toBe(false);
  });

  it('renders a gradient fill as a CSS linear-gradient on every shape (box / clip / line)', () => {
    const gradient = { from: '#4f46e5', to: '#06b6d4', angle: 135 };
    const { container } = render(
      <ElementsLayer elements={[
        { id: 'r', type: 'rect', x: 0, y: 0, w: 100, h: 100, fill: '#fff', gradient },     // box
        { id: 't', type: 'triangle', x: 0, y: 0, w: 100, h: 100, fill: '#fff', gradient },  // clip
        { id: 'l', type: 'line', x: 0, y: 0, w: 100, h: 8, fill: '#fff', gradient },         // line
      ]} />
    );
    const boxes = [...container.querySelectorAll('div > div')];
    expect(boxes.filter((b) => b.style.background.includes('linear-gradient') && b.style.background.includes('135deg'))).toHaveLength(3);
  });

  it('falls back to the solid fill for a malformed gradient (parity with the export blend)', () => {
    // A gate-bypassing write can persist a non-hex gradient; both surfaces must
    // ignore it and use the solid fill (no indigo-fallback gradient on canvas).
    const { container } = render(
      <ElementsLayer elements={[{ id: 'r', type: 'rect', x: 0, y: 0, w: 100, h: 100, fill: '#abcdef', gradient: { from: 'red', to: '#fff', angle: 90 } }]} />
    );
    const box = [...container.querySelectorAll('div > div')].find((b) => b.style.background);
    expect(box.style.background).not.toContain('linear-gradient');
    expect(box.style.background).toContain('rgb(171, 205, 239)'); // the solid #abcdef
  });

  it('renders no border when a box shape has no stroke (or a zero width)', () => {
    const { container } = render(
      <ElementsLayer elements={[{ id: 'r', type: 'rect', x: 0, y: 0, w: 100, h: 100, fill: '#fff', stroke: '#112233', strokeWidth: 0 }]} />
    );
    expect(container.querySelector('div > div').style.border).toBe(''); // width 0 → no outline
  });

  it('skips falsy entries and tolerates a non-array (malformed deck) without crashing', () => {
    const { container } = render(
      <ElementsLayer elements={[null, { id: 'c', type: 'circle', x: 0, y: 0, w: 100, h: 100 }, undefined]} />
    );
    expect(container.firstChild.childElementCount).toBe(1); // layer holds only the real circle, nulls skipped
    const { container: c2 } = render(<ElementsLayer elements={{}} />); // non-array (malformed)
    expect(c2.firstChild).toBeNull(); // renders nothing, no throw
  });
});

describe('Slide with elements', () => {
  it('renders the layout template plus the element overlay', () => {
    const slide = {
      id: 'a', layout: 'text', title: 'Body title',
      elements: [{ id: 'e1', type: 'text', x: 10, y: 10, w: 100, h: 40, content: 'Overlay text' }],
    };
    render(<Slide slide={slide} deck={{ title: 'Demo' }} sectionName="Intro" num={1} total={1} />);
    expect(screen.getByText('Overlay text')).toBeInTheDocument();
  });
});

describe('Slide — font-size baselines (single-sourced with the export basePx)', () => {
  // Find the LEAF <div> with exactly this text (shared by the per-item baseline
  // tests) — exclude ancestors whose concatenated textContent could coincide.
  const find = (c, t) => [...c.querySelectorAll('div')].find((el) => el.textContent === t && !el.querySelector('div'));

  it('sizes the text layout title/body from the shared CANVAS_BASELINE_PX', () => {
    const slide = { id: 'a', layout: 'text', title: 'Heading', body: 'Body copy' };
    const { container } = render(<Slide slide={slide} deck={{ title: 'Demo' }} sectionName="Intro" num={1} total={1} />);
    const h1 = container.querySelector('h1');
    const body = [...container.querySelectorAll('p')].find((el) => el.textContent === 'Body copy');
    expect(h1.style.fontSize).toBe(`${CANVAS_BASELINE_PX.text.title}px`); // 84px
    expect(body.style.fontSize).toBe(`${CANVAS_BASELINE_PX.text.body}px`); // 32px
  });

  it('sizes the cover + divider titles from the shared CANVAS_BASELINE_PX', () => {
    const { container: cov } = render(<Slide slide={{ id: 'c', layout: 'cover', title: 'Hero' }} deck={{ title: 'Demo' }} num={1} total={1} />);
    expect(cov.querySelector('h1').style.fontSize).toBe(`${CANVAS_BASELINE_PX.cover.title}px`); // 140px
    const { container: div } = render(<Slide slide={{ id: 'd', layout: 'divider', title: 'Part One', chapter: '1' }} deck={{ title: 'Demo' }} num={1} total={1} />);
    const dTitle = [...div.querySelectorAll('div')].find((el) => el.textContent === 'Part One');
    expect(dTitle.style.fontSize).toBe(`${CANVAS_BASELINE_PX.divider.title}px`); // 140px
  });

  it('sizes the agenda + list item fields from the shared CANVAS_BASELINE_PX', () => {
    const { container: ag } = render(<Slide slide={{ id: 'a', layout: 'agenda', title: 'Plan', items: [{ n: '07', t: 'First', d: 'Details' }] }} deck={{ title: 'Demo' }} num={1} total={1} />);
    expect(find(ag, '07').style.fontSize).toBe(`${CANVAS_BASELINE_PX.agenda['items.n']}px`);   // 36px
    expect(find(ag, 'First').style.fontSize).toBe(`${CANVAS_BASELINE_PX.agenda['items.t']}px`); // 38px
    expect(find(ag, 'Details').style.fontSize).toBe(`${CANVAS_BASELINE_PX.agenda['items.d']}px`); // 22px
    const { container: ls } = render(<Slide slide={{ id: 'l', layout: 'list', title: 'Items', items: ['Alpha'] }} deck={{ title: 'Demo' }} num={1} total={1} />);
    expect(find(ls, 'Alpha').style.fontSize).toBe(`${CANVAS_BASELINE_PX.list.items}px`); // 38px
  });

  it('sizes the agenda + list titles from the shared CANVAS_BASELINE_PX', () => {
    const { container: ag } = render(<Slide slide={{ id: 'a', layout: 'agenda', title: 'Plan' }} deck={{ title: 'Demo' }} num={1} total={1} />);
    expect(ag.querySelector('h1').style.fontSize).toBe(`${CANVAS_BASELINE_PX.agenda.title}px`); // 96px
    const { container: ls } = render(<Slide slide={{ id: 'l', layout: 'list', title: 'Items' }} deck={{ title: 'Demo' }} num={1} total={1} />);
    expect(ls.querySelector('h1').style.fontSize).toBe(`${CANVAS_BASELINE_PX.list.title}px`); // 84px
  });

  it('sizes the remaining layout titles (kpi/chart/split/table/risks/roadmap/thanks) from the shared CANVAS_BASELINE_PX', () => {
    // thanks' title <span> inherits its wrapping <h1>, so the h1 carries the size for all 7.
    for (const layout of ['kpi', 'chart', 'split', 'table', 'risks', 'roadmap', 'thanks']) {
      const { container } = render(<Slide slide={{ id: layout, layout, title: 'T' }} deck={{ title: 'Demo' }} num={1} total={1} />);
      expect(container.querySelector('h1').style.fontSize).toBe(`${CANVAS_BASELINE_PX[layout].title}px`);
    }
  });

  it('resizes the thanks title <span> when fmt.fontSize is set, overriding the inherited <h1> baseline', () => {
    // The export scales thanks by basePx 220; canvas↔export parity needs the span
    // to actually resize on the canvas (unformatted it merely inherits the h1's 220).
    render(<Slide slide={{ id: 't', layout: 'thanks', title: 'Goodbye', fmt: { title: { fontSize: CANVAS_BASELINE_PX.thanks.title * 2 } } }} deck={{ title: 'Demo' }} num={1} total={1} />);
    expect(screen.getByText('Goodbye').style.fontSize).toBe(`${CANVAS_BASELINE_PX.thanks.title * 2}px`); // 440px — 2× the inherited 220, matching the export's 2×
  });

  it('sizes the kpi/split/risks per-item data fields from the shared CANVAS_BASELINE_PX', () => {
    const { container: kp } = render(<Slide slide={{ id: 'k', layout: 'kpi', title: 'T', kpis: [{ val: 'KV', label: 'KL', delta: 'KD' }] }} deck={{ title: 'Demo' }} num={1} total={1} />);
    expect(find(kp, 'KV').style.fontSize).toBe(`${CANVAS_BASELINE_PX.kpi['kpis.val']}px`);   // 68
    expect(find(kp, 'KL').style.fontSize).toBe(`${CANVAS_BASELINE_PX.kpi['kpis.label']}px`); // 16
    expect(find(kp, 'KD').style.fontSize).toBe(`${CANVAS_BASELINE_PX.kpi['kpis.delta']}px`); // 14
    const { container: sp } = render(<Slide slide={{ id: 's', layout: 'split', title: 'T', stats: [{ val: 'SV', lbl: 'SL' }] }} deck={{ title: 'Demo' }} num={1} total={1} />);
    expect(find(sp, 'SV').style.fontSize).toBe(`${CANVAS_BASELINE_PX.split['stats.val']}px`); // 72
    expect(find(sp, 'SL').style.fontSize).toBe(`${CANVAS_BASELINE_PX.split['stats.lbl']}px`); // 20
    const { container: rk } = render(<Slide slide={{ id: 'r', layout: 'risks', title: 'T', items: [{ sev: 'high', t: 'RT', d: 'RD' }] }} deck={{ title: 'Demo' }} num={1} total={1} />);
    expect(find(rk, 'RT').style.fontSize).toBe(`${CANVAS_BASELINE_PX.risks['items.t']}px`); // 36
    expect(find(rk, 'RD').style.fontSize).toBe(`${CANVAS_BASELINE_PX.risks['items.d']}px`); // 24
  });
});

describe('Slide per-field formatting (fmt)', () => {
  const slide = {
    id: 'c', layout: 'cover', title: 'Quarterly Review',
    fmt: { title: { bold: true, italic: true, color: '#0088ff' } },
  };

  it('merges fmt into the field style on the read-only render (thumbnail/export parity)', () => {
    render(<Slide slide={slide} deck={{ title: 'Demo' }} num={1} total={1} />);
    const title = screen.getByText('Quarterly Review');
    expect(title.style.fontWeight).toBe('700');
    expect(title.style.fontStyle).toBe('italic');
    expect(title.style.color).toBe('rgb(0, 136, 255)');
    // read-only fields are not editable and carry no formatting hook
    expect(title).not.toHaveAttribute('data-fmt-key');
    expect(title).not.toHaveAttribute('contenteditable');
  });

  it('tags an editable field with its data-fmt-key and still applies the fmt style', () => {
    render(<Slide slide={slide} deck={{ title: 'Demo' }} num={1} total={1} editable onEditField={vi.fn()} />);
    const title = screen.getByText('Quarterly Review');
    expect(title).toHaveAttribute('data-fmt-key', 'title');
    expect(title.style.fontWeight).toBe('700');
  });

  it('formats a per-item (index-keyed) field and tags it for the toolbar', () => {
    // Per-item fmt keys are positional (items.0.t) — stable through inline edits;
    // an AI item rewrite re-applies by position. The renderer styles them via E().
    const agenda = {
      id: 'a', layout: 'agenda', title: 'Agenda',
      items: [{ n: '01', t: 'First point', d: 'detail' }, { n: '02', t: 'Second', d: 'more' }],
      fmt: { 'items.0.t': { bold: true, color: '#0088ff' } },
    };
    render(<Slide slide={agenda} deck={{ title: 'Demo' }} num={1} total={1} editable onEditField={vi.fn()} />);
    const first = screen.getByText('First point');
    expect(first).toHaveAttribute('data-fmt-key', 'items.0.t'); // a formatting target now
    expect(first.style.fontWeight).toBe('700');
    expect(first.style.color).toBe('rgb(0, 136, 255)');
    // a sibling item without fmt is untouched
    expect(screen.getByText('Second').style.fontWeight).not.toBe('700');
  });

  it('read-only render applies per-item fmt too (thumbnail/export parity)', () => {
    const agenda = {
      id: 'a', layout: 'agenda', title: 'Agenda',
      items: [{ n: '01', t: 'First point', d: 'detail' }],
      fmt: { 'items.0.t': { bold: true } },
    };
    render(<Slide slide={agenda} deck={{ title: 'Demo' }} num={1} total={1} />);
    const first = screen.getByText('First point');
    expect(first.style.fontWeight).toBe('700');
    expect(first).not.toHaveAttribute('data-fmt-key'); // read-only carries no hook
  });
});

describe('ChartByType (data-driven charts)', () => {
  it('renders bar values and category labels from the slide chart data', () => {
    const slide = { chart: { categories: ['Alpha', 'Beta'], series: [{ values: [42, 7] }] } };
    const { container } = render(<ChartByType type="bar" slide={slide} />);
    const t = container.textContent;
    expect(t).toContain('42');
    expect(t).toContain('Alpha');
    expect(t).toContain('Beta');
  });

  it('renders donut slice percentages + labels from the slide chart data', () => {
    const slide = { chart: { categories: ['A', 'B'], series: [{ values: [3, 1] }] } };
    const { container } = render(<ChartByType type="donut" slide={slide} />);
    expect(container.textContent).toContain('75%'); // 3 of 4
    expect(container.textContent).toContain('A');
  });

  it('falls back to the shared default (same as the export) when the slide has no chart', () => {
    const { container } = render(<ChartByType type="bar" slide={{}} />);
    expect(container.textContent).toContain('Q1'); // chartData() default category — matches chartSpec
  });

  it('renders a 100% single-slice donut (clamped arc, not blank)', () => {
    const slide = { chart: { categories: ['Only'], series: [{ values: [5] }] } };
    const { container } = render(<ChartByType type="donut" slide={slide} />);
    expect(container.querySelector('path')).toBeTruthy(); // arc drawn, not collapsed
    expect(container.textContent).toContain('100%');
  });
});

describe('ChartByType — multi-series', () => {
  const twoSeries = { chart: { categories: ['A', 'B'], series: [{ name: 'S1', values: [1, 2] }, { name: 'S2', values: [3, 4] }] } };

  it('line: draws a legend naming every series', () => {
    const { container } = render(<ChartByType type="line" slide={twoSeries} />);
    expect(container.textContent).toContain('S1');
    expect(container.textContent).toContain('S2');
  });

  it('bar: grouped bars (one per series per category) + legend', () => {
    const { container } = render(<ChartByType type="bar" slide={twoSeries} />);
    expect(container.querySelectorAll('[data-bar]').length).toBe(4); // 2 categories × 2 series
    expect(container.textContent).toContain('S1');
    expect(container.textContent).toContain('S2');
  });

  it('area: legend naming every series', () => {
    const { container } = render(<ChartByType type="area" slide={twoSeries} />);
    expect(container.textContent).toContain('S1');
    expect(container.textContent).toContain('S2');
  });

  it('scales the shared axis to the max across all series', () => {
    // S2 max is 4; the top tick should reflect a ceiling >= 4, not series[0]'s max of 2.
    const { container } = render(<ChartByType type="line" slide={twoSeries} />);
    const ticks = [...container.querySelectorAll('text')].map((t) => Number(t.textContent)).filter((n) => Number.isFinite(n));
    expect(Math.max(...ticks)).toBeGreaterThanOrEqual(4);
  });

  it('single-series charts show no legend (unchanged look)', () => {
    const solo = { chart: { categories: ['A', 'B'], series: [{ name: 'Solo', values: [1, 2] }] } };
    const { container } = render(<ChartByType type="line" slide={solo} />);
    expect(container.textContent).not.toContain('Solo'); // no legend for a single series
  });

  it('emits no NaN coordinates for non-finite or empty series values', () => {
    const { container: c1 } = render(<LineChart categories={['a', 'b', 'c']} series={[{ values: [1, NaN, undefined] }]} />);
    expect(c1.innerHTML).not.toContain('NaN');
    const { container: c2 } = render(<LineChart categories={['a']} series={[{ values: [] }]} />);
    expect(c2.innerHTML).not.toContain('NaN'); // empty series: no area path / badge, no crash
  });
});

describe('RoadmapGraphic (data-driven, shared model)', () => {
  it('renders the demo roadmap (default lanes + TODAY marker) when given no slide data', () => {
    render(<RoadmapGraphic />);
    ['Platform', 'Growth', 'AI', 'Enterprise'].forEach((n) => expect(screen.getByText(n)).toBeTruthy());
    expect(screen.getByText('TODAY')).toBeTruthy();
  });

  it('renders slide-supplied lanes/months and omits TODAY when unspecified', () => {
    render(<RoadmapGraphic slide={{ months: ['W1', 'W2'], lanes: [{ name: 'OnlyLane', items: [{ t: 0, d: 1, lbl: 'Task', state: 'done' }] }] }} />);
    expect(screen.getByText('OnlyLane')).toBeTruthy();
    expect(screen.getByText('W1')).toBeTruthy();
    expect(screen.queryByText('Platform')).toBeNull(); // demo data not used
    expect(screen.queryByText('TODAY')).toBeNull();     // no todayIndex on a custom roadmap
  });

  const barHeights = (container) =>
    [...container.querySelectorAll('rect')].map((r) => Number(r.getAttribute('height')));

  it('keeps the demo bar height at 36 for <=4 lanes', () => {
    const { container } = render(<RoadmapGraphic />);
    expect(barHeights(container).every((h) => h === 36)).toBe(true);
  });

  it('scales bar height down so dense (many-lane) roadmaps do not overlap rows', () => {
    const lanes = Array.from({ length: 20 }, (_, i) => ({ name: `L${i}`, items: [{ t: 0, d: 1, lbl: 'x', state: 'done' }] }));
    const { container } = render(<RoadmapGraphic slide={{ lanes }} />);
    barHeights(container).forEach((h) => expect(h).toBeLessThan(36)); // compressed, not fixed 36
  });
});

describe('Slide — roadmap legend', () => {
  it('drives the canvas legend from the shared status labels', () => {
    render(<Slide slide={{ layout: 'roadmap', title: 'R' }} deck={{ title: 'D' }} />);
    ['Shipped', 'In-flight', 'At risk', 'Planned'].forEach((l) => expect(screen.getByText(l)).toBeTruthy());
  });
});

describe('Slide — risks severity colours', () => {
  it('renders rows for known severities and falls back (no "undefined" style) for unknown ones', () => {
    const slide = { layout: 'risks', title: 'R', items: [
      { sev: 'high', t: 'H', d: 'hd' },
      { sev: 'wat', t: 'U', d: 'ud' }, // unknown severity
    ] };
    const { container } = render(<Slide slide={slide} deck={{ title: 'D' }} />);
    expect(screen.getByText('high risk')).toBeTruthy();
    expect(screen.getByText('wat risk')).toBeTruthy();
    // The old code produced `border-left: 6px solid undefined` for unknown sevs.
    expect(container.innerHTML).not.toContain('solid undefined');
  });
});

describe('slide chrome is content-driven, not sample-deck copy', () => {
  it('agenda renders the slide title, falling back to the stock heading', () => {
    const { container } = render(
      <Slide slide={{ id: 'a', layout: 'agenda', title: 'Our plan', items: [] }} deck={{ title: 'D' }} num={1} total={2} />,
    );
    expect(container.textContent).toContain('Our plan');
    const { container: c2 } = render(
      <Slide slide={{ id: 'a', layout: 'agenda', items: [] }} deck={{ title: 'D' }} num={1} total={2} />,
    );
    expect(c2.textContent).toContain("What we'll cover");
  });

  it('divider footer shows the deck title, not the sample-deck QBR string', () => {
    const { container } = render(
      <Slide slide={{ id: 'd', layout: 'divider', chapter: '01', title: 'Part one' }} deck={{ title: 'My Pitch' }} num={1} total={2} />,
    );
    expect(container.textContent).not.toContain('ATLAS · QBR');
    expect(container.textContent).toContain('MY PITCH');
  });

  it('thanks renders the slide title, falling back to Thanks.', () => {
    const { container } = render(
      <Slide slide={{ id: 't', layout: 'thanks', title: 'Merci', subtitle: 'à bientôt' }} deck={{ title: 'D' }} num={1} total={1} />,
    );
    expect(container.textContent).toContain('Merci.');
    const { container: c2 } = render(
      <Slide slide={{ id: 't', layout: 'thanks' }} deck={{ title: 'D' }} num={1} total={1} />,
    );
    expect(c2.textContent).toContain('Thanks.');
  });
});

describe('ElementsLayer text typography', () => {
  it('renders a text element with its font size/weight/style/align/family', () => {
    const { getByText } = render(<ElementsLayer elements={[{
      id: 't', type: 'text', x: 0, y: 0, w: 200, h: 60, content: 'Hi',
      fontSize: 64, bold: true, italic: true, underline: true, align: 'center', fontFamily: 'Georgia',
    }]} />);
    const el = getByText('Hi');
    expect(el.style.fontSize).toBe('64px');
    expect(el.style.fontWeight).toBe('700');
    expect(el.style.fontStyle).toBe('italic');
    expect(el.style.textDecoration).toContain('underline');
    expect(el.style.textAlign).toBe('center');
    expect(el.style.fontFamily).toBe('Georgia');
    expect(el.style.whiteSpace).toBe('pre-wrap'); // preserves newlines/spaces from the textarea
  });

  it('falls back to the defaults when no typography is set', () => {
    const { getByText } = render(<ElementsLayer elements={[{ id: 't', type: 'text', x: 0, y: 0, w: 200, h: 60, content: 'Plain' }]} />);
    const el = getByText('Plain');
    expect(el.style.fontSize).toBe('48px');
    expect(el.style.fontWeight).toBe('500');
  });
});

describe('Slide inline editing (editable)', () => {
  const renderEditable = (slide) => {
    const onEditField = vi.fn();
    const onApplyPatch = vi.fn(); // roadmap labels commit a full materialized patch through this
    const utils = render(<Slide slide={slide} deck={{ title: 'D' }} editable onEditField={onEditField} onApplyPatch={onApplyPatch} />);
    return { ...utils, onEditField, onApplyPatch };
  };
  const editFirst = (container, selector, text) => {
    const el = container.querySelector(selector);
    el.textContent = text;
    fireEvent.blur(el);
  };

  it('is read-only by default — text fields are not contenteditable', () => {
    const { container } = render(<Slide slide={{ id: 't', layout: 'text', title: 'A', body: 'B' }} deck={{ title: 'D' }} />);
    expect(container.querySelector('[contenteditable]')).toBeNull();
  });

  it('emits the field path + value for a scalar field (text title)', () => {
    const { container, onEditField } = renderEditable({ id: 't', layout: 'text', title: 'Old', body: 'B' });
    editFirst(container, 'h1[contenteditable="true"]', 'New');
    expect(onEditField).toHaveBeenCalledWith(['title'], 'New');
  });

  it('emits the nested path for an agenda item (Editor turns it into a patch)', () => {
    const slide = { id: 'a', layout: 'agenda', title: 'T', items: [{ n: '01', t: 'One', d: 'x' }, { n: '02', t: 'Two', d: 'y' }] };
    const { container, onEditField } = renderEditable(slide);
    const target = [...container.querySelectorAll('[contenteditable="true"]')].find((n) => n.textContent === 'Two');
    target.textContent = 'Two!';
    fireEvent.blur(target);
    expect(onEditField).toHaveBeenCalledWith(['items', 1, 't'], 'Two!');
  });

  // The three roadmap labels each commit the FULL materialized { months, lanes,
  // todayIndex } model via onApplyPatch (so a demo roadmap's defaults survive).
  const editForeign = (container, oldText, newText) => {
    const f = [...container.querySelectorAll('foreignObject [contenteditable="true"]')].find((n) => n.textContent === oldText);
    expect(f).toBeTruthy();
    f.textContent = newText;
    fireEvent.blur(f);
  };

  it('commits a roadmap lane-name edit as a full model patch (siblings preserved)', () => {
    const slide = { id: 'r', layout: 'roadmap', title: 'R', lanes: [
      { name: 'Platform', items: [{ t: 0, d: 2, lbl: 'X', state: 'done' }] },
      { name: 'Growth', items: [{ t: 1, d: 1, lbl: 'Y', state: 'planned' }] },
    ] };
    const { container, onApplyPatch } = renderEditable(slide);
    editForeign(container, 'Platform', 'Core');
    expect(onApplyPatch).toHaveBeenCalledTimes(1);
    const patch = onApplyPatch.mock.calls[0][0];
    expect(Object.keys(patch).sort()).toEqual(['lanes', 'months', 'todayIndex']); // full model, not sparse
    expect(patch.lanes.map((l) => l.name)).toEqual(['Core', 'Growth']);
  });

  it('commits a roadmap month-label edit as a full model patch', () => {
    const slide = { id: 'r', layout: 'roadmap', title: 'R', months: ['Jan', 'Feb'], lanes: [{ name: 'A', items: [{ t: 0, d: 1, lbl: 'M', state: 'done' }] }] };
    const { container, onApplyPatch } = renderEditable(slide);
    editForeign(container, 'Jan', 'Q1');
    const patch = onApplyPatch.mock.calls[0][0];
    expect(patch.months).toEqual(['Q1', 'Feb']);
    expect(patch.lanes).toHaveLength(1); // lanes carried along, not dropped
  });

  it('commits a roadmap milestone-label edit as a full model patch', () => {
    const slide = { id: 'r', layout: 'roadmap', title: 'R', months: ['Jan', 'Feb', 'Mar'], lanes: [{ name: 'A', items: [{ t: 0, d: 1, lbl: 'Mile', state: 'done' }] }] };
    const { container, onApplyPatch } = renderEditable(slide);
    editForeign(container, 'Mile', 'Mile2');
    const patch = onApplyPatch.mock.calls[0][0];
    expect(patch.lanes[0].items[0].lbl).toBe('Mile2');
  });

  it('commits a line-chart category-label edit as a full {chart} model patch', () => {
    const slide = { id: 'c', layout: 'chart', chartType: 'line', chart: { categories: ['Q1', 'Q2'], series: [{ name: 'S', values: [1, 2] }] } };
    const { container, onApplyPatch } = renderEditable(slide);
    editForeign(container, 'Q1', 'Jan');
    const patch = onApplyPatch.mock.calls[0][0];
    expect(patch.chart.categories).toEqual(['Jan', 'Q2']);
    expect(patch.chart.series).toEqual([{ name: 'S', values: [1, 2] }]); // series carried, not dropped
  });

  it('commits a bar-chart category-label edit (single-series path)', () => {
    const slide = { id: 'c', layout: 'chart', chartType: 'bar', chart: { categories: ['Q1', 'Q2'], series: [{ name: 'S', values: [1, 2] }] } };
    const { container, onApplyPatch } = renderEditable(slide);
    editForeign(container, 'Q2', 'H2');
    expect(onApplyPatch.mock.calls[0][0].chart.categories).toEqual(['Q1', 'H2']);
  });

  it('keeps chart category labels as non-editable SVG text when read-only (parity)', () => {
    const slide = { id: 'c', layout: 'chart', chartType: 'bar', chart: { categories: ['Q1'], series: [{ name: 'S', values: [1] }] } };
    const { container } = render(<Slide slide={slide} deck={{ title: 'D' }} num={1} total={1} />);
    expect(container.querySelector('foreignObject')).toBeNull();
    expect([...container.querySelectorAll('svg text')].some((t) => t.textContent === 'Q1')).toBe(true);
  });

  it('keeps the single-category edit box on-screen (no negative foreignObject x)', () => {
    const slide = { id: 'c', layout: 'chart', chartType: 'line', chart: { categories: ['Solo'], series: [{ name: 'S', values: [5] }] } };
    const { container } = renderEditable(slide);
    const xs = [...container.querySelectorAll('foreignObject')].map((f) => parseFloat(f.getAttribute('x')));
    expect(xs.length).toBeGreaterThanOrEqual(1);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
  });

  it('renders a falsy (0) category label rather than blanking it', () => {
    const slide = { id: 'c', layout: 'chart', chartType: 'bar', chart: { categories: [0, 'B'], series: [{ name: 'S', values: [1, 2] }] } };
    const { container } = render(<Slide slide={slide} deck={{ title: 'D' }} num={1} total={1} />);
    // category labels sit on the bottom axis (y = CH-CP+28 = 528); isolate them from y-axis ticks
    const catLabels = [...container.querySelectorAll('svg text')].filter((t) => t.getAttribute('y') === '528');
    expect(catLabels.some((t) => t.textContent === '0')).toBe(true);
  });

  it('commits a chart series-name edit (multi-series legend) as a full {chart} patch', () => {
    const slide = { id: 'c', layout: 'chart', chartType: 'line', chart: { categories: ['Q1', 'Q2'], series: [{ name: 'Alpha', values: [1, 2] }, { name: 'Beta', values: [3, 4] }] } };
    const { container, onApplyPatch } = renderEditable(slide);
    editForeign(container, 'Alpha', 'A2');
    const patch = onApplyPatch.mock.calls[0][0];
    expect(patch.chart.series.map((s) => s.name)).toEqual(['A2', 'Beta']);
    expect(patch.chart.categories).toEqual(['Q1', 'Q2']); // categories carried, not dropped
  });

  it('commits a donut legend label edit (a category) as a full {chart} patch', () => {
    const slide = { id: 'c', layout: 'chart', chartType: 'donut', chart: { categories: ['Slice1', 'Slice2'], series: [{ name: 'S', values: [10, 20] }] } };
    const { container, onApplyPatch } = renderEditable(slide);
    editForeign(container, 'Slice1', 'First');
    expect(onApplyPatch.mock.calls[0][0].chart.categories).toEqual(['First', 'Slice2']);
  });

  it('keeps chart legend labels as non-editable SVG text when read-only (parity)', () => {
    const slide = { id: 'c', layout: 'chart', chartType: 'donut', chart: { categories: ['Slice1'], series: [{ name: 'S', values: [10] }] } };
    const { container } = render(<Slide slide={slide} deck={{ title: 'D' }} num={1} total={1} />);
    expect(container.querySelector('foreignObject')).toBeNull();
    expect([...container.querySelectorAll('svg text')].some((t) => t.textContent === 'Slice1')).toBe(true);
  });

  it('keeps roadmap lane names as non-editable SVG text when read-only (parity)', () => {
    const slide = { id: 'r', layout: 'roadmap', title: 'R', lanes: [{ name: 'Platform', items: [] }] };
    const { container } = render(<Slide slide={slide} deck={{ title: 'D' }} num={1} total={1} />);
    expect(container.querySelector('[contenteditable]')).toBeNull(); // nothing editable off-canvas
    // the lane name is specifically a plain SVG <text>, not a foreignObject field
    const laneText = [...container.querySelectorAll('svg text')].find((t) => t.textContent === 'Platform');
    expect(laneText).toBeTruthy();
    expect(container.querySelector('foreignObject')).toBeNull();
    // MONTH_FONT defines no fontWeight → the month <text> must carry no spurious
    // font-weight attr (React omits undefined attrs), preserving byte-identity.
    const monthText = [...container.querySelectorAll('svg text')].find((t) => t.textContent === 'Jul');
    expect(monthText).toBeTruthy();
    expect(monthText.getAttribute('font-weight')).toBeNull();
  });

  it('keeps each editable lane-name field on its lane in a dense roadmap (no negative foreignObject y)', () => {
    // laneH shrinks below 32 past ~14 lanes; a fixed -16 offset would push the
    // edit field to a negative y, off its lane. The box must adapt to laneH.
    const lanes = Array.from({ length: 20 }, (_, i) => ({ name: `L${i}`, items: [{ t: 0, d: 1, lbl: 'x', state: 'done' }] }));
    const { container } = renderEditable({ id: 'r', layout: 'roadmap', title: 'R', lanes });
    // every editable label (lanes + months + milestones) must sit at a non-negative y
    const ys = [...container.querySelectorAll('foreignObject')].map((f) => parseFloat(f.getAttribute('y')));
    expect(ys.length).toBeGreaterThanOrEqual(20);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
  });

  // One representative edit path per remaining layout — proves each hand-wired
  // E([...path]) emits the right semantic coordinates (catches a path typo in a
  // layout the focused tests above don't exercise).
  it.each([
    ['kpi val', { id: 'k', layout: 'kpi', kpis: [{ label: 'L', val: '10', delta: '+1', target: 't' }] }, '10', ['kpis', 0, 'val'], '20'],
    ['kpi delta', { id: 'k', layout: 'kpi', kpis: [{ label: 'L', val: '10', delta: '+1', target: 't' }] }, '+1', ['kpis', 0, 'delta'], '+2'],
    ['split body', { id: 's', layout: 'split', body: 'Body', stats: [] }, 'Body', ['body'], 'New body'],
    ['split stat', { id: 's', layout: 'split', stats: [{ lbl: 'L', val: '5' }] }, '5', ['stats', 0, 'val'], '6'],
    ['risks item', { id: 'r', layout: 'risks', items: [{ sev: 'low', t: 'Risk', d: 'd' }] }, 'Risk', ['items', 0, 't'], 'Risk2'],
    ['list item', { id: 'l', layout: 'list', items: ['First'] }, 'First', ['items', 0], 'First2'],
    ['thanks subtitle', { id: 't', layout: 'thanks', title: 'T', subtitle: 'Sub' }, 'Sub', ['subtitle'], 'Sub2'],
    ['divider title', { id: 'd', layout: 'divider', title: 'Div', chapter: '1' }, 'Div', ['title'], 'Div2'],
    ['cover subtitle', { id: 'c', layout: 'cover', title: 'C', subtitle: 'CS' }, 'CS', ['subtitle'], 'CS2'],
  ])('emits the right path editing %s', (_name, slide, findText, path, newVal) => {
    const onEditField = vi.fn();
    const { container } = render(<Slide slide={slide} deck={{ title: 'D' }} editable onEditField={onEditField} />);
    const target = [...container.querySelectorAll('[contenteditable="true"]')].find((n) => n.textContent === findText);
    target.textContent = newVal;
    fireEvent.blur(target);
    expect(onEditField).toHaveBeenCalledWith(path, newVal);
  });

  it('uses the ORIGINAL array index when a falsy item precedes the edited one', () => {
    // A null at index 1 must not shift the edited item's index (filter-then-index
    // would have written to the wrong item → data corruption).
    const slide = { id: 'a', layout: 'agenda', title: 'T', items: [{ n: '01', t: 'One', d: 'x' }, null, { n: '03', t: 'Three', d: 'z' }] };
    const { container, onEditField } = renderEditable(slide);
    const target = [...container.querySelectorAll('[contenteditable="true"]')].find((n) => n.textContent === 'Three');
    target.textContent = 'Three!';
    fireEvent.blur(target);
    expect(onEditField).toHaveBeenCalledWith(['items', 2, 't'], 'Three!'); // index 2, not 1
  });

  it('emits the 2-D path for a table cell', () => {
    const slide = { id: 'tb', layout: 'table', title: 'T', columns: ['A', 'B'], rows: [['1', '2'], ['3', '4']] };
    const { container, onEditField } = renderEditable(slide);
    const target = [...container.querySelectorAll('[contenteditable="true"]')].find((n) => n.textContent === '4');
    target.textContent = '40';
    fireEvent.blur(target);
    expect(onEditField).toHaveBeenCalledWith(['rows', 1, 1], '40');
  });
});
