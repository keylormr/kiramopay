import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { AssistantView } from '../AssistantView';

const mockApi = vi.hoisted(() => ({
  assistant: {
    status: vi.fn(),
    chat: vi.fn(),
    listConversations: vi.fn(),
    getConversation: vi.fn(),
    createConversation: vi.fn(),
    deleteConversation: vi.fn(),
  },
  sinpe: { send: vi.fn() },
  services: { recharge: vi.fn(), payBill: vi.fn() },
  mfa: { totpVerify: vi.fn() },
}));

vi.mock('@/api', () => ({
  getApiLayer: () => mockApi,
  MFA_REQUIRED: 'MFA_REQUIRED',
}));

// Spy the global-balance refetch the view fires after a confirmed proposal succeeds.
const mockDataSync = vi.hoisted(() => ({ refreshAccounts: vi.fn(() => Promise.resolve()) }));
vi.mock('@/services/dataSync', () => mockDataSync);

function setup() {
  return render(
    <LanguageProvider>
      <AssistantView onClose={vi.fn()} />
    </LanguageProvider>,
  );
}

const sinpeProposal = {
  kind: 'sinpe_transfer',
  summary: 'SINPE ₡200,000 → 8888-7777',
  amountMinor: 20000000, // above the MFA threshold
  currency: 'CRC',
  phone: '88887777',
  description: '',
};

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
  // jsdom does not implement scrollIntoView; the chat auto-scrolls on new messages.
  Element.prototype.scrollIntoView = vi.fn();
  mockApi.assistant.status.mockResolvedValue({ success: true, data: { available: true } });
  mockApi.assistant.listConversations.mockResolvedValue({ success: true, data: [] });
  mockApi.assistant.chat.mockResolvedValue({
    success: true,
    data: {
      reply: 'Preparé la transferencia.',
      toolsUsed: ['propose_sinpe_transfer'],
      proposals: [sinpeProposal],
    },
  });
  mockApi.sinpe.send.mockReset();
  mockApi.mfa.totpVerify.mockReset();
  mockDataSync.refreshAccounts.mockClear();
});

describe('AssistantView — confirming a high-value proposal', () => {
  it('prompts for MFA on MFA_REQUIRED and retries the action after verify', async () => {
    mockApi.sinpe.send
      .mockResolvedValueOnce({ success: false, error: { code: 'MFA_REQUIRED', message: 'mfa needed' } })
      .mockResolvedValueOnce({ success: true, data: { id: 't1' } });
    mockApi.mfa.totpVerify.mockResolvedValue({ success: true, data: { verified: true } });
    const user = userEvent.setup();
    setup();

    // Ask something; the stubbed chat returns a SINPE confirmation card.
    const input = await screen.findByPlaceholderText(/Escribe tu pregunta/);
    await user.type(input, 'envía 200000 a 8888-7777{Enter}');
    await user.click(await screen.findByText('Confirmar'));

    // The confirmation hits the high-value gate → challenge sheet, not an error.
    expect(await screen.findByText('Verificación requerida')).toBeInTheDocument();
    await user.type(screen.getByPlaceholderText('000000'), '123456');
    await user.click(screen.getByText('Verificar y activar'));

    await waitFor(() => {
      expect(mockApi.mfa.totpVerify).toHaveBeenCalledWith('123456', 'high_value_tx');
      expect(mockApi.sinpe.send).toHaveBeenCalledTimes(2);
    });
    expect(await screen.findByText('Confirmado')).toBeInTheDocument();
  });

  it('refetches the global wallet balance after a confirmed proposal succeeds', async () => {
    mockApi.sinpe.send.mockResolvedValue({ success: true, data: { id: 't1' } });
    const user = userEvent.setup();
    setup();

    const input = await screen.findByPlaceholderText(/Escribe tu pregunta/);
    await user.type(input, 'envía 200000 a 8888-7777{Enter}');
    await user.click(await screen.findByText('Confirmar'));

    await waitFor(() => expect(mockApi.sinpe.send).toHaveBeenCalledTimes(1));
    expect(mockDataSync.refreshAccounts).toHaveBeenCalled();
    expect(await screen.findByText('Confirmado')).toBeInTheDocument();
  });
});

