// Respaldo de la billetera propia en un archivo cifrado con contrasena, y su
// vuelta: restaurar desde ese archivo. Tambien el boton de compartir la
// direccion de cobro. El cifrado esta en src/billetera/respaldo.ts.
import { useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Share } from '@capacitor/share';
import { useLanguage } from '@/i18n/LanguageContext';
import { Icons } from '@/components/Icons';
import { BottomSheet } from '@/components/BottomSheet';
import { rellenar } from '@/utils/planes';
import { entregarArchivo } from '@/utils/entregarArchivo';
import {
  ContrasenaIncorrecta,
  LARGO_MINIMO_DE_LA_CONTRASENA,
  RespaldoInvalido,
  TAMANO_MAXIMO_DEL_RESPALDO,
  cifrarRespaldo,
  contrasenaSuficiente,
  descifrarRespaldo,
  leerRespaldo,
  nombreDelRespaldo,
} from '@/billetera/respaldo';

const BOTON_PRINCIPAL =
  'kp-toque kp-foco h-12 w-full rounded-[16px] bg-[var(--color-primary-fill)] px-6 font-semibold text-white hover:bg-[var(--color-primary-hover)] disabled:opacity-50';
const BOTON_SECUNDARIO =
  'kp-toque kp-foco h-12 w-full rounded-[16px] border border-[var(--color-border)] dark:border-[var(--color-border-dark)] px-6 font-semibold uv-text-primary disabled:opacity-50';
const CAMPO =
  'kp-foco w-full rounded-xl border border-[var(--color-border)] dark:border-[var(--color-border-dark)] uv-surface-1 px-3 py-3 uv-text-primary';
const ERROR = 'text-sm font-semibold text-[var(--color-danger)] dark:text-[var(--color-danger-strong-dark)]';

// ---------------------------------------------------------------- Compartir

/** Abre el menu de compartir del sistema con un texto. Sin menu, no se muestra. */
export function BotonCompartir({ texto }: { texto: string }) {
  const { t } = useLanguage();
  const nativo = Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('Share');
  const web = !nativo && typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  if (!nativo && !web) return null;
  return (
    <button
      type="button"
      className={BOTON_SECUNDARIO}
      onClick={async () => {
        try {
          if (nativo) await Share.share({ text: texto });
          else await navigator.share({ text: texto });
        } catch {
          // Cerrar el menu sin elegir nada no es un error.
        }
      }}
    >
      <span className="inline-flex items-center gap-2">
        <Icons.Share size={16} aria-hidden /> {t('share')}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------- Exportar

interface HojaRespaldoProps {
  /** Las palabras a respaldar; con null la hoja esta cerrada. */
  semilla: string | null;
  onClose: () => void;
  /**
   * Avisa cuando la exportacion empieza y termina. Elegir Drive o el correo en
   * el menu de compartir saca la app a segundo plano: con esto la billetera
   * espera a que el archivo se entregue antes de cerrarse, como con un envio.
   */
  onExportando?: (enCurso: boolean) => void;
}

export function HojaRespaldo({ semilla, onClose, onExportando }: HojaRespaldoProps) {
  const { t } = useLanguage();
  const [contrasena, setContrasena] = useState('');
  const [repetida, setRepetida] = useState('');
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [ocupado, setOcupado] = useState(false);
  // Un segundo toque antes de que React deshabilite el boton no exporta dos veces.
  const enCursoRef = useRef(false);

  // Al cerrar no queda nada escrito: ni la contrasena ni el resultado anterior.
  useEffect(() => {
    if (semilla) return;
    setContrasena('');
    setRepetida('');
    setError('');
    setAviso('');
    setOcupado(false);
  }, [semilla]);

  const crear = async () => {
    if (!semilla || enCursoRef.current) return;
    setAviso('');
    if (!contrasenaSuficiente(contrasena)) {
      setError(rellenar(t('bp_respaldo_corta'), { n: LARGO_MINIMO_DE_LA_CONTRASENA }));
      return;
    }
    if (contrasena.normalize('NFKC') !== repetida.normalize('NFKC')) {
      setError(t('bp_respaldo_distintas'));
      return;
    }
    setError('');
    enCursoRef.current = true;
    setOcupado(true);
    onExportando?.(true);
    try {
      const contenido = await cifrarRespaldo(semilla, contrasena);
      const estado = await entregarArchivo(new Blob([contenido], { type: 'application/json' }), nombreDelRespaldo());
      if (estado === 'compartido' || estado === 'listo') {
        setContrasena('');
        setRepetida('');
        setAviso(t('bp_respaldo_listo'));
      } else if (estado === 'solo_web') {
        setError(t('bp_respaldo_actualizar'));
      } else if (estado === 'error') {
        setError(t('bp_respaldo_error'));
      }
    } catch {
      setError(t('bp_respaldo_error'));
    } finally {
      enCursoRef.current = false;
      setOcupado(false);
      onExportando?.(false);
    }
  };

  return (
    <BottomSheet isOpen={semilla !== null} onClose={onClose} title={t('bp_respaldo_titulo')}>
      <div className="space-y-4">
        <p className="text-sm uv-text-secondary">{t('bp_respaldo_ayuda')}</p>
        <p className="uv-chip-warning rounded-xl p-3 text-sm">{t('bp_respaldo_aviso')}</p>
        <label className="block space-y-1">
          <span className="text-sm font-semibold uv-text-secondary">{t('bp_respaldo_contrasena')}</span>
          <input
            className={CAMPO}
            type="password"
            autoComplete="new-password"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={contrasena}
            onChange={e => { setError(''); setAviso(''); setContrasena(e.target.value); }}
          />
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-semibold uv-text-secondary">{t('bp_respaldo_repetir')}</span>
          <input
            className={CAMPO}
            type="password"
            autoComplete="new-password"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={repetida}
            onChange={e => { setError(''); setAviso(''); setRepetida(e.target.value); }}
          />
        </label>
        <p className="text-xs uv-text-muted">{rellenar(t('bp_respaldo_minimo'), { n: LARGO_MINIMO_DE_LA_CONTRASENA })}</p>
        <p className="text-xs uv-text-muted">{t('bp_respaldo_menu')}</p>
        {error && <p role="alert" className={ERROR}>{error}</p>}
        {aviso && <p role="status" className="text-sm font-semibold text-[var(--color-success)]">{aviso}</p>}
        <button type="button" className={BOTON_PRINCIPAL} disabled={ocupado || !contrasena || !repetida} onClick={crear}>
          {ocupado ? t('bp_respaldo_cifrando') : t('bp_respaldo_crear')}
        </button>
      </div>
    </BottomSheet>
  );
}

// ---------------------------------------------------------------- Restaurar

function leerTexto(f: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onload = () => resolve(String(lector.result ?? ''));
    lector.onerror = () => reject(lector.error ?? new Error('no se pudo leer el archivo'));
    lector.readAsText(f);
  });
}

