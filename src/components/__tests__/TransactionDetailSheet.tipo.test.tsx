import { render, screen } from '@testing-library/react';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { precargarIdioma } from '@/test/idiomas';
import { TransactionDetailSheet } from '../TransactionDetailSheet';
import type { Transaction } from '@/types';

// El detalle de un movimiento decia el nombre, el monto, el estado, la fecha y
// la categoria, pero no QUE tipo de movimiento fue (pago con QR, transferencia
// SINPE, compra de cripto...) ni su detalle (con quien fue, la nota).

function movimiento(extra: Partial<Transaction>): Transaction {
  return {
    id: 'tx-1',
    title: 'Ana Mora',
    type: 'debit',
    amount: -5000,
    ccy: 'CRC',
    date: '4/9/2026',
    dateISO: '2026-09-04T15:30:00Z',
    status: 'completed',
    category: 'transfers',
    kind: 'sinpe_send',
    ...extra,
  };
}

function pintar(tx: Transaction) {
  return render(
    <LanguageProvider>
      <TransactionDetailSheet tx={tx} isOpen onClose={vi.fn()} />
    </LanguageProvider>,
  );
}

// El valor de la fila cuyo rotulo es `etiqueta`.
function valorDe(etiqueta: string): string | null {
  const fila = screen.getByText(etiqueta, { selector: 'dt' }).closest('div');
  return fila?.querySelector('dd')?.textContent ?? null;
}

beforeAll(() => precargarIdioma('en'));

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
});

describe('TransactionDetailSheet: tipo de movimiento', () => {
  it.each([
    ['sinpe_send', 'Transferencia SINPE enviada'],
    ['sinpe_receive', 'Transferencia SINPE recibida'],
    ['qr_payment', 'Pago con QR'],
    ['qr_receive', 'Cobro con QR'],
    ['bill_payment', 'Pago de servicio'],
    ['recharge', 'Recarga telefónica'],
    ['p2p_send', 'Pago dividido enviado'],
    ['crypto_buy', 'Compra de cripto'],
    ['crypto_sell', 'Venta de cripto'],
    ['savings_deposit', 'Depósito a ahorro'],
    ['merchant_withdrawal', 'Retiro del negocio'],
    ['refund', 'Reembolso'],
  ])('%s se dice "%s"', (kind, esperado) => {
    pintar(movimiento({ kind }));

    expect(valorDe('Tipo')).toBe(esperado);
  });

  it('el tipo va aparte del titulo: el titulo sigue siendo el nombre', () => {
    pintar(movimiento({ kind: 'sinpe_send', title: 'Ana Mora' }));

    expect(screen.getByText('Ana Mora')).toBeInTheDocument();
    expect(valorDe('Tipo')).toBe('Transferencia SINPE enviada');
  });

  it('sin tipo conocido dice que entro o salio dinero', () => {
    pintar(movimiento({ kind: undefined }));
    expect(valorDe('Tipo')).toBe('Dinero enviado');
  });

  it('en ingles', async () => {
    localStorage.setItem('kiramopay_language', 'en');
    pintar(movimiento({ kind: 'qr_payment' }));

    expect(await screen.findByText('Type', { selector: 'dt' })).toBeInTheDocument();
    expect(valorDe('Type')).toBe('QR payment');
  });
});

describe('TransactionDetailSheet: con quien fue y la nota', () => {
  it('un envio dice "Para" y a quien', () => {
    pintar(movimiento({ counterparty: 'Ana Mora', title: 'Ana Mora' }));

    expect(valorDe('Para')).toBe('Ana Mora');
  });

  it('un ingreso dice "De" y de quien', () => {
    pintar(movimiento({ type: 'credit', amount: 5000, kind: 'sinpe_receive', counterparty: 'Luis Rojas', title: 'Luis Rojas' }));

    expect(valorDe('De')).toBe('Luis Rojas');
  });

  it('la nota que escribio la persona va en su propia fila', () => {
    pintar(movimiento({ counterparty: 'Ana Mora', note: 'Almuerzo del viernes' }));

    expect(valorDe('Nota')).toBe('Almuerzo del viernes');
  });

  it('sin contraparte ni nota no hay filas vacias', () => {
    pintar(movimiento({ counterparty: undefined, note: undefined }));

    expect(screen.queryByText('Para', { selector: 'dt' })).toBeNull();
    expect(screen.queryByText('De', { selector: 'dt' })).toBeNull();
    expect(screen.queryByText('Nota', { selector: 'dt' })).toBeNull();
  });

  it('un identificador tecnico no se muestra como nombre', () => {
    pintar(movimiento({ counterparty: 'b5f43f1a-1f10-48a3-9a0e-0d2a3c4b5d6e' }));

    expect(screen.queryByText('Para', { selector: 'dt' })).toBeNull();
    expect(screen.queryByText(/b5f43f1a/)).toBeNull();
  });

  it('la descripcion cruda en ingles de un ahorro no sale como nota', () => {
    pintar(movimiento({ kind: 'savings_deposit', note: 'savings deposit: Vacaciones' }));

    expect(screen.queryByText('Nota', { selector: 'dt' })).toBeNull();
    expect(screen.queryByText(/savings deposit:/)).toBeNull();
  });

  it('una nota igual a la contraparte no se repite', () => {
    pintar(movimiento({ counterparty: 'Ana Mora', note: 'Ana Mora' }));

    expect(screen.queryByText('Nota', { selector: 'dt' })).toBeNull();
  });
});
