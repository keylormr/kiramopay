import { render, screen } from '@testing-library/react';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { precargarIdioma } from '@/test/idiomas';
import { TransactionDetailSheet } from '../TransactionDetailSheet';
import type { Transaction } from '@/types';

// El servidor guarda cinco estados (pending, processing, completed, failed,
// reversed) y el detalle conocia dos: todo lo que no estaba completado se
// pintaba "Pendiente", con el reloj. Un SINPE que fallo se le decia a la
// persona como uno que todavia podia salir.

function conEstado(status: string | undefined): Transaction {
  return {
    id: 'tx-1',
    title: 'Ana Mora',
    type: 'debit',
    amount: -5000,
    ccy: 'CRC',
    date: '4/9/2026',
    dateISO: '2026-09-04T15:30:00Z',
    status: status as Transaction['status'],
    category: 'SINPE',
    kind: 'sinpe_send',
  };
}

function pintar(tx: Transaction) {
  return render(
    <LanguageProvider>
      <TransactionDetailSheet tx={tx} isOpen onClose={vi.fn()} />
    </LanguageProvider>,
  );
}

beforeAll(() => precargarIdioma('en'));

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
});

describe('TransactionDetailSheet — cada estado con su nombre', () => {
  it.each([
    ['completed', 'Completado'],
    ['pending', 'Pendiente'],
    ['processing', 'En proceso'],
    ['failed', 'Fallido'],
    ['reversed', 'Revertido'],
    // Un estado que la app no conoce no se disfraza de completado ni de
    // pendiente: se dice que no esta confirmado.
    ['unknown', 'Sin confirmar'],
  ])('%s se dice "%s"', (status, texto) => {
    pintar(conEstado(status));

    expect(screen.getByText(texto)).toBeInTheDocument();
    if (status !== 'pending') expect(screen.queryByText('Pendiente')).toBeNull();
  });

  it('sin estado es un movimiento completado, como antes', () => {
    pintar(conEstado(undefined));

    expect(screen.getByText('Completado')).toBeInTheDocument();
  });

  // El ingles llega en su propio trozo: se espera a que el texto aparezca.
  it('en ingles, un movimiento fallido y uno revertido', async () => {
    localStorage.setItem('kiramopay_language', 'en');
    const { unmount } = pintar(conEstado('failed'));
    expect(await screen.findByText('Failed')).toBeInTheDocument();
    expect(screen.queryByText('Pending')).toBeNull();
    unmount();

    pintar(conEstado('reversed'));
    expect(await screen.findByText('Reversed')).toBeInTheDocument();
  });

  // El monto de lo que no movio dinero va tachado, como el de un cobro que ya
  // no se puede pagar: el numero sigue a la vista, pero no se lee como un
  // gasto hecho.
  it('el monto de un movimiento fallido o revertido va tachado; el de uno pendiente no', () => {
    const { unmount } = pintar(conEstado('failed'));
    expect(screen.getByText('-₡5,000.00')).toHaveClass('line-through');
    unmount();

    const otro = pintar(conEstado('reversed'));
    expect(screen.getByText('-₡5,000.00')).toHaveClass('line-through');
    otro.unmount();

    pintar(conEstado('pending'));
    expect(screen.getByText('-₡5,000.00')).not.toHaveClass('line-through');
  });
});
