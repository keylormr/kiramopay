import { useServicesStore } from '../services.store';
import { initialSavedServices, initialRechargeHistory } from '@/api/adapters/mock/mock-data';
import type { SavedService, Bill, Recharge } from '@/types';

describe('useServicesStore', () => {
  beforeEach(() => {
    localStorage.clear();
    useServicesStore.setState({
      savedServices: initialSavedServices.map((s) => ({ ...s })),
      billHistory: [],
      rechargeHistory: initialRechargeHistory.map((r) => ({ ...r })),
      connectedPartners: ['uber', 'ubereats'],
    });
  });

  it('should have initial saved services', () => {
    const { savedServices } = useServicesStore.getState();
    expect(savedServices).toHaveLength(initialSavedServices.length);
    expect(savedServices[0].providerId).toBe('ice');
  });

  it('should have initial recharge history', () => {
    const { rechargeHistory } = useServicesStore.getState();
    expect(rechargeHistory).toHaveLength(initialRechargeHistory.length);
    expect(rechargeHistory[0].operatorId).toBe('kolbi');
  });

  it('should have empty bill history initially', () => {
    const { billHistory } = useServicesStore.getState();
    expect(billHistory).toHaveLength(0);
  });

  it('should have initial connected partners', () => {
    const { connectedPartners } = useServicesStore.getState();
    expect(connectedPartners).toContain('uber');
    expect(connectedPartners).toContain('ubereats');
    expect(connectedPartners).toHaveLength(2);
  });

  it('should add a saved service', () => {
    const newService: SavedService = {
      id: '3',
      providerId: 'cnfl',
      clientId: '9999999',
      nickname: 'Oficina',
      lastAmount: 15000,
      dueDate: '2025-02-10',
    };

    useServicesStore.getState().addSavedService(newService);
    const { savedServices } = useServicesStore.getState();
    expect(savedServices).toHaveLength(initialSavedServices.length + 1);
    expect(savedServices[savedServices.length - 1].providerId).toBe('cnfl');
  });

  it('should add a bill payment to the beginning', () => {
    const bill: Bill = {
      id: 'bill-1',
      providerId: 'ice',
      providerName: 'ICE',
      clientId: '1234567',
      amount: 28500,
      dueDate: '2025-02-15',
      period: 'Enero 2025',
      status: 'paid',
    };

    useServicesStore.getState().addBillPayment(bill);
    const { billHistory } = useServicesStore.getState();
    expect(billHistory).toHaveLength(1);
    expect(billHistory[0].id).toBe('bill-1');
    expect(billHistory[0].amount).toBe(28500);
  });

  it('should prepend bill payments (newest first)', () => {
    const bill1: Bill = {
      id: 'bill-1',
      providerId: 'ice',
      providerName: 'ICE',
      clientId: '1234567',
      amount: 28500,
      dueDate: '2025-02-15',
      period: 'Enero 2025',
      status: 'paid',
    };
    const bill2: Bill = {
      id: 'bill-2',
      providerId: 'aya',
      providerName: 'AyA',
      clientId: '7654321',
      amount: 9200,
      dueDate: '2025-02-20',
      period: 'Enero 2025',
      status: 'paid',
    };

    useServicesStore.getState().addBillPayment(bill1);
    useServicesStore.getState().addBillPayment(bill2);
    const { billHistory } = useServicesStore.getState();
    expect(billHistory).toHaveLength(2);
    expect(billHistory[0].id).toBe('bill-2');
    expect(billHistory[1].id).toBe('bill-1');
  });

  it('should add a recharge to the beginning', () => {
    const recharge: Recharge = {
      id: '2',
      operatorId: 'movistar',
      phone: '7777-0000',
      amount: 3000,
      date: 'Hoy, 3:00 PM',
      status: 'completed',
    };

    useServicesStore.getState().addRecharge(recharge);
    const { rechargeHistory } = useServicesStore.getState();
    expect(rechargeHistory).toHaveLength(initialRechargeHistory.length + 1);
    expect(rechargeHistory[0].id).toBe('2');
    expect(rechargeHistory[0].operatorId).toBe('movistar');
  });

  it('should connect a new partner', () => {
    useServicesStore.getState().connectPartner('rappi');
    const { connectedPartners } = useServicesStore.getState();
    expect(connectedPartners).toContain('rappi');
    expect(connectedPartners).toHaveLength(3);
  });

  it('should not duplicate an already connected partner', () => {
    useServicesStore.getState().connectPartner('uber');
    const { connectedPartners } = useServicesStore.getState();
    expect(connectedPartners).toHaveLength(2);
  });

  it('should disconnect a partner', () => {
    useServicesStore.getState().disconnectPartner('uber');
    const { connectedPartners } = useServicesStore.getState();
    expect(connectedPartners).not.toContain('uber');
    expect(connectedPartners).toHaveLength(1);
    expect(connectedPartners[0]).toBe('ubereats');
  });

  it('should handle disconnecting a non-connected partner gracefully', () => {
    useServicesStore.getState().disconnectPartner('rappi');
    const { connectedPartners } = useServicesStore.getState();
    expect(connectedPartners).toHaveLength(2);
  });

  it('should allow connect after disconnect', () => {
    useServicesStore.getState().disconnectPartner('uber');
    expect(useServicesStore.getState().connectedPartners).not.toContain('uber');

    useServicesStore.getState().connectPartner('uber');
    expect(useServicesStore.getState().connectedPartners).toContain('uber');
  });
});
