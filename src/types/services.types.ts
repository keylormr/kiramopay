export interface ServiceProvider {
  id: string;
  code: string;
  name: string;
  category: 'electricity' | 'water' | 'telecom' | 'internet' | 'cable' | 'municipal' | 'insurance' | 'education' | 'other';
  logo: string;
  color: string;
}

export interface SavedService {
  id: string;
  providerId: string;
  clientId: string;
  nickname?: string;
  lastAmount?: number;
  dueDate?: string;
  autoPay?: boolean;
}

export interface Bill {
  id: string;
  providerId: string;
  providerName: string;
  clientId: string;
  amount: number;
  dueDate: string;
  period: string;
  status: 'pending' | 'paid' | 'overdue';
}

export interface PhoneOperator {
  id: string;
  name: string;
  logo: string;
  color: string;
  amounts: number[];
}

export interface Recharge {
  id: string;
  operatorId: string;
  phone: string;
  amount: number;
  date: string;
  status: 'completed' | 'pending' | 'failed';
}
