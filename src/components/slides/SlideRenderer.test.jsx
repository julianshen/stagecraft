import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ElementsLayer, Slide } from './SlideRenderer.jsx';

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
