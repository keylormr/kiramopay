import type {
  User,
  Account,
  Budget,
  Transaction,
  SinpeContact,
  SinpeTransaction,
  ServiceProvider,
  SavedService,
  Bill,
  PhoneOperator,
  Recharge,
  MarketplacePartner,
  RideRequest,
  FoodOrder,
  CryptoAsset,
  CryptoTransaction,
  StakingPosition,
  PriceAlert,
  CryptoState,
  Notification,
  AppAction,
} from '../index';

describe('Types barrel exports', () => {
  it('should export all auth types', () => {
    const user: User = {
      id: '1',
      phone: '88888888',
      firstName: 'Test',
      lastName: 'User',
      kycLevel: 0,
      createdAt: '2024-01-01',
    };
    expect(user.id).toBe('1');
  });

  it('should export all account types', () => {
    const account: Account = {
      ccy: 'CRC',
      balance: 1000,
      symbol: '₡',
      flag: '🇨🇷',
      iban: 'CR0000',
      name: 'Colones',
      type: 'fiat',
    };
    const budget: Budget = {
      id: '1',
      label: 'Food',
      spent: 100,
      limit: 500,
      ccy: 'CRC',
    };
    expect(account.type).toBe('fiat');
    expect(budget.label).toBe('Food');
  });

  it('should export all transaction types', () => {
    const tx: Transaction = {
      id: '1',
      title: 'Payment',
      amount: 500,
      ccy: 'CRC',
      date: '2024-01-01',
      type: 'debit',
    };
    expect(tx.type).toBe('debit');
  });

  it('should export all SINPE types', () => {
    const contact: SinpeContact = {
      id: '1',
      name: 'Juan',
      phone: '88888888',
    };
    const sinpeTx: SinpeTransaction = {
      id: '1',
      type: 'sent',
      amount: 5000,
      phone: '88888888',
      name: 'Juan',
      date: '2024-01-01',
      status: 'completed',
    };
    expect(contact.name).toBe('Juan');
    expect(sinpeTx.status).toBe('completed');
  });

  it('should export all service types', () => {
    const provider: ServiceProvider = {
      id: '1',
      code: 'ICE',
      name: 'ICE',
      category: 'electricity',
      logo: '⚡',
      color: '#000',
    };
    const saved: SavedService = {
      id: '1',
      providerId: '1',
      clientId: '123',
    };
    const bill: Bill = {
      id: '1',
      providerId: '1',
      providerName: 'ICE',
      clientId: '123',
      amount: 15000,
      dueDate: '2024-02-01',
      period: 'January',
      status: 'pending',
    };
    const operator: PhoneOperator = {
      id: '1',
      name: 'Kolbi',
      logo: 'K',
      color: '#00f',
      amounts: [1000, 2000],
    };
    const recharge: Recharge = {
      id: '1',
      operatorId: '1',
      phone: '88888888',
      amount: 1000,
      date: '2024-01-01',
      status: 'completed',
    };
    expect(provider.category).toBe('electricity');
    expect(saved.clientId).toBe('123');
    expect(bill.status).toBe('pending');
    expect(operator.amounts).toHaveLength(2);
    expect(recharge.status).toBe('completed');
  });

  it('should export all marketplace types', () => {
    const partner: MarketplacePartner = {
      id: '1',
      code: 'uber',
      name: 'Uber',
      category: 'transport',
      logo: 'U',
      color: '#000',
      description: 'Ride sharing',
    };
    const ride: RideRequest = {
      id: '1',
      partnerId: '1',
      pickup: 'A',
      destination: 'B',
      estimatedPrice: 5000,
      estimatedTime: '15 min',
      distance: '5 km',
      status: 'searching',
    };
    const order: FoodOrder = {
      id: '1',
      partnerId: '1',
      restaurantName: 'McDonalds',
      items: [{ name: 'Burger', quantity: 1, price: 3000 }],
      subtotal: 3000,
      deliveryFee: 500,
      total: 3500,
      status: 'preparing',
      estimatedDelivery: '30 min',
    };
    expect(partner.category).toBe('transport');
    expect(ride.status).toBe('searching');
    expect(order.total).toBe(3500);
  });

  it('should export all crypto types', () => {
    const asset: CryptoAsset = {
      id: '1',
      symbol: 'BTC',
      name: 'Bitcoin',
      icon: '₿',
      color: '#f7931a',
      balance: 0.5,
      avgBuyPrice: 50000,
      currentPrice: 60000,
      priceChange24h: 2.5,
      priceHistory: [58000, 59000, 60000],
    };
    const cryptoTx: CryptoTransaction = {
      id: '1',
      type: 'buy',
      fromAsset: 'USD',
      fromAmount: 1000,
      price: 60000,
      fee: 5,
      date: '2024-01-01',
      status: 'completed',
    };
    const staking: StakingPosition = {
      id: '1',
      asset: 'ETH',
      amount: 10,
      apy: 5.0,
      startDate: '2024-01-01',
      earned: 0.1,
      locked: false,
    };
    const alert: PriceAlert = {
      id: '1',
      asset: 'BTC',
      targetPrice: 100000,
      condition: 'above',
      active: true,
    };
    const state: CryptoState = {
      assets: [asset],
      transactions: [cryptoTx],
      stakingPositions: [staking],
      priceAlerts: [alert],
      favoriteAssets: ['BTC'],
      defaultConvertCurrency: 'USD',
    };
    expect(asset.symbol).toBe('BTC');
    expect(cryptoTx.type).toBe('buy');
    expect(staking.apy).toBe(5.0);
    expect(alert.condition).toBe('above');
    expect(state.favoriteAssets).toContain('BTC');
  });

  it('should export notification type', () => {
    const notification: Notification = {
      id: '1',
      title: 'Welcome',
      message: 'Hello!',
      type: 'info',
      date: '2024-01-01',
      read: false,
    };
    expect(notification.type).toBe('info');
  });

  it('should export AppState and AppAction types', () => {
    const action: AppAction = { type: 'TOGGLE_THEME' };
    expect(action.type).toBe('TOGGLE_THEME');

    const loginAction: AppAction = {
      type: 'LOGIN',
      payload: {
        id: '1',
        phone: '88888888',
        firstName: 'Test',
        lastName: 'User',
        kycLevel: 0,
        createdAt: '2024-01-01',
      },
    };
    expect(loginAction.type).toBe('LOGIN');
  });
});
