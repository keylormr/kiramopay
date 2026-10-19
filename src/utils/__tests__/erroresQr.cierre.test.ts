import es from '@/i18n/languages/es';
import en from '@/i18n/languages/en';
import { mensajeDeCobro, mensajeDelRechazoDelCobro } from '../erroresQr';

// Un comercio cerrado responde MERCHANT_CLOSED al pagarle, al resolver su
// codigo y al emitir un cobro. La hoja de pago lo tiene que decir con su texto:
// sin traduccion caia al aviso generico de "no se pudo verificar".

const traductor = (diccionario: Record<string, string>) => (clave: string) => diccionario[clave] ?? clave;

describe('MERCHANT_CLOSED', () => {
  it('tiene texto propio en el pago y en la resolucion', () => {
    const t = traductor(en as unknown as Record<string, string>);
    const texto = mensajeDeCobro(t, 'MERCHANT_CLOSED');
    expect(texto).toBe((en as unknown as Record<string, string>).qr_err_comercio_cerrado);
    expect(texto).not.toBe('qr_err_comercio_cerrado');
  });

  it('y en el rechazo de un cobro', () => {
    const t = traductor(es as unknown as Record<string, string>);
    expect(mensajeDelRechazoDelCobro(t, { code: 'MERCHANT_CLOSED', message: 'merchant is closed' }, 'qr_err_generico'))
      .toBe('Este comercio cerró y ya no recibe pagos.');
  });
});
