/**
 * El idioma de la persona, antes de que React exista.
 *
 * Lo necesitan quien pinta primero (LanguageProvider, la pantalla de error, la
 * precarga de index.tsx) y quien habla con el servidor fuera de React (el
 * adaptador de avisos): todos tienen que llegar a la misma respuesta. En orden:
 *
 *   1. El que la persona ELIGIO en este dispositivo.
 *   2. El que tiene su cuenta (lo recuerda el dispositivo al entrar: la pantalla
 *      de arranque corre antes de saber quien es). Un idioma que solo adivino el
 *      navegador no manda sobre el de la cuenta.
 *   3. El del navegador.
 *   4. Espanol.
 */
import { LANGUAGES, type Language } from './translations';

const CLAVE_ELECCION = 'kiramopay_language';
const CLAVE_CUENTA = 'kiramopay_language_account';

function esIdioma(valor: string | null): valor is Language {
  return valor !== null && LANGUAGES.some((l) => l.code === valor);
}

// localStorage puede no estar (navegacion privada, previews) o lanzar: sin el,
// la app sigue con el del navegador.
function leer(clave: string): string | null {
  try {
    return localStorage.getItem(clave);
  } catch {
    return null;
  }
}

/** La eleccion que la persona guardo en este dispositivo, si hay una. */
export function eleccionGuardada(): Language | null {
  const guardado = leer(CLAVE_ELECCION);
  // Quien eligio el chino tradicional, ya retirado, pasa al simplificado.
  if (guardado === 'zh-tw') return 'zh-cn';
  return esIdioma(guardado) ? guardado : null;
}

/** El idioma que la cuenta tenia la ultima vez que se supo, si se supo. */
export function idiomaRecordadoDeLaCuenta(): Language | null {
  const guardado = leer(CLAVE_CUENTA);
  return esIdioma(guardado) ? guardado : null;
}

export function recordarIdiomaDeLaCuenta(idioma: Language): void {
  try {
    localStorage.setItem(CLAVE_CUENTA, idioma);
  } catch {
    /* sin almacenamiento, el recuerdo no se guarda */
  }
}

export function guardarEleccion(idioma: Language): void {
  try {
    localStorage.setItem(CLAVE_ELECCION, idioma);
  } catch {
    /* idem */
  }
}

/** El idioma que habla el navegador, si la app lo tiene. */
export function idiomaDelNavegador(): Language {
  const navegador = (typeof navigator !== 'undefined' ? navigator.language : '').toLowerCase();
  if (navegador.startsWith('es')) return 'es';
  if (navegador.startsWith('en')) return 'en';
  if (navegador.startsWith('fr')) return 'fr';
  if (navegador.startsWith('pt')) return 'pt';
  if (navegador.startsWith('zh')) return 'zh-cn';
  if (navegador.startsWith('ja')) return 'ja';
  if (navegador.startsWith('hi')) return 'hi';
  return 'es';
}

/** El idioma con el que arranca la app (ver el orden arriba). */
export function idiomaInicial(): Language {
  return eleccionGuardada() ?? idiomaRecordadoDeLaCuenta() ?? idiomaDelNavegador();
}
