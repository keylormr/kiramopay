import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Icons } from '../Icons';
import { useApp } from '@/hooks/useApp';
import { useLanguage } from '@/i18n/LanguageContext';
import { getApiLayer } from '@/api';
import type { ReferralSummary } from '@/api/repositories/loyalty.repository';
import { compartirEnlace, enlaceInvitacion } from '@/utils/compartir';
import { cerrarTarjetaBanner, tarjetaBannerCerrada } from '@/utils/bannerInicio';

interface BannerInicioProps {
  /** Abre la pantalla de planes (App.tsx: setOverlayView('plans')). */
  onAbrirPlanes?: () => void;
  /** Abre la hoja "Cobrar con QR" que ya vive en HomeView. */
  onCobrarQR?: () => void;
}

type TarjetaId = 'plans' | 'referral' | 'qr';

interface Tarjeta {
  id: TarjetaId;
  icono: React.ComponentType<{ size?: number; className?: string }>;
  colorTexto: string;
  colorFondo: string;
  colorBoton: string;
  titulo: string;
  cuerpo: string;
  ctaLabel: string;
  onCta: () => void;
}

/**
 * Banner de 3 tarjetas cerrables en Inicio, debajo del saldo. Carrusel de
 * navegación MANUAL (deslizar, puntos, teclado) — nunca rotación automática.
 *
 * La tarjeta de referidos solo se arma si el servidor confirma un código: sin
 * eso no hay nada verdadero que ofrecer. Cerrar una tarjeta la oculta 30 días
 * para ESA cuenta (ver utils/bannerInicio.ts) — otra cuenta en el mismo
 * navegador no hereda el cierre.
 */
