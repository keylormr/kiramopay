import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useLanguage } from '@/i18n/LanguageContext';
import { Icons } from '@/components/Icons';
import { Ilustracion3D } from '@/components/arte3d/Arte3D';
import type { NombreIlustracion3D } from '@/components/arte3d/catalogo';
import type { TranslationKeys } from '@/i18n/translations';
import { rellenar } from '@/utils/planes';
import { enfocablesDentro } from '@/navegacion/enfocables';

// Bienvenida del rediseno: cuatro laminas con el arte 3D del paquete (b1-b4).
// En telefono, la ilustracion arriba y el texto abajo; desde 48rem, una al lado
// de la otra, para que en tablet y escritorio no quede una columna perdida en
// el centro. Se avanza con el boton, deslizando el dedo o con las flechas del
// teclado, y se puede volver atras.

interface Lamina {
  ilustracion: NombreIlustracion3D;
  titulo: keyof TranslationKeys;
  texto: keyof TranslationKeys;
}

const LAMINAS: readonly Lamina[] = [
  { ilustracion: 'bienvenida1', titulo: 'onboard_title_1', texto: 'onboard_desc_1' },
  { ilustracion: 'bienvenida2', titulo: 'onboard_title_2', texto: 'onboard_desc_2' },
  { ilustracion: 'bienvenida3', titulo: 'onboard_title_3', texto: 'onboard_desc_3' },
  { ilustracion: 'bienvenida4', titulo: 'onboard_title_4', texto: 'onboard_desc_4' },
];

// Distancia horizontal minima (px) para que un deslizamiento cuente.
const UMBRAL_DESLIZAR = 48;

interface OnboardingViewProps {
  onComplete: () => void;
}

