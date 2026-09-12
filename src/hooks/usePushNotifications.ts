import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuthStore } from '@/stores/auth.store';
import {
  activarAvisos,
  avisosSoportados,
  desactivarAvisos,
  leerEstadoAvisos,
  type EstadoAvisos,
} from '@/utils/avisosPush';

/**
 * El interruptor de avisos de este dispositivo. La logica vive en
 * utils/avisosPush; aqui solo el estado de la pantalla.
 */
export function usePushNotifications() {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const [estado, setEstado] = useState<EstadoAvisos>(() =>
    avisosSoportados() ? 'cargando' : 'no_soportado',
  );
  const [ocupado, setOcupado] = useState(false);
  const [fallo, setFallo] = useState(false);
  // La clave se pide al montar y no al tocar: el permiso tiene que pedirse
  // dentro del gesto, sin una espera al servidor antes.
  const claveRef = useRef('');

  useEffect(() => {
    if (!userId || !avisosSoportados()) return;
    let vigente = true;
    void leerEstadoAvisos(userId).then(({ estado: leido, clave }) => {
      if (!vigente) return;
      claveRef.current = clave;
      setEstado(leido);
    });
    return () => {
      vigente = false;
    };
  }, [userId]);

  const alternar = useCallback(async () => {
    if (ocupado || !userId) return;
    if (estado !== 'activo' && estado !== 'inactivo') return;
    setOcupado(true);
    setFallo(false);
    const resultado =
      estado === 'activo' ? await desactivarAvisos() : await activarAvisos(claveRef.current, userId);
    if (resultado === 'fallo') setFallo(true);
    else setEstado(resultado);
    setOcupado(false);
  }, [estado, ocupado, userId]);

  return { estado, ocupado, fallo, alternar };
}
