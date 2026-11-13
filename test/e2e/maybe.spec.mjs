// "Maybe" days: possible but not confirmed, shown with a dotted outline and a "?".
import { test, expect } from '@playwright/test';
import { freshPage, expectNoSidewaysScroll, day } from './helpers.mjs';

test('a maybe day is marked, shared, matched and settled as a maybe', async ({ browser }, info) => {
  const owner = await (await browser.newContext({ ...info.project.use })).newPage();
  const guest = await (await browser.newContext({ ...info.project.use })).newPage();
  const errors = [await freshPage(owner), await freshPage(guest)];

  await owner.goto('/');
  await owner.getByRole('button', { name: 'Start a plan', exact: true }).click();
  await owner.fill('[data-input=a-name]', 'Sam');
  for (const d of ['2026-11-20', '2026-11-21']) await owner.click(day(d));
  const fri = owner.getByRole('group', { name: /How sure on Friday/ });
  await fri.getByRole('button', { name: 'Maybe' }).click();
  const cell = owner.locator(day('2026-11-20'));
  await expect(cell).toHaveClass(/mine-maybe/);
  await expect(cell.locator('.q')).toHaveText('?');
  await expect(cell).toHaveAttribute('aria-label', /free any time \(maybe\)/);
  // tapping cycles the time and keeps the maybe
  await cell.click();
  await expect(cell.locator('.tags')).toHaveText('M');
  await expect(cell.locator('.q')).toHaveText('?');
  await owner.getByRole('group', { name: /Time on Friday/ }).getByRole('button', { name: 'Any time' }).click();
  await expect(owner.locator(day('2026-11-21') + ' .q')).toHaveCount(0);
  await expectNoSidewaysScroll(owner);
  const pass = await owner.inputValue('[data-input=pass]');
  await owner.click('[data-act=send]');
  await expect(owner.locator('.share')).toBeVisible();

  // The guest sees Sam's maybe, marks both days free, and the match is flagged.
  await guest.goto(owner.url());
  await guest.fill('#pass', pass); await guest.click('button[type=submit]');
  await expect(guest.locator(day('2026-11-20') + ' .q')).toHaveText('?');
  await guest.fill('[data-input=b-name]', 'Alex');
  for (const d of ['2026-11-20', '2026-11-21']) await guest.click(day(d));
  await expect(guest.locator('.day-times')).toContainText('Sam: any time (maybe)');
  await guest.click('[data-act=send]');
  await expect(guest.locator('#msg')).toHaveValue(/We overlap on 2 days \(1 is a maybe\)/);

  await owner.goto(guest.url());
  await expect(owner.locator('.day-list')).toContainText('any time (maybe)');
  await expect(owner.locator(day('2026-11-20') + ' .q')).toHaveText('?');
  await owner.click('.day-list input[data-day="2026-11-20"]');
  await owner.click('[data-act=send]');
  await expect(owner.locator('.share')).toBeVisible();

  await guest.goto(owner.url());
  await guest.getByRole('button', { name: 'Lock in this day' }).click();
  await expect(guest.locator('.final-card')).toContainText('Still a maybe');
  await expect(guest.locator('#msg')).toHaveValue(/\(still a maybe\)/);
  expect(errors.flat()).toEqual([]);
});
