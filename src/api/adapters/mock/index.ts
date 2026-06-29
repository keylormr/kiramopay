import type { ApiLayer } from '../../index';
import { MockAccountRepository } from './account.mock';
import { MockTransactionRepository } from './transaction.mock';
import { MockSinpeRepository } from './sinpe.mock';
import { MockCryptoRepository } from './crypto.mock';
import { MockServicesRepository } from './services.mock';
import { MockNotificationRepository } from './notification.mock';
import { MockSettingsRepository } from './settings.mock';
import { MockCardsRepository } from './cards.mock';
import { MockCountryRepository } from './country.mock';
import { MockLoyaltyRepository } from './loyalty.mock';
import { MockMarketplaceRepository } from './marketplace.mock';
import { MockQRPaymentRepository } from './qrpayment.mock';
import { MockSplitPayRepository } from './splitpay.mock';
import { MockBudgetRepository } from './budget.mock';
import { MockRecurringRepository } from './recurring.mock';
import { MockSavingsRepository } from './savings.mock';

// Auth, MFA, escrow, payout and B2B are NOT mocked — they always go through the
// real backend (they move money / hold secrets). See createApiLayer() in
// src/api/index.ts.
export function createMockApiLayer(
  auth: ApiLayer['auth'],
  mfa: ApiLayer['mfa'],
  escrow: ApiLayer['escrow'],
  payout: ApiLayer['payout'],
  b2b: ApiLayer['b2b'],
  assistant: ApiLayer['assistant'],
): ApiLayer {
  return {
    auth,
    mfa,
    escrow,
    payout,
    b2b,
    assistant,
    accounts: new MockAccountRepository(),
    transactions: new MockTransactionRepository(),
    sinpe: new MockSinpeRepository(),
    crypto: new MockCryptoRepository(),
    services: new MockServicesRepository(),
    notifications: new MockNotificationRepository(),
    settings: new MockSettingsRepository(),
    budgets: new MockBudgetRepository(),
    recurring: new MockRecurringRepository(),
    cards: new MockCardsRepository(),
    country: new MockCountryRepository(),
    loyalty: new MockLoyaltyRepository(),
    marketplace: new MockMarketplaceRepository(),
    qrPayments: new MockQRPaymentRepository(),
    splitPay: new MockSplitPayRepository(),
    savings: new MockSavingsRepository(),
  };
}
