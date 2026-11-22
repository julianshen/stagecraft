import { it, expect } from 'vitest';
import { render } from '@testing-library/react';
import '@stagecraft/react/styles.css';
import '../../apps/playground/src/host.css';

it('fills the playground viewport without browser margins or document overflow', () => {
  const root = document.createElement('div');
  root.id = 'root';
  document.body.append(root);
  try {
    const { container, unmount } = render(
      <div className="app stagecraft-editor"><div style={{ flex: 1 }}>Playground</div></div>,
      { container: root },
    );
    const rect = container.firstElementChild.getBoundingClientRect();
    expect(rect.x).toBe(0);
    expect(rect.y).toBe(0);
    expect(rect.width).toBe(window.innerWidth);
    expect(rect.height).toBe(window.innerHeight);
    expect(document.documentElement.scrollHeight).toBe(window.innerHeight);
    unmount();
  } finally { root.remove(); }
});
