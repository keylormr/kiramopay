import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { olvidarTarifas } from '@/hooks/usePlanes';
import { TARIFAS_POR_DEFECTO } from '@/utils/planes';
import type { BusinessReport, QRMerchant } from '@/api/repositories/qrpayment.repository';
import { BusinessReportsView } from '../BusinessReportsView';

// El reporte de un comercio cerrado. Lo que vendio es del dueno, que lo necesita
// para sus cuentas: el CSV se descarga aunque el comercio tuviera el plan base.
// Y no se le ofrece contratar Analitica para un negocio que ya no existe.

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

const cerrado = {
  id: 'm1', name: 'Soda', description: '', category: 'restaurant', qrCode: 'MRC-1', active: false,
  cedula: '3101', cedulaType: 'juridica', legalName: 'Soda SA', verificationStatus: 'verified',
  commissionBps: 50, comisionEfectivaBps: 50, promoHasta: null, plan: 'base', role: 'owner',
  closedAt: '2026-10-18T20:00:00Z', closureReason: 'owner_request',
} as QRMerchant;

const reporteBase: BusinessReport = {
  days: 30, from: '2026-09-19', to: '2026-10-18',
  totals: { gross: 1000, fee: 5, net: 995, count: 2 },
  daily: [], byLocation: [], byCollector: [], plan: 'base',
};

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
  Object.values(mocks.api.qrPayments).forEach((fn) => fn.mockReset());
  Object.values(mocks.api.plans).forEach((fn) => fn.mockReset());
  mocks.api.plans.getTarifas.mockResolvedValue({ success: true, data: TARIFAS_POR_DEFECTO });
  olvidarTarifas();
  Object.defineProperty(URL, 'createObjectURL', { value: vi.fn(() => 'blob:reporte'), configurable: true, writable: true });
  Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true, writable: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('BusinessReportsView de un comercio cerrado', () => {
  it('ofrece el CSV con el plan base y no la vista previa de Analitica', async () => {
    mocks.api.qrPayments.getMerchantReport.mockResolvedValue({ success: true, data: reporteBase });
    mocks.api.qrPayments.exportMerchantReportCsv.mockResolvedValue({
      success: true,
      data: { blob: new Blob(['seccion']), nombre: 'reporte-2026-09-19-a-2026-10-18.csv' },
    });
    const user = userEvent.setup();
    render(
      <LanguageProvider>
        <BusinessReportsView merchant={cerrado} />
      </LanguageProvider>,
    );

    const exportar = await screen.findByRole('button', { name: 'Exportar CSV' });
    expect(screen.queryByText('Próximamente')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Analítica' })).toBeNull();

    await user.click(exportar);
    await waitFor(() => expect(mocks.api.qrPayments.exportMerchantReportCsv).toHaveBeenCalledWith('m1', 30, 'es'));
    expect(mocks.api.plans.registrarInteres).not.toHaveBeenCalled();
  });

  // Un comercio cerrado ya no vende: "los ultimos 30 dias" son los 30 antes del
  // cierre, y se dice. Y se puede mirar el ultimo ano entero.
  it('cuenta hasta el cierre y deja ver el ultimo ano', async () => {
    mocks.api.qrPayments.getMerchantReport.mockResolvedValue({ success: true, data: reporteBase });
    const user = userEvent.setup();
    render(
      <LanguageProvider>
        <BusinessReportsView merchant={cerrado} />
      </LanguageProvider>,
    );

    expect(await screen.findByText('Los días se cuentan hasta el cierre.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '365 días' }));
    await waitFor(() => expect(mocks.api.qrPayments.getMerchantReport).toHaveBeenLastCalledWith('m1', 365));
  });

  it('un comercio abierto no ofrece el ano ni habla del cierre', async () => {
    mocks.api.qrPayments.getMerchantReport.mockResolvedValue({ success: true, data: reporteBase });
    render(
      <LanguageProvider>
        <BusinessReportsView merchant={{ ...cerrado, closedAt: null, active: true }} />
      </LanguageProvider>,
    );

    await screen.findByRole('button', { name: '30 días' });
    expect(screen.queryByRole('button', { name: '365 días' })).toBeNull();
    expect(screen.queryByText('Los días se cuentan hasta el cierre.')).toBeNull();
  });
});
