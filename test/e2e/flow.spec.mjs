// The full four-step flow between two people, each in their own browser profile.
import { test, expect } from '@playwright/test';
import { freshPage, expectNoSidewaysScroll, day } from './helpers.mjs';

test('owner and guest agree on two days', async ({ browser }, info) => {
  const device = info.project.use;
  const owner = await (await browser.newContext({ ...device })).newPage();
  const guest = await (await browser.newContext({ ...device, colorScheme: 'dark' })).newPage();
  const errors = [...[await freshPage(owner)], ...[await freshPage(guest)]];

  // Step 1: owner marks days (one tagged evening) and makes a link.
  await owner.goto('/');
  await owner.getByRole('button', { name: 'Start a plan' }).click();
  await owner.fill('[data-input=a-name]', 'Sam');
  await owner.fill('[data-input=title]', 'Dinner');
  for (const d of ['2026-11-20', '2026-11-21', '2026-11-28']) await owner.click(day(d));
  await owner.click('[data-act=brush][data-bit="8"]');
  await owner.click(day('2026-11-25'));
  await expect(owner.locator(day('2026-11-25'))).toHaveAttribute('aria-pressed', 'true');
  const pass = await owner.inputValue('[data-input=pass]');
  expect(pass.split('-')).toHaveLength(3);
  await owner.click('[data-act=send]');
  await expect(owner.locator('.share')).toBeVisible();
  const link1 = owner.url();
  await expect(owner.locator('#link-only')).toHaveValue(link1);
  await expect(owner.locator('.passbox code')).toHaveText(pass);
  await expectNoSidewaysScroll(owner);

  // Step 2: guest needs the passphrase, then adds days.
  await guest.goto(link1);
  await guest.fill('#pass', 'not-the-passphrase');
  await guest.click('button[type=submit]');
  await expect(guest.getByRole('alert')).toContainText("doesn't open this link");
  await guest.fill('#pass', pass);
  await guest.click('button[type=submit]');
  await expect(guest.locator('h1')).toContainText('Sam is free on 4 days');
  await guest.fill('[data-input=b-name]', 'Alex');
  for (const d of ['2026-11-21', '2026-11-25', '2026-11-28', '2026-11-29']) await guest.click(day(d));
  await expect(guest.locator('.card h2 .count')).toHaveText('3 matches');
  await guest.click('[data-act=send]');
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
  await expect(guest.locator('#msg')).toHaveValue(/meeting on 2 days:\n• Saturday.*\n• Wednesday.*\(evening\)/);
  const link4 = guest.url();

  // Owner sees the settled plan; an older link warns that a newer one exists.
  await owner.goto(link4);
  await expect(owner.locator('.final-card li')).toHaveCount(2);
  await owner.goto(link2);
  await expect(owner.getByText('This is an older link.')).toBeVisible();
  await owner.goto('/');
  await expect(owner.locator('.plan-row')).toContainText('Settled');

  expect(errors.flat()).toEqual([]);
});

test('no shared days lets the owner add more', async ({ browser }, info) => {
  const device = info.project.use;
  const owner = await (await browser.newContext({ ...device })).newPage();
  const guest = await (await browser.newContext({ ...device })).newPage();
  await freshPage(owner); await freshPage(guest);
  await owner.goto('/');
  await owner.getByRole('button', { name: 'Start a plan' }).click();
  await owner.fill('[data-input=a-name]', 'Sam');
  await owner.click(day('2026-11-20'));
  const pass = await owner.inputValue('[data-input=pass]');
  await owner.click('[data-act=send]');
  await expect(owner.locator('.share')).toBeVisible();
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

test('the marking guide explains tags and can be dismissed and reopened', async ({ page }) => {
  await freshPage(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Start a plan' }).click();
  const guide = page.getByRole('complementary', { name: 'How to mark your days' });
  await expect(guide).toBeVisible();
  await expect(guide).toContainText('M morning');
  await expect(page.locator('[data-act=brush][data-bit="8"] .brush-letter')).toHaveText('E');

  // Behaviour the guide describes: tags add and remove on the same day.
  await page.click('[data-act=brush][data-bit="2"]');
  await page.click(day('2026-11-20'));
  await expect(page.locator(day('2026-11-20') + ' .tags')).toHaveText('M');
  await page.click('[data-act=brush][data-bit="8"]');
  await page.click(day('2026-11-20'));
  await expect(page.locator(day('2026-11-20') + ' .tags')).toHaveText('ME');
  await page.click(day('2026-11-20'));
  await expect(page.locator(day('2026-11-20') + ' .tags')).toHaveText('M');

  await guide.getByRole('button', { name: 'Got it' }).click();
  await expect(guide).toBeHidden();
  await page.reload();
  await page.getByRole('button', { name: 'Start a plan' }).click();
  await expect(guide).toBeHidden();
  await page.getByRole('button', { name: 'How marking days works' }).click();
  await expect(guide).toBeVisible();
  await expectNoSidewaysScroll(page);
});
