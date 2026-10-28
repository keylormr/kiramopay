import es from '@/i18n/languages/es';
import en from '@/i18n/languages/en';
import fr from '@/i18n/languages/fr';
import pt from '@/i18n/languages/pt';
import zh from '@/i18n/languages/zh-cn';
import ja from '@/i18n/languages/ja';
import hi from '@/i18n/languages/hi';
import { CLAVES_DEL_PERFIL_DE_COMERCIO, mensajeDelPerfilDeComercio } from '../erroresDeComercio';

// Registrar o editar un comercio mostraba `res.error.message`: el texto del
// servidor, en ingles ("invalid merchant category", "cedula is required"), en
// medio de una pantalla en cualquier otro idioma. Y para INVALID_CATEGORY la app
// no tenia texto. Cada rechazo conocido sale con su texto, en el idioma de la
// app; lo que no se conoce cae al generico de la pantalla.

const diccionarios: Array<[string, Record<string, string>]> = [
  ['es', es as unknown as Record<string, string>],
  ['en', en as unknown as Record<string, string>],
  ['fr', fr as unknown as Record<string, string>],
  ['pt', pt as unknown as Record<string, string>],
  ['zh-cn', zh as unknown as Record<string, string>],
  ['ja', ja as unknown as Record<string, string>],
  ['hi', hi as unknown as Record<string, string>],
];

const traducir = (d: Record<string, string>) => (clave: string) => d[clave] ?? clave;

const CODIGOS_DEL_SERVIDOR = [
  'INVALID_CATEGORY',
  'MERCHANT_NAME_REQUIRED',
  'MERCHANT_CEDULA_REQUIRED',
  'MERCHANT_LEGAL_NAME_REQUIRED',
  'MERCHANT_CEDULA_TYPE_INVALID',
  'MERCHANT_FIELD_TOO_LONG',
  'MERCHANT_DUPLICATE',
  'MERCHANT_CLOSED',
];

describe('mensajeDelPerfilDeComercio', () => {
  it('conoce todos los codigos que responde el servidor al registrar o editar', () => {
    expect(Object.keys(CLAVES_DEL_PERFIL_DE_COMERCIO).sort()).toEqual([...CODIGOS_DEL_SERVIDOR].sort());
  });

  it.each(diccionarios)('%s: cada codigo tiene un texto propio, no la clave ni el generico', (_idioma, d) => {
    const t = traducir(d);
    const genericos = new Set([t('merchant_register_error'), t('assistant_action_failed')]);
    for (const codigo of CODIGOS_DEL_SERVIDOR) {
      const texto = mensajeDelPerfilDeComercio(t, { code: codigo, message: 'texto del servidor' }, 'merchant_register_error');
      expect(texto.trim(), codigo).not.toBe('');
      expect(texto, codigo).not.toBe('texto del servidor');
      expect(texto, codigo).not.toMatch(/^(merchant|business)_/);
      expect(genericos.has(texto), codigo).toBe(false);
    }
  });

  it('INVALID_CATEGORY se dice en el idioma de la app y no con el texto del servidor', () => {
    const t = traducir(es as unknown as Record<string, string>);
    expect(mensajeDelPerfilDeComercio(t, { code: 'INVALID_CATEGORY', message: 'invalid merchant category' }, 'merchant_register_error'))
      .toBe('Elige una de las categorías de la lista.');
  });

  it('un codigo que no conoce cae al generico de la pantalla, nunca al texto del servidor', () => {
    const t = traducir(es as unknown as Record<string, string>);
    expect(mensajeDelPerfilDeComercio(t, { code: 'REGISTER_FAILED', message: 'ERROR: relation "x" does not exist' }, 'merchant_register_error'))
      .toBe('No se pudo registrar el comercio');
    expect(mensajeDelPerfilDeComercio(t, undefined, 'assistant_action_failed')).toBe('No se pudo completar la acción');
  });

  it('el aviso que ya trae traducido el cliente (sin red) se respeta', () => {
    const t = traducir(es as unknown as Record<string, string>);
    expect(mensajeDelPerfilDeComercio(t, { code: 'NETWORK_ERROR', message: 'Sin conexión' }, 'merchant_register_error'))
      .toBe('Sin conexión');
  });
});
