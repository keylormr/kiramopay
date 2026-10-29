import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import type { QRMerchant } from '@/api/repositories/qrpayment.repository';
import { BusinessMovementsView } from '../BusinessMovementsView';

// En el telefono el reporte no se descarga: se comparte desde el menu del
// sistema. El aviso no puede decir "se descargo", y si la persona cierra el menu
// sin compartir no dice nada.

const mocks = vi.hoisted(() => ({
  api: {
    qrPayments: {
      getMerchantPayments: vi.fn(),
      getMerchantDailyTotals: vi.fn(),
      getMerchantWithdrawals: vi.fn(),
      exportMerchantReportCsv: vi.fn(),
    },
  },
  entregarArchivo: vi.fn(),
}));

vi.mock('@/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api')>()),
  getApiLayer: () => mocks.api,
}));

vi.mock('@/utils/entregarArchivo', () => ({ entregarArchivo: mocks.entregarArchivo }));

vi.mock('@/hooks/useApp', () => ({
  useApp: () => ({
    state: { accounts: [{ ccy: 'CRC', symbol: '₡', balance: 0 }], baseCurrency: 'CRC' },
    dispatch: vi.fn(),
  }),
}));

const comercio: QRMerchant = {
  id: 'm1', name: 'Super La Esquina', description: '', category: 'retail', qrCode: 'MRC-1', active: true,
  cedula: '3101', cedulaType: 'juridica', legalName: 'La Esquina SA', verificationStatus: 'verified',
  commissionBps: 50, comisionEfectivaBps: 50, promoHasta: null, plan: 'analitica', role: 'owner',
};

async function exportar() {
  const user = userEvent.setup();
  render(
    <LanguageProvider>
      <BusinessMovementsView merchant={comercio} />
    </LanguageProvider>,
  );
  await user.click(await screen.findByRole('button', { name: 'Exportar CSV' }));
  await waitFor(() => expect(mocks.entregarArchivo).toHaveBeenCalled());
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
  Object.values(mocks.api.qrPayments).forEach((fn) => fn.mockReset());
  mocks.api.qrPayments.getMerchantPayments.mockResolvedValue({ success: true, data: [] });
  mocks.api.qrPayments.getMerchantDailyTotals.mockResolvedValue({ success: true, data: [] });
  mocks.api.qrPayments.getMerchantWithdrawals.mockResolvedValue({ success: true, data: [] });
  mocks.api.qrPayments.exportMerchantReportCsv.mockResolvedValue({
    success: true,
    data: { blob: new Blob(['x']), nombre: 'reporte.csv' },
  });
  mocks.entregarArchivo.mockReset();
});

describe('BusinessMovementsView — exportar en el telefono', () => {
  it('compartido desde el menu del sistema dice que se compartio, no que se descargo', async () => {
    mocks.entregarArchivo.mockResolvedValue('compartido');
    await exportar();

    expect(await screen.findByText('Listo. El archivo se compartió.')).toBeInTheDocument();
    expect(screen.queryByText('Listo. El archivo se descargó.')).toBeNull();
  });

  it('si la persona cierra el menu sin compartir, no dice que esta listo', async () => {
    mocks.entregarArchivo.mockResolvedValue('quieto');
    await exportar();

    await waitFor(() => expect(screen.getByRole('button', { name: 'Exportar CSV' })).toBeInTheDocument());
    expect(screen.queryByText('Listo. El archivo se compartió.')).toBeNull();
    expect(screen.queryByText('Listo. El archivo se descargó.')).toBeNull();
  });
});
