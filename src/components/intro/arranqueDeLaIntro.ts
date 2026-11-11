// Si esta apertura de la app muestra la intro de la K, cual le toca y si
// todavia esta en pantalla. En la web nunca hay intro: abre igual que siempre.
import { useEffect, type RefObject } from 'react';
import { Capacitor } from '@capacitor/core';
import type { IdConcepto } from './conceptos';

/** Una distinta en cada apertura, por turno. */
export const TURNO = ['ventana', 'cierre', 'giro'] as const satisfies readonly IdConcepto[];
export type ConceptoDelTurno = (typeof TURNO)[number];

const CLAVE_DEL_TURNO = 'kiramopay_intro_turno';
// Si la intro nunca llega a montarse, nada queda esperando por ella: ni el
// splash ni el foco del login. Al montarse, la intro toma el control de sus
// propios tiempos (IntroDeLaK).
const COTA_MS = 5000;

type Almacen = Pick<Storage, 'getItem' | 'setItem'>;

/** La que le toca a esta apertura; deja anotada la siguiente. */
export function tomarTurno(almacen: Almacen | null): ConceptoDelTurno {
  let i = 0;
  try {
    const guardado = Number(almacen?.getItem(CLAVE_DEL_TURNO));
    if (Number.isInteger(guardado) && guardado >= 0) i = guardado % TURNO.length;
  } catch {
    // Sin almacenamiento: siempre la primera.
  }
  try {
    almacen?.setItem(CLAVE_DEL_TURNO, String((i + 1) % TURNO.length));
  } catch {
    // Igual se muestra; la proxima vez repite.
  }
  return TURNO[i];
}

export interface DecisionDeIntro {
  concepto: IdConcepto;
}

let decision: DecisionDeIntro | null | undefined;
let enCurso = false;
let cota: ReturnType<typeof setTimeout> | undefined;
const oyentes = new Set<() => void>();

function almacenLocal(): Almacen | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function pideMenosMovimiento(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/**
 * Si esta apertura de la app muestra la intro, y cual. Se decide una sola vez
 * por arranque: solo en la app instalada (Android e iOS), nunca en la web.
 */
export function decidirIntro(): DecisionDeIntro | null {
  if (decision !== undefined) return decision;
  if (!Capacitor.isNativePlatform()) {
    decision = null;
    return decision;
  }
  // Con "reducir movimiento" se muestra la K quieta y un fundido; el turno no avanza.
  decision = { concepto: pideMenosMovimiento() ? 'reducido' : tomarTurno(almacenLocal()) };
  enCurso = true;
  cota = setTimeout(terminarIntro, COTA_MS);
  return decision;
}

/** La intro ya esta en pantalla y se encarga de irse a tiempo. */
export function tomarElControlDeLaIntro(): void {
  clearTimeout(cota);
  cota = undefined;
}

export function introEnCurso(): boolean {
  return enCurso;
}

/** La intro se fue (termino, la saltaron o no pudo arrancar). */
export function terminarIntro(): void {
  if (!enCurso) return;
  enCurso = false;
  const pendientes = [...oyentes];
  oyentes.clear();
  pendientes.forEach((f) => f());
}

/** Corre `f` cuando la intro se vaya, o ya mismo si no hay intro. Devuelve como desuscribirse. */
export function alTerminarLaIntro(f: () => void): () => void {
  if (!enCurso) {
    f();
    return () => {};
  }
  oyentes.add(f);
  return () => {
    oyentes.delete(f);
  };
}

/**
 * Para un campo con autoFocus en una pantalla que puede quedar debajo de la
 * intro (el login): el teclado no sube sobre la animacion, sino al terminar.
 * Se usa junto con `autoFocus={!introEnCurso()}`.
 */
export function useEnfocarAlTerminarLaIntro(campo: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    if (!introEnCurso()) return;
    return alTerminarLaIntro(() => {
      const el = campo.current;
      // Solo si nadie tomo el foco mientras tanto.
      if (el && el.isConnected && (!document.activeElement || document.activeElement === document.body)) el.focus();
    });
  }, [campo]);
}

/** Solo para las pruebas: vuelve al estado de antes del arranque (o con una intro en pantalla). */
export function reiniciarIntroParaPruebas({ enCurso: conIntro = false } = {}): void {
  clearTimeout(cota);
  cota = undefined;
  decision = undefined;
  enCurso = conIntro;
  oyentes.clear();
}
