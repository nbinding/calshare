// Group plans: one invite, several guests (two with the same name), the organiser locks in the day.
import { test, expect } from '@playwright/test';
import { freshPage, expectNoSidewaysScroll, day, startPlan, createLink } from './helpers.mjs';

async function person(browser, info) {
  const page = await (await browser.newContext({ ...info.project.use })).newPage();
  const errors = await freshPage(page);
  return { page, errors };
}

async function reply(page, invite, pass, name, days) {
  await page.goto(invite);
  if (await page.locator('#pass').isVisible()) { await page.fill('#pass', pass); await page.click('button[type=submit]'); }
  await page.fill('[data-input=b-name]', name);
  for (const d of days) await page.click(day(d));
  await page.click('[data-act=send]');
  await expect(page.locator('.share')).toBeVisible();
  return { link: page.url(), code: (await page.locator('.reply-code strong').textContent()).trim() };
}

test('group: replies are kept apart by hidden id and the organiser locks in a day', async ({ browser }, info) => {
  const org = await person(browser, info), sam1 = await person(browser, info), sam2 = await person(browser, info), jo = await person(browser, info);

  await startPlan(org.page);
  for (const d of ['2026-11-20', '2026-11-21', '2026-11-22', '2026-11-25']) await org.page.click(day(d));
  const pass = await createLink(org.page, { name: 'Nat', title: 'Hike', group: true });
  await expect(org.page.locator('#share-h')).toHaveText("Send it to everyone you're inviting");
  await expect(org.page.locator('#msg')).toHaveValue(/^Hi all! Can we find a day for Hike\?/);
  const invite = org.page.url();

  const r1 = await reply(sam1.page, invite, pass, 'Sam', ['2026-11-20', '2026-11-21']);
  const r2 = await reply(sam2.page, invite, pass, 'Sam', ['2026-11-21', '2026-11-22']);
  const r3 = await reply(jo.page, invite, pass, 'Jo', ['2026-11-21', '2026-11-25']);
  expect(r1.code).toMatch(/^[A-Z2-9]{2}$/);

  // Organiser opens each reply; all three are kept, the two Sams labelled with their codes.
  // Open each reply one at a time, as a person would, waiting for it to register.
  for (const [i, r] of [r1, r2, r3].entries()) {
    await org.page.goto(r.link);
    await expect(org.page.locator('.replies li')).toHaveCount(i + 1);
  }
  await expect(org.page.locator('h1')).toContainText('3 people have replied');
  const names = await org.page.locator('.replies strong').allTextContents();
  expect(names).toHaveLength(3);
  expect(names).toContain('Jo');
  expect(names.filter(n => n.startsWith('Sam · '))).toHaveLength(2);
  expect(names).toContain(`Sam · ${r1.code}`);
  expect(names).toContain(`Sam · ${r2.code}`);
  await expect(org.page.locator(day('2026-11-21') + ' .nb-cell__tags')).toHaveText('4/4');
  await expect(org.page.locator(day('2026-11-20') + ' .nb-cell__tags')).toHaveText('2/4');

  // Sam #1 changes their reply: it replaces the old one instead of adding a fourth person.
  await sam1.page.goto(invite);
  await expect(sam1.page.locator('[data-input=b-name]')).toHaveValue('Sam');
  await expect(sam1.page.locator(day('2026-11-20'))).toHaveAttribute('aria-pressed', 'true');
  await sam1.page.click(day('2026-11-25'));
  await sam1.page.click('[data-act=send]');
  await expect(sam1.page.locator('.share')).toBeVisible();
  await expect(sam1.page.locator('.reply-code strong')).toHaveText(r1.code);
  await org.page.goto(sam1.page.url());
  await expect(org.page.locator('.replies li')).toHaveCount(3);
  await expect(org.page.locator(day('2026-11-25') + ' .nb-cell__tags')).toHaveText('3/4');

  // An older reply from the same guest doesn't undo the newer one.
  await org.page.goto(r1.link);
  await expect(org.page.getByText('This is an older reply from Sam')).toBeVisible();
  await expect(org.page.locator(day('2026-11-25') + ' .nb-cell__tags')).toHaveText('3/4');

  await org.page.getByRole('button', { name: /Days everyone can do/ }).click();
  await expect(org.page.locator('.day-list input:checked')).toHaveCount(1);
  await org.page.getByRole('button', { name: 'Lock in this day' }).click();
  await expect(org.page.locator('.final-card')).toContainText('4 of 4 can make it');
  await expect(org.page.locator('#msg')).toHaveValue(/Hike is on Saturday.*4 of 4 can make it/);
  const final = org.page.url();
  await expectNoSidewaysScroll(org.page);

  // A guest sees the settled plan with everyone who can make it.
  await jo.page.goto(final);
  await expect(jo.page.locator('h1')).toContainText("It's settled.");
  await expect(jo.page.locator('.final-card')).toContainText('Nat, Sam');
  await expect(jo.page.getByRole('button', { name: 'Change the final days' })).toHaveCount(0);

  // The organiser can change the locked-in days later.
  await org.page.goto('/');
  await org.page.getByRole('link', { name: 'Your plans' }).first().click();
  await expect(org.page.locator('.plan-row')).toContainText('Settled');
  await org.page.locator('.plan-row a').click();
  await org.page.getByRole('button', { name: 'Change the final days' }).click();
  await expect(org.page.locator('.day-list input:checked')).toHaveCount(1);

  for (const x of [org, sam1, sam2, jo]) expect(x.errors).toEqual([]);
});
