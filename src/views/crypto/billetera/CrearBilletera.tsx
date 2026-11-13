// Crear o restaurar la billetera propia. Crear muestra las 12 palabras y no deja
// seguir hasta que la persona demuestre que las anoto: una billetera nueva sin
// sus palabras anotadas es dinero que se pierde con el telefono.
import { useMemo, useState } from 'react';
import { useLanguage } from '@/i18n/LanguageContext';
import { Icons } from '@/components/Icons';
import { rellenar } from '@/utils/planes';
import {
  normalizarSemilla,
  nuevaSemilla,
  palabrasDe,
  palabrasDesconocidas,
  posicionesParaVerificar,
  semillaValida,
} from '@/billetera/semilla';
import { BilleteraYaGuardada } from '@/billetera/boveda';

interface Props {
  modo: 'crear' | 'restaurar';
  /** Recibe la semilla ya comprobada; guardarla es cosa de quien llama. */
  onListo: (semilla: string) => Promise<void>;
  onCancelar: () => void;
}

const BOTON_PRINCIPAL =
  'kp-toque kp-foco h-12 w-full rounded-[16px] bg-[var(--color-primary-fill)] px-6 font-semibold text-white hover:bg-[var(--color-primary-hover)] disabled:opacity-50';
const BOTON_SECUNDARIO =
  'kp-toque kp-foco h-12 w-full rounded-[16px] border border-[var(--color-border)] dark:border-[var(--color-border-dark)] px-6 font-semibold uv-text-primary';
const CAMPO =
  'kp-foco w-full rounded-xl border border-[var(--color-border)] dark:border-[var(--color-border-dark)] uv-surface-1 px-3 py-3 uv-text-primary';

export function GrillaDePalabras({ palabras }: { palabras: string[] }) {
  return (
    <ol className="grid grid-cols-2 gap-2 sm:grid-cols-3" aria-label="12">
      {palabras.map((p, i) => (
        <li key={i} className="flex items-baseline gap-2 rounded-xl uv-surface-2 px-3 py-2">
          <span className="w-5 text-right text-xs tabular-nums uv-text-muted">{i + 1}</span>
          <span className="font-semibold uv-text-primary">{p}</span>
        </li>
      ))}
    </ol>
  );
}

