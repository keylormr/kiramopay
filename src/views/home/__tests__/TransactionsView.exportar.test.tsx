import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { TransactionsView } from '../TransactionsView';
import type { Transaction } from '@/types';

// En la app del telefono, "Exportar" no guardaba nada (el WebView ignora el
// enlace de descarga) y aun asi decia "Exportado exitosamente". Ahora escribe el
// archivo en la cache de la app y abre el menu de compartir; el aviso de listo
// sale solo si la persona compartio.

const nativo = vi.hoisted(() => ({
  writeFile: vi.fn(),
  share: vi.fn(),
}));

vi.mock('@capacitor/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@capacitor/core')>()),
  Capacitor: {
    isNativePlatform: () => true,
    isPluginAvailable: (nombre: string) => nombre === 'Filesystem' || nombre === 'Share',
    getPlatform: () => 'android',
  },
}));

vi.mock('@capacitor/filesystem', () => ({
  Filesystem: { writeFile: nativo.writeFile },
  Directory: { Cache: 'CACHE' },
}));

vi.mock('@capacitor/share', () => ({
  Share: { share: nativo.share },
}));

const mockApi = vi.hoisted(() => ({
  transactions: { listTransactions: vi.fn() },
}));

vi.mock('@/api', () => ({ getApiLayer: () => mockApi }));

const movimientos: Transaction[] = [
  {
    id: 't1',
    title: 'Café',
    type: 'debit',
    amount: -1500,
    ccy: 'CRC',
    date: '29/10/2026',
    dateISO: '2026-10-29T15:00:00.000Z',
    status: 'completed',
    category: 'Food',
    kind: 'qr_payment',
  } as Transaction,
];

vi.mock('@/hooks/useApp', () => ({
  useApp: () => ({
    state: { transactions: movimientos, baseCurrency: 'CRC' },
    dispatch: vi.fn(),
  }),
}));

async function abrirExportar() {
  const user = userEvent.setup();
  render(
    <LanguageProvider>
      <TransactionsView onClose={vi.fn()} />
    </LanguageProvider>,
  );
  await waitFor(() => expect(mockApi.transactions.listTransactions).toHaveBeenCalled());
  await user.click(screen.getByRole('button', { name: 'Opciones de exportación' }));
  return user;
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
  mockApi.transactions.listTransactions.mockReset().mockResolvedValue({
    success: true,
    data: { transactions: movimientos, total: movimientos.length },
  });
  nativo.writeFile.mockReset().mockImplementation(async ({ path }: { path: string }) => ({
    uri: `file:///data/user/0/com.kiramopay.app/cache/${path}`,
  }));
  nativo.share.mockReset().mockResolvedValue({ activityType: 'com.google.android.apps.docs' });
});

describe('TransactionsView — exportar en el telefono', () => {
  it('el CSV se escribe en la cache y se abre el menu de compartir con ese archivo', async () => {
    const user = await abrirExportar();
    await user.click(screen.getByText('Excel (CSV)'));

    await waitFor(() => expect(nativo.share).toHaveBeenCalled());
    const { path, directory } = nativo.writeFile.mock.calls[0][0] as { path: string; directory: string };
    expect(path).toMatch(/^KiramoPay-Transacciones-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(directory).toBe('CACHE');
    expect(nativo.share).toHaveBeenCalledWith(
      expect.objectContaining({ files: [`file:///data/user/0/com.kiramopay.app/cache/${path}`] }),
    );
    expect(await screen.findByText('Exportado exitosamente')).toBeInTheDocument();
  });

  it('el JSON sale por el mismo camino', async () => {
    const user = await abrirExportar();
    await user.click(screen.getByText('JSON'));

    await waitFor(() => expect(nativo.share).toHaveBeenCalled());
    const { path } = nativo.writeFile.mock.calls[0][0] as { path: string };
    expect(path).toMatch(/\.json$/);
  });

  it('si la persona cierra el menu sin compartir, no dice "Exportado exitosamente"', async () => {
    nativo.share.mockRejectedValue(new Error('Share canceled'));
    const user = await abrirExportar();
    await user.click(screen.getByText('Excel (CSV)'));

    await waitFor(() => expect(nativo.share).toHaveBeenCalled());
    // Da tiempo a que el resultado del menu llegue a la pantalla.
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText('Exportado exitosamente')).toBeNull();
  });

  it('si no se pudo escribir el archivo, lo dice en vez de "Exportado exitosamente"', async () => {
    nativo.writeFile.mockRejectedValue(new Error('disco lleno'));
    const user = await abrirExportar();
    await user.click(screen.getByText('Excel (CSV)'));

    expect(await screen.findByText('No se pudo exportar. Intenta de nuevo.')).toBeInTheDocument();
    expect(screen.queryByText('Exportado exitosamente')).toBeNull();
  });
});
