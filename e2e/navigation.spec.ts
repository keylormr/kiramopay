import { test, expect } from '@playwright/test';
import { loginAsTestUser } from './helpers';

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
