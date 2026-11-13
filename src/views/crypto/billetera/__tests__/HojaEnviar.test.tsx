import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import es from '@/i18n/languages/es';
import type { BilleteraBitcoin, EnvioBitcoinPreparado } from '@/billetera/bitcoin';
import type { EnvioEvmPreparado } from '@/billetera/evm';

// Confirmar un envio mueve dinero que no vuelve: ni un doble toque ni un
// reintento despues de un error a medias pueden cobrar dos veces.
const evm = vi.hoisted(() => ({ prepararEnvioEvm: vi.fn(), enviarEvm: vi.fn() }));
vi.mock('@/billetera/evm', async importOriginal => ({
  ...(await importOriginal<typeof import('@/billetera/evm')>()),
  prepararEnvioEvm: evm.prepararEnvioEvm,
  enviarEvm: evm.enviarEvm,
}));
const boveda = vi.hoisted(() => ({ confirmarConHuella: vi.fn() }));
vi.mock('@/billetera/boveda', () => ({
  confirmarConHuella: boveda.confirmarConHuella,
  BilleteraYaGuardada: class extends Error {},
}));

const qr = vi.hoisted(() => ({ valor: '' }));
vi.mock('@/components/QrScannerPanel', () => ({
  QrScannerPanel: ({ onDecode }: { onDecode: (v: string) => void }) => (
    <button type="button" onClick={() => onDecode(qr.valor)}>leer</button>
  ),
}));

import { ACTIVOS_EVM } from '@/billetera/evm';
import { HojaEnviar, type ActivoDeLaBilletera } from '../HojasBilletera';

const SEMILLA = 'test test test test test test test test test test test junk';
const DESDE = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const OTRA = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const ETH = ACTIVOS_EVM[0];
const ACTIVO_ETH: ActivoDeLaBilletera = { tipo: 'evm', simbolo: 'ETH', nombre: 'Ethereum', simboloDelCatalogo: 'ETH', evm: ETH };
const ACTIVO_BTC: ActivoDeLaBilletera = { tipo: 'btc', simbolo: 'BTC', nombre: 'Bitcoin', simboloDelCatalogo: 'BTC' };

const envioEvm: EnvioEvmPreparado = {
  activo: ETH, desde: DESDE, hacia: OTRA, monto: 10n ** 17n, gas: 21000n,
  maxFeePerGas: 10n ** 9n, maxPriorityFeePerGas: 10n ** 8n, comisionMaxima: 21000n * 10n ** 9n, nonce: 7,
};

function montar(activo: ActivoDeLaBilletera, btc: BilleteraBitcoin | null = null) {
  render(
    <LanguageProvider>
      <HojaEnviar activo={activo} onClose={vi.fn()} semilla={SEMILLA} btc={btc} onEnviado={vi.fn()} />
    </LanguageProvider>,
  );
}

async function llenarYRevisar(destino: string, monto: string) {
  const [campoDestino, campoMonto] = screen.getAllByRole('textbox');
  await userEvent.type(campoDestino, destino);
  await userEvent.type(campoMonto, monto);
  await userEvent.click(screen.getByRole('button', { name: es.bp_revisar }));
  return screen.findByRole('button', { name: es.bp_confirmar });
}

beforeEach(() => {
  localStorage.setItem('kiramopay_language', 'es');
  evm.prepararEnvioEvm.mockReset().mockResolvedValue(envioEvm);
  evm.enviarEvm.mockReset().mockResolvedValue('0xabc');
  boveda.confirmarConHuella.mockReset().mockResolvedValue(true);
});

afterEach(() => vi.restoreAllMocks());

