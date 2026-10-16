import { useEffect, useRef } from 'react';
import { useLanguage } from '@/i18n/LanguageContext';
import { defaultTranslations } from '@/i18n/translations';
import { useAccountStore } from '@/stores/account.store';
import { useNotificationStore } from '@/stores/notification.store';
import { useSinpeStore } from '@/stores/sinpe.store';
import { useTransactionStore } from '@/stores/transaction.store';

const hasBackend = !!import.meta.env.VITE_API_URL;

type Traductor = (clave: string) => string;
type Tabla = Record<string, Record<string, string>>;

// De que clave sale cada texto de los ejemplos, por id (ver mock-data.ts).
const MOVIMIENTOS: Tabla = {
  '2': { title: 'demo_tx_sinpe_diego' },
  '4': { title: 'demo_tx_pago_ice' },
};
const PRESUPUESTOS: Tabla = {
  '1': { label: 'budget_icon_food' },
  '2': { label: 'budget_icon_transport' },
  '3': { label: 'budget_icon_fun' },
  '4': { label: 'budget_icon_utilities' },
};
const AVISOS: Tabla = {
  '1': { title: 'demo_notif_welcome_title', message: 'demo_notif_welcome_body' },
  '2': { title: 'demo_notif_sinpe_title', message: 'demo_notif_sinpe_body' },
  '3': { title: 'demo_notif_paid_title', message: 'demo_notif_paid_body' },
  '4': { title: 'demo_notif_promo_title', message: 'demo_notif_promo_body' },
  '5': { title: 'demo_notif_security_title', message: 'demo_notif_security_body' },
};
const SINPE: Tabla = {
  '1': { reference: 'demo_sinpe_ref_lunch' },
  '2': { reference: 'demo_sinpe_ref_debt' },
  '3': { reference: 'demo_sinpe_ref_gift' },
};

/**
 * Pasa al idioma nuevo cada texto de ejemplo que sigue diciendo lo que decia
 * en el idioma anterior. Si la persona lo cambio (renombro un presupuesto), ya
 * no coincide y queda como lo dejo. Devuelve null si no hubo nada que cambiar.
 */
function retraducir<T extends { id: string }>(items: T[], tabla: Tabla, antes: Traductor, ahora: Traductor): T[] | null {
  let hubo = false;
  const nuevos = items.map((item) => {
    const campos = tabla[item.id];
    if (!campos) return item;
    let copia = item;
    for (const [campo, clave] of Object.entries(campos)) {
      const actual = (item as unknown as Record<string, unknown>)[campo];
      const nuevo = ahora(clave);
      if (actual === antes(clave) && actual !== nuevo) {
        copia = { ...copia, [campo]: nuevo };
        hubo = true;
      }
    }
    return copia;
  });
  return hubo ? nuevos : null;
}

/**
 * Sin servidor, los stores arrancan con los datos de ejemplo de la demo, que se
 * arman al importar: en espanol, porque el idioma de la app carga despues.
 * Cuando el idioma carga, o la persona lo cambia, los ejemplos que nadie toco
 * pasan a ese idioma. Con servidor no hay ejemplos y no hace nada.
 */
export function useSemillasDeLaDemo(): void {
  // `t` cambia cada vez que el proveedor del idioma se vuelve a dibujar, entre
  // ellas cuando termina de cargar otro diccionario. Si nada cambio, retraducir
  // no encuentra diferencias y no toca los stores.
  const { t } = useLanguage();
  // Los ejemplos se armaron con el espanol, que es el diccionario de arranque.
  const anterior = useRef<Traductor>((clave) => (defaultTranslations as unknown as Record<string, string>)[clave] ?? clave);

  useEffect(() => {
    if (hasBackend) return;
    const antes = anterior.current;
    const ahora: Traductor = t;

    const movimientos = retraducir(useTransactionStore.getState().transactions, MOVIMIENTOS, antes, ahora);
    if (movimientos) useTransactionStore.setState({ transactions: movimientos });
    const presupuestos = retraducir(useAccountStore.getState().budgets, PRESUPUESTOS, antes, ahora);
    if (presupuestos) useAccountStore.setState({ budgets: presupuestos });
    const avisos = retraducir(useNotificationStore.getState().notifications, AVISOS, antes, ahora);
    if (avisos) useNotificationStore.setState({ notifications: avisos });
    const sinpe = retraducir(useSinpeStore.getState().sinpeHistory, SINPE, antes, ahora);
    if (sinpe) useSinpeStore.setState({ sinpeHistory: sinpe });

    anterior.current = ahora;
  }, [t]);
}
