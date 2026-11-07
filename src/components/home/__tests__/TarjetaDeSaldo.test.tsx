import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { useSettingsStore } from '@/stores/settings.store';
import type { Account, CryptoAsset } from '@/types';
import { TarjetaDeSaldo } from '../TarjetaDeSaldo';

// La tarjeta de saldo del rediseno (fase 3). Pestanas por decision del dueno:
// Total, una por cuenta en moneda y Cripto; ningun numero sin dato que lo
// respalde.

const colones = (balance: number, rateToUsd?: number): Account => ({
  ccy: 'CRC', balance, symbol: '₡', flag: 'CR', iban: '', name: 'Colones', type: 'fiat', rateToUsd,
});
const dolares = (balance: number): Account => ({
  ccy: 'USD', balance, symbol: '$', flag: 'US', iban: '', name: 'Dolares', type: 'fiat', rateToUsd: 1,
});
const activo = (symbol: string, balance: number, currentPrice: number): CryptoAsset => ({
  id: symbol, symbol, name: symbol, icon: '', color: '', balance, avgBuyPrice: 0, currentPrice, priceChange24h: 0, priceHistory: [],
});

function pintar({
  cuentas = [colones(500_000, 0.002), dolares(445)],
  cripto = [] as CryptoAsset[],
  onAgregarDinero = vi.fn(),
  monedaBase = 'CRC',
} = {}) {
  render(
    <LanguageProvider>
      <TarjetaDeSaldo
        cuentas={cuentas}
        monedaBase={monedaBase}
        cripto={cripto}
        onAgregarDinero={onAgregarDinero}
        acciones={[
          { id: 'enviar', etiqueta: 'Enviar', onClick: vi.fn() },
          { id: 'escanear', etiqueta: 'Escanear', nombreAccesible: 'Escanear QR', onClick: vi.fn() },
        ]}
      />
    </LanguageProvider>,
  );
  return within(screen.getByRole('region', { name: 'Saldo' }));
}

// La cifra grande va partida en simbolo, entero y decimales.
const cifra = (texto: string) => (_: string, el: Element | null) => el?.tagName === 'P' && el.textContent === texto;

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
  useSettingsStore.setState({ saldoOculto: false });
});

