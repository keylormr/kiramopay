import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import es from '@/i18n/languages/es';
import type { EnvioEvmPreparado } from '@/billetera/evm';

// Al pasar la app a segundo plano la billetera vuelve a estar cerrada: la semilla
// sale de la memoria y para verla otra vez hace falta la huella. Un envio en
// marcha no se corta a la mitad.
const SEMILLA = 'test test test test test test test test test test test junk';
const DESDE = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const OTRA = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';

const fondo = vi.hoisted(() => ({ alIrse: null as (() => void) | null, suscripciones: 0, quitadas: 0 }));
vi.mock('@/billetera/segundoPlano', () => ({
  alPasarASegundoPlano: (alIrse: () => void) => {
    fondo.alIrse = alIrse;
    fondo.suscripciones += 1;
    return () => { fondo.quitadas += 1; fondo.alIrse = null; };
  },
}));

const boveda = vi.hoisted(() => ({
  abrirSemilla: vi.fn(),
  confirmarConHuella: vi.fn(),
}));
vi.mock('@/billetera/boveda', () => ({
  bovedaDisponible: () => true,
  estadoDeLaBilletera: vi.fn().mockResolvedValue('hay'),
  abrirSemilla: boveda.abrirSemilla,
  confirmarConHuella: boveda.confirmarConHuella,
  guardarSemilla: vi.fn(),
  borrarSemilla: vi.fn(),
  BilleteraYaGuardada: class extends Error {},
}));

vi.mock('@/billetera/pantalla', () => ({ usePantallaSegura: () => 'protegida' }));

// Por defecto bitcoin queda sin configurar (sin SDK). Las pruebas que necesitan la
// conexion la prenden y le dan una billetera falsa para ver si se cierra.
const bitcoin = vi.hoisted(() => ({ configurado: false, abrir: vi.fn() }));
vi.mock('@/billetera/bitcoin', async importOriginal => ({
  ...(await importOriginal<typeof import('@/billetera/bitcoin')>()),
  bitcoinConfigurado: () => bitcoin.configurado,
  abrirBitcoin: bitcoin.abrir,
}));

const evm = vi.hoisted(() => ({ saldoEvm: vi.fn(), prepararEnvioEvm: vi.fn(), enviarEvm: vi.fn() }));
vi.mock('@/billetera/evm', async importOriginal => ({
  ...(await importOriginal<typeof import('@/billetera/evm')>()),
  saldoEvm: evm.saldoEvm,
  prepararEnvioEvm: evm.prepararEnvioEvm,
  enviarEvm: evm.enviarEvm,
}));

vi.mock('@/hooks/useApp', () => ({
  useApp: () => ({
    state: { user: { id: 'u-1', username: 'keilor' }, crypto: { assets: [] } },
    dispatch: vi.fn(),
  }),
}));

vi.mock('@/components/QrScannerPanel', () => ({ QrScannerPanel: () => null }));

import { ACTIVOS_EVM } from '@/billetera/evm';
import { BilleteraPropia } from '../BilleteraPropia';

const ETH = ACTIVOS_EVM[0];
const envioEvm: EnvioEvmPreparado = {
  activo: ETH, desde: DESDE, hacia: OTRA, monto: 10n ** 17n, gas: 21000n,
  maxFeePerGas: 10n ** 9n, maxPriorityFeePerGas: 10n ** 8n, comisionMaxima: 21000n * 10n ** 9n, nonce: 7,
};

const montar = () => render(<LanguageProvider><BilleteraPropia /></LanguageProvider>);

async function abrirLaBilletera() {
  await userEvent.click(await screen.findByRole('button', { name: es.bp_abrir }));
  return screen.findByRole('button', { name: es.bp_ver_palabras });
}

/** El destino de fondo: pasa la app a segundo plano como lo haria Capacitor. */
const irseAlSegundoPlano = () => act(() => { fondo.alIrse?.(); });

beforeEach(() => {
  localStorage.setItem('kiramopay_language', 'es');
  fondo.alIrse = null;
  fondo.suscripciones = 0;
  fondo.quitadas = 0;
  bitcoin.configurado = false;
  bitcoin.abrir.mockReset();
  boveda.abrirSemilla.mockReset().mockResolvedValue({ estado: 'abierta', semilla: SEMILLA });
  boveda.confirmarConHuella.mockReset().mockResolvedValue(true);
  evm.saldoEvm.mockReset().mockResolvedValue(0n);
  evm.prepararEnvioEvm.mockReset().mockResolvedValue(envioEvm);
  evm.enviarEvm.mockReset();
});

