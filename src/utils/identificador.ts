// Clasificador del identificador de login: un solo campo acepta nombre de
// usuario, cedula, correo o telefono. Refleja EXACTAMENTE las reglas del
// backend (backend/pkg/identifier): empieza por letra y calza
// [a-z][a-z0-9._-]{2,19} = nombre de usuario (lower/trim); contiene '@' =
// correo (lower/trim); tras quitar espacios, guiones y puntos: 8 digitos o
// 506+8 = telefono (+506XXXXXXXX, via normalizarTelefonoCR); 9-12 digitos =
// cedula (solo digitos). La ambiguedad de 11 digitos que empiezan en 506 se
// resuelve a favor del telefono, en ambos lados por igual.
//
// Los cuatro espacios son DISJUNTOS a proposito: el nombre de usuario exige
// empezar por letra, asi que no puede confundirse con una cedula ni con un
// telefono, y su alfabeto no admite '@', asi que tampoco con un correo. Si
// fuera un comodin, cualquier cadena tecleada saldria hacia el servidor y
// alguien podria registrar el usuario "702650930" para chocar con la cedula
// de otra persona.
import { normalizarTelefonoCR } from './telefono';

export type TipoIdentificador = 'usuario' | 'cedula' | 'correo' | 'telefono';

export interface IdentificadorClasificado {
  tipo: TipoIdentificador;
  canonico: string;
}

const CORREO_VALIDO = /^\S+@\S+\.\S+$/;
const USUARIO_VALIDO = /^[a-z][a-z0-9._-]{2,19}$/;

/** Misma regla que identifier.ValidUsername del backend, sobre un valor ya canonico. */
export function esNombreDeUsuarioValido(canonico: string): boolean {
  return USUARIO_VALIDO.test(canonico);
}

export function clasificarIdentificador(entrada: string): IdentificadorClasificado | null {
  const s = entrada.trim();
  if (!s || s.length > 254) return null;

  // Primero el nombre de usuario, por regla POSITIVA: si empieza por letra no
  // puede ser ninguno de los otros tres.
  const minusculas = s.toLowerCase();
  if (USUARIO_VALIDO.test(minusculas)) return { tipo: 'usuario', canonico: minusculas };

  if (s.includes('@')) {
    const canonico = s.toLowerCase();
    return CORREO_VALIDO.test(canonico) ? { tipo: 'correo', canonico } : null;
  }

  const limpio = s.replace(/[\s.-]/g, '');
  const sinMas = limpio.startsWith('+') ? limpio.slice(1) : limpio;
  if (!/^\d+$/.test(sinMas)) return null;

  // El telefono se prueba primero: 506XXXXXXXX pelado (11 digitos) es
  // telefono, no cedula, igual que en el backend.
  const telefono = normalizarTelefonoCR(limpio);
  if (telefono) return { tipo: 'telefono', canonico: telefono };
  if (limpio.startsWith('+')) return null;
  if (sinMas.length >= 9 && sinMas.length <= 12) {
    return { tipo: 'cedula', canonico: sinMas };
  }
  return null;
}
