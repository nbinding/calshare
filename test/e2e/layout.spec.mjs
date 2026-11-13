// Desktop gets stead-mobile's sidebar layout; phones keep the single column.
import { test, expect } from '@playwright/test';
import { freshPage, expectNoSidewaysScroll, day } from './helpers.mjs';

test('sidebar and breadcrumb show on desktop only', async ({ page }, info) => {
  await freshPage(page);
  await page.goto('/');
  const desktop = info.project.name === 'desktop';
  const sidebar = page.locator('.sidebar');
  if (!desktop) {
    await expect(sidebar).toBeHidden();
    await expect(page.locator('.breadcrumb')).toBeHidden();
    return;
  }
  await expect(sidebar).toBeVisible();
  await expect(page.locator('.breadcrumb')).toContainText('Home');
  await sidebar.getByRole('button', { name: /Start a plan/ }).click();
  await expect(page.locator('.breadcrumb')).toContainText('Step 1 of 4');
  await expect(sidebar.locator('.nav-item.active')).toContainText('shares');
  await expect(page.locator('.stepper')).toBeHidden();
  await page.getByRole('radio', { name: 'A group' }).click();
  await expect(page.locator('.breadcrumb')).toContainText('Step 1 of 3');
  await expect(sidebar.locator('.side-steps li')).toHaveCount(3);
  await page.click(day('2026-11-20'));
  const box = await page.locator('.calendar').boundingBox();
  expect(box.x).toBeGreaterThan(300); // content sits to the right of the sidebar
  expect(box.width).toBeLessThanOrEqual(560);
  await expectNoSidewaysScroll(page);
});
