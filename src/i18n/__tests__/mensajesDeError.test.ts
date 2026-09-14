import es from '../languages/es';
import en from '../languages/en';
import fr from '../languages/fr';
import { fijarDiccionarioActivo, mensajeDelCliente, mensajeDelServidor } from '../mensajesDeError';

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
});
