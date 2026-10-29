import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { ProfileView } from '../ProfileView';

// Soporte en el Perfil. La fila decia "Chat con soporte" y la hoja, "el chat en
// vivo llegara pronto": una promesa sin fecha y sin a quien escribir mientras
// tanto. El chat no existe; el canal es el correo de soporte.

vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

const api = vi.hoisted(() => ({
  getSummary: vi.fn().mockResolvedValue({ success: false }),
}));

vi.mock('@/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getApiLayer: () => ({
    kyc: { getStatus: vi.fn().mockResolvedValue({ success: false }), verifyIdentity: vi.fn() },
    loyalty: { getReferralSummary: vi.fn().mockResolvedValue({ success: false }) },
    mfa: { totpStatus: vi.fn().mockResolvedValue({ success: false }) },
    transactions: { getSummary: api.getSummary },
  }),
}));

vi.mock('@/hooks/useApp', () => ({
  useApp: () => ({
    state: {
      accounts: [],
      baseCurrency: 'CRC',
      user: { id: 'u1', firstName: 'Ana', lastName: 'Mora', kycLevel: 0, email: 'a@b.co', phone: '+50688880001' },
      settings: { biometricEnabled: false, notifications: true, language: 'es' },
      transactions: [],
      theme: 'light',
    },
    dispatch: vi.fn(),
  }),
}));

const pintar = (onOpenFAQ = vi.fn()) => {
  render(
    <LanguageProvider>
      <ProfileView onOpenFAQ={onOpenFAQ} />
    </LanguageProvider>,
  );
  return onOpenFAQ;
};

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
});

afterEach(() => cleanup());

describe('ProfileView: soporte', () => {
  it('la fila ya no se llama chat: dice que se le escribe a soporte y muestra el correo', () => {
    pintar();

    expect(screen.queryByText('Chat con soporte')).toBeNull();
    const fila = screen.getByRole('button', { name: /Escribir a soporte/ });
    expect(fila).toHaveTextContent('soporte@kiramopay.com');
  });

  it('la hoja da el correo como enlace y no promete un chat', async () => {
    const user = userEvent.setup();
    pintar();
    await waitFor(() => expect(api.getSummary).toHaveBeenCalled());

    await user.click(screen.getByRole('button', { name: /Escribir a soporte/ }));

    const hoja = await screen.findByRole('dialog');
    const enlace = within(hoja).getByRole('link', { name: 'soporte@kiramopay.com' });
    expect(enlace).toHaveAttribute('href', 'mailto:soporte@kiramopay.com');
    expect(within(hoja).queryByText(/llegará pronto|próximamente/i)).toBeNull();
  });

  it('desde la hoja se llega al Centro de ayuda', async () => {
    const user = userEvent.setup();
    const onOpenFAQ = pintar();

    await user.click(screen.getByRole('button', { name: /Escribir a soporte/ }));
    const hoja = await screen.findByRole('dialog');
    await user.click(within(hoja).getByRole('button', { name: 'Centro de ayuda' }));

    expect(onOpenFAQ).toHaveBeenCalledTimes(1);
  });
});
