import { it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { TRANSITION_TYPES } from '@stagecraft/core/lib/deckUtils.js';
import { transitionAnim } from '../../apps/playground/src/lib/transitions.js';
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

for (const type of TRANSITION_TYPES) {
  if (type === 'none') continue;
  it(`plays the presenter's ${type} transition`, () => {
    const slide = document.createElement('div');
    slide.style.animation = transitionAnim({ type, duration: 500 });
    document.body.append(slide);
    try {
      const animations = slide.getAnimations();
      expect(animations).toHaveLength(1);
      expect(animations[0].animationName).toBe(`present-${type}`);
    } finally { slide.remove(); }
  });
}
