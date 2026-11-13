// The full four-step flow between two people, each in their own browser profile.
import { test, expect } from '@playwright/test';
import { freshPage, expectNoSidewaysScroll, day, startPlan, createLink, openDaySheet } from './helpers.mjs';

test('owner and guest agree on two days', async ({ browser }, info) => {
  const device = info.project.use;
  const owner = await (await browser.newContext({ ...device })).newPage();
  const guest = await (await browser.newContext({ ...device, colorScheme: 'dark' })).newPage();
  const errors = [await freshPage(owner), await freshPage(guest)];

  // Step 1: a fresh visit opens on the calendar; mark days (one evening), then name the plan and make the link.
  await startPlan(owner);
  await expect(owner.locator('.dock')).toContainText('No days yet');
  for (const d of ['2026-11-20', '2026-11-21', '2026-11-25', '2026-11-28']) await owner.click(day(d));
  const sheet = await openDaySheet(owner, '2026-11-25');
  await sheet.getByRole('button', { name: 'Evening' }).click();
  await sheet.getByRole('button', { name: 'Done' }).click();
  await expect(owner.locator(day('2026-11-25') + ' .tags')).toHaveText('E');
  await expect(owner.locator(day('2026-11-21') + ' .tags')).toHaveCount(0);
  await expect(owner.locator('.dock')).toContainText('4 days free');
  const pass = await createLink(owner, { name: 'Sam', title: 'Dinner' });
  expect(pass.split('-')).toHaveLength(3);
  const link1 = owner.url();
  await expect(owner.locator('h1')).toHaveText('Two things to send.');
  await expect(owner.locator('#link-only')).toHaveValue(link1);
  await expect(owner.locator('.words')).toHaveText(pass);
  await expect(owner.locator('.preview')).not.toContainText('http');
  await expectNoSidewaysScroll(owner);

  // Step 2: guest needs the passphrase, then adds days.
  await guest.goto(link1);
  await guest.fill('#pass', 'not-the-passphrase');
  await guest.click('button[type=submit]');
  await expect(guest.getByRole('alert')).toContainText("doesn't open this link");
  await guest.fill('#pass', pass);
  await guest.click('button[type=submit]');
  await expect(guest.locator('h1')).toHaveText('When can you?');
  await expect(guest.locator('.context')).toContainText('Dinner with Sam');
  await expect(guest.locator('.cal-lead')).toContainText('Sam is free on 4 days');
  await guest.fill('[data-input=b-name]', 'Alex');
  for (const d of ['2026-11-21', '2026-11-25', '2026-11-28', '2026-11-29']) await guest.click(day(d));
  await expect(guest.locator(day('2026-11-21'))).toHaveClass(/both/);
  await expect(guest.locator(day('2026-11-29'))).toHaveClass(/mine/);
  await expect(guest.locator(day('2026-11-20'))).toHaveClass(/theirs/);
  await expect(guest.locator('.dock')).toContainText('3 days match');
  await guest.getByRole('button', { name: 'Send back to Sam' }).click();
  await expect(guest.locator('.share')).toBeVisible();
  const link2 = guest.url();

  // Step 3: owner opens the reply without retyping the passphrase and picks two days.
  await owner.goto(link2);
  await expect(owner.locator('h1')).toContainText("You're both free on 3 days");
  await expect(owner.locator(day('2026-11-20'))).toBeDisabled();
  await owner.click('.day-list input[data-day="2026-11-21"]');
  await owner.click(day('2026-11-25'));
  await owner.click('[data-act=send]');
  await expect(owner.locator('#msg')).toHaveValue(/Sat.*21.*Wed.*25/s);
  const link3 = owner.url();

  // Step 4: guest locks in both days.
  await guest.goto(link3);
  await guest.click('input[data-day="2026-11-21"]');
  await guest.click('input[data-day="2026-11-25"]');
  await guest.getByRole('button', { name: 'Lock in 2 days' }).click();
  await expect(guest.locator('.final-card li')).toHaveCount(2);
  await expect(guest.locator('.final-card .poster-day').first()).toHaveText('21');
  await expect(guest.locator('#msg')).toHaveValue(/meeting on 2 days:\n• Saturday.*\n• Wednesday.*\(evening\)/);
  const link4 = guest.url();

  // Owner sees the settled plan; an older link warns that a newer one exists.
  await owner.goto(link4);
  await expect(owner.locator('.final-card li')).toHaveCount(2);
  await owner.goto(link2);
  await expect(owner.getByText('This is an older link.')).toBeVisible();
  await owner.getByRole('link', { name: 'Your plans' }).first().click();
  await expect(owner.locator('.plan-row')).toContainText('Settled');

  expect(errors.flat()).toEqual([]);
});