export const OnboardingView: React.FC<OnboardingViewProps> = ({ onComplete }) => {
  const { t } = useLanguage();
  const [paso, setPaso] = useState(0);
  const inicioX = useRef<number | null>(null);
  const dialogoRef = useRef<HTMLDivElement>(null);
  const principalRef = useRef<HTMLButtonElement>(null);
  const idTitulo = useId();
  const lamina = LAMINAS[paso];
  const esUltima = paso === LAMINAS.length - 1;

  const terminar = useCallback(() => {
    localStorage.setItem('kiramopay_onboarded', 'true');
    onComplete();
  }, [onComplete]);

  const siguiente = useCallback(() => {
    if (esUltima) terminar();
    else setPaso((p) => p + 1);
  }, [esUltima, terminar]);

  const anterior = useCallback(() => setPaso((p) => Math.max(0, p - 1)), []);

  // Flechas del teclado: solo cambian de lamina (en la ultima, la derecha no
  // termina: entrar a la app es una decision del boton, no de una tecla).
  useEffect(() => {
    const alPulsar = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') setPaso((p) => Math.min(LAMINAS.length - 1, p + 1));
      else if (e.key === 'ArrowLeft') setPaso((p) => Math.max(0, p - 1));
    };
    window.addEventListener('keydown', alPulsar);
    return () => window.removeEventListener('keydown', alPulsar);
  }, []);

  // Foco, como en BottomSheet: el dialogo declara aria-modal, asi que al
  // montarse el foco entra al boton principal y Tab no sale a la pantalla de
  // atras, que queda tapada.
  useEffect(() => {
    principalRef.current?.focus({ preventScroll: true });
    const alTabular = (e: KeyboardEvent) => {
      const dialogo = dialogoRef.current;
      if (e.key !== 'Tab' || !dialogo) return;
      const enfocables = enfocablesDentro(dialogo);
      if (enfocables.length === 0) return;
      const primero = enfocables[0];
      const ultimo = enfocables[enfocables.length - 1];
      const activo = document.activeElement;
      if (!(activo instanceof Node) || !dialogo.contains(activo)) {
        e.preventDefault();
        (e.shiftKey ? ultimo : primero).focus();
      } else if (e.shiftKey && activo === primero) {
        e.preventDefault();
        ultimo.focus();
      } else if (!e.shiftKey && activo === ultimo) {
        e.preventDefault();
        primero.focus();
      }
    };
    document.addEventListener('keydown', alTabular);
    return () => document.removeEventListener('keydown', alTabular);
  }, []);

  const alTocar = (e: React.PointerEvent) => {
    inicioX.current = e.clientX;
  };
  const alSoltar = (e: React.PointerEvent) => {
    if (inicioX.current === null) return;
    const dx = e.clientX - inicioX.current;
    inicioX.current = null;
    if (dx <= -UMBRAL_DESLIZAR) setPaso((p) => Math.min(LAMINAS.length - 1, p + 1));
    else if (dx >= UMBRAL_DESLIZAR) anterior();
  };

  return (
    <div
      ref={dialogoRef}
      className="fixed inset-0 z-[200] flex flex-col overflow-y-auto overscroll-contain bg-[var(--color-background)] dark:bg-[var(--color-background-dark)]"
      role="dialog"
      aria-modal="true"
      aria-labelledby={idTitulo}
    >
      <div className="pt-safe">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-2 md:px-6">
          {paso > 0 ? (
            <button
              type="button"
              onClick={anterior}
              aria-label={t('back')}
              className="kp-toque kp-foco flex h-11 w-11 items-center justify-center rounded-xl uv-text-secondary"
            >
              <Icons.ChevronLeft size={22} />
            </button>
          ) : (
            <span aria-hidden="true" className="h-11 w-11" />
          )}
          <button
            type="button"
            onClick={terminar}
            className="kp-toque kp-foco h-11 rounded-xl px-4 text-sm font-semibold uv-text-secondary"
          >
            {t('onboard_skip')}
          </button>
        </div>
      </div>

      {/* Telefono y tablet en vertical: la ilustracion arriba, el texto abajo y
          el boton al pie. Desde 64rem (escritorio, tablet en horizontal) una al
          lado de la otra, y el bloque entero, boton incluido, queda centrado. */}
      <div className="flex flex-1 flex-col lg:justify-center">
      <div
        className="mx-auto flex w-full max-w-5xl flex-1 touch-pan-y flex-col items-center justify-center gap-6 px-6 pb-4 md:gap-8 lg:grid lg:flex-none lg:grid-cols-2 lg:items-center lg:gap-12 lg:px-10"
        onPointerDown={alTocar}
        onPointerUp={alSoltar}
        onPointerCancel={() => { inicioX.current = null; }}
      >
        <div className="relative flex w-full items-center justify-center">
          <div
            aria-hidden="true"
            className="absolute inset-0 m-auto aspect-square w-[min(78vw,320px)] rounded-full bg-[radial-gradient(closest-side,rgba(45,123,255,0.26),rgba(45,123,255,0.06)_60%,transparent)] md:w-[440px]"
          />
          <div key={lamina.ilustracion} className="relative h-[min(64vw,260px)] w-[min(64vw,260px)] md:h-[340px] md:w-[340px] lg:h-[360px] lg:w-[360px]">
            <Ilustracion3D
              nombre={lamina.ilustracion}
              tamano={360}
              prioritaria
              className="kp-aparece h-full w-full object-contain"
            />
          </div>
        </div>

        <div className="flex w-full max-w-md flex-col items-center text-center lg:items-start lg:text-left">
          <div key={paso} className="kp-cifra-entra">
            <h1 id={idTitulo} className="text-[28px] font-semibold leading-tight tracking-[-0.02em] uv-text-primary md:text-[34px]">
              {t(lamina.titulo)}
            </h1>
            <p className="mt-3 text-[15px] leading-relaxed uv-text-secondary md:text-base">{t(lamina.texto)}</p>
          </div>

          <p className="sr-only" aria-live="polite">
            {rellenar(t('onboard_paso'), { n: String(paso + 1), total: String(LAMINAS.length) })}
          </p>
          <div aria-hidden="true" className="mt-8 flex gap-2">
            {LAMINAS.map((l, i) => (
              <span
                key={l.ilustracion}
                className={`h-1.5 rounded-full transition-[width,background-color] duration-[var(--kp-mov-estado)] ease-kp ${
                  i === paso
                    ? 'w-7 bg-[var(--color-primary)]'
                    : i < paso
                      ? 'w-1.5 bg-[var(--color-primary)]/45'
                      : 'w-1.5 bg-[var(--color-border-strong)] dark:bg-[var(--color-border-strong-dark)]'
                }`}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Un solo boton: abajo, al alcance del pulgar; desde 64rem queda bajo el
          texto, en la columna de la derecha. */}
      <div className="mx-auto w-full max-w-5xl px-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] md:max-w-md md:pb-12 lg:grid lg:max-w-5xl lg:grid-cols-2 lg:gap-12 lg:px-10 lg:pb-10 lg:pt-2">
        <button
          ref={principalRef}
          type="button"
          onClick={siguiente}
          className="kp-toque kp-foco flex h-14 w-full items-center justify-center rounded-[18px] bg-[var(--color-primary-fill)] text-base font-semibold text-white shadow-[0_10px_22px_-10px_rgba(45,123,255,0.75)] hover:bg-[var(--color-primary-hover)] lg:col-start-2 lg:max-w-xs"
        >
          {esUltima ? t('onboard_get_started') : t('continue')}
        </button>
      </div>
      </div>
    </div>
  );
};
