import { test, expect } from '@playwright/test';
import { loginAsTestUser, jsonRoute } from './helpers';

test.describe('Payouts', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsTestUser(page);
    // PayoutView loads the rail list when opened; give it one so the create
    // flow is enabled. Registered after stubBackend's catch-all → it wins.
    await page.route('**/api/v1/payouts/rails', (route) =>
      jsonRoute(route, { success: true, data: { rails: ['mock'] } }),
    );
  });

  test('opens the payouts view from the profile', async ({ page }) => {
    await page.locator('button:has-text("Perfil")').first().click();
    await page.locator('button:has-text("Pagos salientes")').first().click();
    // The subtitle is unique to the payouts overlay.
    await expect(
      page.locator('text=/env[ií]a fondos a cuentas externas/i').first(),
    ).toBeVisible({ timeout: 5000 });
  });

  test('opens the create-payout sheet over a rail', async ({ page }) => {
    await page.locator('button:has-text("Perfil")').first().click();
    await page.locator('button:has-text("Pagos salientes")').first().click();
    // Header "+" (aria-label "Nuevo pago") — enabled once the stubbed rail loads.
    await page.locator('button[aria-label="Nuevo pago"]').first().click();
    await expect(
      page.locator('button:has-text("Enviar pago")').first(),
    ).toBeVisible({ timeout: 5000 });
  });
});
