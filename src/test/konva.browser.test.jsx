// Konva + react-konva@18 smoke test (the `browser` project, headless Chromium):
// a Stage mounts under React 18, a custom-painted shape is hit by its own path
// (not its bounding box), and dragging moves it.
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { createRef } from 'react';
import { Stage, Layer, Shape } from 'react-konva';

// A right triangle (top-left, top-right, bottom-left) painted and hit by the same path.
const triangle = (ctx, shape) => {
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(100, 0);
  ctx.lineTo(0, 100);
  ctx.closePath();
  ctx.fillStrokeShape(shape);
};

describe('Konva stage under React 18', () => {
  it('hit-tests a shape by its painted path and drags it', () => {
    const stage = createRef();
    const shape = createRef();
    render(
      <Stage ref={stage} width={200} height={200}>
        <Layer>
          <Shape ref={shape} x={0} y={0} fill="red" draggable sceneFunc={triangle} />
        </Layer>
      </Stage>,
    );
    const s = stage.current;
    expect(s.getIntersection({ x: 20, y: 20 })).toBe(shape.current); // inside the triangle
    expect(s.getIntersection({ x: 90, y: 90 })).toBeNull(); // inside its box, outside the path

    shape.current.startDrag();
    shape.current.position({ x: 50, y: 30 });
    shape.current.stopDrag();
    expect(s.getIntersection({ x: 70, y: 50 })).toBe(shape.current);
  });
});
