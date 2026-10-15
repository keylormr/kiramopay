import { test, expect } from '@playwright/test';
import { loginAsTestUser } from './helpers';

// En un telefono chico la hoja de enviar dinero no cabia en la pantalla: el
// area que se desplaza tenia su propio tope (el 70% del alto) que, sumado al
// asa y al titulo, pasaba el de la hoja (el 85%). El final de la hoja quedaba
// bajo el borde, y con el el error de un envio rechazado: la persona tocaba
// Enviar y a la vista no pasaba nada.
//
// Sin VITE_API_URL el envio de SINPE va por el repositorio de la demo, que no
// rechaza nada: la prueba lo cambia por uno que contesta lo que el servidor
// contesta cuando no alcanza el saldo.

const RECHAZO = `(async () => {
  const { getApiLayer } = await import('/src/api/index.ts');
  getApiLayer().sinpe.send = async () => ({
    success: false,
    error: { code: 'INSUFFICIENT_BALANCE', message: 'insufficient balance' },
  });
})()`;

for (const [ancho, alto] of [
  [320, 700],
  [360, 640],
] as const) {
  test.describe(`Hoja de enviar en ${ancho}x${alto}`, () => {
    test.use({ viewport: { width: ancho, height: alto } });

    test('cabe en la pantalla, y el rechazo se anuncia y queda a la vista', async ({ page }) => {
      // La invitacion de la campana se abre sola al entrar y tapa la pantalla.
      await page.addInitScript(() => localStorage.setItem('kiramopay-campana-invitar-2026-09-referidos', '1'));
      await loginAsTestUser(page);
      await page.evaluate(RECHAZO);

      await page.getByRole('button', { name: 'SINPE', exact: true }).first().click();
      await page.getByRole('button', { name: 'Enviar', exact: true }).first().click();

      const hoja = page.getByRole('dialog');
      await expect(hoja).toBeVisible();
      await hoja.getByPlaceholder('8888-0000').fill('88887777');
      await hoja.getByPlaceholder('0', { exact: true }).fill('5000');

      // El final de la hoja se alcanza: desplazando su contenido hasta el
      // boton de enviar, el boton queda entero dentro de la pantalla. Antes el
      // area que se desplaza terminaba bajo el borde y el boton quedaba cortado.
      const enviar = hoja.getByRole('button', { name: /^Enviar/ });
      await enviar.scrollIntoViewIfNeeded();
      await expect(enviar).toBeInViewport({ ratio: 1 });

      await enviar.click();
      const confirmar = page.getByRole('dialog').last();
      await confirmar.getByRole('button', { name: /^Enviar/ }).click();

      const aviso = page.getByRole('alert').filter({ hasText: 'Fondos insuficientes' });
      await expect(aviso).toBeVisible();
      await expect(aviso).toBeInViewport({ ratio: 1 });
    });
  });
}
