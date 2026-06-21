import type { IAuthRepository } from './repositories/auth.repository';
import type { IMfaRepository } from './repositories/mfa.repository';
import type { IAccountRepository } from './repositories/account.repository';
import type { ITransactionRepository } from './repositories/transaction.repository';
import type { ISinpeRepository } from './repositories/sinpe.repository';
import type { ICryptoRepository } from './repositories/crypto.repository';
import type { IServicesRepository } from './repositories/services.repository';
import type { INotificationRepository } from './repositories/notification.repository';
import type { ISettingsRepository } from './repositories/settings.repository';
import type { IMarketplaceRepository } from './repositories/marketplace.repository';
import type { ILoyaltyRepository } from './repositories/loyalty.repository';
import type { IQRPaymentRepository } from './repositories/qrpayment.repository';
import type { ISplitPayRepository } from './repositories/splitpay.repository';
import type { ICardsRepository } from './repositories/cards.repository';
import type { ICountryRepository } from './repositories/country.repository';
import type { IBudgetRepository } from './repositories/budget.repository';
import type { IRecurringRepository } from './repositories/recurring.repository';
import type { IEscrowRepository } from './repositories/escrow.repository';
import type { IPayoutRepository } from './repositories/payout.repository';
import type { IB2BRepository } from './repositories/b2b.repository';
import type { IAssistantRepository } from './repositories/assistant.repository';
import { createMockApiLayer } from './adapters/mock';
import { createHttpApiLayer } from './adapters/http';
import { HttpClient } from './adapters/http/client';
import { HttpAuthRepository } from './adapters/http/auth.http';
import { HttpMfaRepository } from './adapters/http/mfa.http';
import { HttpEscrowRepository } from './adapters/http/escrow.http';
import { HttpPayoutRepository } from './adapters/http/payout.http';
import { HttpB2BRepository } from './adapters/http/b2b.http';
import { HttpAssistantRepository } from './adapters/http/assistant.http';

export interface ApiLayer {
  auth: IAuthRepository;
  mfa: IMfaRepository;
  accounts: IAccountRepository;
  transactions: ITransactionRepository;
  sinpe: ISinpeRepository;
  crypto: ICryptoRepository;
  services: IServicesRepository;
  notifications: INotificationRepository;
  settings: ISettingsRepository;
  budgets: IBudgetRepository;
  recurring: IRecurringRepository;
  // Phase F — B2B / escrow (HTTP-only, like mfa)
  escrow: IEscrowRepository;
  payout: IPayoutRepository;
  b2b: IB2BRepository;
  assistant: IAssistantRepository;
  // Phase 5
  marketplace?: IMarketplaceRepository;
  loyalty?: ILoyaltyRepository;
  qrPayments?: IQRPaymentRepository;
  splitPay?: ISplitPayRepository;
  cards?: ICardsRepository;
  country?: ICountryRepository;
}

let apiLayerInstance: ApiLayer | null = null;

function detectMode(): 'mock' | 'http' {
  const apiUrl = import.meta.env.VITE_API_URL;
  return apiUrl ? 'http' : 'mock';
}

export function createApiLayer(mode?: 'mock' | 'http'): ApiLayer {
  const resolvedMode = mode || detectMode();
  const baseUrl = import.meta.env.VITE_API_URL || 'http://localhost:8080';

  if (resolvedMode === 'http') {
    return createHttpApiLayer(baseUrl);
  }

  // Mock mode: auth + MFA + escrow + B2B ALWAYS go through the real backend
  // (DB / money). Other repos use localStorage mock adapters.
  const client = new HttpClient(baseUrl);
  const httpAuth = new HttpAuthRepository(client);
  const httpMfa = new HttpMfaRepository(client);
  const httpEscrow = new HttpEscrowRepository(client);
  const httpPayout = new HttpPayoutRepository(client);
  const httpB2B = new HttpB2BRepository(client);
  const httpAssistant = new HttpAssistantRepository(client);
  return createMockApiLayer(httpAuth, httpMfa, httpEscrow, httpPayout, httpB2B, httpAssistant);
}

export function getApiLayer(): ApiLayer {
  if (!apiLayerInstance) {
    apiLayerInstance = createApiLayer();
  }
  return apiLayerInstance;
}

export function setApiLayer(layer: ApiLayer): void {
  apiLayerInstance = layer;
}

// Re-export types
export type { ApiResponse, ApiError } from './types';
export { apiSuccess, apiError } from './types';
export type { IAuthRepository, LoginRequest, LoginResponse } from './repositories/auth.repository';
export type { IMfaRepository, TotpEnrollResponse } from './repositories/mfa.repository';
export type { IAccountRepository } from './repositories/account.repository';
export type { ITransactionRepository } from './repositories/transaction.repository';
export type { ISinpeRepository, SendSinpeRequest } from './repositories/sinpe.repository';
export type {
  ICryptoRepository,
  BuyCryptoRequest,
  SellCryptoRequest,
} from './repositories/crypto.repository';
export type { IServicesRepository } from './repositories/services.repository';
export type { INotificationRepository } from './repositories/notification.repository';
export type { ISettingsRepository, AppSettings } from './repositories/settings.repository';
export type { IMarketplaceRepository } from './repositories/marketplace.repository';
export type { ILoyaltyRepository } from './repositories/loyalty.repository';
export type { IQRPaymentRepository } from './repositories/qrpayment.repository';
export type { ISplitPayRepository } from './repositories/splitpay.repository';
export type { ICardsRepository } from './repositories/cards.repository';
export type { ICountryRepository } from './repositories/country.repository';
export type { IBudgetRepository } from './repositories/budget.repository';
export type { IRecurringRepository } from './repositories/recurring.repository';
export type {
  IEscrowRepository,
  EscrowAgreement,
  EscrowStatus,
  CreateEscrowRequest,
} from './repositories/escrow.repository';
export type {
  IPayoutRepository,
  Payout,
  PayoutStatus,
  PayoutDestination,
  CreatePayoutRequest,
} from './repositories/payout.repository';
export type {
  IB2BRepository,
  ApiKey,
  CreateApiKeyResult,
  WebhookEndpoint,
  CreateWebhookResult,
  WebhookDelivery,
  B2BScope,
} from './repositories/b2b.repository';
export { B2B_SCOPES } from './repositories/b2b.repository';
export type {
  IAssistantRepository,
  AssistantTurn,
  AssistantReply,
  AssistantProposal,
} from './repositories/assistant.repository';
