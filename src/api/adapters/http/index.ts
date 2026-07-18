import type { ApiLayer } from '../../index';
import { HttpClient } from './client';
import { HttpAuthRepository } from './auth.http';
import { HttpMfaRepository } from './mfa.http';
import { HttpAccountRepository } from './account.http';
import { HttpTransactionRepository } from './transaction.http';
import { HttpSinpeRepository } from './sinpe.http';
import { HttpCryptoRepository } from './crypto.http';
import { HttpServicesRepository } from './services.http';
import { HttpNotificationRepository } from './notification.http';
import { HttpSettingsRepository } from './settings.http';
import { HttpMarketplaceRepository } from './marketplace.http';
import { HttpLoyaltyRepository } from './loyalty.http';
import { HttpQRPaymentRepository } from './qrpayment.http';
import { HttpSplitPayRepository } from './splitpay.http';
import { HttpCardsRepository } from './cards.http';
import { HttpCountryRepository } from './country.http';
import { HttpBudgetRepository } from './budget.http';
import { HttpRecurringRepository } from './recurring.http';
import { HttpEscrowRepository } from './escrow.http';
import { HttpPayoutRepository } from './payout.http';
import { HttpB2BRepository } from './b2b.http';
import { HttpAssistantRepository } from './assistant.http';
import { HttpSavingsRepository } from './savings.http';
import { HttpKycRepository } from './kyc.http';

export function createHttpApiLayer(baseUrl: string): ApiLayer {
  const client = new HttpClient(baseUrl);

  return {
    auth: new HttpAuthRepository(client),
    mfa: new HttpMfaRepository(client),
    escrow: new HttpEscrowRepository(client),
    payout: new HttpPayoutRepository(client),
    b2b: new HttpB2BRepository(client),
    assistant: new HttpAssistantRepository(client),
    accounts: new HttpAccountRepository(client),
    transactions: new HttpTransactionRepository(client),
    sinpe: new HttpSinpeRepository(client),
    crypto: new HttpCryptoRepository(client),
    services: new HttpServicesRepository(client),
    notifications: new HttpNotificationRepository(client),
    settings: new HttpSettingsRepository(),
    budgets: new HttpBudgetRepository(client),
    recurring: new HttpRecurringRepository(client),
    // Phase 5
    marketplace: new HttpMarketplaceRepository(client),
    loyalty: new HttpLoyaltyRepository(client),
    qrPayments: new HttpQRPaymentRepository(client),
    splitPay: new HttpSplitPayRepository(client),
    cards: new HttpCardsRepository(client),
    country: new HttpCountryRepository(client),
    savings: new HttpSavingsRepository(client),
    kyc: new HttpKycRepository(client),
  };
}
