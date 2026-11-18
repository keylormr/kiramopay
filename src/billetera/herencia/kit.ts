// El kit del heredero: lo que hace falta, ademas de su propia llave, para
// encontrar la boveda y cobrarla sin KiramoPay. Va junto al testamento o con el
// heredero, en dos lugares.
//
// No trae nada secreto: con el kit nadie puede gastar. Pero quien lo lea ve el
// saldo y sabe quien es el heredero, asi que se guarda en privado.
//
// Las rutas de cobro estan comprobadas:
// - Bitcoin Core: en regtest (ver __tests__/regtest.test.ts), con el descriptor
//   del kit y walletcreatefundedpsbt con sequence = plazo. `sendall` NO pone ese
//   numero y deja la firma incompleta.
// - Liana: en su codigo (el instalador acepta las 12 palabras de una llave que
//   esta en el descriptor y su firmante deriva por la ruta que trae el PSBT),
//   no de punta a punta.
import { rellenar } from '@/utils/planes';
import type { BovedaGuardada } from './almacen';
import { descriptorDeLaBoveda, descriptoresPorRama } from './descriptor';
import { direccionDeLaBoveda } from './direcciones';
import { diasAproximados } from './estado';

export interface ContenidoDelKit {
  descriptor: string;
  recibir: string;
  cambio: string;
  primeraDireccion: string;
  plazoBloques: number;
  dias: number;
}

export function contenidoDelKit(b: BovedaGuardada): ContenidoDelKit {
  const { recibir, cambio } = descriptoresPorRama(b);
  return {
    descriptor: descriptorDeLaBoveda(b),
    recibir,
    cambio,
    primeraDireccion: direccionDeLaBoveda(b, 0, 0).direccion,
    plazoBloques: b.plazoBloques,
    dias: diasAproximados(b.plazoBloques),
  };
}

type Traducir = (llave: string) => string;

/** El kit como texto plano, en el idioma de la persona. Los descriptores no se traducen. */
export function textoDelKit(c: ContenidoDelKit, t: Traducir, fecha: string): string {
  const v = { fecha, bloques: c.plazoBloques, dias: c.dias };
  return [
    t('hb_kit_titulo'),
    rellenar(t('hb_kit_creado'), v),
    '',
    rellenar(t('hb_kit_que_es'), v),
    t('hb_kit_no_gasta'),
    t('hb_kit_renovar'),
    '',
    t('hb_kit_descriptor'),
    c.descriptor,
    '',
    t('hb_kit_primera'),
    c.primeraDireccion,
    '',
    t('hb_kit_liana_titulo'),
    rellenar(t('hb_kit_liana_pasos'), v),
    '',
    t('hb_kit_core_titulo'),
    rellenar(t('hb_kit_core_pasos'), v),
    `${t('hb_kit_core_recibir')} ${c.recibir}`,
    `${t('hb_kit_core_cambio')} ${c.cambio}`,
    '',
  ].join('\n');
}

/** Nombre del archivo: sin datos de nadie, con la fecha para distinguir versiones. */
export function nombreDelKit(fechaIso: string): string {
  return `kit-heredero-bitcoin-${fechaIso.slice(0, 10)}.txt`;
}
