import {
  CATEGORIAS_MOVIMIENTO,
  estiloDeCategoria,
  etiquetaDeCategoria,
  normalizarCategoria,
} from '../categoriaMovimiento';

// "Todos los movimientos" tenia llaves en ingles ('Transfer', 'Services') que no
// coincidian con ningun slug del adaptador: todas las filas salian con el
// circulo gris y los chips imprimian "transfers" u "other" sin traducir.

describe('categoriaMovimiento', () => {
  it('reconoce cada slug que emite el adaptador', () => {
    for (const categoria of CATEGORIAS_MOVIMIENTO) {
      expect(normalizarCategoria(categoria)).toBe(categoria);
    }
  });

  it('lo desconocido o ausente es "otros", nunca el slug crudo', () => {
    expect(normalizarCategoria('savings_deposit')).toBe('other');
    expect(normalizarCategoria(undefined)).toBe('other');
    expect(normalizarCategoria('')).toBe('other');
  });

  it('acepta los nombres heredados de los datos simulados', () => {
    expect(normalizarCategoria('Transfer')).toBe('transfers');
    expect(normalizarCategoria('SINPE')).toBe('transfers');
    expect(normalizarCategoria('QR Payment')).toBe('shopping');
  });

  it('cada categoria tiene su propio icono', () => {
    const iconos = new Set(CATEGORIAS_MOVIMIENTO.map((c) => estiloDeCategoria(c).icon));
    expect(iconos.size).toBe(CATEGORIAS_MOVIMIENTO.length);
  });

  it('la etiqueta pasa por el diccionario', () => {
    const t = (clave: string) => `[${clave}]`;
    expect(etiquetaDeCategoria('transfers', t)).toBe('[analytics_cat_transfers]');
    expect(etiquetaDeCategoria('lo-que-sea', t)).toBe('[analytics_cat_other]');
  });
});
