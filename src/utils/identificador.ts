// Clasificador del identificador de login: un solo campo acepta cedula,
// correo o telefono. Refleja EXACTAMENTE las reglas del backend
// (backend/pkg/identifier): contiene '@' = correo (lower/trim); tras quitar
// espacios, guiones y puntos: 8 digitos o 506+8 = telefono (+506XXXXXXXX,
// via normalizarTelefonoCR); 9-12 digitos = cedula (solo digitos). La
// ambiguedad de 11 digitos que empiezan en 506 se resuelve a favor del
// telefono, en ambos lados por igual.
import { normalizarTelefonoCR } from './telefono';

export type TipoIdentificador = 'cedula' | 'correo' | 'telefono';

export interface IdentificadorClasificado {
  tipo: TipoIdentificador;
  canonico: string;
}

const CORREO_VALIDO = /^\S+@\S+\.\S+$/;

export function clasificarIdentificador(entrada: string): IdentificadorClasificado | null {
  const s = entrada.trim();
  if (!s || s.length > 254) return null;

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
