import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../../../..');
const readCss = rel => readFileSync(resolve(root, rel), 'utf8');

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function extractBlocks(css) {
  const cleaned = stripComments(css);
  const blocks = [];
  let i = 0;
  while (i < cleaned.length) {
    const open = cleaned.indexOf('{', i);
    if (open === -1) break;
    const selector = cleaned.slice(i, open).trim();
    let depth = 1;
    let j = open + 1;
    while (j < cleaned.length && depth > 0) {
      if (cleaned[j] === '{') depth++;
      else if (cleaned[j] === '}') depth--;
      j++;
    }
    const body = cleaned.slice(open + 1, j - 1).trim();
    if (selector.startsWith('@')) {
      blocks.push(...extractBlocks(body));
    } else {
      blocks.push({ selector, body });
    }
    i = j;
  }
  return blocks;
}

function splitTopLevelCommas(selector) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < selector.length; i++) {
    if (selector[i] === '(') depth++;
    else if (selector[i] === ')') depth = Math.max(0, depth - 1);
    else if (selector[i] === ',' && depth === 0) {
      parts.push(selector.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(selector.slice(start).trim());
  return parts;
}

function hasFocusVisibleOutline(blocks, token) {
  return blocks.some(({ selector, body }) => {
    if (!selector.includes(':focus-visible')) return false;
    const matchesSelector = splitTopLevelCommas(selector).some(
      part => part.includes(':focus-visible') && part.includes(token),
    );
    if (!matchesSelector) return false;
    return /outline\s*:\s*(?!0\b|none\b)[^;]+/i.test(body);
  });
}

describe('shell stylesheet focus-visible, dark-mode contrast, and ancestor selectors', () => {
  const mainCss = readCss('packages/react/src/styles/main.css');
  const mainBlocks = extractBlocks(mainCss);

  it('provides a :focus-visible outline for all interactive controls in main.css', () => {
    const requiredSelectors = [
      '.btn',
      '.iconbtn',
      '.topbar-nav .tab',
      '.inspector-tabs button',
      '.seg button',
      '.menu-item',
      '.ctx-item',
      '.theme-opt',
      '.text-opt',
      '.cmp-item',
      '.chip',
      '.slide-thumb',
      '.sorter-card',
      'input',
      'textarea',
      'select',
    ];
    for (const sel of requiredSelectors) {
      expect(hasFocusVisibleOutline(mainBlocks, sel), `missing :focus-visible outline for ${sel} in main.css`).toBe(true);
    }
  });

  it('does not strip input/textarea outline unconditionally in main.css', () => {
    const baseInputRule = mainBlocks.find(
      b => b.selector.includes('.stagecraft-editor input') && b.selector.includes('.stagecraft-editor textarea') && !b.selector.includes(':focus'),
    );
    expect(baseInputRule).toBeTruthy();
    expect(baseInputRule.body).not.toMatch(/outline\s*:\s*(0|none)\b/i);
  });

  it('supports ancestor [data-theme="dark"] and [data-density] selectors in main.css', () => {
    expect(mainCss).toContain('[data-theme="dark"] .stagecraft-editor');
    expect(mainCss).toContain('[data-density="compact"] .stagecraft-editor');
    expect(mainCss).toContain('[data-density="cozy"] .stagecraft-editor');
  });

  it('uses theme-aware contrast for .new-card.primary, accent fills, and swatch borders in main.css', () => {
    const primaryPreview = mainBlocks.find(b => b.selector === '.stagecraft-editor .new-card.primary .preview');
    const primaryMeta = mainBlocks.find(b => b.selector === '.stagecraft-editor .new-card.primary .meta');
    expect(primaryPreview.body).not.toMatch(/rgba\(255,\s*255,\s*255/i);
    expect(primaryMeta.body).not.toMatch(/oklch\(0\.7\s+0\s+0\)/i);

    const accentBtn = mainBlocks.find(b => b.selector === '.stagecraft-editor .btn.accent');
    expect(accentBtn.body).toContain('var(--accent-ink)');

    const darkSwatchRule = mainBlocks.find(
      b => b.selector.includes('[data-theme="dark"]') && (b.selector.includes('.theme-sw') || b.selector.includes('.swatch')),
    );
    const themeSw = mainBlocks.find(b => b.selector === '.stagecraft-editor .theme-sw');
    expect(Boolean(darkSwatchRule) || themeSw.body.includes('var(--line')).toBe(true);
  });

  it('provides :focus-visible outlines in PresentationEditor.css, canonical.css, and SourceWorkspace.css', () => {
    const presBlocks = extractBlocks(readCss('packages/react/src/PresentationEditor.css'));
    for (const sel of ['button', 'input', 'textarea', 'select', '.stagecraft-presentation-canvas']) {
      expect(hasFocusVisibleOutline(presBlocks, sel), `missing :focus-visible outline for ${sel} in PresentationEditor.css`).toBe(true);
    }

    const canonicalBlocks = extractBlocks(readCss('packages/react/src/styles/canonical.css'));
    for (const sel of ['button', 'input', 'textarea', 'select']) {
      expect(hasFocusVisibleOutline(canonicalBlocks, sel), `missing :focus-visible outline for ${sel} in canonical.css`).toBe(true);
    }

    const sourceBlocks = extractBlocks(readCss('apps/playground/src/components/views/SourceWorkspace.css'));
    for (const sel of ['a', 'input', 'button', 'select', 'textarea']) {
      expect(hasFocusVisibleOutline(sourceBlocks, sel), `missing :focus-visible outline for ${sel} in SourceWorkspace.css`).toBe(true);
    }
  });
});
