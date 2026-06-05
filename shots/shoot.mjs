import pw from '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium } = pw;
import { mkdirSync } from 'node:fs';

const BASE = 'http://127.0.0.1:3000';
const OUT = '/home/claude/stagecraft/shots';
mkdirSync(OUT, { recursive: true });

const VP = { width: 1512, height: 945 };

async function settle(page, ms = 900) {
  try { await page.evaluate(() => document.fonts && document.fonts.ready); } catch {}
  await page.waitForTimeout(ms);
}

async function newPage(browser, initScript) {
  const ctx = await browser.newContext({ viewport: VP, deviceScaleFactor: 2 });
  if (initScript) await ctx.addInitScript(initScript);
  const page = await ctx.newPage();
  return { ctx, page };
}

async function shoot(page, name) {
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log('  ✓', name);
}

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-gpu', '--font-render-hinting=none'] });

try {
  // ---------- LIGHT THEME TOUR ----------
  const { ctx, page } = await newPage(browser);

  // 1. Editor (default view, opens on KPI slide)
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Editor' }).click();
  await settle(page, 1200);
  await shoot(page, '01-editor');

  // 2. Co-pilot drawer open
  await page.getByRole('button', { name: 'Co-pilot' }).click();
  await settle(page, 700);
  await shoot(page, '02-editor-copilot');
  await page.getByRole('button', { name: 'Co-pilot' }).click(); // close
  await settle(page, 400);

  // 3. Export modal
  await page.getByRole('button', { name: 'Export' }).click();
  await settle(page, 700);
  await shoot(page, '03-export-modal');
  await page.keyboard.press('Escape');
  await settle(page, 400);

  // 4. Sorter
  await page.getByRole('button', { name: 'Sorter' }).click();
  await settle(page, 1000);
  await shoot(page, '04-sorter');

  // 5. Files / Home
  await page.getByRole('button', { name: 'Files' }).click();
  await settle(page, 900);
  await shoot(page, '05-home');

  // 6. Templates modal (from Home "From template" card)
  await page.getByText('From template', { exact: false }).first().click();
  await settle(page, 800);
  await shoot(page, '06-templates-modal');
  await page.keyboard.press('Escape');
  await settle(page, 400);

  // 7. Settings — AI & Co-pilot
  await page.getByRole('button', { name: 'Settings' }).first().click();
  await settle(page, 900);
  await shoot(page, '07-settings');
  // try to reveal the AI/provider section by scrolling the settings body
  try {
    await page.evaluate(() => {
      const el = [...document.querySelectorAll('*')].find(n => /Provider|Co-pilot|API key/i.test(n.textContent || '') && n.children.length < 3);
      if (el) el.scrollIntoView({ block: 'center' });
    });
    await settle(page, 500);
    await shoot(page, '08-settings-ai');
  } catch (e) { console.log('  (ai scroll skipped)', e.message); }

  // 8. Presenter mode (Cmd+Enter from editor)
  await page.getByRole('button', { name: 'Editor' }).click();
  await settle(page, 700);
  await page.keyboard.press('Meta+Enter');
  await settle(page, 1200);
  await shoot(page, '09-presenter');
  await page.keyboard.press('Escape');
  await settle(page, 400);

  await ctx.close();

  // ---------- DARK THEME ----------
  const dark = await newPage(browser, () => {
    localStorage.setItem('stagecraft.tw', JSON.stringify({ theme: 'dark', accent: 'emerald', layout: 'default', density: 'default' }));
    localStorage.setItem('stagecraft.view', 'editor');
  });
  await dark.page.goto(BASE, { waitUntil: 'networkidle' });
  await settle(dark.page, 1300);
  await shoot(dark.page, '10-editor-dark');
  await dark.ctx.close();

  console.log('ALL DONE');
} catch (err) {
  console.error('SHOOT ERROR:', err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
