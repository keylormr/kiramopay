import {
  destinoDeAviso,
  publicarToqueDeAviso,
  reiniciarToquesParaPruebas,
  suscribirToqueDeAviso,
  toqueDeAviso,
} from '../destinoDeAviso';

// La regla de a que pantalla lleva un aviso, la misma para la campana y para el
// toque del push. Un aviso de antes (sin datos) va a la pantalla general de su
// tipo; uno de un tipo sin pantalla no lleva a ningun lado.

describe('destinoDeAviso', () => {
  it('alerta de precio: Cripto en su moneda', () => {
    expect(destinoDeAviso('price_alert', { activo: 'BTC' })).toEqual({ pantalla: 'cripto', simbolo: 'BTC' });
    expect(destinoDeAviso('price_alert', { activo: ' eth ' })).toEqual({ pantalla: 'cripto', simbolo: 'ETH' });
  });

  it('alerta de precio sin moneda, o con una que no tiene forma de simbolo: Cripto', () => {
    expect(destinoDeAviso('price_alert', undefined)).toEqual({ pantalla: 'cripto' });
    expect(destinoDeAviso('price_alert', {})).toEqual({ pantalla: 'cripto' });
    expect(destinoDeAviso('price_alert', { activo: '../perfil' })).toEqual({ pantalla: 'cripto' });
    expect(destinoDeAviso('price_alert', { activo: 7 })).toEqual({ pantalla: 'cripto' });
  });

  it('SINPE recibido: su movimiento, o la actividad si no lo trae', () => {
    const id = '5a4c1d2e-0000-4000-8000-0000000000aa';
    expect(destinoDeAviso('transaction', { movimiento: id })).toEqual({ pantalla: 'movimiento', id });
    expect(destinoDeAviso('transaction', null)).toEqual({ pantalla: 'actividad' });
    expect(destinoDeAviso('transaction', { movimiento: 'no es <un> id' })).toEqual({ pantalla: 'actividad' });
  });

  it('seguridad: Seguridad', () => {
    expect(destinoDeAviso('security', undefined)).toEqual({ pantalla: 'seguridad' });
  });

  it('los demas tipos no llevan a ninguna pantalla', () => {
    for (const tipo of ['info', 'promo', 'warning', 'qr_cobro', 'crypto_receive', 'escrow', '', undefined]) {
      expect(destinoDeAviso(tipo, { activo: 'BTC', movimiento: 'tx-1' })).toBeNull();
    }
  });
});

describe('toqueDeAviso: los datos del push de FCM', () => {
  it('lee el tipo, los datos y el id del aviso', () => {
    expect(toqueDeAviso({ url: '/', tipo: 'price_alert', activo: 'BTC', aviso: 'aviso-1', 'google.sent_time': 1 })).toEqual({
      destino: { pantalla: 'cripto', simbolo: 'BTC' },
      aviso: 'aviso-1',
    });
  });

  it('un push de antes, sin id ni datos, igual lleva a la pantalla general', () => {
    expect(toqueDeAviso({ url: '/', tipo: 'transaction' })).toEqual({ destino: { pantalla: 'actividad' } });
  });

  it('un push sin pantalla, o sin datos, no lleva a nada', () => {
    expect(toqueDeAviso({ url: '/', tipo: 'qr_cobro', aviso: 'aviso-2' })).toBeNull();
    expect(toqueDeAviso(undefined)).toBeNull();
    expect(toqueDeAviso({})).toBeNull();
  });
});

describe('el toque que llega antes de que haya quien lo atienda', () => {
  afterEach(() => reiniciarToquesParaPruebas());

  it('queda guardado y se entrega una sola vez al primero que se suscribe', () => {
    publicarToqueDeAviso({ destino: { pantalla: 'seguridad' }, aviso: 'a1' });
    const primero = vi.fn();
    const quitar = suscribirToqueDeAviso(primero);
    expect(primero).toHaveBeenCalledWith({ destino: { pantalla: 'seguridad' }, aviso: 'a1' });
    quitar();

    const segundo = vi.fn();
    suscribirToqueDeAviso(segundo);
    expect(segundo).not.toHaveBeenCalled();
  });

  it('con alguien suscrito se entrega en el momento, y al soltarlo deja de llegar', () => {
    const fn = vi.fn();
    const quitar = suscribirToqueDeAviso(fn);
    publicarToqueDeAviso({ destino: { pantalla: 'actividad' } });
    expect(fn).toHaveBeenCalledTimes(1);
    quitar();
    publicarToqueDeAviso({ destino: { pantalla: 'actividad' } });
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
