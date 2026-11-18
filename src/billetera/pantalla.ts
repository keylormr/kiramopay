// Proteccion de la pantalla mientras se muestran o se escriben las 12 palabras.
//
// Las palabras son la billetera: una captura de pantalla, una grabacion o la
// miniatura de la app en el selector de apps bastan para que alguien mas las
// tenga. El plugin propio de la app (PantallaSegura, en android/ y ios/) lo
// impide mientras la pantalla de las palabras esta abierta:
// - Android: FLAG_SECURE. Sin capturas ni grabacion, y la miniatura en recientes
//   sale en blanco.
// - iOS: una tapa sobre el contenido cuando la app deja de estar activa, para
//   que la miniatura del selector de apps no muestre las palabras. iOS no
//   permite impedir la captura en si.
//
// Si el binario instalado no trae el plugin (la capa web se actualiza sola, el
// binario no), prender la proteccion falla y las palabras NO se muestran: es
// preferible pedir que actualicen la app a mostrarlas sin proteccion.
import { useEffect, useState } from 'react';
import { Capacitor, registerPlugin } from '@capacitor/core';

interface PantallaSeguraPlugin {
  activar(): Promise<void>;
  desactivar(): Promise<void>;
}

// El plugin es un Proxy de Capacitor que responde a CUALQUIER propiedad, "then"
// incluida: devolverlo desde una funcion async (o hacerle await) deja la
// operacion colgada (ver services/almacenSeguro.ts). Por eso esta funcion es
// sincrona y el plugin nunca sale de este archivo.
let plugin: PantallaSeguraPlugin | null = null;
function nativo(): PantallaSeguraPlugin {
  if (!plugin) plugin = registerPlugin<PantallaSeguraPlugin>('PantallaSegura');
  return plugin;
}

// Varias pantallas pueden pedir la proteccion a la vez; se apaga cuando ya no la
// pide ninguna. Las llamadas al plugin van en fila: un "desactivar" tardio no
// puede pisar un "activar" mas nuevo.
let usos = 0;
let puesta = false;
let fila: Promise<unknown> = Promise.resolve();

function enFila<T>(operacion: () => Promise<T>): Promise<T> {
  const resultado = fila.then(operacion, operacion);
  fila = resultado.catch(() => undefined);
  return resultado;
}

/**
 * Prende la proteccion y resuelve cuando ya esta puesta. Devuelve la funcion
 * que la suelta. Falla si el telefono no puede proteger la pantalla. En la web
 * no hace nada: ahi no existe la billetera propia.
 */
export async function protegerPantalla(): Promise<() => void> {
  if (!Capacitor.isNativePlatform()) return () => undefined;
  usos += 1;
  let suelta = false;
  const soltar = () => {
    if (suelta) return;
    suelta = true;
    usos -= 1;
    if (usos > 0) return;
    void enFila(async () => {
      if (usos === 0 && puesta) {
        puesta = false;
        await nativo().desactivar();
      }
    }).catch(() => undefined);
  };
  try {
    await enFila(async () => {
      if (!puesta) {
        await nativo().activar();
        puesta = true;
      }
    });
  } catch (error) {
    soltar();
    throw error;
  }
  return soltar;
}

export type EstadoDeLaProteccion = 'inactiva' | 'comprobando' | 'protegida' | 'sin-proteccion';

/**
 * Mantiene la pantalla protegida mientras `activa` sea verdadero. Quien muestre
 * o reciba las palabras solo las pinta cuando el estado es 'protegida': con
 * cualquier otro valor (incluido 'comprobando') no hay proteccion todavia.
 */
export function usePantallaSegura(activa: boolean): EstadoDeLaProteccion {
  const nativa = Capacitor.isNativePlatform();
  const [resultado, setResultado] = useState<'protegida' | 'sin-proteccion' | null>(null);

  useEffect(() => {
    if (!activa || !nativa) return;
    let vigente = true;
    let soltar: (() => void) | null = null;
    protegerPantalla().then(
      s => {
        if (vigente) {
          soltar = s;
          setResultado('protegida');
        } else {
          s();
        }
      },
      () => {
        if (vigente) setResultado('sin-proteccion');
      },
    );
    return () => {
      vigente = false;
      soltar?.();
      // Al volver a activarse, el estado anterior no vale: la proteccion se pide de nuevo.
      setResultado(null);
    };
  }, [activa, nativa]);

  if (!activa) return 'inactiva';
  if (!nativa) return 'protegida';
  return resultado ?? 'comprobando';
}
