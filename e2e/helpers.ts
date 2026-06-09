import { expect, type Page, type Route } from '@playwright/test';

// Shared E2E helpers. Auth ALWAYS goes through the real backend (no mock
// adapter), and the E2E job runs the Vite dev server with no backend behind
// it. We therefore stub the network at the browser with page.route() so the
// suite is deterministic and re-gateable.

export const BACKEND_USER = {
  id: '00000000-0000-0000-0000-000000000001',
  cedula: '702650930',
  phone: '88880000',
  first_name: 'Keilor',
  last_name: 'Martinez',
  email: 'keilor@example.com',
  kyc_level: 0,
  status: 'active',
};

export function jsonRoute(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

/**
 * Stub every /api/v1 call with an empty success, plus a successful login.
 * Registered last → the login route takes precedence over the catch-all.
 */
export async function stubBackend(page: Page) {
  // Skip the first-run onboarding carousel so login lands on the app shell.
  // addInitScript re-applies on every navigation, surviving localStorage.clear().
  await page.addInitScript(() => localStorage.setItem('kiramopay_onboarded', '1'));
  await page.route('**/api/v1/**', (route) => jsonRoute(route, { success: true, data: [] }));
  await page.route('**/api/v1/auth/login', (route) =>
    jsonRoute(route, {
      success: true,
      data: {
        user: BACKEND_USER,
        tokens: {
          access_token: 'access-token',
          refresh_token: 'refresh-token',
          expires_at: Date.now() + 3_600_000,
        },
      },
    }),
  );
}

/** Drives the two-stage login form with the test user against a stubbed backend. */
export async function loginAsTestUser(page: Page) {
  await stubBackend(page);
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.goto('/');

  await page.locator('input[type="text"]').first().fill('702650930');
  await page
    .locator('button:has-text("Continuar"), button:has-text("Continue"), button:has-text("Siguiente")')
    .first()
    .click();

  const password = page.locator('input[type="password"]').first();
  await expect(password).toBeVisible({ timeout: 5000 });
  await password.fill('Kiramopay2024!');
  await page
    .locator('button:has-text("Ingresar"), button:has-text("Login"), button:has-text("Entrar")')
    .first()
    .click();

  // The bottom nav (Perfil tab) only renders once authenticated.
  await expect(page.locator('text=Perfil').first()).toBeVisible({ timeout: 10000 });
}
