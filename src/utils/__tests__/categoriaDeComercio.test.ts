import es from '@/i18n/languages/es';
import en from '@/i18n/languages/en';
import fr from '@/i18n/languages/fr';
import pt from '@/i18n/languages/pt';
import zh from '@/i18n/languages/zh-cn';
import ja from '@/i18n/languages/ja';
import hi from '@/i18n/languages/hi';
import { CATEGORIAS_DE_COMERCIO, categoriaDeComercio } from '../categoriaDeComercio';

// El servidor guardaba cualquier categoria y la pantalla armaba la clave de
// traduccion con ella: un comercio con "other" mostraba `merchant_cat_other`
// tal cual en el panel de verificacion. La etiqueta sale de un solo lugar y
// cae a "Otro" cuando la categoria no tiene traduccion.

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

describe('categoriaDeComercio', () => {
  it('ofrece las cinco categorias que acepta el servidor', () => {
    expect([...CATEGORIAS_DE_COMERCIO]).toEqual(['restaurant', 'retail', 'services', 'food_truck', 'market']);
  });

  it('traduce una categoria conocida', () => {
    const t = traducir(es as unknown as Record<string, string>);
    expect(categoriaDeComercio(t, 'restaurant')).toBe('Restaurante');
    expect(categoriaDeComercio(t, 'food_truck')).toBe('Food truck');
  });

  it.each(['other', 'bar', '', 'Restaurant', 'merchant_cat_x'])(
    'una categoria sin traduccion (%j) cae a Otro y nunca a la clave cruda',
    (categoria) => {
      const t = traducir(es as unknown as Record<string, string>);
      const texto = categoriaDeComercio(t, categoria);
      expect(texto).toBe('Otro');
      expect(texto).not.toMatch(/merchant_cat_/);
    },
  );

  it.each(diccionarios)('%s: toda categoria conocida y la de respaldo tienen texto', (_idioma, d) => {
    const t = traducir(d);
    for (const c of [...CATEGORIAS_DE_COMERCIO, 'other', 'desconocida']) {
      const texto = categoriaDeComercio(t, c);
      expect(texto.trim()).not.toBe('');
      expect(texto).not.toMatch(/merchant_cat_/);
    }
  });
});
