import { HttpAccountRepository } from '../account.http';
import type { HttpClient } from '../client';

// El adaptador le pegaba a cada cuenta la tasa a dolares. Sin tasa del servidor
// la constante de respaldo (515) hacia que Inicio y Perfil pintaran un total en
// dolares con una tasa que nadie dio. Sin tasa, la cuenta en colones sale sin
// `rateToUsd` -no 0, no 1/515- y el total dice que no hay dato.

const tasa = vi.hoisted(() => ({ valor: null as number | null }));

vi.mock('@/services/fxRate', () => ({
  getUsdToCrcRate: vi.fn(async () => tasa.valor),
}));

// 500.000 colones y 100 dolares, en centimos.
function repo(crc = 50_000_000, usd = 10_000) {
  const client = {
    get: async () => ({ success: true, data: { crc, usd } }),
  } as unknown as HttpClient;
  return new HttpAccountRepository(client);
}

beforeEach(() => {
  tasa.valor = null;
});

describe('HttpAccountRepository.getAccounts: sin tipo de cambio', () => {
  it('la cuenta en colones sale sin tasa a dolares, no con 515 ni con cero', async () => {
    const res = await repo().getAccounts();

    const colones = res.data?.find((a) => a.ccy === 'CRC');
    expect(colones?.balance).toBe(500_000);
    expect(colones?.rateToUsd).toBeUndefined();
    // El dolar vale un dolar con o sin tipo de cambio.
    expect(res.data?.find((a) => a.ccy === 'USD')?.rateToUsd).toBe(1);
  });

  it('el resumen no suma una parte: sin tasa y con colones, el total es null', async () => {
    const res = await repo().getBalanceSummary();

    expect(res.success).toBe(true);
    expect(res.data?.totalUsd).toBeNull();
  });

  it('una cuenta en colones en cero no necesita tasa', async () => {
    const res = await repo(0, 10_000).getBalanceSummary();

    expect(res.data?.totalUsd).toBe(100);
  });
});

describe('HttpAccountRepository.getAccounts: con tipo de cambio', () => {
  it('convierte con la tasa del servidor', async () => {
    tasa.valor = 450;
    const res = await repo().getAccounts();

    expect(res.data?.find((a) => a.ccy === 'CRC')?.rateToUsd).toBeCloseTo(1 / 450, 12);
  });

  it('el resumen suma las dos cuentas en dolares', async () => {
    tasa.valor = 500;
    const res = await repo().getBalanceSummary();

    // 500.000 colones a 500 son 1.000 dolares, mas los 100 de la otra cuenta.
    expect(res.data?.totalUsd).toBeCloseTo(1100, 6);
  });
});
