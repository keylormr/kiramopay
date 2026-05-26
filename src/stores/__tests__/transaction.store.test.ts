import { useTransactionStore } from '../transaction.store';
import { initialTransactions } from '@/api/adapters/mock/mock-data';
import type { Transaction } from '@/types';

describe('useTransactionStore', () => {
  beforeEach(() => {
    localStorage.clear();
    useTransactionStore.setState({
      transactions: initialTransactions.map((t) => ({ ...t })),
    });
  });

  it('should have initial transactions', () => {
    const { transactions } = useTransactionStore.getState();
    expect(transactions).toHaveLength(initialTransactions.length);
    expect(transactions[0].title).toBe('Café Alma');
  });

  it('should have correct initial transaction types', () => {
    const { transactions } = useTransactionStore.getState();
    const debits = transactions.filter((t) => t.type === 'debit');
    const credits = transactions.filter((t) => t.type === 'credit');
    expect(debits.length).toBeGreaterThan(0);
    expect(credits.length).toBeGreaterThan(0);
  });

  it('should add a debit transaction to the beginning', () => {
    const newTx: Transaction = {
      id: '100',
      title: 'Supermercado',
      amount: -25000,
      ccy: 'CRC',
      date: 'Hoy, 3:00 PM',
      type: 'debit',
      category: 'Compras',
      status: 'completed',
    };

    useTransactionStore.getState().addTransaction(newTx);
    const { transactions } = useTransactionStore.getState();
    expect(transactions).toHaveLength(initialTransactions.length + 1);
    expect(transactions[0].id).toBe('100');
    expect(transactions[0].title).toBe('Supermercado');
    expect(transactions[0].amount).toBe(-25000);
  });

  it('should add a credit transaction to the beginning', () => {
    const newTx: Transaction = {
      id: '101',
      title: 'SINPE de Ana',
      amount: 15000,
      ccy: 'CRC',
      date: 'Hoy, 4:00 PM',
      type: 'credit',
      category: 'SINPE',
      status: 'completed',
    };

    useTransactionStore.getState().addTransaction(newTx);
    const { transactions } = useTransactionStore.getState();
    expect(transactions[0].id).toBe('101');
    expect(transactions[0].type).toBe('credit');
    expect(transactions[0].amount).toBe(15000);
  });

  it('should preserve existing transactions when adding a new one', () => {
    const newTx: Transaction = {
      id: '102',
      title: 'New Transaction',
      amount: -5000,
      ccy: 'CRC',
      date: 'Hoy',
      type: 'debit',
    };

    useTransactionStore.getState().addTransaction(newTx);
    const { transactions } = useTransactionStore.getState();
    // The original first transaction should now be second
    expect(transactions[1].title).toBe('Café Alma');
    expect(transactions[2].title).toBe('SINPE de Diego');
  });

  it('should maintain order with multiple additions (newest first)', () => {
    const tx1: Transaction = {
      id: 'a',
      title: 'First Added',
      amount: -1000,
      ccy: 'CRC',
      date: 'Hoy, 1:00 PM',
      type: 'debit',
    };
    const tx2: Transaction = {
      id: 'b',
      title: 'Second Added',
      amount: -2000,
      ccy: 'CRC',
      date: 'Hoy, 2:00 PM',
      type: 'debit',
    };

    useTransactionStore.getState().addTransaction(tx1);
    useTransactionStore.getState().addTransaction(tx2);
    const { transactions } = useTransactionStore.getState();
    expect(transactions[0].id).toBe('b');
    expect(transactions[1].id).toBe('a');
    expect(transactions[2].title).toBe('Café Alma');
  });

  it('should handle transactions with optional fields', () => {
    const minimalTx: Transaction = {
      id: '200',
      title: 'Minimal TX',
      amount: -500,
      ccy: 'USD',
      date: 'Hoy',
      type: 'debit',
    };

    useTransactionStore.getState().addTransaction(minimalTx);
    const { transactions } = useTransactionStore.getState();
    const added = transactions[0];
    expect(added.id).toBe('200');
    expect(added.category).toBeUndefined();
    expect(added.status).toBeUndefined();
    expect(added.ccy).toBe('USD');
  });

  it('should handle a pending transaction', () => {
    const pendingTx: Transaction = {
      id: '300',
      title: 'Pending Transfer',
      amount: -100000,
      ccy: 'CRC',
      date: 'Hoy, 5:00 PM',
      type: 'debit',
      status: 'pending',
    };

    useTransactionStore.getState().addTransaction(pendingTx);
    const { transactions } = useTransactionStore.getState();
    expect(transactions[0].status).toBe('pending');
  });
});
