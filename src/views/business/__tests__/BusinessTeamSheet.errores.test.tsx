import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { BusinessTeamSheet } from '../BusinessTeamSheet';

// El backend respondia "esa cedula no tiene una cuenta de KiramoPay" en espanol
// fijo y esta hoja pintaba `res.error.message` tal cual: ese renglon salia en
// espanol en medio de una pantalla en ingles, en japones o en frances. El
// motivo viaja como CODIGO y el texto lo pone la pantalla.

const mockApi = vi.hoisted(() => ({
  qrPayments: {
    getStaff: vi.fn(),
    getLocations: vi.fn(),
    addStaff: vi.fn(),
    revokeStaff: vi.fn(),
  },
}));

vi.mock('@/api', () => ({ getApiLayer: () => mockApi }));

function abrir() {
  return render(
    <LanguageProvider>
      <BusinessTeamSheet isOpen onClose={vi.fn()} merchantId="comercio-1" />
    </LanguageProvider>,
  );
}

async function intentarAgregar() {
  abrir();
  await waitFor(() => expect(mockApi.qrPayments.getStaff).toHaveBeenCalled());
  fireEvent.click(await screen.findByRole('button', { name: /agregar|add/i }));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '112340567' } });
  const botones = screen.getAllByRole('button');
  fireEvent.click(botones[botones.length - 1]);
}

beforeEach(() => {
  localStorage.clear();
  mockApi.qrPayments.getStaff.mockResolvedValue({ success: true, data: [] });
  mockApi.qrPayments.getLocations.mockResolvedValue({ success: true, data: [] });
  mockApi.qrPayments.addStaff.mockReset();
});

describe('BusinessTeamSheet — el motivo se traduce en la pantalla', () => {
  it('en ingles NO muestra el texto en espanol del servidor', async () => {
    localStorage.setItem('kiramopay_language', 'en');
    mockApi.qrPayments.addStaff.mockResolvedValue({
      success: false,
      error: { code: 'STAFF_CEDULA_NOT_FOUND', message: 'no KiramoPay account is registered with that cedula' },
    });

    await intentarAgregar();

    expect(await screen.findByText('No KiramoPay account is registered with that ID number')).toBeInTheDocument();
    expect(screen.queryByText(/cédula|cedula/i)).not.toBeInTheDocument();
  });

  it('en espanol muestra el texto en espanol', async () => {
    localStorage.setItem('kiramopay_language', 'es');
    mockApi.qrPayments.addStaff.mockResolvedValue({
      success: false,
      error: { code: 'STAFF_CEDULA_NOT_FOUND', message: 'no KiramoPay account is registered with that cedula' },
    });

    await intentarAgregar();

    expect(await screen.findByText('Esa cédula no tiene una cuenta de KiramoPay')).toBeInTheDocument();
  });
});
