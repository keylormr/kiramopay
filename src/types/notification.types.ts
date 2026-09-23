export interface Notification {
  id: string;
  title: string;
  message: string;
  // price_alert: el barrido de alertas de precio del servidor.
  type: 'info' | 'transaction' | 'promo' | 'security' | 'warning' | 'price_alert';
  date: string;
  /**
   * La fecha de maquina (ISO). La pantalla la escribe en el idioma de la
   * persona; `date` es el texto ya escrito, para lo que llego sin esta.
   */
  dateISO?: string;
  read: boolean;
  action?: {
    label: string;
    route?: string;
  };
}
