import { test, expect } from '@playwright/test';

test('CarePilot shows map and Genie chat panels', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('india-map-panel')).toBeVisible();
  await expect(page.getByTestId('genie-panel')).toBeVisible();
  await expect(page.getByText('India Healthcare Map')).toBeVisible();
  await expect(
    page.getByPlaceholder('Ask about facilities, health indicators, or PIN codes...'),
  ).toBeVisible();
});
