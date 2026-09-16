import { useAccountStore } from '../account.store';
import { initialAccounts, initialBudgets } from '@/api/adapters/mock/mock-data';

describe('useAccountStore', () => {
  beforeEach(() => {
    localStorage.clear();
    useAccountStore.setState({
      baseCurrency: 'CRC',
      accounts: [...initialAccounts],
      budgets: [...initialBudgets],
    });
  });

  it('should have initial accounts', () => {
    const { accounts } = useAccountStore.getState();
    expect(accounts).toHaveLength(2);
    expect(accounts[0].ccy).toBe('CRC');
  });

  // Una moneda base que el servidor ya no devuelve quedaba huerfana: el rotulo
  // "GBP · Base" sobre un saldo en colones, persistido hasta tocar otra cuenta.
  it('al sincronizar, una moneda base sin cuenta real vuelve a colones', () => {
    useAccountStore.setState({ baseCurrency: 'GBP' });
    useAccountStore.getState().setAccounts([...initialAccounts]);
    expect(useAccountStore.getState().baseCurrency).toBe('CRC');
  });

  it('al sincronizar, una moneda base que si existe se respeta', () => {
    useAccountStore.setState({ baseCurrency: 'USD' });
    useAccountStore.getState().setAccounts([...initialAccounts]);
    expect(useAccountStore.getState().baseCurrency).toBe('USD');
  });

  it('una lista vacia no toca la moneda base', () => {
    useAccountStore.setState({ baseCurrency: 'USD' });
    useAccountStore.getState().setAccounts([]);
    expect(useAccountStore.getState().baseCurrency).toBe('USD');
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

  it('should set base currency', () => {
    useAccountStore.getState().setBaseCurrency('USD');
    expect(useAccountStore.getState().baseCurrency).toBe('USD');
  });
});
