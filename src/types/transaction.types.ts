export interface Transaction {
  id: string;
  title: string;
  amount: number;
  ccy: string;
  date: string;
  type: 'credit' | 'debit';
  category?: string;
  status?: 'completed' | 'pending';
  icon?: string;
  description?: string;
}
