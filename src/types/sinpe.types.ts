export interface SinpeContact {
  id: string;
  name: string;
  phone: string;
  bank?: string;
  avatar?: string;
  isFavorite?: boolean;
}

export interface SinpeTransaction {
  id: string;
  type: 'sent' | 'received';
  amount: number;
  phone: string;
  name: string;
  date: string;
  status: 'completed' | 'pending' | 'failed';
  reference?: string;
}
