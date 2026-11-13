import { describe, expect, it } from 'vitest';
import { ACTIVOS_EVM, destinoDeUnQrEvm, direccionEvm, enlaceDeTransaccion, NOMBRE_DE_LA_RED, prepararEnvioEvm, RechazoEvm, saldoLegible } from '../evm';

// La semilla de prueba de Hardhat y Anvil y su primera cuenta (m/44'/60'/0'/0/0).
// Es publica: nunca guardar fondos en ella.
const SEMILLA_DE_PRUEBA = 'test test test test test test test test test test test junk';
const SU_DIRECCION = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

const ETH = ACTIVOS_EVM.find(a => a.simbolo === 'ETH')!;

async function rechazo(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof RechazoEvm) return e.motivo;
    throw e;
  }
  throw new Error('no rechazo');
}

describe('la billetera propia en redes EVM', () => {
  it('deriva la direccion estandar de la semilla', () => {
    expect(direccionEvm(SEMILLA_DE_PRUEBA)).toBe(SU_DIRECCION);
  });

  it('lista las cinco monedas y las liga al catalogo de la app', () => {
    expect(ACTIVOS_EVM.map(a => a.simbolo)).toEqual(['ETH', 'LINK', 'UNI', 'POL', 'AVAX']);
    expect(ACTIVOS_EVM.find(a => a.simbolo === 'POL')?.simboloDelCatalogo).toBe('MATIC');
    for (const a of ACTIVOS_EVM.filter(x => x.contrato)) {
      expect(a.red).toBe('ethereum');
      expect(a.contrato).toMatch(/^0x[0-9a-fA-F]{40}$/);
    }
  });

  it('muestra el saldo exacto, sin redondeo de punto flotante', () => {
    expect(saldoLegible(ETH, 1234567890123456789n)).toBe('1.234567890123456789');
  });

  it('enlaza cada red con su explorador', () => {
    expect(enlaceDeTransaccion('ethereum', '0xabc')).toBe('https://etherscan.io/tx/0xabc');
    expect(enlaceDeTransaccion('polygon', '0xabc')).toBe('https://polygonscan.com/tx/0xabc');
    expect(enlaceDeTransaccion('avalanche', '0xabc')).toBe('https://snowtrace.io/tx/0xabc');
  });

  // Estos rechazos salen antes de tocar la red.
  it('rechaza una direccion que no es EVM', async () => {
    expect(await rechazo(prepararEnvioEvm(SEMILLA_DE_PRUEBA, ETH, 'bc1qxyz', '0.1'))).toBe('direccion-invalida');
  });

  it('rechaza enviarse a si mismo', async () => {
    expect(await rechazo(prepararEnvioEvm(SEMILLA_DE_PRUEBA, ETH, SU_DIRECCION.toLowerCase(), '0.1'))).toBe('a-si-mismo');
  });

  it('rechaza un monto que no es positivo o no se entiende', async () => {
    const otra = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
    expect(await rechazo(prepararEnvioEvm(SEMILLA_DE_PRUEBA, ETH, otra, '0'))).toBe('monto-invalido');
    expect(await rechazo(prepararEnvioEvm(SEMILLA_DE_PRUEBA, ETH, otra, 'diez'))).toBe('monto-invalido');
    expect(await rechazo(prepararEnvioEvm(SEMILLA_DE_PRUEBA, ETH, otra, '-1'))).toBe('monto-invalido');
  });
});

describe('la direccion mal copiada y los codigos QR de pago', () => {
  const OTRA = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
  const LINK = ACTIVOS_EVM.find(a => a.simbolo === 'LINK')!;
  const UNI = ACTIVOS_EVM.find(a => a.simbolo === 'UNI')!;
  const POL = ACTIVOS_EVM.find(a => a.simbolo === 'POL')!;

  it('rechaza una direccion con mayusculas que no cuadran con su suma de verificacion', async () => {
    // Una sola letra cambiada de mayuscula a minuscula: EIP-55 la delata.
    const malCopiada = '0x70997970c51812dc3A010C7d01b50e0d17dc79C8';
    expect(await rechazo(prepararEnvioEvm(SEMILLA_DE_PRUEBA, ETH, malCopiada, '0.1'))).toBe('direccion-invalida');
    expect(destinoDeUnQrEvm(malCopiada, ETH)).toBeNull();
  });

  it('acepta la direccion sola y el enlace de pago simple', () => {
    expect(destinoDeUnQrEvm(OTRA, ETH)).toBe(OTRA);
    expect(destinoDeUnQrEvm(`ethereum:${OTRA.toLowerCase()}`, ETH)).toBe(OTRA);
    expect(destinoDeUnQrEvm(`ethereum:${OTRA}@1?value=1e18`, ETH)).toBe(OTRA);
    expect(destinoDeUnQrEvm(`ethereum:${OTRA}@137`, POL)).toBe(OTRA);
  });

  it('en un pedido de token paga a quien cobra, no al contrato', () => {
    expect(destinoDeUnQrEvm(`ethereum:${LINK.contrato}@1/transfer?address=${OTRA}&uint256=1e18`, LINK)).toBe(OTRA);
  });

  it('rechaza el codigo de otra red, de otro token o de otra operacion', () => {
    expect(destinoDeUnQrEvm(`ethereum:${OTRA}@137`, ETH)).toBeNull();
    expect(destinoDeUnQrEvm(`ethereum:${UNI.contrato}/transfer?address=${OTRA}`, LINK)).toBeNull();
    expect(destinoDeUnQrEvm(`ethereum:${LINK.contrato}/transfer?address=${OTRA}`, ETH)).toBeNull();
    expect(destinoDeUnQrEvm(`ethereum:${LINK.contrato}/approve?address=${OTRA}`, LINK)).toBeNull();
    expect(destinoDeUnQrEvm(`ethereum:${LINK.contrato}/transfer`, LINK)).toBeNull();
    expect(destinoDeUnQrEvm('bitcoin:bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq', ETH)).toBeNull();
  });

  it('nombra cada red como la conocen los exchanges', () => {
    expect(NOMBRE_DE_LA_RED).toEqual({ ethereum: 'Ethereum', polygon: 'Polygon', avalanche: 'Avalanche C-Chain' });
  });
});
