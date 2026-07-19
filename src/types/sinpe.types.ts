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
  // False when the recipient is not a KiramoPay user: the funds were booked to
  // the external rail (delivery to other banks is not yet enabled), so the UI
  // must not present the transfer as delivered.
  internal?: boolean;
}
