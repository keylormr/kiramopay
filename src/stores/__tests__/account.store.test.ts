import { useAccountStore } from '../account.store';
import { initialAccounts, initialBudgets } from '@/api/adapters/mock/mock-data';

describe('useAccountStore', () => {
  beforeEach(() => {
    localStorage.clear();
    useAccountStore.setState({
      baseCurrency: 'CRC',
      accounts: [...initialAccounts],
      budgets: [...initialBudgets],
      cards: { frozen: false, last4: '8842', limits: { online: 500000, atm: 200000 } },
    });
  });

  it('should have initial accounts', () => {
    const { accounts } = useAccountStore.getState();
    expect(accounts).toHaveLength(2);
    expect(accounts[0].ccy).toBe('CRC');
  });

  it('should add a new account', () => {
    useAccountStore.getState().addAccount({
      ccy: 'EUR',
      balance: 100,
      symbol: '€',
      flag: '🇪🇺',
      iban: 'DE89',
      name: 'Euro',
      type: 'fiat',
    });
    expect(useAccountStore.getState().accounts).toHaveLength(3);
  });

  it('should not add duplicate account', () => {
    useAccountStore.getState().addAccount({
      ccy: 'CRC',
      balance: 0,
      symbol: '₡',
      flag: '🇨🇷',
      iban: 'XX',
      name: 'Dup',
      type: 'fiat',
    });
    expect(useAccountStore.getState().accounts).toHaveLength(2);
  });

  it('should update account balance', () => {
    useAccountStore.getState().updateAccountBalance('CRC', -5000);
    const crc = useAccountStore.getState().accounts.find((a) => a.ccy === 'CRC')!;
    expect(crc.balance).toBe(384500 - 5000);
  });

  it('should toggle freeze', () => {
    expect(useAccountStore.getState().cards.frozen).toBe(false);
    useAccountStore.getState().toggleFreeze();
    expect(useAccountStore.getState().cards.frozen).toBe(true);
  });

  it('should update limits', () => {
    useAccountStore.getState().updateLimits({ online: 100000, atm: 50000 });
    expect(useAccountStore.getState().cards.limits.online).toBe(100000);
  });

  it('should set base currency', () => {
    useAccountStore.getState().setBaseCurrency('USD');
    expect(useAccountStore.getState().baseCurrency).toBe('USD');
  });
});
