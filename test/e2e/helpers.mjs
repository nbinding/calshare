import { expect } from '@playwright/test';

// All browser tests run on a fixed "today" so the calendar is the same every run.
export const TODAY = new Date('2026-11-13T10:00:00');

export async function freshPage(page) {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.clock.setFixedTime(TODAY);
  return errors;
}

export async function expectNoSidewaysScroll(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  // A phone browser widens the layout (and zooms out) when something is too wide, so check the viewport didn't grow.
  const vp = page.viewportSize();
  if (vp) expect(await page.evaluate(() => innerWidth)).toBe(vp.width);
}

export const day = iso => `.cell[data-day="${iso}"]`;

// A fresh visit opens straight on the calendar.
export async function startPlan(page) {
  await page.goto('/');
  await expect(page.locator('.calendar.edit')).toBeVisible();
}

// From the calendar: "Send to someone" (or "Next" when editing), fill the details, create the link. Returns the passphrase.
export async function createLink(page, { name = 'Sam', title = '', group = false } = {}) {
  await page.click('[data-act=details]');
  if (name !== null) await page.fill('[data-input=a-name]', name);
  if (title) await page.fill('[data-input=title]', title);
  if (group) await page.getByRole('radio', { name: 'A group' }).click();
  const pass = await page.inputValue('[data-input=pass]');
  await page.getByRole('button', { name: /^Create my (new )?link$/ }).click();
  await expect(page.locator('.share')).toBeVisible();
  return pass;
}

// Open one day's sheet (time, maybe, remove). Right-click is the desktop form of holding a day.
export async function openDaySheet(page, iso) {
  await page.click(`.cell[data-day="${iso}"]`, { button: 'right' });
  await expect(page.locator('.sheet')).toBeVisible();
  return page.locator('.sheet');
}
