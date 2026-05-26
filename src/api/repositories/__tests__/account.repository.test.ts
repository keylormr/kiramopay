import { MockAccountRepository } from '../../adapters/mock/account.mock';

describe('MockAccountRepository', () => {
  let repo: MockAccountRepository;

  beforeEach(() => {
    localStorage.clear();
    repo = new MockAccountRepository();
  });

  describe('getAccounts', () => {
    it('should return initial accounts', async () => {
      const result = await repo.getAccounts();
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
      expect(result.data![0].ccy).toBe('CRC');
      expect(result.data![1].ccy).toBe('USD');
    });
  });

  describe('getAccount', () => {
    it('should return a specific account by currency', async () => {
      const result = await repo.getAccount('CRC');
      expect(result.success).toBe(true);
      expect(result.data!.ccy).toBe('CRC');
      expect(result.data!.balance).toBe(384500);
    });

    it('should fail for non-existent currency', async () => {
      const result = await repo.getAccount('EUR');
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('NOT_FOUND');
    });
  });

  describe('addAccount', () => {
    it('should add a new account', async () => {
      const newAccount = {
        ccy: 'EUR',
        balance: 100,
        symbol: '€',
        flag: '🇪🇺',
        iban: 'DE89 3704 0044 0532 0130 00',
        name: 'Euro Account',
        type: 'fiat' as const,
        rateToUsd: 1.1,
      };
      const result = await repo.addAccount(newAccount);
      expect(result.success).toBe(true);
      expect(result.data!.ccy).toBe('EUR');

      const accounts = await repo.getAccounts();
      expect(accounts.data).toHaveLength(3);
    });

    it('should reject duplicate currency', async () => {
      const result = await repo.addAccount({
        ccy: 'CRC',
        balance: 0,
        symbol: '₡',
        flag: '🇨🇷',
        iban: 'CR00',
        name: 'Duplicate',
        type: 'fiat',
      });
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('DUPLICATE');
    });
  });

  describe('getBalanceSummary', () => {
    it('should return total USD balance', async () => {
      const result = await repo.getBalanceSummary();
      expect(result.success).toBe(true);
      expect(result.data!.totalUsd).toBeGreaterThan(0);
      expect(result.data!.accounts).toHaveLength(2);
    });
  });

  describe('getBudgets', () => {
    it('should return initial budgets', async () => {
      const result = await repo.getBudgets();
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(4);
      expect(result.data![0].label).toBe('Comida');
    });
  });
});
