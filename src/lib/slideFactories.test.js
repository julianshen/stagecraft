import { describe, it, expect } from 'vitest';
import { newId, createTableSlide, createChartSlide, createTextSlide, createComponentSlide } from './slideFactories.js';
import { ROADMAP_STATES } from './roadmapSpec.js';

describe('newId', () => {
  it('is unique across calls and carries the kind prefix', () => {
    const a = newId('text');
    const b = newId('text');
    expect(a).not.toBe(b);
    expect(a.startsWith('text-')).toBe(true);
  });
});

describe('createTableSlide', () => {
  it('builds the requested dimensions with labelled first column', () => {
    const s = createTableSlide(2, 4);
    expect(s.layout).toBe('table');
    expect(s.columns).toHaveLength(4);
    expect(s.rows).toHaveLength(2);
    for (const row of s.rows) expect(row).toHaveLength(4);
    expect(s.rows[0][0]).toBe('Row 1');
  });
});

describe('createChartSlide', () => {
  it('carries explicit neutral starter data (not the shared demo fallback)', () => {
    // A fresh chart must not export the demo series as if it were content.
    const s = createChartSlide('bar');
    expect(s.chartType).toBe('bar');
    expect(s.chart.categories.length).toBeGreaterThan(0);
    expect(s.chart.series[0].values).toHaveLength(s.chart.categories.length);
  });

  it('titles by type with a fallback', () => {
    expect(createChartSlide('donut').title).toBe('Composition');
    expect(createChartSlide('mystery').title).toBe('New chart');
  });
});

describe('createTextSlide', () => {
  it('builds each style, defaulting to heading', () => {
    expect(createTextSlide('body').body).toMatch(/single idea/);
    expect(createTextSlide('subheading').title).toBe('Subheading');
    expect(createTextSlide('nope').title).toBe('New heading');
  });
});

describe('createComponentSlide', () => {
  it('routes table and chart to their dedicated factories', () => {
    expect(createComponentSlide('table').columns).toBeDefined();
    expect(createComponentSlide('chart').chartType).toBe('line');
  });

  it('split starter carries lbl/val stats the renderer and export read', () => {
    const s = createComponentSlide('split');
    expect(s.layout).toBe('split');
    expect(s.stats.length).toBeGreaterThan(0);
    expect(s.stats[0]).toHaveProperty('lbl');
    expect(s.stats[0]).toHaveProperty('val');
  });

  it('thanks starter carries a title and subtitle', () => {
    const s = createComponentSlide('thanks');
    expect(s.layout).toBe('thanks');
    expect(s.title).toBeTruthy();
    expect(s.subtitle).toBeTruthy();
  });

  it('cover starter exists so templates can override it instead of hand-building', () => {
    const s = createComponentSlide('cover');
    expect(s.layout).toBe('cover');
    expect(s.title).toBeTruthy();
  });

  it('roadmap starter carries neutral lanes (not the demo fallback milestones)', () => {
    const s = createComponentSlide('roadmap');
    expect(Array.isArray(s.lanes)).toBe(true);
    expect(s.lanes.length).toBeGreaterThan(0);
    for (const lane of s.lanes) {
      expect(lane.name).toBeTruthy();
      for (const it of lane.items) expect(ROADMAP_STATES).toContain(it.state);
    }
  });

  it('the text starter points at the Co-pilot', () => {
    expect(createComponentSlide('text').body).toMatch(/Co-pilot/);
  });

  it('falls back to a plain text slide for unknown ids', () => {
    const s = createComponentSlide('mystery');
    expect(s.layout).toBe('text');
    expect(s.title).toBe('New slide');
  });
});
