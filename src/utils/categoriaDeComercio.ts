// La categoria de un comercio. El servidor solo acepta estas cinco al registrar
// y al editar, pero guarda lo que haya en las filas anteriores a esa validacion
// (por ejemplo "other"), y la pantalla arma la clave de traduccion con la
// categoria: una sin traduccion se mostraba como la clave cruda
// ("merchant_cat_other"). La etiqueta sale de un solo lugar.
export const CATEGORIAS_DE_COMERCIO = ['restaurant', 'retail', 'services', 'food_truck', 'market'] as const;

export type CategoriaDeComercio = (typeof CATEGORIAS_DE_COMERCIO)[number];

/**
 * El texto de una categoria. Una categoria sin traduccion (una fila vieja, o
 * una que esta app todavia no conoce) cae a "Otro", nunca a la clave cruda.
 */
export function categoriaDeComercio(t: (clave: string) => string, categoria: string): string {
  const clave = `merchant_cat_${categoria}`;
  const texto = t(clave);
  return texto !== clave ? texto : t('merchant_cat_other');
}
