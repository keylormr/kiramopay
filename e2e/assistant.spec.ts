import { test, expect } from '@playwright/test';
import { loginAsTestUser, jsonRoute } from './helpers';

test.describe('Assistant', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsTestUser(page);
    // Report the assistant as available so the chat input is enabled.
    await page.route('**/api/v1/assistant/status', (route) =>
      jsonRoute(route, { success: true, data: { available: true } }),
    );
  });

  test('opens the assistant chat from the home card', async ({ page }) => {
    // The home tab is active after login; its assistant card opens the chat.
    await page.locator('button:has-text("Asistente")').first().click();
    // The chat textarea (with its placeholder) is unique to the open view.
    await expect(
      page.locator('textarea[placeholder*="Escribe tu pregunta"]'),
    ).toBeVisible({ timeout: 5000 });
  });
});
