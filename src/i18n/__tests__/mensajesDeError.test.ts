import es from '../languages/es';
import en from '../languages/en';
import fr from '../languages/fr';
import { fijarDiccionarioActivo, mensajeDeRechazo, mensajeDelCliente, mensajeDelServidor } from '../mensajesDeError';

// El cliente HTTP fabricaba "Network request failed. Check your connection." en
// ingles, y las vistas lo pintaban tal cual: con la app en frances, el aviso de
// red salia en ingles en medio de una pantalla en frances.

describe('mensajesDeError', () => {
  afterEach(() => {
    fijarDiccionarioActivo(es);
  });

  it('los avisos que arma el cliente salen en el idioma activo', () => {
    expect(mensajeDelCliente('NETWORK_ERROR')).toBe(es.err_network);

    fijarDiccionarioActivo(fr);
    expect(mensajeDelCliente('NETWORK_ERROR')).toBe(fr.err_network);
    expect(mensajeDelCliente('SESSION_EXPIRED')).toBe(fr.err_session_expired);
    expect(mensajeDelCliente('RATE_LIMITED')).toBe(fr.err_rate_limited);
    expect(mensajeDelCliente('NETWORK_ERROR')).not.toMatch(/network request failed/i);
  });

  it('respeta el texto de un rechazo 4xx que el servidor redacto', () => {
    expect(mensajeDelServidor(409, 'COBRO_VENCIDO', 'ese cobro vencio')).toBe('ese cobro vencio');
  });

  it('traduce lo que el servidor no escribe para una persona', () => {
    fijarDiccionarioActivo(en);
    expect(mensajeDelServidor(500, 'INTERNAL_ERROR', 'internal server error')).toBe(en.err_server);
    expect(mensajeDelServidor(400, 'INVALID_REQUEST', 'invalid request')).toBe(en.err_invalid_request);
    expect(mensajeDelServidor(400, 'INVALID_BODY', 'invalid request body')).toBe(en.err_invalid_request);
    expect(mensajeDelServidor(404, 'HTTP_ERROR', '')).toBe(en.err_generic);
    expect(mensajeDelServidor(404, 'HTTP_ERROR')).not.toMatch(/request failed with status/i);
  });

  describe('mensajeDeRechazo', () => {
    const t = (clave: string) => `[${clave}]`;
    const claves = { BUDGET_NOT_FOUND: 'budget_err_not_found' };

    it('un codigo del modulo sale con su clave, nunca con el texto del servidor', () => {
      expect(mensajeDeRechazo({ code: 'BUDGET_NOT_FOUND', message: 'budget not found' }, claves, 'budget_err_save', t)).toBe(
        '[budget_err_not_found]',
      );
    });

    it('un codigo desconocido cae al generico del modulo', () => {
      expect(mensajeDeRechazo({ code: 'B2B_NOT_FOUND', message: 'resource not found' }, claves, 'budget_err_save', t)).toBe(
        '[budget_err_save]',
      );
      expect(mensajeDeRechazo(undefined, claves, 'budget_err_save', t)).toBe('[budget_err_save]');
      // "toString" existe en cualquier objeto: no es un codigo del modulo.
      expect(mensajeDeRechazo({ code: 'toString', message: 'x' }, claves, 'budget_err_save', t)).toBe('[budget_err_save]');
    });

    it('respeta lo que el cliente ya tradujo', () => {
      expect(mensajeDeRechazo({ code: 'NETWORK_ERROR', message: es.err_network }, claves, 'budget_err_save', t)).toBe(
        es.err_network,
      );
      expect(mensajeDeRechazo({ code: 'INVALID_BODY', message: es.err_invalid_request }, claves, 'budget_err_save', t)).toBe(
        es.err_invalid_request,
      );
      expect(mensajeDeRechazo({ code: 'RATE_LIMITED', message: '' }, claves, 'budget_err_save', t)).toBe('[budget_err_save]');
    });
  });
});
