import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ElementsLayer, Slide, ChartByType, RoadmapGraphic, LineChart, DECK_CHROME_FIELDS } from './SlideRenderer.jsx';

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
