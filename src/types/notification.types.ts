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
  /**
   * Con que abrir la pantalla del aviso (ver utils/destinoDeAviso): `activo`
   * en una alerta de precio, `movimiento` en un SINPE recibido. No viene en
   * los avisos de antes ni en los que no llevan a ninguna pantalla.
   */
  data?: Record<string, string>;
  action?: {
    label: string;
    route?: string;
  };
}