test('no shared days lets the owner add more', async ({ browser }, info) => {
  const device = info.project.use;
  const owner = await (await browser.newContext({ ...device })).newPage();
  const guest = await (await browser.newContext({ ...device })).newPage();
  await freshPage(owner); await freshPage(guest);
  await startPlan(owner);
  await owner.click(day('2026-11-20'));
  const pass = await createLink(owner, { name: 'Sam' });
  await guest.goto(owner.url());
  await guest.fill('#pass', pass); await guest.click('button[type=submit]');
  await guest.fill('[data-input=b-name]', 'Alex');
  await guest.click(day('2026-11-27'));
  await guest.click('[data-act=send]');
  await expect(guest.locator('.share')).toBeVisible();
  await owner.goto(guest.url());
  await expect(owner.locator('h1')).toContainText('No days in common');
  await owner.getByRole('button', { name: 'Add more days' }).click();
  await expect(owner.locator(day('2026-11-27'))).toHaveClass(/theirs/);
});

test('tap cycles a day; holding opens its sheet; the keyboard route and Escape work', async ({ page }) => {
  await freshPage(page);
  await startPlan(page);
  await expect(page.locator('.tap-hint')).toContainText('Hold it for maybe');

  // Sending with no days asks for one first.
  await page.click('[data-act=details]');
  await expect(page.getByRole('alert')).toContainText('Tap at least one day');

  // Tapping the same day cycles all day → morning → afternoon → evening → cleared.
  const cell = page.locator(day('2026-11-20'));
  await cell.click(); await expect(cell).toHaveAttribute('aria-pressed', 'true'); await expect(cell.locator('.tags')).toHaveCount(0);
  for (const t of ['M', 'A', 'E']) { await cell.click(); await expect(cell.locator('.tags')).toHaveText(t); }
  await cell.click(); await expect(cell).toHaveAttribute('aria-pressed', 'false');

  // Holding an unmarked day marks it and opens its sheet, without the release also cycling it.
  const box = await page.locator(day('2026-11-21')).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down(); await page.waitForTimeout(650); await page.mouse.up();
  const sheet = page.getByRole('dialog', { name: /Saturday/ });
  await expect(sheet).toBeVisible();
  await expect(page.locator(day('2026-11-21'))).toHaveAttribute('aria-pressed', 'true');
  await sheet.getByRole('button', { name: 'Morning' }).click();
  await sheet.getByRole('button', { name: 'Evening' }).click();
  await sheet.getByRole('button', { name: 'Done' }).click();
  await expect(page.locator(day('2026-11-21') + ' .tags')).toHaveText('ME');
  await expect(page.locator(day('2026-11-21'))).toBeFocused();

  // Keyboard users reach every day's times from the button; Escape closes the sheet.
  await page.click(day('2026-11-22'));
  await page.getByRole('button', { name: 'Times and maybes' }).click();
  const all = page.getByRole('dialog', { name: 'Times and maybes' });
  await expect(all.locator('.day-times li')).toHaveCount(2);
  await all.getByRole('group', { name: /Time on Sunday/ }).getByRole('button', { name: 'Evening' }).click();
  await all.getByRole('group', { name: /Time on Saturday/ }).getByRole('button', { name: 'Any time' }).click();
  await page.keyboard.press('Escape');
  await expect(all).toBeHidden();
  await expect(page.getByRole('button', { name: 'Times and maybes' })).toBeFocused();
  await expect(page.locator(day('2026-11-21') + ' .tags')).toHaveCount(0);
  await expect(page.locator(day('2026-11-22') + ' .tags')).toHaveText('E');

  // Removing a day from its sheet clears it.
  const sun = await openDaySheet(page, '2026-11-22');
  await sun.getByRole('button', { name: /Remove Sunday/ }).click();
  await expect(page.locator('.sheet')).toHaveCount(0);
  await expect(page.locator(day('2026-11-22'))).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.dock')).toContainText('1 day free');
  await expectNoSidewaysScroll(page);
});
