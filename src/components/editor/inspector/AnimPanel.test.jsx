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
  });
});
