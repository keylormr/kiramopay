import es from '@/i18n/languages/es';
import en from '@/i18n/languages/en';
import { mensajeDeCobro } from '../erroresQr';

// Solo seis codigos se traducian: QR_INVALIDO o NO_PODES_PAGARTE caian al texto
// del servidor, que existe solo en espanol ("no podes pagarte a vos mismo"), y
// con la app en ingles el motivo salia sin traducir.

const traductor = (diccionario: Record<string, string>) => (clave: string) => diccionario[clave] ?? clave;

describe('mensajeDeCobro', () => {
  it.each([
    ['QR_INVALIDO', 'qr_err_invalido'],
    ['NO_PODES_PAGARTE', 'qr_err_pago_propio'],
    ['MONTO_REQUERIDO', 'qr_err_monto_requerido'],
    ['LLAVE_REUTILIZADA', 'qr_err_llave_reutilizada'],
    ['LLAVE_INVALIDA', 'qr_err_llave_invalida'],
    ['PAGO_NO_REGISTRADO', 'qr_err_pago_no_registrado'],
    ['MFA_REQUIRED', 'qr_err_mfa'],
    ['QR_REVOCADO', 'qr_err_revocado'],
  ])('traduce %s', (codigo, clave) => {
    const t = traductor(en as unknown as Record<string, string>);
    const texto = mensajeDeCobro(t, codigo);
    expect(texto).toBe((en as unknown as Record<string, string>)[clave]);
    expect(texto).not.toBe(clave);
  });

  it('en espanol usa tuteo, no el voseo del servidor', () => {
    const t = traductor(es as unknown as Record<string, string>);
    expect(mensajeDeCobro(t, 'NO_PODES_PAGARTE')).toBe('No puedes pagarte a ti mismo.');
  });

  it('un codigo desconocido devuelve vacio para que la vista use su generico', () => {
    expect(mensajeDeCobro(traductor({}), 'OTRA_COSA')).toBe('');
    expect(mensajeDeCobro(traductor({}))).toBe('');
  });
});