describe('TarjetaDeSaldo', () => {
  it('abre en el total, con el rotulo en frase normal', () => {
    const tarjeta = pintar();
    expect(tarjeta.getByRole('tab', { name: 'Total' })).toHaveAttribute('aria-selected', 'true');
    expect(tarjeta.getByText('Saldo total')).toBeInTheDocument();
    expect(tarjeta.getByText(cifra('₡722,500.00'))).toBeInTheDocument();
  });

  it('cada moneda muestra su saldo y su equivalente con la tasa que hay', async () => {
    const user = userEvent.setup();
    const tarjeta = pintar();

    await user.click(tarjeta.getByRole('tab', { name: 'Colones' }));
    expect(tarjeta.getByText('Saldo disponible')).toBeInTheDocument();
    expect(tarjeta.getByText(cifra('₡500,000.00'))).toBeInTheDocument();
    expect(tarjeta.getByText('≈ $1,000.00')).toBeInTheDocument();

    await user.click(tarjeta.getByRole('tab', { name: 'Dólares' }));
    expect(tarjeta.getByText(cifra('$445.00'))).toBeInTheDocument();
    expect(tarjeta.getByText('≈ ₡222,500.00')).toBeInTheDocument();
  });

  it('sin tasa de colones no inventa el equivalente', async () => {
    const user = userEvent.setup();
    const tarjeta = pintar({ cuentas: [colones(500_000, undefined), dolares(445)] });
    await user.click(tarjeta.getByRole('tab', { name: 'Dólares' }));
    expect(tarjeta.getByText(cifra('$445.00'))).toBeInTheDocument();
    expect(tarjeta.queryByText(/≈/)).not.toBeInTheDocument();
  });

  describe('Cripto', () => {
    it('sin la lista de cripto no da numero: dice que falta el dato', async () => {
      const user = userEvent.setup();
      const tarjeta = pintar({ cripto: [] });
      await user.click(tarjeta.getByRole('tab', { name: 'Cripto' }));
      expect(tarjeta.getByText('—')).toBeInTheDocument();
      expect(tarjeta.getByText(/Sin dato por ahora/)).toBeInTheDocument();
    });

    it('con una tenencia sin precio tampoco suma: seria menos de lo real', async () => {
      const user = userEvent.setup();
      const tarjeta = pintar({ cripto: [activo('BTC', 0.01, 60_000), activo('ETH', 0.5, 0)] });
      await user.click(tarjeta.getByRole('tab', { name: 'Cripto' }));
      expect(tarjeta.getByText('—')).toBeInTheDocument();
      expect(tarjeta.queryByText(cifra('$600.00'))).not.toBeInTheDocument();
    });

    it('con precios, el valor en dolares y lo que se tiene', async () => {
      const user = userEvent.setup();
      const tarjeta = pintar({ cripto: [activo('BTC', 0.01, 60_000), activo('ETH', 0.5, 3_000), activo('USDT', 0, 1)] });
      await user.click(tarjeta.getByRole('tab', { name: 'Cripto' }));
      expect(tarjeta.getByText('Valor en cripto')).toBeInTheDocument();
      expect(tarjeta.getByText(cifra('$2,100.00'))).toBeInTheDocument();
      expect(tarjeta.getByText('0.5 ETH, 0.01 BTC')).toBeInTheDocument();
    });

    it('cantidades grandes con separador de miles y sin cambiar el valor', async () => {
      const user = userEvent.setup();
      const tarjeta = pintar({ cripto: [activo('DOGE', 1_234_567, 0.1), activo('BTC', 0.00012345, 60_000)] });
      await user.click(tarjeta.getByRole('tab', { name: 'Cripto' }));
      expect(tarjeta.getByText('1,234,567 DOGE, 0.00012345 BTC')).toBeInTheDocument();
    });

    it('con la lista cargada y nada guardado, cero de verdad', async () => {
      const user = userEvent.setup();
      const tarjeta = pintar({ cripto: [activo('BTC', 0, 0)] });
      await user.click(tarjeta.getByRole('tab', { name: 'Cripto' }));
      expect(tarjeta.getByText(cifra('$0.00'))).toBeInTheDocument();
      expect(tarjeta.getByText('Aún no tienes cripto.')).toBeInTheDocument();
    });
  });

  it('con la base en dolares el total no repite la cifra como estimado en dolares', () => {
    const tarjeta = pintar({ monedaBase: 'USD' });
    expect(tarjeta.queryByText(/≈/)).not.toBeInTheDocument();
  });

  it('las flechas recorren las pestanas (patron de pestanas ARIA)', async () => {
    const user = userEvent.setup();
    const tarjeta = pintar();
    tarjeta.getByRole('tab', { name: 'Total' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(tarjeta.getByRole('tab', { name: 'Colones' })).toHaveFocus();
    expect(tarjeta.getByRole('tab', { name: 'Colones' })).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(tarjeta.getByRole('tab', { name: 'Cripto' })).toHaveAttribute('aria-selected', 'true');
    expect(tarjeta.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', tarjeta.getByRole('tab', { name: 'Cripto' }).id);
  });

  it('el ojo tapa el saldo y la eleccion queda en el dispositivo', async () => {
    const user = userEvent.setup();
    const tarjeta = pintar();
    const ojo = tarjeta.getByRole('button', { name: 'Ocultar saldo' });
    expect(ojo).toHaveAttribute('aria-pressed', 'false');

    await user.click(ojo);
    expect(ojo).toHaveAttribute('aria-pressed', 'true');
    expect(tarjeta.queryByText(cifra('₡722,500.00'))).not.toBeInTheDocument();
    // Una sola vez: la linea de detalle lo dice y la cifra solo lleva puntos.
    expect(tarjeta.getAllByText('Saldo oculto')).toHaveLength(1);
    expect(useSettingsStore.getState().saldoOculto).toBe(true);
  });

  it('Agregar dinero esta en la tarjeta y la accion corta lleva el nombre completo', async () => {
    const user = userEvent.setup();
    const onAgregarDinero = vi.fn();
    const tarjeta = pintar({ onAgregarDinero });
    await user.click(tarjeta.getByRole('button', { name: 'Agregar dinero' }));
    expect(onAgregarDinero).toHaveBeenCalledTimes(1);
    expect(tarjeta.getByRole('button', { name: 'Escanear QR' })).toHaveTextContent('Escanear');
  });
});
