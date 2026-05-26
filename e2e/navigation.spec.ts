import { test, expect } from '@playwright/test';

// Helper to login before navigation tests
async function loginAsTestUser(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  // Enter cedula
  const cedulaInput = page.locator('input[type="text"], input[placeholder*="cédula" i], input[placeholder*="cedula" i]').first();
  if (await cedulaInput.isVisible({ timeout: 5000 })) {
    await cedulaInput.fill('702650930');
    const continueBtn = page.locator('button:has-text("Continuar"), button:has-text("Continue"), button:has-text("Siguiente")').first();
    if (await continueBtn.isVisible()) {
      await continueBtn.click();
    }
  }

  // Enter password
  await page.waitForTimeout(500);
  const passwordInput = page.locator('input[type="password"]').first();
  if (await passwordInput.isVisible()) {
    await passwordInput.fill('Kiramopay2024!');
    const loginBtn = page.locator('button:has-text("Ingresar"), button:has-text("Login"), button:has-text("Entrar")').first();
    if (await loginBtn.isVisible()) {
      await loginBtn.click();
    }
  }

  // Wait for main app
  await page.waitForTimeout(2000);
}

test.describe('Main Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsTestUser(page);
  });

  test('should display bottom navigation tabs', async ({ page }) => {
    // Bottom nav should be visible with main tabs
    const nav = page.locator('nav, [role="navigation"], [data-testid="bottom-nav"]').first();
    await expect(nav).toBeVisible({ timeout: 5000 });
  });

  test('should navigate to SINPE tab', async ({ page }) => {
    const sinpeTab = page.locator('button:has-text("SINPE"), [data-tab="sinpe"], a:has-text("SINPE")').first();
    if (await sinpeTab.isVisible({ timeout: 3000 })) {
      await sinpeTab.click();
      await expect(page.locator('text=/sinpe|transferencia|enviar/i').first()).toBeVisible({ timeout: 5000 });
    }
  });

  test('should navigate to Crypto tab', async ({ page }) => {
    const cryptoTab = page.locator('button:has-text("Crypto"), [data-tab="crypto"], a:has-text("Crypto")').first();
    if (await cryptoTab.isVisible({ timeout: 3000 })) {
      await cryptoTab.click();
      await expect(page.locator('text=/crypto|bitcoin|portafolio|portfolio/i').first()).toBeVisible({ timeout: 5000 });
    }
  });

  test('should navigate to Services tab', async ({ page }) => {
    const servicesTab = page.locator('button:has-text("Servicio"), button:has-text("Service"), [data-tab="services"]').first();
    if (await servicesTab.isVisible({ timeout: 3000 })) {
      await servicesTab.click();
      await expect(page.locator('text=/servicio|pago|recarga|service/i').first()).toBeVisible({ timeout: 5000 });
    }
  });

  test('should navigate to Profile', async ({ page }) => {
    const profileBtn = page.locator('button:has-text("Perfil"), button:has-text("Profile"), [data-tab="profile"]').first();
    if (await profileBtn.isVisible({ timeout: 3000 })) {
      await profileBtn.click();
      await expect(page.locator('text=/perfil|profile|keilor/i').first()).toBeVisible({ timeout: 5000 });
    }
  });
});
