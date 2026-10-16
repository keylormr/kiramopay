// Quien pide el segundo factor para mover dinero dice en el boton que hace:
// "Verificar y enviar" en un retiro, "Verificar y pagar" en un servicio. Las
// pantallas de pagos salientes y de servicios no lo pasaban y quedaba el texto
// de activar el segundo factor en Perfil.

const vistas = import.meta.glob('/src/views/**/*.tsx', { query: '?raw', import: 'default', eager: true }) as Record<
  string,
  string
>;

function usosDelReto(ruta: string): string[] {
  const fuente = vistas[ruta];
  expect(fuente, `no se encontro ${ruta}`).toBeTruthy();
  return [...fuente.matchAll(/<MfaChallengeSheet[\s\S]*?\/>/g)].map((m) => m[0]);
}

describe('el reto del segundo factor dice que hace el boton', () => {
  it.each([
    ['/src/views/payout/PayoutView.tsx', 'mfa_verify_and_send'],
    ['/src/views/services/ServicesView.tsx', 'mfa_verify_and_pay'],
  ])('%s', (ruta, clave) => {
    const usos = usosDelReto(ruta);
    expect(usos.length).toBeGreaterThan(0);
    for (const uso of usos) expect(uso).toContain(`confirmLabel={t('${clave}')}`);
  });
});
