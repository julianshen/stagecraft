// <SlideCanvas> in a real browser (the `chromium` project): DPR-sized backing
// store, a paint on mount, and a repaint once an image has decoded.
import { describe, it, expect } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import SlideCanvas from './SlideCanvas.jsx';
import { createPaintEnv } from '../../canvas/paint.js';

const blank = (elements, extra = {}) => ({ id: 's', layout: 'blank', elements, ...extra });
// The RGBA at slide point (x, y) on a rendered SlideCanvas.
const pixelAt = (canvas, x, y) => {
  const k = canvas.width / 1920;
  return [...canvas.getContext('2d').getImageData(Math.floor(x * k), Math.floor(y * k), 1, 1).data];
};

// A 1×1 red PNG, made by the browser itself.
const redPng = () => {
  const c = document.createElement('canvas');
  c.width = c.height = 1;
  const g = c.getContext('2d');
  g.fillStyle = '#ff0000';
  g.fillRect(0, 0, 1, 1);
  return c.toDataURL('image/png');
};

describe('<SlideCanvas>', () => {
  it('sizes its backing store to its CSS size × devicePixelRatio, at the slide\'s aspect ratio', () => {
    const { container } = render(<div style={{ width: 480 }}><SlideCanvas slide={blank([])} deck={{}} /></div>);
    const canvas = container.querySelector('canvas');
    expect(canvas.width).toBe(Math.round(480 * devicePixelRatio));
    expect(canvas.height).toBe(Math.round(270 * devicePixelRatio));
    expect(canvas.getBoundingClientRect().height).toBeCloseTo(270, 0);
  });

  it('follows the deck\'s slide height (4:3)', () => {
    const { container } = render(<div style={{ width: 480 }}><SlideCanvas slide={blank([])} deck={{ size: { h: 1440 } }} /></div>);
    expect(container.querySelector('canvas').getBoundingClientRect().height).toBeCloseTo(360, 0);
  });

  it('takes an explicit width instead of its container\'s', () => {
    const { container } = render(<SlideCanvas slide={blank([])} deck={{}} width={192} />);
    expect(container.querySelector('canvas').getBoundingClientRect().width).toBeCloseTo(192, 0);
  });

  it('paints the slide on mount', () => {
    const slide = blank([{ id: 'r', type: 'rect', x: 0, y: 0, w: 960, h: 1080, fill: '#ff0000' }], { bgColor: '#0000ff' });
    const { container } = render(<div style={{ width: 480 }}><SlideCanvas slide={slide} deck={{}} env={createPaintEnv()} /></div>);
    const canvas = container.querySelector('canvas');
    expect(pixelAt(canvas, 400, 500).slice(0, 3)).toEqual([255, 0, 0]);
    expect(pixelAt(canvas, 1500, 500).slice(0, 3)).toEqual([0, 0, 255]);
  });

  it('repaints once a picture has decoded (the placeholder shows meanwhile)', async () => {
    const slide = blank([{ id: 'i', type: 'image', x: 0, y: 0, w: 1920, h: 1080, src: redPng(), fit: 'stretch' }]);
    const { container } = render(<div style={{ width: 480 }}><SlideCanvas slide={slide} deck={{}} env={createPaintEnv()} /></div>);
    const canvas = container.querySelector('canvas');
    await waitFor(() => expect(pixelAt(canvas, 960, 540).slice(0, 3)).toEqual([255, 0, 0]));
  });

  it('frees its backing store when it unmounts (rails mount many)', () => {
    const { container, unmount } = render(<SlideCanvas slide={blank([])} deck={{}} width={480} />);
    const canvas = container.querySelector('canvas');
    expect(canvas.width).toBeGreaterThan(0);
    unmount();
    expect([canvas.width, canvas.height]).toEqual([0, 0]);
  });

  it('exposes the slide\'s text to assistive tech (canvas text is otherwise invisible)', () => {
    const slide = blank([{ id: 't', type: 'text', x: 0, y: 0, w: 500, h: 100, content: 'Quarterly results', color: '#000000' }, { id: 'u', type: 'text', x: 0, y: 200, w: 500, h: 100, content: 'Up 12%', color: '#000000' }]);
    const { getByRole } = render(<SlideCanvas slide={slide} deck={{}} width={480} />);
    expect(getByRole('img').getAttribute('aria-label')).toBe('Quarterly results. Up 12%');
    const { getAllByRole } = render(<SlideCanvas slide={blank([])} deck={{}} width={480} label="Slide 3" />);
    expect(getAllByRole('img')[1].getAttribute('aria-label')).toBe('Slide 3');
  });
});
