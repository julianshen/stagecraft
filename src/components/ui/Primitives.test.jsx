import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button, Seg } from './Primitives.jsx';

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
