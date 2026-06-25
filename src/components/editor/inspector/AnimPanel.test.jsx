import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import AnimPanel from './AnimPanel.jsx';

describe('AnimPanel — per-slide transition editing', () => {
  const withTransition = { id: 's', layout: 'cover', transition: { type: 'fade', duration: 600 } };

  it('reflects the slide.transition type + duration', () => {
    render(<AnimPanel slide={withTransition} onApply={vi.fn()} />);
    expect(screen.getByLabelText('Transition type').value).toBe('fade');
    expect(screen.getByLabelText('Transition duration').value).toBe('600');
  });

  it('defaults to none / 480ms when the slide has no transition', () => {
    render(<AnimPanel slide={{ id: 's', layout: 'cover' }} onApply={vi.fn()} />);
    expect(screen.getByLabelText('Transition type').value).toBe('none');
    expect(screen.getByLabelText('Transition duration').value).toBe('480');
  });

  it('commits a type change as a full { transition } patch (preserving duration)', () => {
    const onApply = vi.fn();
    render(<AnimPanel slide={withTransition} onApply={onApply} />);
    fireEvent.change(screen.getByLabelText('Transition type'), { target: { value: 'slide' } });
    expect(onApply).toHaveBeenCalledWith({ transition: { type: 'slide', duration: 600 } });
  });

  it('commits a duration change as a full { transition } patch (preserving type)', () => {
    const onApply = vi.fn();
    render(<AnimPanel slide={withTransition} onApply={onApply} />);
    fireEvent.change(screen.getByLabelText('Transition duration'), { target: { value: '300' } });
    expect(onApply).toHaveBeenCalledWith({ transition: { type: 'fade', duration: 300 } });
  });

  it('ignores a non-positive / non-numeric duration (never commits an invalid patch)', () => {
    const onApply = vi.fn();
    render(<AnimPanel slide={withTransition} onApply={onApply} />);
    fireEvent.change(screen.getByLabelText('Transition duration'), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText('Transition duration'), { target: { value: 'abc' } });
    expect(onApply).not.toHaveBeenCalled();
  });

  it('lets the duration field hold an incomplete value while typing, then reverts on blur', () => {
    const onApply = vi.fn();
    render(<AnimPanel slide={withTransition} onApply={onApply} />); // duration 600
    const dur = screen.getByLabelText('Transition duration');
    fireEvent.change(dur, { target: { value: '' } }); // cleared mid-edit — tolerated locally
    expect(dur.value).toBe('');                        // not snapped back, so it stays editable
    expect(onApply).not.toHaveBeenCalled();            // empty never commits an invalid patch
    fireEvent.blur(dur);                               // blur reverts to the committed value
    expect(dur.value).toBe('600');
  });

  it('disables the controls when no slide is selected', () => {
    render(<AnimPanel slide={null} onApply={vi.fn()} />);
    expect(screen.getByLabelText('Transition type').disabled).toBe(true);
    expect(screen.getByLabelText('Transition duration').disabled).toBe(true);
    expect(screen.getByText('Add build').disabled).toBe(true);
  });
});

describe('AnimPanel — builds editing', () => {
  const withBuilds = { id: 's', layout: 'cover', builds: [{ type: 'fadeIn' }] };

  it('lists each slide.build with its type', () => {
    render(<AnimPanel slide={withBuilds} onApply={vi.fn()} />);
    expect(screen.getByLabelText('Build 1 type').value).toBe('fadeIn');
  });

  it('skips malformed build entries (null / non-object / unknown type) instead of crashing', () => {
    // MCP update_slide / PUT /api/deck bypass the gate, so a persisted deck can carry
    // junk; the editor guards its render the way isRenderableShadow/Gradient guard the
    // canvas — a raw render would deref b.type on null and crash the inspector.
    const messy = { id: 's', layout: 'cover', builds: [null, 42, {}, { type: 'spinIn' }, { type: 'riseIn' }] };
    render(<AnimPanel slide={messy} onApply={vi.fn()} />);
    expect(screen.getByLabelText('Build 1 type').value).toBe('riseIn'); // only the renderable entry
    expect(screen.queryByLabelText('Build 2 type')).toBeNull();
  });

  it('adds a build (appends a typed default to the array)', () => {
    const onApply = vi.fn();
    render(<AnimPanel slide={{ id: 's', layout: 'cover' }} onApply={onApply} />); // no builds yet
    fireEvent.click(screen.getByText('Add build'));
    expect(onApply).toHaveBeenCalledWith({ builds: [{ type: 'fadeIn' }] });
  });

  it('changes one build type, keeping the others, committing the whole array', () => {
    const onApply = vi.fn();
    const two = { id: 's', layout: 'cover', builds: [{ type: 'fadeIn' }, { type: 'riseIn' }] };
    render(<AnimPanel slide={two} onApply={onApply} />);
    fireEvent.change(screen.getByLabelText('Build 1 type'), { target: { value: 'zoomIn' } });
    expect(onApply).toHaveBeenCalledWith({ builds: [{ type: 'zoomIn' }, { type: 'riseIn' }] });
  });

  it('deletes a build', () => {
    const onApply = vi.fn();
    render(<AnimPanel slide={withBuilds} onApply={onApply} />);
    fireEvent.click(screen.getByTitle('Delete build 1'));
    expect(onApply).toHaveBeenCalledWith({ builds: [] });
  });
});
