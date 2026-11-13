// Desktop gets stead-mobile's sidebar layout; phones keep the single column.
import { test, expect } from '@playwright/test';
import { freshPage, expectNoSidewaysScroll, day, startPlan } from './helpers.mjs';

test('sidebar and breadcrumb show on desktop only', async ({ page }, info) => {
  await freshPage(page);
  await startPlan(page);
  const desktop = info.project.name === 'desktop';
  const sidebar = page.locator('.sidebar');
  if (!desktop) {
    await expect(sidebar).toBeHidden();
    await expect(page.locator('.breadcrumb')).toBeHidden();
    return;
  }
  await expect(sidebar).toBeVisible();
  await expect(page.locator('.breadcrumb')).toContainText('Step 1 of 4');
  await expect(sidebar.locator('.nav-item.active')).toContainText('shares');
  await expect(page.locator('.stepper')).toBeHidden();
  await page.click(day('2026-11-20'));
  const box = await page.locator('.calendar').boundingBox();
  expect(box.x).toBeGreaterThan(300); // content sits to the right of the sidebar
  expect(box.width).toBeLessThanOrEqual(600);
  await page.click('[data-act=details]');
  await page.getByRole('radio', { name: 'A group' }).click();
  await expect(page.locator('.breadcrumb')).toContainText('Step 1 of 3');
  await expect(sidebar.locator('.side-steps li')).toHaveCount(3);
  await page.locator('.brand').first().click();
  await expect(page.locator('.breadcrumb')).toContainText('Home');
  await expectNoSidewaysScroll(page);
});
