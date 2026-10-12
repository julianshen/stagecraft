// Konva + react-konva@18 smoke test (the `chromium` project): a Stage mounts
// under React 18, a custom-painted shape is hit by its own path (not its
// bounding box), and a real mouse drag — down on the stage, move and up on the
// window, where Konva's drag tracking listens — moves it through Konva's drag
// machinery.
import { describe, it, expect, vi } from 'vitest';
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

// A mouse event at stage coordinates (x, y) on `target` (default: the stage's DOM).
const mouse = (stage, type, x, y, target = stage.content) => {
  const box = stage.content.getBoundingClientRect();
  target.dispatchEvent(new MouseEvent(type, { clientX: box.left + x, clientY: box.top + y, button: 0, buttons: type === 'mouseup' ? 0 : 1, bubbles: true }));
};

describe('Konva stage under React 18', () => {
  it('hit-tests a shape by its painted path', () => {
    const stage = createRef();
    const shape = createRef();
    render(
      <Stage ref={stage} width={200} height={200}>
        <Layer>
          <Shape ref={shape} fill="red" sceneFunc={triangle} />
        </Layer>
      </Stage>,
    );
    expect(stage.current.getIntersection({ x: 20, y: 20 })).toBe(shape.current); // inside the triangle
    expect(stage.current.getIntersection({ x: 90, y: 90 })).toBeNull(); // inside its box, outside the path
  });

  it('drags a shape with real mouse events, firing the drag lifecycle', () => {
    const stage = createRef();
    const shape = createRef();
    const onDragMove = vi.fn();
    const onDragEnd = vi.fn();
    render(
      <Stage ref={stage} width={200} height={200}>
        <Layer>
          <Shape ref={shape} fill="red" draggable sceneFunc={triangle} onDragMove={onDragMove} onDragEnd={onDragEnd} />
        </Layer>
      </Stage>,
    );
    const s = stage.current;
    mouse(s, 'mousedown', 20, 20);
    mouse(s, 'mousemove', 50, 40, window);
    mouse(s, 'mousemove', 70, 50, window);
    mouse(s, 'mouseup', 70, 50, window);

    expect(shape.current.position()).toEqual({ x: 50, y: 30 });
    expect(onDragMove).toHaveBeenCalled();
    expect(onDragEnd).toHaveBeenCalledTimes(1);
    expect(s.getIntersection({ x: 70, y: 50 })).toBe(shape.current); // hit where it was dropped
  });
});
