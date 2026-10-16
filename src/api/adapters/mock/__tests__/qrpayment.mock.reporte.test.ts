import { describe, it, expect, beforeEach } from 'vitest';
import { MockQRPaymentRepository } from '../qrpayment.mock';

// La demo arma el mismo CSV que el servidor, tambien en el idioma pedido: sin
// esto, la app en otro idioma bajaba el reporte de la demo en espanol.
describe('el CSV del reporte en la demo', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(
      'kiramopay_app_state',
      JSON.stringify({ qrMerchants: [{ id: 'm1', name: 'Soda', plan: 'analitica', role: 'owner' }] }),
    );
  });

  const texto = async (idioma?: string) => {
    const res = await new MockQRPaymentRepository().exportMerchantReportCsv('m1', 7, idioma);
    expect(res.success).toBe(true);
    return (await res.data!.blob.text()).replace(/^\uFEFF/, '');
  };

  it('en ingles, con el encabezado y el nombre del servidor', async () => {
    const csv = await texto('en');
    expect(csv.split(/\r?\n/)[0]).toBe('section,from,to,key,name,gross,fee,net,payments');
    expect(csv).toMatch(/^total,/m);
    expect(csv).not.toMatch(/seccion|^dia,/m);
    const res = await new MockQRPaymentRepository().exportMerchantReportCsv('m1', 7, 'en');
    expect(res.data!.nombre).toMatch(/^report-/);
  });

  it('sin idioma, en espanol como el servidor', async () => {
    const csv = await texto();
    expect(csv.split(/\r?\n/)[0]).toBe('seccion,desde,hasta,clave,nombre,bruto,comision,neto,cobros');
  });
});
