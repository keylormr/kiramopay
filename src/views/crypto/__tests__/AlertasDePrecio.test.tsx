import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import type { CryptoAsset, PriceAlert } from '@/types';
import { HojaAlertasDePrecio, formatoPrecio, useAlertasDePrecio, yaSeCumple } from '../AlertasDePrecio';

// La hoja de alertas de precio: lista lo que el servidor devolvio, crea y quita
// esperando su respuesta, y explica cada rechazo con su propio texto.

const mocks = vi.hoisted(() => ({
  api: {
    crypto: {
      getPriceAlerts: vi.fn(),
      addPriceAlert: vi.fn(),
      removePriceAlert: vi.fn(),
    },
  },
  dispatch: vi.fn(),
}));

vi.mock('@/api', () => ({
  getApiLayer: () => mocks.api,
}));

vi.mock('@/hooks/useApp', () => ({
  useApp: () => ({ state: {}, dispatch: mocks.dispatch }),
}));

const activo = (symbol: string, name: string, currentPrice: number): CryptoAsset => ({
  id: symbol.toLowerCase(),
  symbol,
  name,
  balance: 0,
  avgBuyPrice: 0,
  currentPrice,
  priceChange24h: 0,
  priceHistory: [],
  icon: symbol[0],
  color: '#123456',
});

const ACTIVOS: CryptoAsset[] = [
  activo('BTC', 'Bitcoin', 60000),
  activo('ETH', 'Ethereum', 3000),
  activo('ADA', 'Cardano', 0),
  // Una estable del modo demo: el servidor no la cotiza, no admite alertas.
  activo('USDT', 'Tether', 1),
];

const activa = (over: Partial<PriceAlert> = {}): PriceAlert => ({
  id: 'a-1',
  asset: 'BTC',
  targetPrice: 66000,
  condition: 'above',
  active: true,
  status: 'active',
  createdAt: '2026-09-15T12:00:00Z',
  ...over,
});

const cumplida = (over: Partial<PriceAlert> = {}): PriceAlert => ({
  id: 'c-1',
  asset: 'ETH',
  targetPrice: 2800,
  condition: 'below',
  active: false,
  status: 'triggered',
  createdAt: '2026-09-10T12:00:00Z',
  triggeredAt: '2026-09-14T15:30:00Z',
  triggeredPrice: 2795.5,
  ...over,
});

function Prueba({ activoInicial = null }: { activoInicial?: string | null }) {
  const alertas = useAlertasDePrecio();
  return (
    <HojaAlertasDePrecio isOpen onClose={() => {}} alertas={alertas} activos={ACTIVOS} activoInicial={activoInicial} />
  );
}

function montar(activoInicial: string | null = null) {
  return render(
    <LanguageProvider>
      <Prueba activoInicial={activoInicial} />
    </LanguageProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
  mocks.api.crypto.getPriceAlerts.mockReset();
  mocks.api.crypto.addPriceAlert.mockReset();
  mocks.api.crypto.removePriceAlert.mockReset();
  mocks.dispatch.mockReset();
});

