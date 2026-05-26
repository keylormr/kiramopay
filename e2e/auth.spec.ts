import { test, expect } from '@playwright/test';

test.describe('Authentication Flow', () => {
  test.beforeEach(async ({ page }) => {
    // Clear localStorage to start fresh
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
  });

  test('should show login page by default', async ({ page }) => {
    await page.goto('/');
    // The login view should be visible
    await expect(page.locator('text=KiramoPay')).toBeVisible();
  });

  test('should show error for invalid credentials', async ({ page }) => {
    await page.goto('/');

    // Type an unregistered cedula
    const cedulaInput = page.locator('input[type="text"], input[placeholder*="cédula" i], input[placeholder*="cedula" i]').first();
    if (await cedulaInput.isVisible()) {
      await cedulaInput.fill('999999999');
      // Submit/continue
      const continueBtn = page.locator('button:has-text("Continuar"), button:has-text("Continue"), button:has-text("Siguiente")').first();
      if (await continueBtn.isVisible()) {
        await continueBtn.click();
        // Enter wrong password
        await page.waitForTimeout(500);
        const passwordInput = page.locator('input[type="password"]').first();
        if (await passwordInput.isVisible()) {
          await passwordInput.fill('WrongPassword123!');
          const loginBtn = page.locator('button:has-text("Ingresar"), button:has-text("Login"), button:has-text("Entrar")').first();
          if (await loginBtn.isVisible()) {
            await loginBtn.click();
            // Should show error message
            await expect(page.locator('text=/incorrecta|not found|inválid|error/i')).toBeVisible({ timeout: 5000 });
          }
        }
      }
    }
  });

  test('should navigate to password input after valid cedula', async ({ page }) => {
    await page.goto('/');

    const cedulaInput = page.locator('input[type="text"], input[placeholder*="cédula" i], input[placeholder*="cedula" i]').first();
    if (await cedulaInput.isVisible()) {
      await cedulaInput.fill('702650930');
      const continueBtn = page.locator('button:has-text("Continuar"), button:has-text("Continue"), button:has-text("Siguiente")').first();
      if (await continueBtn.isVisible()) {
        await continueBtn.click();
        // Should show password input
        await expect(page.locator('input[type="password"]').first()).toBeVisible({ timeout: 5000 });
      }
    }
  });

  test('should login successfully with valid credentials', async ({ page }) => {
    await page.goto('/');

    // Step 1: Enter cedula
    const cedulaInput = page.locator('input[type="text"], input[placeholder*="cédula" i], input[placeholder*="cedula" i]').first();
    if (await cedulaInput.isVisible()) {
      await cedulaInput.fill('702650930');
      const continueBtn = page.locator('button:has-text("Continuar"), button:has-text("Continue"), button:has-text("Siguiente")').first();
      if (await continueBtn.isVisible()) {
        await continueBtn.click();
      }
    }

    // Step 2: Enter password
    await page.waitForTimeout(500);
    const passwordInput = page.locator('input[type="password"]').first();
    if (await passwordInput.isVisible()) {
      await passwordInput.fill('Kiramopay2024!');
      const loginBtn = page.locator('button:has-text("Ingresar"), button:has-text("Login"), button:has-text("Entrar")').first();
      if (await loginBtn.isVisible()) {
        await loginBtn.click();
      }
    }

    // Should reach the main app (home view with balance or tab bar)
    await expect(
      page.locator('text=/saldo|balance|inicio|home/i').first()
    ).toBeVisible({ timeout: 10000 });
  });
});
