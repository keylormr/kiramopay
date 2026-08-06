import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { SinpeView } from '../SinpeView';

const mocks = vi.hoisted(() => ({
  api: { sinpe: { send: vi.fn() }, mfa: { totpVerify: vi.fn() } },
  dispatch: vi.fn(),
}));

vi.mock('@/api', () => ({
  getApiLayer: () => mocks.api,
  MFA_REQUIRED: 'MFA_REQUIRED',
}));

vi.mock('@/hooks/useApp', () => ({
  useApp: () => ({
    state: {
      accounts: [{ ccy: 'CRC', balance: 1_000_000 }],
      sinpeContacts: [],
      sinpeHistory: [],
      user: { phone: '+506 8888-0000' },
    },
    dispatch: mocks.dispatch,
  }),
}));

function setup() {
  return render(
    <LanguageProvider>
      <SinpeView />
    </LanguageProvider>,
  );
}

const sentTx = {
  id: 'tx1',
  name: 'Acme',
  amount: 5000,
  phone: '88887777',
  type: 'sent',
  status: 'completed',
  date: 'Ahora',
  reference: '',
};

async function openSendSheetAndSubmit(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getAllByRole('button', { name: 'Enviar' })[0]); // header CTA
  const dialog = await screen.findByRole('dialog');
  const d = within(dialog);
  await user.type(d.getByPlaceholderText('8888-0000'), '88887777');
  await user.type(d.getByPlaceholderText('0'), '5000');
  await user.click(d.getByRole('button', { name: /Enviar/ })); // opens the review sheet
  // Review-before-send: confirm the transfer in the confirmation sheet.
  const sheets = await screen.findAllByRole('dialog');
  await user.click(within(sheets[sheets.length - 1]).getByRole('button', { name: /Enviar/ }));
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
  mocks.api.sinpe.send.mockReset();
  mocks.api.mfa.totpVerify.mockReset();
  mocks.dispatch.mockReset();
});

describe('SinpeView — send', () => {
  it('sends through the API and shows the success sheet', async () => {
    mocks.api.sinpe.send.mockResolvedValue({ success: true, data: sentTx });
    const user = userEvent.setup();
    setup();

    await openSendSheetAndSubmit(user);

    await waitFor(() =>
      expect(mocks.api.sinpe.send).toHaveBeenCalledWith({
        phone: '88887777',
        amount: 5000,
        description: '',
        idempotencyKey: expect.any(String),
      }),
    );
    expect(await screen.findByText('¡Enviado!')).toBeInTheDocument();
    expect(mocks.dispatch).toHaveBeenCalled();
  });

  it('prompts for MFA on MFA_REQUIRED and retries the transfer after verify', async () => {
    mocks.api.sinpe.send
      .mockResolvedValueOnce({ success: false, error: { code: 'MFA_REQUIRED', message: 'mfa needed' } })
      .mockResolvedValueOnce({ success: true, data: sentTx });
    mocks.api.mfa.totpVerify.mockResolvedValue({ success: true, data: { verified: true } });
    const user = userEvent.setup();
    setup();

    await openSendSheetAndSubmit(user);

    // The challenge appears instead of completing/erroring.
    expect(await screen.findByText('Verificación requerida')).toBeInTheDocument();
    await user.type(screen.getByPlaceholderText('000000'), '123456');
    await user.click(screen.getByText('Verificar y activar'));

    await waitFor(() => {
      expect(mocks.api.mfa.totpVerify).toHaveBeenCalledWith('123456', 'high_value_tx');
      expect(mocks.api.sinpe.send).toHaveBeenCalledTimes(2);
    });
    expect(await screen.findByText('¡Enviado!')).toBeInTheDocument();
  });

  // El envío a un número que NO es de KiramoPay se debita pero NO se entrega:
  // el riel a otros bancos sigue pendiente de licencia. Mostrarlo como "enviado"
  // hace que alguien crea que su amigo recibió la plata. El backend lo marca con
  // internal:false y status pending; la vista TIENE que reflejarlo.
  //
  // Este caso existe porque el aviso ya estaba escrito pero era código muerto:
  // la vista rearmaba la transacción campo por campo y se dejaba `internal`
  // afuera, así que la condición comparaba `undefined === false` y siempre caía
  // en la rama verde de éxito.
  it('avisa que la entrega queda pendiente cuando el destinatario no es usuario', async () => {
    mocks.api.sinpe.send.mockResolvedValue({
      success: true,
      data: { ...sentTx, status: 'pending', internal: false },
    });
    const user = userEvent.setup();
    setup();

    await openSendSheetAndSubmit(user);

    expect(await screen.findByText('Envío en proceso')).toBeInTheDocument();
    expect(screen.getByText(/no pertenece a KiramoPay/)).toBeInTheDocument();
    // Y NO puede decir que se envió.
    expect(screen.queryByText('¡Enviado!')).not.toBeInTheDocument();
  });

  it('mantiene el mensaje de éxito cuando el destinatario sí es usuario', async () => {
    mocks.api.sinpe.send.mockResolvedValue({
      success: true,
      data: { ...sentTx, internal: true },
    });
    const user = userEvent.setup();
    setup();

    await openSendSheetAndSubmit(user);

    expect(await screen.findByText('¡Enviado!')).toBeInTheDocument();
    expect(screen.queryByText('Envío en proceso')).not.toBeInTheDocument();
  });
});
