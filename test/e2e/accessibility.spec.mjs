// Display and accessibility settings.
import { test, expect } from '@playwright/test';
import { freshPage, expectNoSidewaysScroll, day } from './helpers.mjs';

test('display settings apply, persist and keep the calendar intact', async ({ page }) => {
  const errors = await freshPage(page);
  await page.goto('/');
  const trigger = page.getByRole('button', { name: 'Display and accessibility settings' });
  await trigger.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  expect(await page.evaluate(() => document.querySelector('.dialog').contains(document.activeElement))).toBe(true);

  await dialog.locator('[data-key=size][data-value="150"]').click();
  await dialog.locator('[data-key=font][data-value=dyslexic]').click();
  await dialog.locator('[data-key=theme][data-value=dark]').click();
  for (const k of ['dateHelp', 'spacing', 'motion']) await dialog.locator(`[data-act=pref-toggle][data-key=${k}]`).check();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();

  const root = page.locator('html');
  await expect(root).toHaveAttribute('data-font', 'dyslexic');
  await expect(root).toHaveAttribute('data-theme', 'dark');
  await expect(root).toHaveAttribute('data-date-help', 'true');
  expect(await page.evaluate(() => document.fonts.load('16px OpenDyslexic').then(f => f.length > 0))).toBe(true);

  await page.click(day('2026-11-20'));
  await expect(page.locator(day('2026-11-13') + ' .wd')).toHaveText('Today');
  await expectNoSidewaysScroll(page);
  const spilling = await page.$$eval('.cell span, .weekdays span, .month-head h3', els =>
    els.filter(e => e.offsetParent && (e.scrollWidth > e.clientWidth + 1 || e.getBoundingClientRect().right > innerWidth)).length);
  expect(spilling).toBe(0);

  await page.reload();
  await expect(root).toHaveAttribute('data-font', 'dyslexic');
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--text-scale').trim())).toBe('1.5');

  await page.getByRole('button', { name: 'Display and accessibility settings' }).click();
  await page.getByRole('button', { name: 'Reset display settings' }).click();
  await expect(root).toHaveAttribute('data-font', 'default');
  expect(errors).toEqual([]);
});

test('skip link moves focus to the main content', async ({ page }) => {
  await freshPage(page);
  await page.goto('/');
  await page.keyboard.press('Tab');
  await expect(page.locator('.skip-link')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('main#main')).toBeFocused();
});
