import type { ReactNode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { BusinessTeamSheet } from '../BusinessTeamSheet';
import { BusinessLocationsSheet } from '../BusinessLocationsSheet';
import { BusinessCatalogSheet } from '../BusinessCatalogSheet';

// Si el comercio se cerro con la hoja abierta (desde otro telefono, o lo cerro
// un administrador), el servidor responde 409 MERCHANT_CLOSED. La hoja lo dice
// en el idioma de la app, no con el texto en ingles del servidor.

const mockApi = vi.hoisted(() => ({
  qrPayments: {
    getStaff: vi.fn(), addStaff: vi.fn(), revokeStaff: vi.fn(),
    getLocations: vi.fn(), createLocation: vi.fn(), updateLocation: vi.fn(),
    getCatalog: vi.fn(), createCatalogItem: vi.fn(), updateCatalogItem: vi.fn(), deleteCatalogItem: vi.fn(),
  },
}));
vi.mock('@/api', () => ({ getApiLayer: () => mockApi }));

const CERRADO = { success: false, error: { code: 'MERCHANT_CLOSED', message: 'this merchant was closed' } };
const TEXTO = 'Este comercio está cerrado y ya no se puede modificar.';

const pintar = (hoja: ReactNode) => render(<LanguageProvider>{hoja}</LanguageProvider>);

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
  Object.values(mockApi.qrPayments).forEach((fn) => fn.mockReset());
  mockApi.qrPayments.getStaff.mockResolvedValue({ success: true, data: [] });
  mockApi.qrPayments.getLocations.mockResolvedValue({ success: true, data: [] });
  mockApi.qrPayments.getCatalog.mockResolvedValue({ success: true, data: [] });
});

describe('Hojas de gestion de un comercio que se cerro', () => {
  it('el equipo', async () => {
    mockApi.qrPayments.addStaff.mockResolvedValue(CERRADO);
    pintar(<BusinessTeamSheet isOpen onClose={vi.fn()} merchantId="m1" />);
    await waitFor(() => expect(mockApi.qrPayments.getStaff).toHaveBeenCalled());

    fireEvent.click(await screen.findByRole('button', { name: /agregar/i }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '112340567' } });
    const botones = screen.getAllByRole('button');
    fireEvent.click(botones[botones.length - 1]);

    expect(await screen.findByText(TEXTO)).toBeInTheDocument();
    expect(screen.queryByText('this merchant was closed')).toBeNull();
  });

  it('los locales', async () => {
    mockApi.qrPayments.createLocation.mockResolvedValue(CERRADO);
    pintar(<BusinessLocationsSheet isOpen onClose={vi.fn()} merchantId="m1" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Agregar local' }));
    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: 'Centro' } });
    fireEvent.click(screen.getByRole('button', { name: 'Agregar' }));

    expect(await screen.findByText(TEXTO)).toBeInTheDocument();
    expect(screen.queryByText('this merchant was closed')).toBeNull();
  });

  it('el catalogo', async () => {
    mockApi.qrPayments.createCatalogItem.mockResolvedValue(CERRADO);
    pintar(<BusinessCatalogSheet isOpen onClose={vi.fn()} merchantId="m1" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Agregar producto' }));
    const campos = screen.getAllByRole('textbox');
    fireEvent.change(campos[0], { target: { value: 'Cafe' } });
    fireEvent.change(campos[1], { target: { value: '1000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Agregar' }));

    expect(await screen.findByText(TEXTO)).toBeInTheDocument();
    expect(screen.queryByText('this merchant was closed')).toBeNull();
  });
});