// El asistente confirma un SINPE con el mismo POST /sinpe/send que la pantalla
// SINPE, pero sin llave: el servidor acuñaba una por llamada, y confirmar otra
// vez tras un corte de red mandaba la plata dos veces. Además mandaba el
// número tal como lo propone el modelo —8 dígitos— y el servidor solo acepta
// +506 y los 8 dígitos: la confirmación no podía salir nunca.
describe('AssistantView — la llave del envío SINPE', () => {
  const sinRed = { success: false, error: { code: 'NETWORK_ERROR', message: 'Sin conexión.' } };
  const pedidos = () => mockApi.sinpe.send.mock.calls.map((c) => c[0]);

  async function pedirYConfirmar(user: ReturnType<typeof userEvent.setup>) {
    const input = await screen.findByPlaceholderText(/Escribe tu pregunta/);
    await user.type(input, 'envía 200000 a 8888-7777{Enter}');
    await user.click(await screen.findByText('Confirmar'));
  }

  it('manda el número con el +506 y una llave', async () => {
    mockApi.sinpe.send.mockResolvedValue({ success: true, data: { id: 't1' } });
    const user = userEvent.setup();
    setup();

    await pedirYConfirmar(user);
    await waitFor(() => expect(mockApi.sinpe.send).toHaveBeenCalledTimes(1));

    const [pedido] = pedidos();
    expect(pedido.phone).toBe('+50688887777');
    expect(pedido.idempotencyKey).toMatch(/\S/);
  });

  it('un número que no se entiende no se envía y lo explica', async () => {
    mockApi.assistant.chat.mockResolvedValueOnce({
      success: true,
      data: { reply: 'Preparé la transferencia.', toolsUsed: [], proposals: [{ ...sinpeProposal, phone: '123' }] },
    });
    const user = userEvent.setup();
    setup();

    await pedirYConfirmar(user);

    expect(await screen.findByText('Revisa el número: debe tener 8 dígitos')).toBeInTheDocument();
    expect(mockApi.sinpe.send).not.toHaveBeenCalled();
  });

  it('tras un corte de red lo explica, y confirmar otra vez lleva la misma llave', async () => {
    mockApi.sinpe.send.mockResolvedValueOnce(sinRed).mockResolvedValueOnce({ success: true, data: { id: 't1' } });
    const user = userEvent.setup();
    setup();

    await pedirYConfirmar(user);
    expect(await screen.findByText(/No pudimos confirmar el envío/)).toBeInTheDocument();
    await user.click(screen.getByText('Confirmar'));
    await waitFor(() => expect(mockApi.sinpe.send).toHaveBeenCalledTimes(2));

    const [primero, segundo] = pedidos();
    expect(primero.idempotencyKey).toMatch(/\S/);
    expect(segundo.idempotencyKey).toBe(primero.idempotencyKey);
  });

  it('el reintento tras el segundo factor lleva la misma llave', async () => {
    mockApi.sinpe.send
      .mockResolvedValueOnce({ success: false, error: { code: 'MFA_REQUIRED', message: 'mfa needed' } })
      .mockResolvedValueOnce({ success: true, data: { id: 't1' } });
    mockApi.mfa.totpVerify.mockResolvedValue({ success: true, data: { verified: true } });
    const user = userEvent.setup();
    setup();

    await pedirYConfirmar(user);
    expect(await screen.findByText('Verificación requerida')).toBeInTheDocument();
    await user.type(screen.getByPlaceholderText('000000'), '123456');
    await user.click(screen.getByText('Verificar y activar'));
    await waitFor(() => expect(mockApi.sinpe.send).toHaveBeenCalledTimes(2));

    const [primero, segundo] = pedidos();
    expect(primero.idempotencyKey).toMatch(/\S/);
    expect(segundo.idempotencyKey).toBe(primero.idempotencyKey);
  });

  // La repetición: el servidor contestó con un envío que YA estaba hecho bajo
  // esa llave. "Confirmado" haría creer que salió otro.
  it('si el envío ya se había hecho, lo dice en vez de "Confirmado"', async () => {
    mockApi.sinpe.send.mockResolvedValue({ success: true, data: { id: 't1', repetida: true } });
    const user = userEvent.setup();
    setup();

    await pedirYConfirmar(user);

    expect(await screen.findByText('Ese envío ya se había hecho')).toBeInTheDocument();
    expect(screen.getByText(/No se envió otra vez/)).toBeInTheDocument();
    expect(screen.queryByText('Confirmado')).not.toBeInTheDocument();
  });
});
