import { useSinpeStore } from '../sinpe.store';
import { initialSinpeContacts, initialSinpeHistory } from '@/api/adapters/mock/mock-data';
import type { SinpeContact, SinpeTransaction } from '@/types';

describe('useSinpeStore', () => {
  beforeEach(() => {
    localStorage.clear();
    useSinpeStore.setState({
      sinpeContacts: initialSinpeContacts.map((c) => ({ ...c })),
      sinpeHistory: initialSinpeHistory.map((h) => ({ ...h })),
    });
  });

  it('should have initial contacts', () => {
    const { sinpeContacts } = useSinpeStore.getState();
    expect(sinpeContacts).toHaveLength(initialSinpeContacts.length);
    expect(sinpeContacts[0].name).toBe('Diego Mora');
  });

  it('should have initial transaction history', () => {
    const { sinpeHistory } = useSinpeStore.getState();
    expect(sinpeHistory).toHaveLength(initialSinpeHistory.length);
    expect(sinpeHistory[0].type).toBe('sent');
  });

  it('should add a new contact', () => {
    const newContact: SinpeContact = {
      id: '5',
      name: 'Laura Vargas',
      phone: '9999-1111',
      bank: 'Davivienda',
      isFavorite: false,
    };

    useSinpeStore.getState().addContact(newContact);
    const { sinpeContacts } = useSinpeStore.getState();
    expect(sinpeContacts).toHaveLength(initialSinpeContacts.length + 1);
    expect(sinpeContacts[sinpeContacts.length - 1].name).toBe('Laura Vargas');
    expect(sinpeContacts[sinpeContacts.length - 1].phone).toBe('9999-1111');
  });

  it('should preserve existing contacts when adding a new one', () => {
    const newContact: SinpeContact = {
      id: '5',
      name: 'Laura Vargas',
      phone: '9999-1111',
    };

    useSinpeStore.getState().addContact(newContact);
    const { sinpeContacts } = useSinpeStore.getState();
    expect(sinpeContacts[0].name).toBe('Diego Mora');
    expect(sinpeContacts[1].name).toBe('María González');
  });

  it('should add a sent transaction to the beginning', () => {
    const tx: SinpeTransaction = {
      id: '4',
      type: 'sent',
      amount: 10000,
      phone: '8888-1234',
      name: 'Diego Mora',
      date: 'Hoy, 5:00 PM',
      status: 'completed',
      reference: 'Cena',
    };

    useSinpeStore.getState().addTransaction(tx);
    const { sinpeHistory } = useSinpeStore.getState();
    expect(sinpeHistory).toHaveLength(initialSinpeHistory.length + 1);
    expect(sinpeHistory[0].id).toBe('4');
    expect(sinpeHistory[0].type).toBe('sent');
    expect(sinpeHistory[0].amount).toBe(10000);
  });

  it('should add a received transaction to the beginning', () => {
    const tx: SinpeTransaction = {
      id: '5',
      type: 'received',
      amount: 50000,
      phone: '7777-5678',
      name: 'María González',
      date: 'Hoy, 6:00 PM',
      status: 'completed',
      reference: 'Pago factura',
    };

    useSinpeStore.getState().addTransaction(tx);
    const { sinpeHistory } = useSinpeStore.getState();
    expect(sinpeHistory[0].id).toBe('5');
    expect(sinpeHistory[0].type).toBe('received');
    expect(sinpeHistory[0].amount).toBe(50000);
  });

  it('should add a pending transaction', () => {
    const tx: SinpeTransaction = {
      id: '6',
      type: 'sent',
      amount: 5000,
      phone: '6666-9012',
      name: 'Carlos Jiménez',
      date: 'Hoy, 7:00 PM',
      status: 'pending',
    };

    useSinpeStore.getState().addTransaction(tx);
    const { sinpeHistory } = useSinpeStore.getState();
    expect(sinpeHistory[0].status).toBe('pending');
  });

  it('should handle multiple additions correctly', () => {
    const contact1: SinpeContact = {
      id: '10',
      name: 'Person A',
      phone: '1111-1111',
    };
    const contact2: SinpeContact = {
      id: '11',
      name: 'Person B',
      phone: '2222-2222',
    };

    useSinpeStore.getState().addContact(contact1);
    useSinpeStore.getState().addContact(contact2);
    const { sinpeContacts } = useSinpeStore.getState();
    expect(sinpeContacts).toHaveLength(initialSinpeContacts.length + 2);
  });

  it('should maintain transaction order (newest first)', () => {
    const tx1: SinpeTransaction = {
      id: 'first',
      type: 'sent',
      amount: 1000,
      phone: '1111-1111',
      name: 'First',
      date: 'Hoy, 1:00 PM',
      status: 'completed',
    };
    const tx2: SinpeTransaction = {
      id: 'second',
      type: 'received',
      amount: 2000,
      phone: '2222-2222',
      name: 'Second',
      date: 'Hoy, 2:00 PM',
      status: 'completed',
    };

    useSinpeStore.getState().addTransaction(tx1);
    useSinpeStore.getState().addTransaction(tx2);
    const { sinpeHistory } = useSinpeStore.getState();
    expect(sinpeHistory[0].id).toBe('second');
    expect(sinpeHistory[1].id).toBe('first');
  });
});
