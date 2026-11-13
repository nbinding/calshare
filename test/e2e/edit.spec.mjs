// Editing after a link was sent, and keeping each person's latest days.
import { test, expect } from '@playwright/test';
import { freshPage, day } from './helpers.mjs';

test('organiser edits after sending; a reply to the old link keeps the new days', async ({ browser }, info) => {
  const owner = await (await browser.newContext({ ...info.project.use })).newPage();
  const guest = await (await browser.newContext({ ...info.project.use })).newPage();
  const errors = [await freshPage(owner), await freshPage(guest)];

  await owner.goto('/');
  await owner.getByRole('button', { name: 'Start a plan' }).click();
  await owner.fill('[data-input=a-name]', 'Sam');
  for (const d of ['2026-11-20', '2026-11-21']) await owner.click(day(d));
  const pass = await owner.inputValue('[data-input=pass]');
  await owner.click('[data-act=send]');
  await expect(owner.locator('.share')).toBeVisible();
  const oldLink = owner.url();

  // Later: open the plan from the home screen and edit.
  await owner.goto('/');
  await owner.locator('.plan-row a').click();
  await expect(owner.locator('h1')).toContainText('Over to');
  await owner.getByRole('button', { name: 'Edit my days' }).click();
  await expect(owner.locator('.eyebrow').first()).toContainText('Editing');
  await expect(owner.getByRole('radio', { name: 'A group' })).toHaveCount(0);
  await owner.click(day('2026-11-27'));
  await owner.getByRole('button', { name: 'Create my new link' }).click();
  await expect(owner.locator('#msg')).toHaveValue(/^I've updated my days\. Please use this link instead of the one I sent before \(same passphrase\)/);
  expect(owner.url()).not.toBe(oldLink);

  // The guest still uses the old link and replies.
  await guest.goto(oldLink);
  await guest.fill('#pass', pass); await guest.click('button[type=submit]');
  await expect(guest.locator('h1')).toContainText('Sam is free on 2 days');
  await guest.fill('[data-input=b-name]', 'Alex');
  for (const d of ['2026-11-21', '2026-11-27']) await guest.click(day(d));
  await guest.click('[data-act=send]');
  await expect(guest.locator('.share')).toBeVisible();
  const reply = guest.url();

  // The owner's newer days (including the 27th) are kept, so both days match.
  await owner.goto(reply);
  await expect(owner.getByText('replied to an earlier version of your days')).toBeVisible();
  await expect(owner.locator('h1')).toContainText("You're both free on 2 days");

  // The guest can edit their reply too.
  await guest.goto('/');
  await guest.locator('.plan-row a').click();
  await guest.getByRole('button', { name: 'Edit my days' }).click();
  await expect(guest.locator(day('2026-11-21'))).toHaveAttribute('aria-pressed', 'true');
  await guest.click(day('2026-11-20'));
  await guest.getByRole('button', { name: 'Send my new days to Sam' }).click();
  await expect(guest.locator('#msg')).toHaveValue(/^I've updated my days\. Use this link instead of my earlier one\./);
  await owner.goto(guest.url());
  await expect(owner.locator('h1')).toContainText("You're both free on 3 days");

  expect(errors.flat()).toEqual([]);
});

test('the guest can change the final days after confirming', async ({ browser }, info) => {
  const owner = await (await browser.newContext({ ...info.project.use })).newPage();
  const guest = await (await browser.newContext({ ...info.project.use })).newPage();
  await freshPage(owner); await freshPage(guest);
  await owner.goto('/');
  await owner.getByRole('button', { name: 'Start a plan' }).click();
  await owner.fill('[data-input=a-name]', 'Sam');
  for (const d of ['2026-11-20', '2026-11-21']) await owner.click(day(d));
  const pass = await owner.inputValue('[data-input=pass]');
  await owner.click('[data-act=send]');
  await expect(owner.locator('.share')).toBeVisible();
  await guest.goto(owner.url());
  await guest.fill('#pass', pass); await guest.click('button[type=submit]');
  await guest.fill('[data-input=b-name]', 'Alex');
  for (const d of ['2026-11-20', '2026-11-21']) await guest.click(day(d));
  await guest.click('[data-act=send]');
  await expect(guest.locator('.share')).toBeVisible();
  await owner.goto(guest.url());
  await owner.getByRole('button', { name: 'Select all' }).click();
  await owner.click('[data-act=send]');
  await expect(owner.locator('.share')).toBeVisible();
  await guest.goto(owner.url());
  await guest.click('input[data-day="2026-11-20"]');
  await guest.getByRole('button', { name: 'Lock in this day' }).click();
  await expect(guest.locator('.final-card li')).toHaveCount(1);

  await guest.goto('/');
  await guest.locator('.plan-row a').click();
  await guest.getByRole('button', { name: 'Change the final days' }).click();
  await expect(guest.locator('input[data-day="2026-11-20"]')).toBeChecked();
  await guest.click('input[data-day="2026-11-21"]');
  await guest.getByRole('button', { name: 'Lock in 2 days' }).click();
  await expect(guest.locator('#msg')).toHaveValue(/^Change of plan! It's settled.*2 days/s);
  await owner.goto(guest.url());
  await expect(owner.locator('.final-card li')).toHaveCount(2);
  await expect(owner.getByRole('button', { name: 'Change the final days' })).toHaveCount(0);
});
