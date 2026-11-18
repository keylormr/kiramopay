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
vi.mock('@/billetera/bitcoin', async importOriginal => ({
  ...(await importOriginal<typeof import('@/billetera/bitcoin')>()),
  bitcoinConfigurado: () => false,
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

  it('ya cerrada, otro aviso de segundo plano no cambia nada', async () => {
    montar();
    await abrirLaBilletera();
    await irseAlSegundoPlano();
    expect(await screen.findByText(es.bp_cerrada_titulo)).toBeInTheDocument();
    await irseAlSegundoPlano();
    expect(screen.getByText(es.bp_cerrada_titulo)).toBeInTheDocument();
  }, 20_000);
});
