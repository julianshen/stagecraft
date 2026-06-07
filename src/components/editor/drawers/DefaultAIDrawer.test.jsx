import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../../lib/llmClient.js', () => ({ callLLM: vi.fn().mockResolvedValue('done') }));

import DefaultAIDrawer from './DefaultAIDrawer.jsx';

describe('DefaultAIDrawer', () => {
  it('clears the prompt input after sending a typed message', async () => {
    render(<DefaultAIDrawer onClose={vi.fn()} slideNum={1} slide={null} />);
    const input = screen.getByPlaceholderText(/Ask Co-pilot/i);
    await userEvent.type(input, 'rewrite this');
    expect(input).toHaveValue('rewrite this');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(input).toHaveValue('');
  });
});
