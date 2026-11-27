import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { NotificationsView } from '../NotificationsView';
import type { Notification } from '@/types';
import type { DestinoDeAviso } from '@/utils/destinoDeAviso';

// El dueno lo reporto el 2026-11-27: en la campana, tocar "Alerta de precio:
// BTC" o "SINPE recibido" solo marcaba el aviso como leido, no llevaba a
// ningun lado. El panel nunca tuvo destinos. Ahora tocar un aviso con pantalla
// lo marca leido, cierra el panel y la abre; uno sin pantalla sigue igual.

const app = vi.hoisted(() => ({ notifications: [] as Notification[], dispatch: vi.fn() }));

vi.mock('@/hooks/useApp', () => ({
  useApp: () => ({ state: { notifications: app.notifications }, dispatch: app.dispatch }),
}));

function aviso(extra: Partial<Notification> & Pick<Notification, 'id' | 'type'>): Notification {
  return { title: 'Aviso', message: 'Texto', date: 'Hoy', dateISO: '2026-11-27T14:05:00Z', read: false, ...extra };
}

function pintar(onAbrirDestino?: (d: DestinoDeAviso) => boolean) {
  const onClose = vi.fn();
  render(
    <LanguageProvider>
      <NotificationsView onClose={onClose} onAbrirDestino={onAbrirDestino} />
    </LanguageProvider>,
  );
  return { onClose };
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
  app.dispatch.mockReset();
});

describe('NotificationsView: tocar un aviso lleva a su pantalla', () => {
  const casos: Array<{ nombre: string; n: Notification; etiqueta: string; destino: DestinoDeAviso }> = [
    {
      nombre: 'alerta de precio con su moneda: Cripto en esa moneda',
      n: aviso({ id: 'a1', type: 'price_alert', title: 'Alerta de precio: BTC', data: { activo: 'BTC' } }),
      etiqueta: 'Ver BTC',
      destino: { pantalla: 'cripto', simbolo: 'BTC' },
    },
    {
      nombre: 'alerta de precio de antes, sin datos: Cripto',
      n: aviso({ id: 'a2', type: 'price_alert', title: 'Alerta de precio: BTC' }),
      etiqueta: 'Ver Cripto',
      destino: { pantalla: 'cripto' },
    },
    {
      nombre: 'SINPE recibido con su movimiento: ese movimiento',
      n: aviso({ id: 't1', type: 'transaction', title: 'SINPE recibido', data: { movimiento: 'tx-42' } }),
      etiqueta: 'Ver transacción',
      destino: { pantalla: 'movimiento', id: 'tx-42' },
    },
    {
      nombre: 'SINPE recibido de antes, sin datos: la actividad',
      n: aviso({ id: 't2', type: 'transaction', title: 'SINPE recibido' }),
      etiqueta: 'Ver transacciones',
      destino: { pantalla: 'actividad' },
    },
    {
      nombre: 'aviso de seguridad: Seguridad',
      n: aviso({ id: 's1', type: 'security', title: 'Nuevo inicio de sesión' }),
      etiqueta: 'Ver Seguridad',
      destino: { pantalla: 'seguridad' },
    },
  ];

  for (const c of casos) {
    it(c.nombre, async () => {
      app.notifications = [c.n];
      const onAbrirDestino = vi.fn(() => true);
      const { onClose } = pintar(onAbrirDestino);

      // La tarjeta dice a donde lleva, tambien al lector de pantalla.
      expect(screen.getByText(c.etiqueta)).toBeInTheDocument();
      const boton = screen.getByRole('button', { name: new RegExp(`${c.n.title}\\. ${c.etiqueta}$`) });

      fireEvent.click(boton);

      expect(app.dispatch).toHaveBeenCalledWith({ type: 'MARK_NOTIFICATION_READ', payload: c.n.id });
      await waitFor(() => expect(onAbrirDestino).toHaveBeenCalledWith(c.destino));
      expect(onAbrirDestino).toHaveBeenCalledTimes(1);
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  }

  it.each(['info', 'promo', 'warning', 'qr_cobro', 'crypto_receive', 'escrow'])(
    'un aviso de tipo %s no tiene pantalla: solo se marca leido y el panel queda abierto',
    async (tipo) => {
      app.notifications = [aviso({ id: 'x1', type: tipo as Notification['type'], title: 'Pago recibido' })];
      const onAbrirDestino = vi.fn(() => true);
      const { onClose } = pintar(onAbrirDestino);

      expect(screen.queryByText(/^Ver /)).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'No leída: Pago recibido' }));

      expect(app.dispatch).toHaveBeenCalledWith({ type: 'MARK_NOTIFICATION_READ', payload: 'x1' });
      await new Promise((r) => setTimeout(r, 400));
      expect(onAbrirDestino).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
    },
  );

  it('sin quien abra pantallas (modo negocio), tocar una alerta solo la marca leida', async () => {
    app.notifications = [aviso({ id: 'a1', type: 'price_alert', title: 'Alerta de precio: BTC', data: { activo: 'BTC' } })];
    const { onClose } = pintar(undefined);

    expect(screen.queryByText('Ver BTC')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'No leída: Alerta de precio: BTC' }));

    expect(app.dispatch).toHaveBeenCalledWith({ type: 'MARK_NOTIFICATION_READ', payload: 'a1' });
    await new Promise((r) => setTimeout(r, 400));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('borrar un aviso con pantalla no navega', async () => {
    app.notifications = [aviso({ id: 'a1', type: 'price_alert', title: 'Alerta de precio: BTC', data: { activo: 'BTC' } })];
    const onAbrirDestino = vi.fn(() => true);
    pintar(onAbrirDestino);

    fireEvent.click(screen.getByRole('button', { name: 'Eliminar notificación: Alerta de precio: BTC' }));

    expect(app.dispatch).toHaveBeenCalledWith({ type: 'DELETE_NOTIFICATION', payload: 'a1' });
    await new Promise((r) => setTimeout(r, 400));
    expect(onAbrirDestino).not.toHaveBeenCalled();
  });
});
