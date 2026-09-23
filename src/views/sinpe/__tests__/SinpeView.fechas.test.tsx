import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { precargarIdioma } from '@/test/idiomas';
import { fechaYHora } from '@/utils/fechaPlazo';
import { SinpeView } from '../SinpeView';

// El historial de SINPE pintaba la fecha que escribia el adaptador en es-CR
// (d/m/aaaa), y el envio recien hecho se anotaba con "Ahora", en espanol y para
// siempre: en la demo, un SINPE de hace tres dias seguia diciendo "Ahora".

const mocks = vi.hoisted(() => ({
  api: { sinpe: { send: vi.fn() }, mfa: { totpVerify: vi.fn() } },
  dispatch: vi.fn(),
  state: {
    accounts: [{ ccy: 'CRC', balance: 1_000_000 }],
    sinpeContacts: [] as unknown[],
    sinpeHistory: [] as unknown[],
    user: { phone: '+506 8888-0000' },
  },
}));

vi.mock('@/api', () => ({
  getApiLayer: () => mocks.api,
  MFA_REQUIRED: 'MFA_REQUIRED',
}));

vi.mock('@/hooks/useApp', () => ({
  useApp: () => ({ state: mocks.state, dispatch: mocks.dispatch }),
}));

const ISO = '2026-09-04T15:30:00Z';

// La fecha comparte linea con el sentido y el telefono ("Sent · <fecha> ·
// 8888-7777"): se busca el elemento hoja cuyo texto la contiene.
const lineaCon = (texto: string) => (_: string, el: Element | null) =>
  !!el && el.children.length === 0 && (el.textContent ?? '').includes(texto);

beforeAll(() => precargarIdioma('en'));

beforeEach(() => {
  localStorage.clear();
  mocks.api.sinpe.send.mockReset();
  mocks.dispatch.mockReset();
  mocks.state.sinpeHistory = [];
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia: () => new Promise(() => {}) },
    configurable: true,
  });
});

describe('SinpeView — la fecha en el idioma de la pantalla', () => {
  it('en ingles, el historial muestra la fecha en formato ingles y no el d/m de es-CR', async () => {
    localStorage.setItem('kiramopay_language', 'en');
    mocks.state.sinpeHistory = [{
      id: 'h1', type: 'sent', amount: 5000, phone: '88887777', name: 'Acme',
      date: '4/9/2026', dateISO: ISO, status: 'completed',
    }];

    render(
      <LanguageProvider>
        <SinpeView initialTab="history" />
      </LanguageProvider>,
    );

    expect(await screen.findByText(lineaCon(fechaYHora(ISO, 'en')))).toBeInTheDocument();
    expect(screen.queryByText(lineaCon('4/9/2026'))).not.toBeInTheDocument();
  });

  it('una fila sin fecha de maquina (guardada por una version anterior) muestra la que trae', async () => {
    localStorage.setItem('kiramopay_language', 'es');
    mocks.state.sinpeHistory = [{
      id: 'h2', type: 'received', amount: 5000, phone: '77776666', name: 'Maria',
      date: 'Ayer, 4:20 PM', status: 'completed',
    }];

    render(
      <LanguageProvider>
        <SinpeView initialTab="history" />
      </LanguageProvider>,
    );

    expect(await screen.findByText(lineaCon('Ayer, 4:20 PM'))).toBeInTheDocument();
  });

  it('el envio recien hecho se anota con la fecha de maquina de ese momento', async () => {
    localStorage.setItem('kiramopay_language', 'es');
    mocks.api.sinpe.send.mockResolvedValue({
      success: true,
      data: { id: 'tx1', name: 'Acme', amount: 5000, phone: '88887777', type: 'sent', status: 'completed', date: 'Ahora', reference: '' },
    });
    const user = userEvent.setup();
    render(
      <LanguageProvider>
        <SinpeView />
      </LanguageProvider>,
    );
    const antes = Date.now();

    await user.click(screen.getAllByRole('button', { name: 'Enviar' })[0]);
    const hoja = within(await screen.findByRole('dialog'));
    await user.type(hoja.getByPlaceholderText('8888-0000'), '88887777');
    await user.type(hoja.getByPlaceholderText('0'), '5000');
    await user.click(hoja.getByRole('button', { name: /Enviar/ }));
    const hojas = await screen.findAllByRole('dialog');
    await user.click(within(hojas[hojas.length - 1]).getByRole('button', { name: /Enviar/ }));

    await waitFor(() => expect(mocks.dispatch).toHaveBeenCalled());
    const anotado = mocks.dispatch.mock.calls.find(([a]) => a.type === 'ADD_SINPE_TRANSACTION')?.[0];
    const cuando = Date.parse(anotado?.payload?.dateISO ?? '');
    expect(cuando).toBeGreaterThanOrEqual(antes);
    expect(cuando).toBeLessThanOrEqual(Date.now());
  });
});