export const BannerInicio: React.FC<BannerInicioProps> = ({ onAbrirPlanes, onCobrarQR }) => {
  const { state } = useApp();
  const { t } = useLanguage();
  const userId = state.user?.id || '';

  // El resumen de referidos trae el código y cuánto paga el programa
  // (bonus_points). Nunca se escribe un número a mano: si la consulta falla o
  // no hay código, la tarjeta de referidos simplemente no existe.
  const [referidos, setReferidos] = useState<ReferralSummary | null>(null);
  const [referidosListos, setReferidosListos] = useState(false);
  useEffect(() => {
    let cancelado = false;
    void (async () => {
      try {
        const res = await getApiLayer().loyalty?.getReferrals();
        if (!cancelado && res?.success && res.data?.referralCode) setReferidos(res.data);
      } catch {
        /* sin resumen: la tarjeta de referidos no se arma */
      } finally {
        if (!cancelado) setReferidosListos(true);
      }
    })();
    return () => { cancelado = true; };
  }, []);

  // Cierres guardados para ESTA cuenta. Se recalculan si cambia el usuario
  // (cerrar sesión y entrar con otra cuenta en el mismo navegador).
  const [cerradas, setCerradas] = useState<Set<TarjetaId>>(() => new Set());
  useEffect(() => {
    const ids: TarjetaId[] = ['plans', 'referral', 'qr'];
    setCerradas(new Set(ids.filter((id) => tarjetaBannerCerrada(userId, id))));
  }, [userId]);

  const [compartiendo, setCompartiendo] = useState(false);
  const [enlaceCopiado, setEnlaceCopiado] = useState(false);
  const copiadoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (copiadoTimer.current) clearTimeout(copiadoTimer.current); }, []);

  const compartirInvitacion = async () => {
    if (!referidos?.referralCode || compartiendo) return;
    setCompartiendo(true);
    try {
      const resultado = await compartirEnlace(t('promo_share_text'), enlaceInvitacion(referidos.referralCode));
      if (resultado === 'copiado') {
        if (copiadoTimer.current) clearTimeout(copiadoTimer.current);
        setEnlaceCopiado(true);
        copiadoTimer.current = setTimeout(() => setEnlaceCopiado(false), 1500);
      }
    } finally {
      setCompartiendo(false);
    }
  };

  const tarjetas = useMemo<Tarjeta[]>(() => {
    const lista: Tarjeta[] = [];
    if (!cerradas.has('plans')) {
      lista.push({
        id: 'plans',
        icono: Icons.Zap,
        colorTexto: 'var(--color-primary)',
        colorFondo: 'var(--color-primary-soft)',
        colorBoton: 'var(--color-primary)',
        titulo: t('banner_plans_title'),
        cuerpo: t('banner_plans_body'),
        ctaLabel: t('banner_plans_cta'),
        onCta: () => onAbrirPlanes?.(),
      });
    }
    // bonusPoints en 0 significa que el programa esta apagado (ver
    // ProfileView, que aplica el mismo criterio): sin puntos que prometer, la
    // tarjeta no se arma.
    if (referidosListos && referidos?.referralCode && referidos.bonusPoints > 0 && !cerradas.has('referral')) {
      lista.push({
        id: 'referral',
        icono: Icons.Gift,
        colorTexto: 'var(--color-accent)',
        colorFondo: 'var(--color-accent-soft)',
        colorBoton: 'var(--color-accent)',
        titulo: t('banner_referral_title'),
        cuerpo: t('banner_referral_body').replace('{puntos}', String(referidos.bonusPoints)),
        ctaLabel: enlaceCopiado ? t('promo_copied') : t('banner_referral_cta'),
        onCta: compartirInvitacion,
      });
    }
    if (!cerradas.has('qr')) {
      lista.push({
        id: 'qr',
        icono: Icons.QrCode,
        colorTexto: 'var(--color-success)',
        colorFondo: 'var(--color-success-soft)',
        colorBoton: 'var(--color-success)',
        titulo: t('banner_qr_title'),
        cuerpo: t('banner_qr_body'),
        ctaLabel: t('banner_qr_cta'),
        onCta: () => onCobrarQR?.(),
      });
    }
    return lista;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cerradas, referidosListos, referidos, enlaceCopiado, t, onAbrirPlanes, onCobrarQR]);

  const scrollerRef = useRef<HTMLDivElement>(null);
  const [indice, setIndice] = useState(0);

  // El índice nunca debe apuntar fuera del arreglo: cerrar una tarjeta, o que
  // la de referidos aparezca/desaparezca, puede achicar la lista.
  useEffect(() => {
    setIndice((i) => Math.min(i, Math.max(tarjetas.length - 1, 0)));
  }, [tarjetas.length]);

  const irA = (i: number) => {
    const el = scrollerRef.current;
    if (!el) return;
    const destino = Math.max(0, Math.min(i, tarjetas.length - 1));
    // Un behavior:'smooth' explicito en scrollTo ignora el scroll-behavior de
    // CSS (y su override para prefers-reduced-motion): hay que preguntarle
    // directo al matchMedia para no animar cuando el sistema pide quietud.
    const prefiereQuietud = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    el.scrollTo({ left: destino * el.clientWidth, behavior: prefiereQuietud ? 'auto' : 'smooth' });
    setIndice(destino);
  };

  // Sincroniza el índice cuando la persona desliza a mano (touch/trackpad):
  // los puntos y las flechas tienen que reflejar dónde quedó, no solo lo que
  // ellos mismos dispararon.
  const onScroll = () => {
    const el = scrollerRef.current;
    if (!el || el.clientWidth === 0) return;
    const i = Math.round(el.scrollLeft / el.clientWidth);
    setIndice((prev) => (prev === i ? prev : i));
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); irA(indice + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); irA(indice - 1); }
  };

  const cerrarTarjeta = (id: TarjetaId) => {
    cerrarTarjetaBanner(userId, id);
    setCerradas((prev) => new Set(prev).add(id));
  };

  if (tarjetas.length === 0) return null;

  return (
    <section
      aria-label={t('banner_home_label')}
      aria-roledescription="carousel"
      onKeyDown={onKeyDown}
    >
      <div
        ref={scrollerRef}
        onScroll={onScroll}
        className="flex overflow-x-auto snap-x snap-mandatory no-scrollbar rounded-2xl"
        style={{ scrollbarWidth: 'none' }}
      >
        {tarjetas.map((tarjeta, i) => {
          const Icono = tarjeta.icono;
          return (
            <div
              key={tarjeta.id}
              role="group"
              aria-roledescription="slide"
              aria-label={`${i + 1}/${tarjetas.length}: ${tarjeta.titulo}`}
              className="relative w-full shrink-0 snap-start overflow-hidden rounded-2xl border border-[var(--color-border)] dark:border-[var(--color-border-dark)] p-5 pr-12"
              style={{ backgroundColor: tarjeta.colorFondo, minHeight: '164px' }}
            >
              <div
                className="absolute -right-10 -top-10 w-32 h-32 rounded-full opacity-40 pointer-events-none"
                style={{ background: `radial-gradient(closest-side, ${tarjeta.colorFondo}, transparent)` }}
              />

              <button
                type="button"
                onClick={() => cerrarTarjeta(tarjeta.id)}
                aria-label={`${t('banner_close_card')}: ${tarjeta.titulo}`}
                className="absolute top-3 right-3 w-7 h-7 flex items-center justify-center rounded-full uv-text-muted hover:bg-black/5 dark:hover:bg-white/10 transition-colors uv-focus-ring"
              >
                <Icons.Close size={15} />
              </button>

              <div className="relative flex flex-col h-full">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center mb-3 shrink-0 bg-[var(--color-surface-1)] dark:bg-[var(--color-surface-2-dark)]"
                  style={{ color: tarjeta.colorTexto }}
                >
                  <Icono size={20} />
                </div>
                <h3 className="text-[15px] font-extrabold uv-text-primary leading-snug">{tarjeta.titulo}</h3>
                <p className="text-[13px] uv-text-secondary mt-1 leading-relaxed max-w-[90%]">{tarjeta.cuerpo}</p>
                <button
                  type="button"
                  onClick={tarjeta.onCta}
                  disabled={tarjeta.id === 'referral' && compartiendo}
                  className="mt-auto pt-3 self-start inline-flex items-center gap-1.5 text-[13px] font-bold text-white rounded-xl px-4 py-2 disabled:opacity-60 uv-focus-ring"
                  style={{ backgroundColor: tarjeta.colorBoton }}
                >
                  {tarjeta.ctaLabel}
                  <Icons.ChevronRight size={14} />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {tarjetas.length > 1 && (
        <div className="flex items-center justify-center gap-3 mt-3">
          <button
            type="button"
            onClick={() => irA(indice - 1)}
            disabled={indice === 0}
            aria-label={t('banner_prev')}
            className="w-7 h-7 flex items-center justify-center rounded-full uv-text-muted disabled:opacity-30 hover:bg-[var(--color-surface-muted)] dark:hover:bg-[var(--color-surface-muted-dark)] transition-colors uv-focus-ring"
          >
            <Icons.ChevronLeft size={16} />
          </button>

          <div className="flex items-center gap-1.5">
            {tarjetas.map((tarjeta, i) => (
              <button
                key={tarjeta.id}
                type="button"
                onClick={() => irA(i)}
                aria-label={t('banner_go_to').replace('{n}', String(i + 1))}
                aria-current={i === indice}
                className={`rounded-full transition-all uv-focus-ring ${i === indice ? 'w-5 h-2 bg-[var(--color-primary)]' : 'w-2 h-2 bg-[var(--color-border-strong)] dark:bg-[var(--color-border-dark)]'}`}
              />
            ))}
          </div>

          <button
            type="button"
            onClick={() => irA(indice + 1)}
            disabled={indice === tarjetas.length - 1}
            aria-label={t('banner_next')}
            className="w-7 h-7 flex items-center justify-center rounded-full uv-text-muted disabled:opacity-30 hover:bg-[var(--color-surface-muted)] dark:hover:bg-[var(--color-surface-muted-dark)] transition-colors uv-focus-ring"
          >
            <Icons.ChevronRight size={16} />
          </button>
        </div>
      )}
    </section>
  );
};
