// Arte 3D en uso (paquete de 2026-11-06, vidrio oscuro). Cada archivo se importa
// a mano: Vite solo copia al build lo que se importa, y el resto del paquete
// convertido espera en src/assets/arte-3d/ hasta que una pantalla lo necesite
// (la tabla completa esta en src/assets/arte-3d/README.md).
//
// Iconos: 64 y 128 px. Se muestran entre 28 y 44 px, asi que la de 128 cubre
// las pantallas de densidad 3. La de 256 existe en el repo y entra solo cuando
// una pantalla muestre el icono a mas de 44 px.
// Ilustraciones: 480 y 960 px.

import c0_64 from '@/assets/arte-3d/iconos/c0-comida-64.webp';
import c0_128 from '@/assets/arte-3d/iconos/c0-comida-128.webp';
import c1_64 from '@/assets/arte-3d/iconos/c1-transporte-64.webp';
import c1_128 from '@/assets/arte-3d/iconos/c1-transporte-128.webp';
import c2_64 from '@/assets/arte-3d/iconos/c2-supermercado-64.webp';
import c2_128 from '@/assets/arte-3d/iconos/c2-supermercado-128.webp';
import c3_64 from '@/assets/arte-3d/iconos/c3-entretenimiento-64.webp';
import c3_128 from '@/assets/arte-3d/iconos/c3-entretenimiento-128.webp';
import s0_64 from '@/assets/arte-3d/iconos/s0-luz-64.webp';
import s0_128 from '@/assets/arte-3d/iconos/s0-luz-128.webp';
import s1_64 from '@/assets/arte-3d/iconos/s1-agua-64.webp';
import s1_128 from '@/assets/arte-3d/iconos/s1-agua-128.webp';
import s2_64 from '@/assets/arte-3d/iconos/s2-telefonia-64.webp';
import s2_128 from '@/assets/arte-3d/iconos/s2-telefonia-128.webp';
import s3_64 from '@/assets/arte-3d/iconos/s3-internet-64.webp';
import s3_128 from '@/assets/arte-3d/iconos/s3-internet-128.webp';
import s4_64 from '@/assets/arte-3d/iconos/s4-cable-64.webp';
import s4_128 from '@/assets/arte-3d/iconos/s4-cable-128.webp';
import s5_64 from '@/assets/arte-3d/iconos/s5-recarga-64.webp';
import s5_128 from '@/assets/arte-3d/iconos/s5-recarga-128.webp';
import s6_64 from '@/assets/arte-3d/iconos/s6-factura-64.webp';
import s6_128 from '@/assets/arte-3d/iconos/s6-factura-128.webp';
import m1_64 from '@/assets/arte-3d/iconos/m1-moneda-64.webp';
import m1_128 from '@/assets/arte-3d/iconos/m1-moneda-128.webp';
import m2_64 from '@/assets/arte-3d/iconos/m2-pila-64.webp';
import m2_128 from '@/assets/arte-3d/iconos/m2-pila-128.webp';
import f1_64 from '@/assets/arte-3d/iconos/f1-analisis-64.webp';
import f1_128 from '@/assets/arte-3d/iconos/f1-analisis-128.webp';
import f2_64 from '@/assets/arte-3d/iconos/f2-metas-64.webp';
import f2_128 from '@/assets/arte-3d/iconos/f2-metas-128.webp';
import f3_64 from '@/assets/arte-3d/iconos/f3-dividir-64.webp';
import f3_128 from '@/assets/arte-3d/iconos/f3-dividir-128.webp';
import f4_64 from '@/assets/arte-3d/iconos/f4-recompensas-64.webp';
import f4_128 from '@/assets/arte-3d/iconos/f4-recompensas-128.webp';
import f5_64 from '@/assets/arte-3d/iconos/f5-asistente-64.webp';
import f5_128 from '@/assets/arte-3d/iconos/f5-asistente-128.webp';
import f6_64 from '@/assets/arte-3d/iconos/f6-marketplace-64.webp';
import f6_128 from '@/assets/arte-3d/iconos/f6-marketplace-128.webp';
import f7_64 from '@/assets/arte-3d/iconos/f7-tarjetas-64.webp';
import f7_128 from '@/assets/arte-3d/iconos/f7-tarjetas-128.webp';
import f9_64 from '@/assets/arte-3d/iconos/f9-cripto-64.webp';
import f9_128 from '@/assets/arte-3d/iconos/f9-cripto-128.webp';
import f10_64 from '@/assets/arte-3d/iconos/f10-protegido-64.webp';
import f10_128 from '@/assets/arte-3d/iconos/f10-protegido-128.webp';
import e1_480 from '@/assets/arte-3d/ilustraciones/e1-enviado-480.webp';
import e1_960 from '@/assets/arte-3d/ilustraciones/e1-enviado-960.webp';
import e2_480 from '@/assets/arte-3d/ilustraciones/e2-pagado-480.webp';
import e2_960 from '@/assets/arte-3d/ilustraciones/e2-pagado-960.webp';
import v1_480 from '@/assets/arte-3d/ilustraciones/v1-movimientos-480.webp';
import v1_960 from '@/assets/arte-3d/ilustraciones/v1-movimientos-960.webp';

/** Ancho real en px de cada archivo -> su URL en el build. */
export type Fuentes = Readonly<Record<number, string>>;

export const ICONOS_3D = {
  comida: { 64: c0_64, 128: c0_128 },
  transporte: { 64: c1_64, 128: c1_128 },
  supermercado: { 64: c2_64, 128: c2_128 },
  entretenimiento: { 64: c3_64, 128: c3_128 },
  luz: { 64: s0_64, 128: s0_128 },
  agua: { 64: s1_64, 128: s1_128 },
  telefonia: { 64: s2_64, 128: s2_128 },
  internet: { 64: s3_64, 128: s3_128 },
  cable: { 64: s4_64, 128: s4_128 },
  recarga: { 64: s5_64, 128: s5_128 },
  factura: { 64: s6_64, 128: s6_128 },
  moneda: { 64: m1_64, 128: m1_128 },
  pila: { 64: m2_64, 128: m2_128 },
  analisis: { 64: f1_64, 128: f1_128 },
  metas: { 64: f2_64, 128: f2_128 },
  dividir: { 64: f3_64, 128: f3_128 },
  recompensas: { 64: f4_64, 128: f4_128 },
  asistente: { 64: f5_64, 128: f5_128 },
  mercado: { 64: f6_64, 128: f6_128 },
  tarjetas: { 64: f7_64, 128: f7_128 },
  cripto: { 64: f9_64, 128: f9_128 },
  protegido: { 64: f10_64, 128: f10_128 },
} as const satisfies Record<string, Fuentes>;

export const ILUSTRACIONES_3D = {
  envioListo: { 480: e1_480, 960: e1_960 },
  pagoListo: { 480: e2_480, 960: e2_960 },
  sinMovimientos: { 480: v1_480, 960: v1_960 },
} as const satisfies Record<string, Fuentes>;

export type NombreIcono3D = keyof typeof ICONOS_3D;
export type NombreIlustracion3D = keyof typeof ILUSTRACIONES_3D;