describe('Alertas de precio — lista', () => {
  it('muestra las activas y las cumplidas que devolvio el servidor', async () => {
    mocks.api.crypto.getPriceAlerts.mockResolvedValue({ success: true, data: [activa(), cumplida()] });
    montar();

    const activas = await screen.findByRole('region', { name: 'Activas' });
    expect(within(activas).getByText('Cuando suba a $66,000.00')).toBeInTheDocument();
    // 66.000 contra 60.000: diez por ciento arriba.
    expect(within(activas).getByText('10.0% por encima del precio actual')).toBeInTheDocument();
    expect(within(activas).getByText('1 de 20')).toBeInTheDocument();

    const cumplidas = screen.getByRole('region', { name: 'Cumplidas' });
    expect(within(cumplidas).getByText('Bajó a $2,800.00')).toBeInTheDocument();
    expect(within(cumplidas).getByText(/Se cumplió el .* con \$2,795\.50/)).toBeInTheDocument();

    // La promesa de la pantalla es la que el servidor cumple: una vez, sin montos.
    expect(screen.getByText(/Cada alerta avisa una sola vez/)).toBeInTheDocument();
    // Y el estado global copia la lista confirmada.
    await waitFor(() =>
      expect(mocks.dispatch).toHaveBeenCalledWith({ type: 'SET_PRICE_ALERTS', payload: [activa(), cumplida()] }),
    );
  });

  it('sin alertas explica que hacer, y no muestra la seccion de cumplidas', async () => {
    mocks.api.crypto.getPriceAlerts.mockResolvedValue({ success: true, data: [] });
    montar();

    expect(await screen.findByText('Sin alertas activas')).toBeInTheDocument();
    expect(screen.getByText('0 de 20')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Cumplidas' })).not.toBeInTheDocument();
  });

  it('una lectura fallida no se pinta como lista vacia, y se puede reintentar', async () => {
    mocks.api.crypto.getPriceAlerts
      .mockResolvedValueOnce({ success: false, error: { code: 'FETCH_FAILED', message: 'boom' } })
      .mockResolvedValueOnce({ success: true, data: [activa()] });
    const user = userEvent.setup();
    montar();

    expect(await screen.findByText('No pudimos cargar tus alertas.')).toBeInTheDocument();
    expect(screen.queryByText('Sin alertas activas')).not.toBeInTheDocument();
    expect(screen.queryByText(/de 20/)).not.toBeInTheDocument();
    expect(mocks.dispatch).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('Cuando suba a $66,000.00')).toBeInTheDocument();
    expect(screen.queryByText('No pudimos cargar tus alertas.')).not.toBeInTheDocument();
  });

  it('quita una alerta solo cuando el servidor lo confirma', async () => {
    mocks.api.crypto.getPriceAlerts.mockResolvedValue({ success: true, data: [activa(), cumplida()] });
    mocks.api.crypto.removePriceAlert
      .mockResolvedValueOnce({ success: false, error: { code: 'REMOVE_FAILED', message: 'pq error' } })
      .mockResolvedValueOnce({ success: true });
    const user = userEvent.setup();
    montar();

    const quitar = await screen.findByRole('button', { name: 'Quitar la alerta de BTC en $66,000.00' });
    await user.click(quitar);
    expect(await screen.findByText('No pudimos quitar la alerta. Intenta de nuevo.')).toBeInTheDocument();
    expect(screen.queryByText('pq error')).not.toBeInTheDocument();
    expect(screen.getByText('Cuando suba a $66,000.00')).toBeInTheDocument();

    await user.click(quitar);
    await waitFor(() => expect(screen.queryByText('Cuando suba a $66,000.00')).not.toBeInTheDocument());
    expect(mocks.api.crypto.removePriceAlert).toHaveBeenLastCalledWith('a-1');
    // La cumplida sigue ahi.
    expect(screen.getByText('Bajó a $2,800.00')).toBeInTheDocument();
  });

  it('con el tope lleno no ofrece crear otra', async () => {
    const veinte = Array.from({ length: 20 }, (_, i) => activa({ id: `a-${i}`, targetPrice: 61000 + i }));
    mocks.api.crypto.getPriceAlerts.mockResolvedValue({ success: true, data: veinte });
    montar();

    expect(await screen.findByText('20 de 20')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nueva alerta' })).toBeDisabled();
    expect(screen.getByText(/Ya tienes 20 alertas activas/)).toBeInTheDocument();
  });
});

describe('Alertas de precio — crear', () => {
  async function abrirNueva(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByRole('button', { name: 'Nueva alerta' }));
    return screen.getByRole('dialog');
  }

  it('crea la alerta con lo que eligio la persona y vuelve a la lista con la del servidor', async () => {
    mocks.api.crypto.getPriceAlerts.mockResolvedValue({ success: true, data: [] });
    mocks.api.crypto.addPriceAlert.mockResolvedValue({
      success: true,
      data: activa({ id: 'srv-1', asset: 'ETH', targetPrice: 2500, condition: 'below' }),
    });
    const user = userEvent.setup();
    montar();
    const hoja = within(await abrirNueva(user));

    // Solo los activos que el servidor cotiza.
    const selector = hoja.getByLabelText('Activo');
    expect(within(selector).queryByRole('option', { name: /Tether/ })).not.toBeInTheDocument();
    await user.selectOptions(selector, 'ETH');
    expect(hoja.getByText('ETH vale $3,000.00 ahora')).toBeInTheDocument();

    await user.click(hoja.getByRole('button', { name: 'Baje a' }));
    expect(hoja.getByRole('button', { name: 'Baje a' })).toHaveAttribute('aria-pressed', 'true');
    await user.type(hoja.getByLabelText('Precio objetivo en USD'), '2500');
    expect(hoja.getByText('16.7% por debajo del precio actual')).toBeInTheDocument();

    await user.click(hoja.getByRole('button', { name: 'Crear alerta' }));

    expect(mocks.api.crypto.addPriceAlert).toHaveBeenCalledWith({ asset: 'ETH', targetPrice: 2500, condition: 'below' });
    expect(await screen.findByText('Listo: te avisamos cuando ETH llegue a $2,500.00.')).toBeInTheDocument();
    const activas = screen.getByRole('region', { name: 'Activas' });
    expect(within(activas).getByText('Cuando baje a $2,500.00')).toBeInTheDocument();
    expect(within(activas).getByText('1 de 20')).toBeInTheDocument();
  });

  it('avisa y bloquea una alerta que ya se cumple, y ofrece cambiar la direccion', async () => {
    mocks.api.crypto.getPriceAlerts.mockResolvedValue({ success: true, data: [] });
    const user = userEvent.setup();
    montar();
    const hoja = within(await abrirNueva(user));

    // BTC a 60.000: "suba a 55.000" ya esta cumplida.
    await user.type(hoja.getByLabelText('Precio objetivo en USD'), '55000');
    expect(hoja.getByText(/BTC ya está en ese precio o más arriba/)).toBeInTheDocument();
    expect(hoja.getByRole('button', { name: 'Crear alerta' })).toBeDisabled();

    await user.click(hoja.getByRole('button', { name: 'Cambiar a "Baje a"' }));
    expect(hoja.getByRole('button', { name: 'Baje a' })).toHaveAttribute('aria-pressed', 'true');
    expect(hoja.queryByText(/ya está en ese precio/)).not.toBeInTheDocument();
    expect(hoja.getByRole('button', { name: 'Crear alerta' })).toBeEnabled();
  });

  it('los atajos de porcentaje ponen el objetivo y la direccion', async () => {
    mocks.api.crypto.getPriceAlerts.mockResolvedValue({ success: true, data: [] });
    const user = userEvent.setup();
    montar();
    const hoja = within(await abrirNueva(user));

    await user.click(hoja.getByRole('button', { name: '-5%' }));
    expect(hoja.getByLabelText('Precio objetivo en USD')).toHaveValue('57,000');
    expect(hoja.getByRole('button', { name: 'Baje a' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(hoja.getByRole('button', { name: '+10%' }));
    expect(hoja.getByLabelText('Precio objetivo en USD')).toHaveValue('66,000');
    expect(hoja.getByRole('button', { name: 'Suba a' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('sin precio del activo no inventa uno: lo dice y deja crear igual', async () => {
    mocks.api.crypto.getPriceAlerts.mockResolvedValue({ success: true, data: [] });
    const user = userEvent.setup();
    montar();
    const hoja = within(await abrirNueva(user));

    await user.selectOptions(hoja.getByLabelText('Activo'), 'ADA');
    expect(hoja.getByText(/Ahora no tenemos el precio de ADA/)).toBeInTheDocument();
    expect(hoja.queryByRole('button', { name: '+5%' })).not.toBeInTheDocument();
    await user.type(hoja.getByLabelText('Precio objetivo en USD'), '0.45');
    expect(hoja.queryByText(/por encima del precio actual/)).not.toBeInTheDocument();
    expect(hoja.getByRole('button', { name: 'Crear alerta' })).toBeEnabled();
  });

  it.each([
    ['ALERT_LIMIT_REACHED', { limite: 20, actuales: 20, plan: 'free' }, 'Ya tienes 20 alertas activas, que es el máximo. Quita una para crear otra.'],
    ['ALERT_ALREADY_MET', undefined, 'El precio ya llegó a ese objetivo. Elige otro precio o cambia la dirección.'],
    ['ALERT_PRICE_OUT_OF_RANGE', undefined, 'Ese precio está demasiado lejos del actual. Revisa que esté bien escrito.'],
    ['ALERT_UNSUPPORTED_ASSET', undefined, 'Todavía no hay alertas para este activo.'],
    ['ALERT_FAILED', undefined, 'No pudimos crear la alerta. Intenta de nuevo.'],
  ])('explica el rechazo %s con su propio texto y no agrega nada', async (code, details, texto) => {
    mocks.api.crypto.getPriceAlerts.mockResolvedValue({ success: true, data: [] });
    mocks.api.crypto.addPriceAlert.mockResolvedValue({
      success: false,
      error: { code, message: 'server said no', details },
    });
    const user = userEvent.setup();
    montar();
    const hoja = within(await abrirNueva(user));

    await user.type(hoja.getByLabelText('Precio objetivo en USD'), '70000');
    await user.click(hoja.getByRole('button', { name: 'Crear alerta' }));

    expect(await hoja.findByText(texto)).toBeInTheDocument();
    expect(hoja.queryByText('server said no')).not.toBeInTheDocument();
    // Sigue en el formulario, con lo que la persona escribio.
    expect(hoja.getByLabelText('Precio objetivo en USD')).toHaveValue('70,000');
  });

  it('si el servidor rechaza por tope, relee la lista para que el conteo diga la verdad', async () => {
    const veinte = Array.from({ length: 20 }, (_, i) => activa({ id: `a-${i}`, targetPrice: 61000 + i }));
    mocks.api.crypto.getPriceAlerts
      .mockResolvedValueOnce({ success: true, data: [] })
      .mockResolvedValueOnce({ success: true, data: veinte });
    mocks.api.crypto.addPriceAlert.mockResolvedValue({
      success: false,
      error: { code: 'ALERT_LIMIT_REACHED', message: 'limit', details: { limite: 20, actuales: 20, plan: 'free' } },
    });
    const user = userEvent.setup();
    montar();
    const hoja = within(await abrirNueva(user));

    await user.type(hoja.getByLabelText('Precio objetivo en USD'), '70000');
    await user.click(hoja.getByRole('button', { name: 'Crear alerta' }));

    await waitFor(() => expect(mocks.api.crypto.getPriceAlerts).toHaveBeenCalledTimes(2));
    expect(await hoja.findByRole('button', { name: /Ver mis alertas \(20\)/ })).toBeInTheDocument();
    expect(hoja.getByRole('button', { name: 'Crear alerta' })).toBeDisabled();
    // Un solo aviso del tope, no el informativo y el rechazo a la vez.
    expect(hoja.getAllByText(/Ya tienes 20 alertas activas/)).toHaveLength(1);
  });

  it('un error del cliente (red, limite de tasa) llega ya traducido y se respeta', async () => {
    mocks.api.crypto.getPriceAlerts.mockResolvedValue({ success: true, data: [] });
    mocks.api.crypto.addPriceAlert.mockResolvedValue({
      success: false,
      error: { code: 'NETWORK_ERROR', message: 'Sin conexión. Revisa tu internet.' },
    });
    const user = userEvent.setup();
    montar();
    const hoja = within(await abrirNueva(user));

    await user.type(hoja.getByLabelText('Precio objetivo en USD'), '70000');
    await user.click(hoja.getByRole('button', { name: 'Crear alerta' }));
    expect(await hoja.findByText('Sin conexión. Revisa tu internet.')).toBeInTheDocument();
  });

  it('con un activo que no esta entre las opciones, rige el que muestra el selector', async () => {
    mocks.api.crypto.getPriceAlerts.mockResolvedValue({ success: true, data: [] });
    mocks.api.crypto.addPriceAlert.mockResolvedValue({ success: true, data: activa({ id: 'srv-2', targetPrice: 70000 }) });
    const user = userEvent.setup();
    montar('NOEXISTE');

    const hoja = within(screen.getByRole('dialog'));
    expect(hoja.getByLabelText('Activo')).toHaveValue('BTC');
    await user.type(hoja.getByLabelText('Precio objetivo en USD'), '70000');
    await user.click(hoja.getByRole('button', { name: 'Crear alerta' }));
    expect(mocks.api.crypto.addPriceAlert).toHaveBeenCalledWith({ asset: 'BTC', targetPrice: 70000, condition: 'above' });
  });

  it('abierta desde un activo, arranca en el formulario con ese activo', async () => {
    mocks.api.crypto.getPriceAlerts.mockResolvedValue({ success: true, data: [activa()] });
    montar('ETH');

    const hoja = within(screen.getByRole('dialog'));
    expect(hoja.getByRole('heading', { name: 'Nueva alerta' })).toBeInTheDocument();
    expect(hoja.getByLabelText('Activo')).toHaveValue('ETH');
    expect(await hoja.findByRole('button', { name: /Ver mis alertas \(1\)/ })).toBeInTheDocument();
  });
});

describe('Alertas de precio — formato y regla', () => {
  it('formatea con los decimales que le sirven al precio', () => {
    expect(formatoPrecio(65000.5)).toBe('$65,000.50');
    expect(formatoPrecio(7.12345)).toBe('$7.1235');
    expect(formatoPrecio(0.351234)).toBe('$0.351234');
  });

  it('yaSeCumple aplica la misma regla que el servidor, borde incluido', () => {
    expect(yaSeCumple('above', 100, 100)).toBe(true);
    expect(yaSeCumple('above', 100, 99.99)).toBe(false);
    expect(yaSeCumple('below', 100, 100)).toBe(true);
    expect(yaSeCumple('below', 100, 100.01)).toBe(false);
    expect(yaSeCumple('above', 100, null)).toBe(false);
  });
});
