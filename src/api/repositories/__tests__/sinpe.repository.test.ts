import { MockSinpeRepository } from '../../adapters/mock/sinpe.mock';

describe('MockSinpeRepository', () => {
  let repo: MockSinpeRepository;

  beforeEach(() => {
    localStorage.clear();
    repo = new MockSinpeRepository();
  });

  describe('getContacts', () => {
    it('should return initial contacts', async () => {
      const result = await repo.getContacts();
      expect(result.success).toBe(true);
      expect(result.data!.length).toBeGreaterThanOrEqual(4);
      expect(result.data![0].name).toBe('Diego Mora');
    });
  });

  describe('addContact', () => {
    it('should add a new contact', async () => {
      const contact = {
        id: 'new-1',
        name: 'Luis Pérez',
        phone: '8888-9999',
        bank: 'BAC',
      };
      const result = await repo.addContact(contact);
      expect(result.success).toBe(true);
      expect(result.data!.name).toBe('Luis Pérez');

      const contacts = await repo.getContacts();
      expect(contacts.data!.length).toBeGreaterThanOrEqual(5);
    });
  });

  describe('getHistory', () => {
    it('should return initial SINPE history', async () => {
      const result = await repo.getHistory();
      expect(result.success).toBe(true);
      expect(result.data!.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('send', () => {
    it('should create a SINPE transaction', async () => {
      const result = await repo.send({
        phone: '8888-1234',
        amount: 10000,
        description: 'Test transfer',
      });
      expect(result.success).toBe(true);
      expect(result.data!.type).toBe('sent');
      expect(result.data!.amount).toBe(10000);
      expect(result.data!.name).toBe('Diego Mora'); // matched from contacts
      expect(result.data!.status).toBe('completed');

      // Should appear in history
      const history = await repo.getHistory();
      expect(history.data![0].amount).toBe(10000);
    });

    it('should use phone as name when contact not found', async () => {
      const result = await repo.send({
        phone: '9999-0000',
        amount: 5000,
      });
      expect(result.success).toBe(true);
      expect(result.data!.name).toBe('9999-0000');
    });
  });
});
