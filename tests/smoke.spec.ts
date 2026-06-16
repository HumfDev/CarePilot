import { test, expect } from '@playwright/test';

test('CarePilot shows map and referral chat', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('india-map-panel')).toBeVisible();
  await expect(page.getByTestId('right-chat-panel')).toBeVisible();
  await expect(page.getByTestId('referral-chat-panel')).toBeVisible();
  await expect(page.getByPlaceholder('Try "dialysis near Jaipur"')).toBeVisible();
});
