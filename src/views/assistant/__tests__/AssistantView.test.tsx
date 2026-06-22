import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { AssistantView } from '../AssistantView';

const mockApi = vi.hoisted(() => ({
  assistant: { status: vi.fn(), chat: vi.fn() },
  sinpe: { send: vi.fn() },
  services: { recharge: vi.fn(), payBill: vi.fn() },
  mfa: { totpVerify: vi.fn() },
}));

vi.mock('@/api', () => ({
  getApiLayer: () => mockApi,
  MFA_REQUIRED: 'MFA_REQUIRED',
}));

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
});
