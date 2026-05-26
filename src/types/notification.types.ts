export interface Notification {
  id: string;
  title: string;
  message: string;
  type: 'info' | 'transaction' | 'promo' | 'security' | 'warning';
  date: string;
  read: boolean;
  action?: {
    label: string;
    route?: string;
  };
}