export function CrearBilletera({ modo, onListo, onCancelar }: Props) {
  const { t } = useLanguage();
  const semilla = useMemo(() => (modo === 'crear' ? nuevaSemilla() : ''), [modo]);
  const palabras = useMemo(() => palabrasDe(semilla), [semilla]);
  const posiciones = useMemo(() => posicionesParaVerificar(palabras.length || 12), [palabras.length]);

  const [paso, setPaso] = useState<'mostrar' | 'verificar' | 'restaurar'>(modo === 'crear' ? 'mostrar' : 'restaurar');
  const [anotadas, setAnotadas] = useState(false);
  const [respuestas, setRespuestas] = useState<Record<number, string>>({});
  const [texto, setTexto] = useState('');
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);

  const terminar = async (lista: string) => {
    setGuardando(true);
    setError('');
    try {
      await onListo(lista);
    } catch (e) {
      setError(e instanceof BilleteraYaGuardada ? t('bp_err_ya_hay_billetera') : t('bp_guardar_error'));
      setGuardando(false);
    }
  };

  if (paso === 'mostrar') {
    return (
      <section className="space-y-4 uv-surface-1 rounded-[20px] border border-[var(--color-border)] dark:border-[var(--color-border-dark)] p-5">
        <h3 className="text-lg font-bold uv-text-primary">{t('bp_palabras_titulo')}</h3>
        <p className="uv-chip-warning flex gap-2 rounded-xl p-3 text-sm">
          <Icons.AlertTriangle size={18} className="shrink-0" aria-hidden />
          <span>{t('bp_palabras_aviso')}</span>
        </p>
        <GrillaDePalabras palabras={palabras} />
        <label className="flex items-center gap-3 text-sm uv-text-primary">
          <input type="checkbox" className="h-5 w-5" checked={anotadas} onChange={e => setAnotadas(e.target.checked)} />
          {t('bp_palabras_anotadas')}
        </label>
        <div className="space-y-2">
          <button type="button" className={BOTON_PRINCIPAL} disabled={!anotadas} onClick={() => setPaso('verificar')}>
            {t('continue')}
          </button>
          <button type="button" className={BOTON_SECUNDARIO} onClick={onCancelar}>{t('cancel')}</button>
        </div>
      </section>
    );
  }

  if (paso === 'verificar') {
    const completas = posiciones.every(i => (respuestas[i] ?? '').trim().length > 0);
    const comprobar = () => {
      const bien = posiciones.every(i => normalizarSemilla(respuestas[i] ?? '') === palabras[i]);
      if (!bien) {
        setError(t('bp_verificar_error'));
        return;
      }
      void terminar(semilla);
    };
    return (
      <section className="space-y-4 uv-surface-1 rounded-[20px] border border-[var(--color-border)] dark:border-[var(--color-border-dark)] p-5">
        <h3 className="text-lg font-bold uv-text-primary">{t('bp_verificar_titulo')}</h3>
        {posiciones.map(i => (
          <label key={i} className="block space-y-1">
            <span className="text-sm font-semibold uv-text-secondary">{rellenar(t('bp_verificar_palabra'), { n: i + 1 })}</span>
            <input
              className={CAMPO}
              autoCapitalize="none"
              autoCorrect="off"
              autoComplete="off"
              spellCheck={false}
              value={respuestas[i] ?? ''}
              onChange={e => { setError(''); setRespuestas(r => ({ ...r, [i]: e.target.value })); }}
            />
          </label>
        ))}
        {error && <p role="alert" className="text-sm font-semibold text-[var(--color-danger)] dark:text-[var(--color-danger-strong-dark)]">{error}</p>}
        <div className="space-y-2">
          <button type="button" className={BOTON_PRINCIPAL} disabled={!completas || guardando} onClick={comprobar}>
            {t('bp_guardar')}
          </button>
          <button type="button" className={BOTON_SECUNDARIO} disabled={guardando} onClick={() => { setError(''); setPaso('mostrar'); }}>
            {t('back')}
          </button>
        </div>
      </section>
    );
  }

  const restaurar = () => {
    const desconocidas = palabrasDesconocidas(texto);
    if (desconocidas.length > 0) {
      setError(rellenar(t('bp_restaurar_desconocidas'), { palabras: desconocidas.join(', ') }));
      return;
    }
    if (!semillaValida(texto)) {
      setError(t('bp_restaurar_invalida'));
      return;
    }
    void terminar(normalizarSemilla(texto));
  };

  return (
    <section className="space-y-4 uv-surface-1 rounded-[20px] border border-[var(--color-border)] dark:border-[var(--color-border-dark)] p-5">
      <h3 className="text-lg font-bold uv-text-primary">{t('bp_restaurar_titulo')}</h3>
      <p className="text-sm uv-text-secondary">{t('bp_restaurar_ayuda')}</p>
      <textarea
        className={`${CAMPO} min-h-[120px] font-mono`}
        autoCapitalize="none"
        autoCorrect="off"
        autoComplete="off"
        spellCheck={false}
        value={texto}
        onChange={e => { setError(''); setTexto(e.target.value); }}
      />
      {error && <p role="alert" className="text-sm font-semibold text-[var(--color-danger)] dark:text-[var(--color-danger-strong-dark)]">{error}</p>}
      <div className="space-y-2">
        <button type="button" className={BOTON_PRINCIPAL} disabled={!texto.trim() || guardando} onClick={restaurar}>
          {t('bp_guardar')}
        </button>
        <button type="button" className={BOTON_SECUNDARIO} disabled={guardando} onClick={onCancelar}>{t('cancel')}</button>
      </div>
    </section>
  );
}
