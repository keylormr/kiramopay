import { test, expect } from '@playwright/test';
import { loginAsTestUser } from './helpers';

test.describe('Escrow', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsTestUser(page);
  });

  test('opens the escrow view from the profile', async ({ page }) => {
    await page.locator('button:has-text("Perfil")').first().click();
    await page.locator('button:has-text("Pagos protegidos")').first().click();
    // The subtitle is unique to the escrow overlay.
    await expect(
      page.locator('text=/se retiene de forma segura/i').first(),
    ).toBeVisible({ timeout: 5000 });
  });

  test('opens the create-agreement sheet', async ({ page }) => {
    await page.locator('button:has-text("Perfil")').first().click();
    await page.locator('button:has-text("Pagos protegidos")').first().click();
    await page.locator('button[aria-label="Nuevo acuerdo"]').first().click();
    await expect(
      page.locator('button:has-text("Crear acuerdo")').first(),
    ).toBeVisible({ timeout: 5000 });
  });
});