describe('confirmar un envio de la billetera propia', () => {
  it('dos toques seguidos mientras se pide la huella mandan una sola vez', async () => {
    let soltarHuella: (ok: boolean) => void = () => undefined;
    boveda.confirmarConHuella.mockReturnValue(new Promise<boolean>(r => { soltarHuella = r; }));
    montar(ACTIVO_ETH);
    const confirmar = await llenarYRevisar(OTRA, '0.1');

    fireEvent.click(confirmar);
    fireEvent.click(confirmar);
    soltarHuella(true);

    expect(await screen.findByText(es.bp_enviado)).toBeInTheDocument();
    expect(boveda.confirmarConHuella).toHaveBeenCalledTimes(1);
    expect(evm.enviarEvm).toHaveBeenCalledTimes(1);
  });

  it('muestra la red y la direccion completa antes de confirmar', async () => {
    montar(ACTIVO_ETH);
    await llenarYRevisar(OTRA, '0.1');
    expect(screen.getByText(es.bp_resumen_red)).toBeInTheDocument();
    expect(screen.getByText('Ethereum')).toBeInTheDocument();
    expect(screen.getByText(OTRA)).toBeInTheDocument();
  });

  it('en una red EVM, despues de un error reintenta con el mismo nonce', async () => {
    evm.enviarEvm.mockRejectedValueOnce(new Error('se corto la conexion'));
    montar(ACTIVO_ETH);
    await userEvent.click(await llenarYRevisar(OTRA, '0.1'));
    expect(await screen.findByText(es.bp_err_envio)).toBeInTheDocument();

    // Volver y revisar de nuevo el MISMO envio no puede pedir otro numero.
    await userEvent.click(screen.getByRole('button', { name: es.back }));
    await userEvent.click(screen.getByRole('button', { name: es.bp_revisar }));
    await screen.findByRole('button', { name: es.bp_confirmar });
    expect(evm.prepararEnvioEvm).toHaveBeenLastCalledWith(SEMILLA, ETH, OTRA, '0.1', { nonce: 7 });
  });

  it('en bitcoin, el reintento usa la misma llave de idempotencia', async () => {
    const preparado: EnvioBitcoinPreparado = {
      destino: { tipo: 'direccion-bitcoin' }, montoSats: 1000, comisionSats: 120,
      interno: { via: 'pago', respuesta: {} as never },
    };
    const enviar = vi.fn().mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce(undefined);
    const btc = { prepararEnvio: vi.fn().mockResolvedValue(preparado), enviar } as unknown as BilleteraBitcoin;
    montar(ACTIVO_BTC, btc);
    const direccion = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
    const confirmar = await llenarYRevisar(direccion, '1000');
    expect(screen.getByText(es.bp_btc_red)).toBeInTheDocument();
    expect(screen.getByText(direccion)).toBeInTheDocument();

    await userEvent.click(confirmar);
    expect(await screen.findByText(es.bp_err_envio)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: es.bp_confirmar }));
    expect(await screen.findByText(es.bp_enviado)).toBeInTheDocument();

    expect(enviar).toHaveBeenCalledTimes(2);
    expect(enviar.mock.calls[1][1]).toBe(enviar.mock.calls[0][1]);
  });

  it('lo revisado hace mas de 90 segundos se recalcula antes de firmar', async () => {
    montar(ACTIVO_ETH);
    const confirmar = await llenarYRevisar(OTRA, '0.1');
    const ahora = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(ahora + 91_000);

    await userEvent.click(confirmar);
    expect(await screen.findByText(es.bp_cotizacion_vencida)).toBeInTheDocument();
    expect(evm.prepararEnvioEvm).toHaveBeenCalledTimes(2);
    expect(boveda.confirmarConHuella).not.toHaveBeenCalled();
    expect(evm.enviarEvm).not.toHaveBeenCalled();
  });

  it('un QR de otra red no llena el destino; uno de pago toma a quien cobra', async () => {
    montar(ACTIVO_ETH);
    qr.valor = `ethereum:${OTRA}@137`;
    await userEvent.click(screen.getByRole('button', { name: es.scan_qr }));
    await userEvent.click(screen.getByRole('button', { name: 'leer' }));
    expect(await screen.findByText(es.bp_err_qr)).toBeInTheDocument();
    expect(screen.getAllByRole('textbox')[0]).toHaveValue('');

    qr.valor = `ethereum:${OTRA.toLowerCase()}@1?value=1e17`;
    await userEvent.click(screen.getByRole('button', { name: es.scan_qr }));
    await userEvent.click(screen.getByRole('button', { name: 'leer' }));
    expect(screen.getAllByRole('textbox')[0]).toHaveValue(OTRA);
  });
});
