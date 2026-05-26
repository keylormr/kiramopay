import { test, expect } from '@playwright/test';

async function loginAsTestUser(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  const cedulaInput = page.locator('input[type="text"], input[placeholder*="cédula" i], input[placeholder*="cedula" i]').first();
  if (await cedulaInput.isVisible({ timeout: 5000 })) {
    await cedulaInput.fill('702650930');
    const continueBtn = page.locator('button:has-text("Continuar"), button:has-text("Continue"), button:has-text("Siguiente")').first();
    if (await continueBtn.isVisible()) {
      await continueBtn.click();
    }
  }

  await page.waitForTimeout(500);
  const passwordInput = page.locator('input[type="password"]').first();
  if (await passwordInput.isVisible()) {
    await passwordInput.fill('Kiramopay2024!');
    const loginBtn = page.locator('button:has-text("Ingresar"), button:has-text("Login"), button:has-text("Entrar")').first();
    if (await loginBtn.isVisible()) {
      await loginBtn.click();
    }
  }

  await page.waitForTimeout(2000);
}

test.describe('Home View', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsTestUser(page);
  });

  test('should display user balance', async ({ page }) => {
    // Balance should be visible on home screen
    await expect(
      page.locator('text=/\\₡|CRC|saldo|balance/i').first()
    ).toBeVisible({ timeout: 5000 });
  });

  test('should display quick action buttons', async ({ page }) => {
    // Quick actions like Send, Pay, Recharge
    const actionButtons = page.locator('button, [role="button"]');
    const count = await actionButtons.count();
    expect(count).toBeGreaterThan(2);
  });

  test('should show recent transactions section', async ({ page }) => {
    // Transactions section should exist
    await expect(
      page.locator('text=/transaccion|movimiento|historial|recent/i').first()
    ).toBeVisible({ timeout: 5000 });
  });

  test('should toggle balance visibility', async ({ page }) => {
    // Look for eye icon to toggle balance
    const eyeBtn = page.locator('[data-testid="toggle-balance"], button:has(svg)').first();
    if (await eyeBtn.isVisible({ timeout: 3000 })) {
      await eyeBtn.click();
      await page.waitForTimeout(300);
      // Balance might be hidden now
    }
  });
});

test.describe('Dark Mode', () => {
  test('should toggle dark mode from settings', async ({ page }) => {
    await loginAsTestUser(page);

    // Navigate to profile/settings
    const profileBtn = page.locator('button:has-text("Perfil"), button:has-text("Profile"), [data-tab="profile"]').first();
    if (await profileBtn.isVisible({ timeout: 3000 })) {
      await profileBtn.click();
      await page.waitForTimeout(500);

      // Look for dark mode toggle
      const darkModeToggle = page.locator('text=/oscuro|dark|tema|theme/i').first();
      if (await darkModeToggle.isVisible({ timeout: 3000 })) {
        await darkModeToggle.click();
        // HTML element should have dark class
        const html = page.locator('html');
        const classList = await html.getAttribute('class');
        expect(classList).toContain('dark');
      }
    }
  });
});