describe('la billetera propia al pasar a segundo plano', () => {
  it('cerrada no escucha nada; al abrirse, empieza a escuchar', async () => {
    montar();
    await screen.findByRole('button', { name: es.bp_abrir });
    expect(fondo.suscripciones).toBe(0);
    await abrirLaBilletera();
    await waitFor(() => expect(fondo.alIrse).not.toBeNull());
  }, 20_000);

  it('suelta la semilla y pide la huella otra vez para volver a abrir', async () => {
    montar();
    await abrirLaBilletera();
    expect(boveda.abrirSemilla).toHaveBeenCalledTimes(1);

    await irseAlSegundoPlano();
    expect(await screen.findByText(es.bp_cerrada_titulo)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: es.bp_ver_palabras })).toBeNull();
    expect(fondo.quitadas).toBeGreaterThanOrEqual(1);

    // Volver no abre sola: hace falta la huella, que vuelve a leer la semilla.
    await userEvent.click(screen.getByRole('button', { name: es.bp_abrir }));
    expect(await screen.findByRole('button', { name: es.bp_ver_palabras })).toBeInTheDocument();
    expect(boveda.abrirSemilla).toHaveBeenCalledTimes(2);
  }, 20_000);

  it('cierra tambien las hojas que estaban abiertas', async () => {
    montar();
    await abrirLaBilletera();
    await userEvent.click(screen.getByRole('button', { name: `${es.receive} ETH` }));
    expect(await screen.findByText(`${es.receive} ETH`)).toBeInTheDocument();

    await irseAlSegundoPlano();
    expect(await screen.findByText(es.bp_cerrada_titulo)).toBeInTheDocument();
    expect(screen.queryByText(`${es.receive} ETH`)).toBeNull();
  }, 20_000);

  it('un envio en marcha no se corta: la billetera se cierra cuando termina', async () => {
    let terminarEnvio: (hash: string) => void = () => undefined;
    evm.enviarEvm.mockReturnValue(new Promise<string>(r => { terminarEnvio = r; }));

    montar();
    await abrirLaBilletera();
    await userEvent.click(screen.getByRole('button', { name: `${es.send} ETH` }));
    const [campoDestino, campoMonto] = await screen.findAllByRole('textbox');
    await userEvent.type(campoDestino, OTRA);
    await userEvent.type(campoMonto, '0.1');
    await userEvent.click(screen.getByRole('button', { name: es.bp_revisar }));
    await userEvent.click(await screen.findByRole('button', { name: es.bp_confirmar }));
    await waitFor(() => expect(evm.enviarEvm).toHaveBeenCalledTimes(1));

    // La app sale a segundo plano con el envio en el aire: la billetera sigue ahi.
    await irseAlSegundoPlano();
    expect(screen.queryByText(es.bp_cerrada_titulo)).toBeNull();
    expect(screen.getByRole('button', { name: es.bp_ver_palabras })).toBeInTheDocument();

    // Al terminar el envio, se cierra.
    await act(async () => { terminarEnvio('0xabc'); });
    expect(await screen.findByText(es.bp_cerrada_titulo)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: es.bp_ver_palabras })).toBeNull();
  }, 30_000);

  it('las palabras que estaban a la vista no vuelven solas al reabrir', async () => {
    montar();
    await userEvent.click(await abrirLaBilletera());
    expect(await screen.findByText('junk')).toBeInTheDocument();

    await irseAlSegundoPlano();
    expect(await screen.findByText(es.bp_cerrada_titulo)).toBeInTheDocument();
    expect(screen.queryByText('junk')).toBeNull();

    // Con la huella se reabre la billetera, pero las palabras ya no estan en memoria.
    await userEvent.click(screen.getByRole('button', { name: es.bp_abrir }));
    await screen.findByRole('button', { name: es.bp_ver_palabras });
    expect(screen.queryByText('junk')).toBeNull();
  }, 20_000);

  it('cierra la conexion de bitcoin, que tiene la semilla', async () => {
    const desconectar = vi.fn().mockResolvedValue(undefined);
    bitcoin.configurado = true;
    bitcoin.abrir.mockResolvedValue({
      saldoSats: vi.fn().mockResolvedValue(0),
      movimientos: vi.fn().mockResolvedValue([]),
      direccionLightning: vi.fn().mockResolvedValue(null),
      depositosSinSumar: vi.fn().mockResolvedValue([]),
      desconectar,
    });

    montar();
    await abrirLaBilletera();
    await waitFor(() => expect(bitcoin.abrir).toHaveBeenCalledTimes(1));
    // La conexion ya esta lista: recibir bitcoin se habilita.
    await waitFor(() => expect(screen.getAllByRole('button', { name: es.receive })[0]).toBeEnabled());
    expect(desconectar).not.toHaveBeenCalled();

    await irseAlSegundoPlano();
    expect(await screen.findByText(es.bp_cerrada_titulo)).toBeInTheDocument();
    expect(desconectar).toHaveBeenCalledTimes(1);
  }, 20_000);

  it('una conexion de bitcoin que llega despues de cerrar se cierra en vez de quedar abierta', async () => {
    const desconectar = vi.fn().mockResolvedValue(undefined);
    let conectar: (b: unknown) => void = () => undefined;
    bitcoin.configurado = true;
    bitcoin.abrir.mockReturnValue(new Promise(r => { conectar = r; }));

    montar();
    await abrirLaBilletera();
    await waitFor(() => expect(bitcoin.abrir).toHaveBeenCalledTimes(1));
    await irseAlSegundoPlano();
    expect(await screen.findByText(es.bp_cerrada_titulo)).toBeInTheDocument();

    await act(async () => {
      conectar({ saldoSats: vi.fn(), movimientos: vi.fn(), direccionLightning: vi.fn(), depositosSinSumar: vi.fn(), desconectar });
    });
    await waitFor(() => expect(desconectar).toHaveBeenCalledTimes(1));
    expect(screen.getByText(es.bp_cerrada_titulo)).toBeInTheDocument();
  }, 20_000);

  describe('con un envio en marcha cuando la app sale', () => {
    async function empezarElEnvio() {
      montar();
      await abrirLaBilletera();
      await userEvent.click(screen.getByRole('button', { name: `${es.send} ETH` }));
      const [campoDestino, campoMonto] = await screen.findAllByRole('textbox');
      await userEvent.type(campoDestino, OTRA);
      await userEvent.type(campoMonto, '0.1');
      await userEvent.click(screen.getByRole('button', { name: es.bp_revisar }));
      await userEvent.click(await screen.findByRole('button', { name: es.bp_confirmar }));
    }

    it('si el envio falla, la billetera se cierra igual (el aviso de pendiente no se pierde)', async () => {
      let fallar: (e: Error) => void = () => undefined;
      evm.enviarEvm.mockReturnValue(new Promise<string>((_ok, no) => { fallar = no; }));
      await empezarElEnvio();
      await waitFor(() => expect(evm.enviarEvm).toHaveBeenCalledTimes(1));

      await irseAlSegundoPlano();
      expect(screen.queryByText(es.bp_cerrada_titulo)).toBeNull();

      await act(async () => { fallar(new Error('se corto la conexion')); });
      expect(await screen.findByText(es.bp_cerrada_titulo)).toBeInTheDocument();
    }, 30_000);

    it('el envio dudoso se puede reintentar despues de reabrir, con el mismo nonce', async () => {
      let fallar: (e: Error) => void = () => undefined;
      evm.enviarEvm.mockReturnValueOnce(new Promise<string>((_ok, no) => { fallar = no; }));
      await empezarElEnvio();
      await waitFor(() => expect(evm.enviarEvm).toHaveBeenCalledTimes(1));
      await irseAlSegundoPlano();
      await act(async () => { fallar(new Error('se corto la conexion')); });
      expect(await screen.findByText(es.bp_cerrada_titulo)).toBeInTheDocument();

      // La billetera se cerro y se desmonto la hoja, pero el intento sigue: reintentar el
      // MISMO envio no pide otro numero de transaccion (otro pago dejaria dos).
      await userEvent.click(screen.getByRole('button', { name: es.bp_abrir }));
      await userEvent.click(await screen.findByRole('button', { name: `${es.send} ETH` }));
      const [campoDestino, campoMonto] = await screen.findAllByRole('textbox');
      await userEvent.type(campoDestino, OTRA);
      await userEvent.type(campoMonto, '0.1');
      await userEvent.click(screen.getByRole('button', { name: es.bp_revisar }));
      await screen.findByRole('button', { name: es.bp_confirmar });
      expect(evm.prepararEnvioEvm).toHaveBeenLastCalledWith(SEMILLA, ETH, OTRA, '0.1', { nonce: 7 });
    }, 40_000);

    it('si el envio no termina, la billetera se cierra igual pasado un minuto', async () => {
      evm.enviarEvm.mockReturnValue(new Promise<string>(() => undefined));
      await empezarElEnvio();
      await waitFor(() => expect(evm.enviarEvm).toHaveBeenCalledTimes(1));

      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      try {
        await irseAlSegundoPlano();
        await act(async () => { vi.advanceTimersByTime(59_000); });
        expect(screen.queryByText(es.bp_cerrada_titulo)).toBeNull();
        await act(async () => { vi.advanceTimersByTime(2_000); });
      } finally {
        vi.useRealTimers();
      }
      expect(await screen.findByText(es.bp_cerrada_titulo)).toBeInTheDocument();
    }, 30_000);

    it('si cancelan la huella, la billetera se cierra igual', async () => {
      let responder: (ok: boolean) => void = () => undefined;
      boveda.confirmarConHuella.mockReturnValue(new Promise<boolean>(r => { responder = r; }));
      await empezarElEnvio();
      await waitFor(() => expect(boveda.confirmarConHuella).toHaveBeenCalledTimes(1));

      await irseAlSegundoPlano();
      expect(screen.queryByText(es.bp_cerrada_titulo)).toBeNull();

      await act(async () => { responder(false); });
      expect(await screen.findByText(es.bp_cerrada_titulo)).toBeInTheDocument();
      expect(evm.enviarEvm).not.toHaveBeenCalled();
    }, 30_000);
  });
});
