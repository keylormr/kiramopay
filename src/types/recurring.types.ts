export interface RecurringPayment {
  id: string;
  label: string;
  type: 'service' | 'sinpe' | 'recharge';
  amount: number;
  ccy: string;
  frequency: 'weekly' | 'biweekly' | 'monthly';
  nextDate: string; // ISO date string
  lastPaidDate?: string;
  recipientPhone?: string; // for SINPE
  recipientName?: string;
  serviceProviderId?: string; // for service payments
  clientId?: string; // for service payments
  enabled: boolean;
}
