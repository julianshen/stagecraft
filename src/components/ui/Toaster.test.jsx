import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import Toaster from './Toaster.jsx';

const toasts = [
  { id: 1, message: 'Saved', tone: 'success' },
  { id: 2, message: 'Could not read the image', tone: 'error' },
];

describe('Toaster', () => {
  it('renders nothing when there are no toasts', () => {
    const { container } = render(<Toaster toasts={[]} onDismiss={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders one row per toast with its message', () => {
    const { getByText } = render(<Toaster toasts={toasts} onDismiss={() => {}} />);
    expect(getByText('Saved')).toBeInTheDocument();
    expect(getByText('Could not read the image')).toBeInTheDocument();
  });

  it('marks the toast with its tone class', () => {
    const { getByText } = render(<Toaster toasts={toasts} onDismiss={() => {}} />);
    expect(getByText('Could not read the image').closest('.toast')).toHaveClass('toast-error');
    expect(getByText('Saved').closest('.toast')).toHaveClass('toast-success');
  });

  it('exposes the stack as a polite live region for screen readers', () => {
    const { container } = render(<Toaster toasts={toasts} onDismiss={() => {}} />);
    const region = container.querySelector('.toaster');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toHaveAttribute('role', 'status');
  });

  it('the dismiss button fires onDismiss with the toast id', () => {
    const onDismiss = vi.fn();
    const { getAllByLabelText } = render(<Toaster toasts={toasts} onDismiss={onDismiss} />);
    fireEvent.click(getAllByLabelText('Dismiss')[1]);
    expect(onDismiss).toHaveBeenCalledWith(2);
  });

  it('does not throw when onDismiss is omitted', () => {
    const { getAllByLabelText } = render(<Toaster toasts={toasts} />);
    expect(() => fireEvent.click(getAllByLabelText('Dismiss')[0])).not.toThrow();
  });

  it('falls back to the info tone when a toast has none', () => {
    const { getByText } = render(<Toaster toasts={[{ id: 9, message: 'hi' }]} onDismiss={() => {}} />);
    expect(getByText('hi').closest('.toast')).toHaveClass('toast-info');
  });
});
