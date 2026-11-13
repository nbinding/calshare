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
}

export const day = iso => `.cell[data-day="${iso}"]`;
