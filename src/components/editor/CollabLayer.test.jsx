import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import CollabLayer from './CollabLayer.jsx';

describe('CollabLayer', () => {
  it('renders nothing without crashing when collaborators is omitted', () => {
    const { container } = render(<CollabLayer />);
    expect(container.querySelectorAll('.cursor')).toHaveLength(0);
  });

  it('renders one cursor per collaborator', () => {
    const { container } = render(
      <CollabLayer collaborators={[{ name: 'A', color: 'red' }, { name: 'B', color: 'blue' }]} />
    );
    expect(container.querySelectorAll('.cursor')).toHaveLength(2);
  });
});
