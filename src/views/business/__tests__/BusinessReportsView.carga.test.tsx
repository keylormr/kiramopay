import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { olvidarTarifas } from '@/hooks/usePlanes';
import { TARIFAS_POR_DEFECTO } from '@/utils/planes';
import type { BusinessReport, QRMerchant } from '@/api/repositories/qrpayment.repository';
import { BusinessReportsView } from '../BusinessReportsView';

// Hallazgo QA n=35: mientras el reporte cargaba, la pantalla pintaba guiones y
// un grafico en cero, identico a un comercio sin ventas. Y si la consulta
// fallaba, ademas del error decia "Sin ventas en este periodo".

const mocks = vi.hoisted(() => ({
  api: {
    qrPayments: { getMerchantReport: vi.fn(), exportMerchantReportCsv: vi.fn() },
    plans: { registrarInteres: vi.fn(), getTarifas: vi.fn() },
  },
}));

vi.mock('@/api', () => ({ getApiLayer: () => mocks.api }));

vi.mock('@/hooks/useApp', () => ({
  useApp: () => ({
    state: { accounts: [{ ccy: 'CRC', symbol: '₡', balance: 0 }], baseCurrency: 'CRC' },
    dispatch: vi.fn(),
  }),
}));

const comercio = {
  id: 'm1', name: 'Soda', description: '', category: 'restaurant', qrCode: 'MRC-1', active: true,
  cedula: '3101', cedulaType: 'juridica', legalName: 'Soda SA', verificationStatus: 'verified',
  commissionBps: 50, comisionEfectivaBps: 50, promoHasta: null, plan: 'base', role: 'owner',
} as QRMerchant;

const reporte = (count: number, net: number): BusinessReport => ({
  days: 30, from: '2026-08-15', to: '2026-09-13',
  totals: { gross: net, fee: 0, net, count },
  daily: [], byLocation: [], byCollector: [], plan: 'base',
});

const SIN_VENTAS = 'Sin ventas en este período';

// Una promesa que la prueba resuelve cuando quiere: asi se ve la pantalla
// mientras el servidor todavia no contesta.
function pendiente<T>() {
  let resolver: (v: T) => void = () => {};
  const promesa = new Promise<T>((r) => { resolver = r; });
  return { promesa, resolver };
}

const pintar = () =>
  render(
    <LanguageProvider>
      <BusinessReportsView merchant={comercio} />
    </LanguageProvider>,
  );

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
  Object.values(mocks.api.qrPayments).forEach((fn) => fn.mockReset());
  Object.values(mocks.api.plans).forEach((fn) => fn.mockReset());
  mocks.api.plans.getTarifas.mockResolvedValue({ success: true, data: TARIFAS_POR_DEFECTO });
  olvidarTarifas();
});

describe('BusinessReportsView: cargando no es "sin ventas"', () => {
  it('mientras llega el reporte dice que esta cargando, sin guiones ni "sin ventas"', async () => {
    const espera = pendiente<unknown>();
    mocks.api.qrPayments.getMerchantReport.mockReturnValue(espera.promesa);
    pintar();

    expect(screen.getAllByText('Cargando el reporte…').length).toBeGreaterThan(0);
    expect(screen.queryByText(SIN_VENTAS)).toBeNull();
    expect(screen.queryByText('Neto del período')).toBeNull();

    espera.resolver({ success: true, data: reporte(0, 0) });
    // Con la respuesta en la mano, un comercio sin ventas si se dice.
    expect(await screen.findByText(SIN_VENTAS)).toBeInTheDocument();
    expect(screen.queryAllByText('Cargando el reporte…')).toHaveLength(0);
  });

  it('si la consulta falla lo dice y ofrece reintentar, sin afirmar que no hubo ventas', async () => {
    mocks.api.qrPayments.getMerchantReport.mockResolvedValueOnce({
      success: false,
      error: { code: 'NOT_FOUND', message: 'merchant not found or not a member' },
    });
    mocks.api.qrPayments.getMerchantReport.mockResolvedValueOnce({ success: true, data: reporte(3, 1500) });
    const user = userEvent.setup();
    pintar();

    expect(await screen.findByRole('alert')).toHaveTextContent('No pudimos cargar el reporte de este período.');
    expect(screen.queryByText(SIN_VENTAS)).toBeNull();
    // El texto del servidor (en ingles) nunca llega a la pantalla.
    expect(screen.queryByText(/not a member/)).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Reintentar' }));

    expect(await screen.findByText('₡1,500.00')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(mocks.api.qrPayments.getMerchantReport).toHaveBeenCalledTimes(2);
  });

  it('un corte de red usa el aviso traducido del cliente', async () => {
    mocks.api.qrPayments.getMerchantReport.mockResolvedValue({
      success: false,
      error: { code: 'NETWORK_ERROR', message: 'No pudimos conectar con KiramoPay. Revisa tu conexión e intenta de nuevo.' },
    });
    pintar();

    expect(await screen.findByRole('alert')).toHaveTextContent('No pudimos conectar con KiramoPay.');
  });

  it('al cambiar de rango, los numeros anteriores quedan atenuados y rotulados hasta que llega el nuevo', async () => {
    const nuevo = pendiente<unknown>();
    mocks.api.qrPayments.getMerchantReport
      .mockResolvedValueOnce({ success: true, data: reporte(2, 1000) })
      .mockReturnValueOnce(nuevo.promesa);
    const user = userEvent.setup();
    pintar();

    expect(await screen.findByText('₡1,000.00')).toBeInTheDocument();
    expect(screen.queryAllByText('Actualizando…')).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: '90 días' }));

    // Lo ve quien mira (en la tarjeta) y lo oye quien usa lector de pantalla.
    expect(await screen.findAllByText('Actualizando…')).toHaveLength(2);
    expect(screen.getByText('₡1,000.00').closest('[aria-busy="true"]')).not.toBeNull();

    nuevo.resolver({ success: true, data: reporte(0, 0) });

    expect(await screen.findByText(SIN_VENTAS)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryAllByText('Actualizando…')).toHaveLength(0));
    expect(mocks.api.qrPayments.getMerchantReport).toHaveBeenLastCalledWith('m1', 90);
  });
});
