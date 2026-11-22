import { render, within } from '@testing-library/react';
import { CommandPalette } from './CommandPalette.jsx';

it('keeps ARIA references within each palette when two instances are mounted', () => {
  const getCommands = () => [{ id: 'slide.new', label: 'New slide', run: () => {} }];
  const { getAllByRole } = render(<>
    <CommandPalette getCommands={getCommands} onClose={() => {}} />
    <CommandPalette getCommands={getCommands} onClose={() => {}} />
  </>);

  for (const dialog of getAllByRole('dialog')) {
    const input = within(dialog).getByRole('combobox');
    expect(document.getElementById(input.getAttribute('aria-controls'))).toBe(within(dialog).getByRole('listbox'));
    expect(document.getElementById(input.getAttribute('aria-activedescendant'))).toBe(within(dialog).getByRole('option'));
  }
});
