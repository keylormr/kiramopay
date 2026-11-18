import type { VentaLightning } from '@/api/repositories/qrpayment.repository';

/**
 * Un cobro del comercio pagado por Lightning, como lo lee el contador: el
 * precio de la venta en la moneda del cobro (lo que cobro el cajero), los sats
 * que llegaron a la billetera propia y el precio del bitcoin con que se cotizo.
 * Salen del servidor, no del archivo del banco: ese bitcoin nunca paso por el.
 */
export interface CobroLightningDelMes {
  id: string;
  /** AAAA-MM-DD en la zona de la persona. */
  fecha: string;
  descripcion: string;
  /** Centimos enteros, como los ingresos del banco. */
  centimos: number;
  moneda: string;
  sats: number;
  /** Precio de 1 BTC en la moneda del cobro, texto decimal del servidor. */
  precioBtc: string;
}

/** El dia de un instante en la zona de la persona: el de UTC cambia de noche. */
export function fechaLocal(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Las ventas por Lightning de una moneda, de la mas vieja a la mas nueva. Un
 * resumen es de una moneda: colones y dolares no se suman. Sin nota, la venta
 * lleva un texto que dice que fue (`sinNota`).
 */
export function cobrosLightningDelMes(ventas: VentaLightning[], moneda: string, sinNota: string): CobroLightningDelMes[] {
  return ventas
    .filter((v) => v.currency === moneda)
    .map((v) => ({
      id: v.chargeId,
      fecha: fechaLocal(v.paidAt),
      descripcion: v.note.trim() || sinNota,
      // El adaptador lo dio en unidades mayores desde centimos enteros: el
      // redondeo devuelve exactamente esos centimos.
      centimos: Math.round(v.monto * 100),
      moneda: v.currency,
      sats: v.sats,
      precioBtc: v.precioBtc,
    }))
    .sort((a, b) => a.fecha.localeCompare(b.fecha) || a.id.localeCompare(b.id));
}

export function sumarLightning(lista: CobroLightningDelMes[]): number {
  return lista.reduce((s, x) => s + x.centimos, 0);
}
