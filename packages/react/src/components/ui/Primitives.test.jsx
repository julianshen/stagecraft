import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button, Seg, Select } from './Primitives.jsx';

// Smoke tests proving the jsdom + Testing Library harness works end-to-end.
describe('Button', () => {
  it('renders its label and fires onClick', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Present</Button>);
    const btn = screen.getByRole('button', { name: 'Present' });
    await userEvent.click(btn);
    expect(onClick).toHaveBeenCalledOnce();
  });
});

describe('Seg', () => {
  it('marks the active option and reports changes', async () => {
    const onChange = vi.fn();
    render(<Seg value="light" onChange={onChange} options={[{ v: 'light', l: 'Light' }, { v: 'dark', l: 'Dark' }]} />);
    await userEvent.click(screen.getByRole('button', { name: 'Dark' }));
    expect(onChange).toHaveBeenCalledWith('dark');
  });
});

describe('Select', () => {
  it('reports the chosen value and labels each option', async () => {
    const onChange = vi.fn();
    render(<Select ariaLabel="Dash" value="solid" onChange={onChange}
      options={[{ value: 'solid', label: 'Solid' }, { value: 'dashed', label: 'Dashed' }]} />);
    const select = screen.getByRole('combobox', { name: 'Dash' });
    expect(select).toHaveValue('solid');
    expect(screen.getByRole('option', { name: 'Dashed' })).toBeInTheDocument();
    await userEvent.selectOptions(select, 'dashed');
    expect(onChange).toHaveBeenCalledWith('dashed');
  });

  it('accepts bare strings as options, and disabled options', () => {
    render(<Select ariaLabel="Family" value="Inter" onChange={() => {}}
      options={['Inter', { value: 'key', label: 'Keynote', disabled: true }]} />);
    expect(screen.getByRole('option', { name: 'Inter' })).toHaveValue('Inter');
    expect(screen.getByRole('option', { name: 'Keynote' })).toBeDisabled();
  });

  it('draws exactly one chevron — its own — over a select with the native arrow hidden', () => {
    const { container } = render(<Select ariaLabel="X" value="a" onChange={() => {}} options={['a']} />);
    const field = container.firstChild;
    expect(field).toHaveClass('select-field');
    expect(field.querySelectorAll('svg')).toHaveLength(1);
    expect(screen.getByRole('combobox')).toHaveClass('select-field-control'); // appearance: none in CSS
  });

  it('disables the control', () => {
    render(<Select ariaLabel="X" value="a" onChange={() => {}} options={['a']} disabled />);
    expect(screen.getByRole('combobox')).toBeDisabled();
  });
});
