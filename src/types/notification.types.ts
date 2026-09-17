export interface Notification {
  id: string;
  title: string;
  message: string;
  // price_alert: el barrido de alertas de precio del servidor.
  type: 'info' | 'transaction' | 'promo' | 'security' | 'warning' | 'price_alert';
  date: string;
  read: boolean;
  action?: {
    label: string;
    route?: string;
  };
}
