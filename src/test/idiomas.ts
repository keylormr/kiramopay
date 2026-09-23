import { loadLanguage, type Language } from '@/i18n/translations';

/**
 * Carga un idioma antes de pintar la pantalla que lo usa.
 *
 * El espanol va dentro del paquete; los demas idiomas llegan en su propio trozo
 * y el LanguageProvider los pide al montarse. La primera carga de la corrida
 * puede tardar mas que el segundo que espera findByText —con la suite completa
 * en paralelo llego a 1,5 s— y la prueba fallaba sin que la pantalla tuviera
 * nada mal. Precargado, el modulo ya esta en cache cuando el LanguageProvider
 * lo pide y el texto llega sin carrera.
 *
 * Uso: `beforeAll(() => precargarIdioma('en'));`
 */
export async function precargarIdioma(idioma: Language): Promise<void> {
  await loadLanguage(idioma);
}
