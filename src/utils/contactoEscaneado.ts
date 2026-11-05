import type { SinpeContact } from '@/types/sinpe.types';
import type { ContactQrPayload } from '@/utils/contactQr';
import { formatearTelefonoCR, mismoTelefonoCR } from '@/utils/telefono';

/**
 * Lo que la app puede decir de un QR de contacto SIN servidor.
 *
 * El nombre de un QR de contacto lo escribe quien lo creo y nadie lo comprueba:
 * un QR "de Mama" con el numero de otra persona llega por chat igual que uno de
 * verdad, y con una imagen de chat esa suplantacion es mucho mas facil que con
 * una camara frente a frente. Lo unico que se puede contrastar es lo que la
 * persona YA guardo. Comprobar el nombre contra el numero registrado en
 * KiramoPay exigiria un endpoint nuevo que devuelva nombres por telefono, con su
 * costo de privacidad: queda como decision aparte.
 */
export interface EvaluacionDeContacto {
  /**
   * El nombre que se muestra: el del contacto GUARDADO bajo ese numero si lo hay
   * (lo escribio la persona), y si no el del QR.
   */
  nombre: string;
  /** El nombre es el que trae el QR y nadie lo comprobo. */
  nombreSinVerificar: boolean;
  /** Un contacto guardado con ese MISMO nombre y OTRO numero. */
  homonimo?: SinpeContact;
}

/**
 * El nombre tal como se LEE: sin mayusculas, sin tildes, con los espacios
 * colapsados y sin los caracteres que no se ven. "  MAMA " es igual a "Mama", a
 * "Mam<ancho cero>a" y a las letras de ancho completo. Sin esto un QR con un
 * caracter invisible de mas se veria igual que el contacto guardado y esquivaria
 * el aviso. NFKD descompone ademas las formas de compatibilidad; no cubre las
 * letras de otro alfabeto que se parecen (una "a" cirilica): eso pide una tabla
 * de confusables y queda fuera.
 */
export function nombreComparable(nombre: string): string {
  return nombre
    .normalize('NFKD')
    .replace(/[\p{M}\p{Cf}]/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * El texto del aviso de homonimo con el nombre y el numero ya puestos. Una sola
 * pasada y con funcion de reemplazo: el nombre de un contacto lo escribe
 * cualquiera, y con replace(texto, cadena) un "$&" o un "$'" se interpretan, y
 * un "{telefono}" dentro del nombre se volveria a sustituir.
 */
export function avisoDeHomonimo(plantilla: string, homonimo: SinpeContact): string {
  const datos = { nombre: homonimo.name, telefono: formatearTelefonoCR(homonimo.phone) };
  return plantilla.replace(/\{(nombre|telefono)\}/g, (_, clave: 'nombre' | 'telefono') => datos[clave]);
}

export function evaluarContactoEscaneado(
  contacto: ContactQrPayload,
  guardados: SinpeContact[],
): EvaluacionDeContacto {
  const conEseNumero = guardados.find((c) => mismoTelefonoCR(c.phone, contacto.phone));
  if (conEseNumero) {
    return { nombre: conEseNumero.name, nombreSinVerificar: false, homonimo: undefined };
  }
  const nombre = nombreComparable(contacto.name);
  const homonimo = nombre
    ? guardados.find((c) => nombreComparable(c.name) === nombre)
    : undefined;
  return { nombre: contacto.name, nombreSinVerificar: true, homonimo };
}