interface RestaurarDesdeArchivoProps {
  /** Recibe las palabras ya descifradas y validas. */
  onSemilla: (semilla: string) => void;
  deshabilitado?: boolean;
}

export function RestaurarDesdeArchivo({ onSemilla, deshabilitado }: RestaurarDesdeArchivoProps) {
  const { t } = useLanguage();
  const entrada = useRef<HTMLInputElement>(null);
  const [archivo, setArchivo] = useState<{ nombre: string; texto: string } | null>(null);
  const [contrasena, setContrasena] = useState('');
  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState(false);

  const elegido = async (lista: FileList | null) => {
    const f = lista?.[0];
    if (entrada.current) entrada.current.value = '';
    if (!f) return;
    setError('');
    setContrasena('');
    try {
      if (f.size > TAMANO_MAXIMO_DEL_RESPALDO) throw new RespaldoInvalido();
      const texto = await leerTexto(f);
      leerRespaldo(texto);
      setArchivo({ nombre: f.name, texto });
    } catch {
      setArchivo(null);
      setError(t('bp_restaurar_archivo_invalido'));
    }
  };

  const abrir = async () => {
    if (!archivo) return;
    setOcupado(true);
    setError('');
    try {
      const semilla = await descifrarRespaldo(archivo.texto, contrasena);
      setContrasena('');
      onSemilla(semilla);
    } catch (e) {
      setError(e instanceof ContrasenaIncorrecta ? t('bp_restaurar_archivo_contrasena') : t('bp_restaurar_archivo_invalido'));
    } finally {
      setOcupado(false);
    }
  };

  return (
    <div className="space-y-3 border-t border-[var(--color-border)] dark:border-[var(--color-border-dark)] pt-4">
      <p className="text-sm font-semibold uv-text-primary">{t('bp_restaurar_archivo_titulo')}</p>
      <p className="text-sm uv-text-secondary">{t('bp_restaurar_archivo_ayuda')}</p>
      <input
        ref={entrada}
        type="file"
        className="hidden"
        aria-hidden
        tabIndex={-1}
        data-testid="respaldo-archivo"
        onChange={e => void elegido(e.target.files)}
      />
      {archivo ? (
        <>
          <p className="break-all rounded-xl uv-surface-2 px-3 py-2 text-xs uv-text-primary">{archivo.nombre}</p>
          <label className="block space-y-1">
            <span className="text-sm font-semibold uv-text-secondary">{t('bp_respaldo_contrasena')}</span>
            <input
              className={CAMPO}
              type="password"
              autoComplete="current-password"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={contrasena}
              onChange={e => { setError(''); setContrasena(e.target.value); }}
            />
          </label>
          {error && <p role="alert" className={ERROR}>{error}</p>}
          <button type="button" className={BOTON_PRINCIPAL} disabled={deshabilitado || ocupado || !contrasena} onClick={abrir}>
            {ocupado ? t('bp_respaldo_abriendo') : t('bp_restaurar_archivo_abrir')}
          </button>
          <button type="button" className={BOTON_SECUNDARIO} disabled={deshabilitado || ocupado} onClick={() => entrada.current?.click()}>
            {t('bp_restaurar_archivo_otro')}
          </button>
        </>
      ) : (
        <>
          {error && <p role="alert" className={ERROR}>{error}</p>}
          <button type="button" className={BOTON_SECUNDARIO} disabled={deshabilitado} onClick={() => entrada.current?.click()}>
            {t('bp_restaurar_archivo_elegir')}
          </button>
        </>
      )}
    </div>
  );
}
