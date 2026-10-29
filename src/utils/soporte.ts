// El correo de soporte es el unico canal para escribirle a una persona del
// equipo: el chat en vivo no existe. Esta es la unica direccion que conoce la
// app; los textos de los idiomas (src/i18n/languages) la repiten porque son
// frases completas, y la prueba src/i18n/__tests__/soporte.test.ts vigila que
// digan la misma.
export const CORREO_SOPORTE = 'soporte@kiramopay.com';

/** Abre el programa de correo de la persona con soporte como destinatario. */
export const ENLACE_SOPORTE = `mailto:${CORREO_SOPORTE}`;
