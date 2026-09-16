import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Capacitor } from '@capacitor/core';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { olvidarTarifas } from '@/hooks/usePlanes';
import { TARIFAS_POR_DEFECTO } from '@/utils/planes';
import type { BusinessReport, QRMerchant } from '@/api/repositories/qrpayment.repository';
import { BusinessReportsView } from '../BusinessReportsView';

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

const comercio = (plan: 'base' | 'analitica') =>
  ({
    id: 'm1', name: 'Soda', description: '', category: 'restaurant', qrCode: 'MRC-1', active: true,
    cedula: '3101', cedulaType: 'juridica', legalName: 'Soda SA', verificationStatus: 'verified',
    commissionBps: 50, comisionEfectivaBps: 50, promoHasta: null, plan, role: 'owner',
  }) as QRMerchant;

const reporteBase: BusinessReport = {
  days: 30, from: '2026-08-15', to: '2026-09-13',
  totals: { gross: 1000, fee: 5, net: 995, count: 2 },
  daily: [], byLocation: [], byCollector: [], plan: 'base',
};

const reporteAnalitica: BusinessReport = {
  ...reporteBase,
  plan: 'analitica',
  comparison: {
    previousFrom: '2026-07-16',
    previousTo: '2026-08-14',
    previousTotals: { gross: 800, fee: 4, net: 796, count: 0 },
    delta: { gross: 200, fee: 1, net: 199, count: 2, grossPct: 25, netPct: 25, countPct: null },
  },
};

const pintar = (plan: 'base' | 'analitica') =>
  render(
    <LanguageProvider>
      <BusinessReportsView merchant={comercio(plan)} />
    </LanguageProvider>,
  );

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

describe('BusinessReportsView sin Analitica', () => {
  it('muestra una vista previa honesta: precio, proximamente y nada de numeros inventados', async () => {
    mocks.api.qrPayments.getMerchantReport.mockResolvedValue({ success: true, data: reporteBase });
    pintar('base');

    expect(await screen.findByRole('heading', { name: 'Analítica' })).toBeInTheDocument();
    expect(screen.getByText('$9.99')).toBeInTheDocument();
    expect(screen.getByText('Próximamente')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Exportar CSV' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Contra el período anterior' })).toBeNull();
    // La vista previa no trae montos: solo guiones.
    expect(screen.getAllByText('± —%')).toHaveLength(2);
  });

  it('anota el interes en Analitica una sola vez', async () => {
    mocks.api.qrPayments.getMerchantReport.mockResolvedValue({ success: true, data: reporteBase });
    mocks.api.plans.registrarInteres.mockResolvedValue({ success: true, data: { plan: 'analitica', registeredAt: '' } });
    const user = userEvent.setup();
    pintar('base');

    await user.click(await screen.findByRole('button', { name: 'Avisarme cuando esté disponible Analítica' }));

    const anotado = await screen.findByRole('button', { name: 'Anotado. Te avisamos. Analítica' });
    expect(anotado).toBeDisabled();
    expect(mocks.api.plans.registrarInteres).toHaveBeenCalledTimes(1);
    expect(mocks.api.plans.registrarInteres).toHaveBeenCalledWith('analitica');
  });
});

describe('BusinessReportsView con Analitica', () => {
  it('compara contra el periodo anterior con el signo escrito y sin porcentaje cuando antes fue cero', async () => {
    mocks.api.qrPayments.getMerchantReport.mockResolvedValue({ success: true, data: reporteAnalitica });
    pintar('analitica');

    expect(await screen.findByRole('heading', { name: 'Contra el período anterior' })).toBeInTheDocument();
    expect(screen.getAllByText('+25%')).toHaveLength(2);
    expect(screen.getByText('Sin cobros antes')).toBeInTheDocument();
    expect(screen.getByText('Antes ₡796.00')).toBeInTheDocument();
    // Las fechas del periodo anterior son dias locales: el 16 no se corre al 15.
    expect(screen.getByText(/Del 16 .*jul.* al 14 .*ago/i)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Analítica' })).toBeNull();
  });

  it('exporta el CSV del rango elegido y lo descarga en el navegador', async () => {
    mocks.api.qrPayments.getMerchantReport.mockResolvedValue({ success: true, data: reporteAnalitica });
    mocks.api.qrPayments.exportMerchantReportCsv.mockResolvedValue({
      success: true,
      data: { blob: new Blob(['seccion']), nombre: 'reporte-2026-09-07-a-2026-09-13.csv' },
    });
    const clic = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const user = userEvent.setup();
    pintar('analitica');

    await user.click(await screen.findByRole('button', { name: '7 días' }));
    await waitFor(() => expect(mocks.api.qrPayments.getMerchantReport).toHaveBeenLastCalledWith('m1', 7));
    await user.click(screen.getByRole('button', { name: 'Exportar CSV' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Listo. El archivo se descargó.');
    expect(mocks.api.qrPayments.exportMerchantReportCsv).toHaveBeenCalledWith('m1', 7);
    expect(clic).toHaveBeenCalledTimes(1);
  });

  it('si el servidor dice PLAN_REQUIRED lo explica en vez de descargar un error', async () => {
    mocks.api.qrPayments.getMerchantReport.mockResolvedValue({ success: true, data: reporteAnalitica });
    mocks.api.qrPayments.exportMerchantReportCsv.mockResolvedValue({
      success: false,
      error: { code: 'PLAN_REQUIRED', message: 'plan', details: { plan_requerido: 'analitica' } },
    });
    const user = userEvent.setup();
    pintar('analitica');

    await user.click(await screen.findByRole('button', { name: 'Exportar CSV' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Exportar el reporte requiere el plan Analítica.');
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('en la app del telefono sin forma de compartir no finge que descargo', async () => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    mocks.api.qrPayments.getMerchantReport.mockResolvedValue({ success: true, data: reporteAnalitica });
    mocks.api.qrPayments.exportMerchantReportCsv.mockResolvedValue({
      success: true,
      data: { blob: new Blob(['seccion']), nombre: 'reporte.csv' },
    });
    const user = userEvent.setup();
    pintar('analitica');

    await user.click(await screen.findByRole('button', { name: 'Exportar CSV' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/Exporta desde kiramopay\.com en el navegador/);
    expect(screen.queryByText('Listo. El archivo se descargó.')).toBeNull();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('el plan que manda es el del reporte del servidor, no el del comercio cargado antes', async () => {
    mocks.api.qrPayments.getMerchantReport.mockResolvedValue({ success: true, data: reporteBase });
    pintar('analitica');

    expect(await screen.findByRole('heading', { name: 'Analítica' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Exportar CSV' })).toBeNull();
  });
});
