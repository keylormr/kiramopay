import es from '@/i18n/languages/es';
import fr from '@/i18n/languages/fr';
import { fijarDiccionarioActivo } from '@/i18n/mensajesDeError';
import { MockTransactionRepository } from '../transaction.mock';
import { MockBudgetRepository } from '../budget.mock';
import { MockAccountRepository } from '../account.mock';
import { MockNotificationRepository } from '../notification.mock';
import { MockRecurringRepository } from '../recurring.mock';
import { MockSinpeRepository } from '../sinpe.mock';

// La demo sin servidor arranca con datos de ejemplo, y esos datos estaban
// escritos en espanol: con la app en frances, la lista decia "SINPE de Diego" y
// "Pago ICE", los presupuestos "Comida" y "Transporte", y los avisos "SINPE
// recibido". Salen en el idioma de la app al momento de leerlos. Los nombres
// propios (Cafe Alma, Uber, Diego Mora) quedan como estan.

const EN_ESPANOL = new Set([
  'SINPE de Diego',
  'Pago ICE',
  'SINPE a Diego',
  'Recarga Kolbi',
  'Comida',
  'Transporte',
  'Entretenimiento',
  'Servicios',
  'Bienvenido a KiramoPay',
  'SINPE recibido',
  'Pago exitoso',
  'Promoción especial',
  'Seguridad',
  'Almuerzo',
  'Pago deuda',
  'Regalo',
]);

function sinEspanol(textos: Array<string | undefined>): string[] {
  return textos.filter((x): x is string => !!x && (EN_ESPANOL.has(x) || /[¡¿]|exitosamente|Obtén|Se detectó/.test(x)));
}

describe('los datos de ejemplo de la demo salen en el idioma de la app', () => {
  beforeEach(() => {
    localStorage.clear();
    fijarDiccionarioActivo(fr);
  });
  afterAll(() => fijarDiccionarioActivo(es));

  it('los movimientos', async () => {
    const res = await new MockTransactionRepository().getTransactions();
    expect(res.data?.length).toBeGreaterThan(0);
    expect(sinEspanol(res.data!.map((t) => t.title))).toEqual([]);
  });

  it('los presupuestos, de las dos fuentes de la demo', async () => {
    const deBudget = await new MockBudgetRepository().getBudgets();
    const deCuentas = await new MockAccountRepository().getBudgets();
    expect(deBudget.data?.length).toBeGreaterThan(0);
    expect(sinEspanol(deBudget.data!.map((b) => b.label))).toEqual([]);
    expect(sinEspanol(deCuentas.data!.map((b) => b.label))).toEqual([]);
  });

  it('los avisos', async () => {
    const res = await new MockNotificationRepository().getAll();
    expect(res.data?.length).toBeGreaterThan(0);
    expect(sinEspanol(res.data!.flatMap((n) => [n.title, n.message]))).toEqual([]);
  });

  it('los pagos fijos', async () => {
    const res = await new MockRecurringRepository().getPayments();
    expect(res.data?.length).toBeGreaterThan(0);
    expect(sinEspanol(res.data!.map((p) => p.label))).toEqual([]);
  });

  it('las notas del historial de SINPE', async () => {
    const res = await new MockSinpeRepository().getHistory();
    expect(res.data?.length).toBeGreaterThan(0);
    expect(sinEspanol(res.data!.map((s) => s.reference))).toEqual([]);
  });
});

// El store de pagos fijos tenia su propia copia de los ejemplos, en espanol y
// armada al importar (antes de que cargue el idioma). La pantalla los pide al
// repositorio al abrirse, asi que esa copia solo podia mostrar el espanol.
describe('el store de pagos fijos no trae ejemplos propios', () => {
  it('arranca vacio y los ejemplos los da el repositorio', async () => {
    const { useRecurringStore } = await import('@/stores/recurring.store');
    expect(useRecurringStore.getState().payments).toEqual([]);
  });
});
