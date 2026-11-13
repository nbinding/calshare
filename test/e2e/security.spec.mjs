// Content inside a shared link is untrusted: it must be shown as text, never run.
import { test, expect } from '@playwright/test';
import { freshPage } from './helpers.mjs';

const EVIL = '<img src=x onerror="window.__pwned=1"><script>window.__pwned=2</script>';

test('names and titles from a link are escaped', async ({ page }) => {
  const errors = await freshPage(page);
  await page.goto('/');
  const hash = await page.evaluate(async evil => {
    const { seal } = await import('/src/share.js');
    const { toWire } = await import('/src/core.js');
    const plan = { id: 'evil01', step: 1, created: Date.now(), title: evil, start: '2026-11', count: 1,
      a: { name: evil, days: { '2026-11-20': 1 } }, picks: [] };
    return `evil01.${await seal(toWire(plan), 'pass-word-here')}`;
  }, EVIL);
  await page.goto(`/#${hash}`);
  await page.fill('#pass', 'pass-word-here');
  await page.click('button[type=submit]');
  await expect(page.locator('h1')).toContainText('<img src=x');
  expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
  expect(await page.locator('main img, main script').count()).toBe(0);
  expect(errors).toEqual([]);
});

test('a link whose plan id does not match is rejected', async ({ page }) => {
  await freshPage(page);
  await page.goto('/');
  const code = await page.evaluate(async () => {
    const { seal } = await import('/src/share.js');
    const { toWire } = await import('/src/core.js');
    const plan = { id: 'real01', step: 1, created: Date.now(), title: '', start: '2026-11', count: 1, a: { name: 'Sam', days: { '2026-11-20': 1 } }, picks: [] };
    return seal(toWire(plan), 'pass-word-here');
  });
  await page.goto(`/#fake01.${code}`);
  await page.fill('#pass', 'pass-word-here');
  await page.click('button[type=submit]');
  await expect(page.getByRole('alert')).toContainText('damaged or incomplete');
});

test('the page makes no network requests after loading', async ({ page }) => {
  const external = [];
  page.on('request', r => { if (!r.url().startsWith('http://localhost:4173/') && !r.url().startsWith('data:')) external.push(r.url()); });
  await freshPage(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Start a plan' }).click();
  await page.click('[data-day="2026-11-20"]');
  expect(external).toEqual([]);
});
