import { test, expect, type Page } from '@playwright/test';
import { jsonRoute, stubBackend } from './helpers';

// Auth ALWAYS goes through the real backend (no mock adapter). The E2E job
// runs the Vite dev server with no backend behind it, so we stub the network
// at the browser with page.route() — deterministic and re-gateable.

async function fillCedula(page: Page, cedula: string) {
  await page.locator('input[type="text"]').first().fill(cedula);
  await page
    .locator('button:has-text("Continuar"), button:has-text("Continue"), button:has-text("Siguiente")')
    .first()
    .click();
}

async function submitPassword(page: Page, password: string) {
  const field = page.locator('input[type="password"]').first();
  await expect(field).toBeVisible({ timeout: 5000 });
  await field.fill(password);
  await page
    .locator('button:has-text("Ingresar"), button:has-text("Login"), button:has-text("Entrar")')
    .first()
    .click();
}

test.describe('Authentication Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
  });

  test('shows the login page by default', async ({ page }) => {
    await page.goto('/');
    // Scope to the header so we don't also match the document <title>KiramoPay</title>.
    await expect(page.locator('header').getByText('KiramoPay')).toBeVisible();
  });

  test('advances from cédula to the password stage', async ({ page }) => {
    await page.goto('/');
    await fillCedula(page, '702650930');
    await expect(page.locator('input[type="password"]').first()).toBeVisible({ timeout: 5000 });
  });

  test('shows an error for invalid credentials', async ({ page }) => {
    await page.route('**/api/v1/auth/login', (route) =>
      jsonRoute(
        route,
        { success: false, error: { code: 'AUTH_FAILED', message: 'Credenciales incorrectas' } },
        401,
      ),
    );
    await page.goto('/');
    await fillCedula(page, '999999999');
    await submitPassword(page, 'WrongPassword123!');
    await expect(page.locator('text=/incorrecta|inválid|error/i').first()).toBeVisible({
      timeout: 5000,
    });
  });

  test('logs in with valid credentials', async ({ page }) => {
    await stubBackend(page);
    await page.goto('/');
    await fillCedula(page, '702650930');
    await submitPassword(page, 'Kiramopay2024!');
    // The bottom nav (Perfil tab) only renders once authenticated.
    await expect(page.locator('text=Perfil').first()).toBeVisible({ timeout: 10000 });
  });
});
