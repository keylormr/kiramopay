import es from '@/i18n/languages/es';
import en from '@/i18n/languages/en';
import jaDic from '@/i18n/languages/ja';
import { codigoDeCobroCerrado, mensajeDeCobro, textoDeDuracion } from '../erroresQr';

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

  // La lista de quien paga se llama "Transacciones recientes", y los otros
  // seis idiomas ya decían transacciones.
  it.each(['LLAVE_REUTILIZADA', 'PAGO_NO_REGISTRADO'])('en espanol, %s remite a las transacciones', (codigo) => {
    const t = traductor(es as unknown as Record<string, string>);
    expect(mensajeDeCobro(t, codigo)).toMatch(/Revisa tus transacciones antes de intentar de nuevo/);
  });

  it('un codigo desconocido devuelve vacio para que la vista use su generico', () => {
    expect(mensajeDeCobro(traductor({}), 'OTRA_COSA')).toBe('');
    expect(mensajeDeCobro(traductor({}))).toBe('');
  });
});

// La hoja de pago recibe el estado del cobro en /qr/resolve y lo descartaba:
// un cobro ya pagado se veia vigente hasta tocar Pagar.
describe('codigoDeCobroCerrado', () => {
  it.each([
    ['paid', 'COBRO_YA_PAGADO', 'Ese cobro ya fue pagado.'],
    ['cancelled', 'COBRO_CANCELADO', 'Ese cobro fue cancelado.'],
    ['expired', 'COBRO_VENCIDO', 'Ese cobro venció.'],
    ['superseded', 'COBRO_REEMPLAZADO', 'El cobro cambió. Vuelve a escanear.'],
  ])('%s se avisa con el mismo codigo que usaria el servidor', (estado, codigo, texto) => {
    expect(codigoDeCobroCerrado(estado)).toBe(codigo);
    const t = traductor(es as unknown as Record<string, string>);
    expect(mensajeDeCobro(t, codigoDeCobroCerrado(estado))).toBe(texto);
  });

  it('un cobro pendiente o un estado desconocido no se bloquea: decide el servidor', () => {
    expect(codigoDeCobroCerrado('pending')).toBe('');
    expect(codigoDeCobroCerrado('otro')).toBe('');
    expect(codigoDeCobroCerrado(undefined)).toBe('');
  });
});

// "Vence en 1440 min": un cobro de un dia se leia en minutos. La duracion se
// escribe en la unidad que se lee de un vistazo, con las abreviaturas de cada
// idioma.
describe('textoDeDuracion', () => {
  const enEspanol = traductor(es as unknown as Record<string, string>);
  const enIngles = traductor(en as unknown as Record<string, string>);

  it.each([
    [1, '1 min'],
    [20, '20 min'],
    [59, '59 min'],
    [60, '1 h'],
    [90, '1 h 30 min'],
    [1440, '24 h'],
    [1500, '25 h'],
    [2880, '48 h'],
  ])('%i minutos en espanol: %s', (minutos, texto) => {
    expect(textoDeDuracion(minutos, enEspanol)).toBe(texto);
  });

  it('usa las unidades del idioma', () => {
    expect(textoDeDuracion(1440, enIngles)).toBe('24 h');
    const ja = traductor(jaDic as unknown as Record<string, string>);
    expect(textoDeDuracion(90, ja)).toBe('1 時間 30 分');
  });

  it('cero o un valor que no sirve se lee como 0 min, no como NaN', () => {
    expect(textoDeDuracion(0, enEspanol)).toBe('0 min');
    expect(textoDeDuracion(Number.NaN, enEspanol)).toBe('0 min');
    expect(textoDeDuracion(-5, enEspanol)).toBe('0 min');
  });
});
