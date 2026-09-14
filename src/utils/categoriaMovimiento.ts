import type { LucideIcon } from 'lucide-react';
import { Icons } from '@/components/Icons';

/**
 * Categoria de un movimiento: su icono, su color y su nombre en pantalla.
 *
 * Las categorias reales son los slugs que emite `mapCategory` en
 * api/adapters/http/transaction.http.ts. "Todos los movimientos" tenia su propio
 * mapa con nombres en ingles ('Transfer', 'QR Payment', 'Services'...) que no
 * coincidia con ninguno: todas las filas caian al circulo gris y los chips
 * imprimian el slug crudo ("transfers", "other"). Analisis de gastos ya habia
 * sufrido y corregido el mismo defecto; este modulo es el lugar comun para que
 * no vuelvan a separarse. Los colores son los de Analisis.
 */
export const CATEGORIAS_MOVIMIENTO = ['transfers', 'services', 'shopping', 'income', 'cash', 'other'] as const;
export type CategoriaMovimiento = (typeof CATEGORIAS_MOVIMIENTO)[number];

export interface EstiloCategoria {
  icon: LucideIcon;
  /** Fondo del icono. */
  bg: string;
  /** Color del icono y de la etiqueta. */
  text: string;
}

const ESTILOS: Record<CategoriaMovimiento, EstiloCategoria> = {
  // Hoy toda transferencia es SINPE (sinpe_send / sinpe_receive): lleva el
  // mismo telefono que la pestana SINPE.
  transfers: { icon: Icons.Smartphone, bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-700 dark:text-blue-300' },
  services: { icon: Icons.Zap, bg: 'bg-amber-100 dark:bg-amber-900/30', text: 'text-amber-700 dark:text-amber-300' },
  shopping: { icon: Icons.ShoppingCart, bg: 'bg-pink-100 dark:bg-pink-900/30', text: 'text-pink-700 dark:text-pink-300' },
  income: { icon: Icons.ArrowDownLeft, bg: 'bg-emerald-100 dark:bg-emerald-900/30', text: 'text-emerald-700 dark:text-emerald-300' },
  cash: { icon: Icons.Banknote, bg: 'bg-teal-100 dark:bg-teal-900/30', text: 'text-teal-700 dark:text-teal-300' },
  other: {
    icon: Icons.Receipt,
    bg: 'bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)]',
    text: 'uv-text-secondary',
  },
};

// Nombres heredados (datos simulados y filas viejas) que designan una categoria
// conocida. Todo lo demas es "otros": nunca un slug crudo en pantalla.
const ALIAS: Record<string, CategoriaMovimiento> = {
  transfer: 'transfers',
  sinpe: 'transfers',
  service: 'services',
  servicios: 'services',
  recharge: 'services',
  recarga: 'services',
  'qr payment': 'shopping',
  qr_payment: 'shopping',
  compras: 'shopping',
  deposit: 'income',
  ingresos: 'income',
  withdrawal: 'cash',
  efectivo: 'cash',
};

export function normalizarCategoria(categoria?: string): CategoriaMovimiento {
  const clave = (categoria ?? '').trim().toLowerCase();
  if ((CATEGORIAS_MOVIMIENTO as readonly string[]).includes(clave)) return clave as CategoriaMovimiento;
  return ALIAS[clave] ?? 'other';
}

export function estiloDeCategoria(categoria?: string): EstiloCategoria {
  return ESTILOS[normalizarCategoria(categoria)];
}

export function etiquetaDeCategoria(categoria: string | undefined, t: (clave: string) => string): string {
  return t(`analytics_cat_${normalizarCategoria(categoria)}`);
}
