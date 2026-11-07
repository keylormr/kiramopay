import React, { useId, useRef, useState } from 'react';
import type { Account, CryptoAsset } from '@/types';
import { useLanguage } from '@/i18n/LanguageContext';
import { useSettingsStore } from '@/stores/settings.store';
import { IconosLinea } from '@/components/Icons';
import { MarcaKiramo } from '@/components/MarcaKiramo';
import { saldoTotal } from '@/utils/saldoTotal';
import { formatMoney, MONEY_LOCALE } from '@/utils/money';
import { partesDelMonto } from '@/utils/partesDelMonto';
import { rellenar } from '@/utils/planes';

// La tarjeta de saldo "metal" del concepto aprobado el 2026-11-06: degradado
// medianoche, filo naranja, marca de agua K al 6 % y las acciones adentro. Es
// oscura en los dos temas, como una tarjeta fisica.
//
// Pestanas (decision del dueno, 2026-11-06): Total, una por cada cuenta en
// moneda y Cripto. El total va primero: es la suma real de las cuentas en la
// moneda base (utils/saldoTotal), no la cuenta base rotulada como total.

type Pestana = { id: string; etiqueta: string };

interface Accion {
  id: 'enviar' | 'recibir' | 'escanear' | 'cobrar';
  etiqueta: string;
  /** El nombre completo para el lector de pantalla cuando la etiqueta visible
   *  es corta ("Escanear" -> "Escanear QR"). Contiene la etiqueta visible
   *  (WCAG 2.5.3: quien dicta "Escanear" lo encuentra). */
  nombreAccesible?: string;
  onClick: () => void;
}

interface TarjetaDeSaldoProps {
  cuentas: Account[];
  monedaBase: string;
  cripto: CryptoAsset[];
  onAgregarDinero: () => void;
  acciones: Accion[];
}

const ICONO_DE_ACCION = {
  enviar: IconosLinea.Enviar,
  recibir: IconosLinea.Recibir,
  escanear: IconosLinea.Escanear,
  cobrar: IconosLinea.Cobrar,
} as const;

const tasaValida = (tasa: number | undefined): tasa is number =>
  typeof tasa === 'number' && Number.isFinite(tasa) && tasa > 0;

const ORDEN_DE_MONEDAS = ['CRC', 'USD'];

// Cantidades de cripto en la linea de detalle: con separador de miles y sin
// cambiar el valor (1,234,567 DOGE, no 1235000). Hasta 4 decimales desde 1 y
// hasta 8 por debajo, donde viven los BTC chicos.
const cantidadCripto = (n: number): string =>
  new Intl.NumberFormat(MONEY_LOCALE, { maximumFractionDigits: Math.abs(n) >= 1 ? 4 : 8 }).format(n);

interface Lectura {
  etiqueta: string;
  /** null: no hay dato para dar un numero. */
  monto: number | null;
  moneda: string;
  detalle: string;
}

export const TarjetaDeSaldo: React.FC<TarjetaDeSaldoProps> = ({ cuentas, monedaBase, cripto, onAgregarDinero, acciones }) => {
  const { t } = useLanguage();
  const oculto = useSettingsStore((s) => s.saldoOculto);
  const alternarOculto = useSettingsStore((s) => s.alternarSaldoOculto);
  const [elegida, setElegida] = useState('total');
  const idBase = useId();
  const refsPestanas = useRef<(HTMLButtonElement | null)[]>([]);

  const enMoneda = cuentas
    .filter((c) => c.type !== 'crypto')
    .sort((a, b) => {
      const ia = ORDEN_DE_MONEDAS.indexOf(a.ccy);
      const ib = ORDEN_DE_MONEDAS.indexOf(b.ccy);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });
  const cuentaCrc = enMoneda.find((c) => c.ccy === 'CRC');

  const pestanas: Pestana[] = [
    { id: 'total', etiqueta: t('saldo_pestana_total') },
    ...enMoneda.map((c) => ({
      id: c.ccy,
      etiqueta: c.ccy === 'CRC' ? t('saldo_pestana_crc') : c.ccy === 'USD' ? t('saldo_pestana_usd') : c.ccy,
    })),
    { id: 'cripto', etiqueta: t('nav_crypto') },
  ];
  // Una cuenta que desaparece (otra sesion, limpieza) no deja la tarjeta sin
  // pestana elegida: vuelve al total.
  const actual = pestanas.some((p) => p.id === elegida) ? elegida : 'total';

  const leer = (): Lectura => {
    if (actual === 'total') {
      const totales = saldoTotal(cuentas, monedaBase);
      return {
        etiqueta: t('total_balance'),
        monto: totales.enBase,
        moneda: monedaBase,
        // Sin tasa para alguna cuenta no hay total: se dice por que, en vez de
        // inventar una cifra.
        detalle:
          totales.enBase === null
            ? t('fx_total_unavailable')
            : // Con la base en dolares el estimado en dolares repetiria la cifra.
              totales.enUsd !== null && monedaBase !== 'USD'
              ? rellenar(t('balance_usd_estimate'), { amount: formatMoney(totales.enUsd, 'USD', { decimals: 2 }) })
              : '',
      };
    }
    if (actual === 'cripto') {
      // Sin la lista no se sabe si hay cripto o no: se dice que falta el dato.
      if (cripto.length === 0) {
        return { etiqueta: t('saldo_cripto_valor'), monto: null, moneda: 'USD', detalle: t('saldo_cripto_sin_dato') };
      }
      const conSaldo = cripto.filter((a) => a.balance > 0);
      if (conSaldo.length === 0) {
        return { etiqueta: t('saldo_cripto_valor'), monto: 0, moneda: 'USD', detalle: t('saldo_cripto_vacio') };
      }
      // El precio lo pone el feed de Cripto; sin precio de alguna, la suma
      // seria menor que lo real.
      if (conSaldo.some((a) => !tasaValida(a.currentPrice))) {
        return { etiqueta: t('saldo_cripto_valor'), monto: null, moneda: 'USD', detalle: t('saldo_cripto_sin_dato') };
      }
      const valor = conSaldo.reduce((suma, a) => suma + a.balance * a.currentPrice, 0);
      const tenencias = [...conSaldo]
        .sort((a, b) => b.balance * b.currentPrice - a.balance * a.currentPrice)
        .slice(0, 3)
        .map((a) => `${cantidadCripto(a.balance)} ${a.symbol}`);
      const resto = conSaldo.length - tenencias.length;
      return {
        etiqueta: t('saldo_cripto_valor'),
        monto: valor,
        moneda: 'USD',
        detalle: tenencias.join(', ') + (resto > 0 ? ` +${resto}` : ''),
      };
    }
    const cuenta = enMoneda.find((c) => c.ccy === actual);
    if (!cuenta) return { etiqueta: t('available_balance'), monto: null, moneda: monedaBase, detalle: '' };
    // Su equivalente en la otra moneda principal, solo con la tasa a mano.
    let detalle = '';
    if (cuenta.ccy !== 'USD') {
      const tasa = cuenta.rateToUsd;
      if (tasaValida(tasa)) detalle = `≈ ${formatMoney(cuenta.balance * tasa, 'USD', { decimals: 2 })}`;
    } else if (cuentaCrc && tasaValida(cuentaCrc.rateToUsd)) {
      detalle = `≈ ${formatMoney(cuenta.balance / cuentaCrc.rateToUsd, 'CRC', { decimals: 2 })}`;
    }
    return { etiqueta: t('available_balance'), monto: cuenta.balance, moneda: cuenta.ccy, detalle };
  };

  const lectura = leer();
  const partes = lectura.monto === null ? null : partesDelMonto(lectura.monto, lectura.moneda);
  // Cifras largas bajan de tamano para caber en un plegable cerrado (344 px).
  const largo = partes ? partes.entero.length : 1;
  const tamanoCifra = largo <= 7 ? 'text-[44px]' : largo <= 10 ? 'text-[38px]' : 'text-[30px]';

  const alTeclear = (e: React.KeyboardEvent, indice: number) => {
    let siguiente = -1;
    if (e.key === 'ArrowRight') siguiente = (indice + 1) % pestanas.length;
    else if (e.key === 'ArrowLeft') siguiente = (indice - 1 + pestanas.length) % pestanas.length;
    else if (e.key === 'Home') siguiente = 0;
    else if (e.key === 'End') siguiente = pestanas.length - 1;
    if (siguiente < 0) return;
    e.preventDefault();
    setElegida(pestanas[siguiente].id);
    refsPestanas.current[siguiente]?.focus();
  };

  const idPanel = `${idBase}-panel`;
  const idPestana = (id: string) => `${idBase}-pestana-${id}`;

  return (
    <section aria-label={t('saldo_seccion')} className="kp-tarjeta-metal @container/saldo relative overflow-hidden rounded-[28px] p-[18px] pb-4 text-[var(--color-text-primary-dark)]">
      {/* Filo naranja: el unico naranja de la pantalla, la firma de la marca. */}
      <span aria-hidden="true" className="absolute left-7 top-0 h-[3px] w-11 rounded-b-[3px] bg-[var(--color-accent)]" />
      <span aria-hidden="true" className="kp-brillo pointer-events-none absolute -bottom-[30%] -top-[30%] left-0 w-[26%]" />
      <MarcaKiramo monocromo size={190} className="pointer-events-none absolute -bottom-[34px] -right-[18px] opacity-[0.06]" />

      <div
        role="tablist"
        aria-label={t('saldo_pestanas')}
        className="no-scrollbar relative -mx-0.5 flex max-w-full gap-1 overflow-x-auto rounded-xl bg-[rgba(5,11,24,0.45)] p-[3px] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)] w-max"
      >
        {pestanas.map((p, i) => {
          const sel = p.id === actual;
          return (
            <button
              key={p.id}
              ref={(el) => { refsPestanas.current[i] = el; }}
              id={idPestana(p.id)}
              role="tab"
              type="button"
              aria-selected={sel}
              aria-controls={idPanel}
              tabIndex={sel ? 0 : -1}
              onClick={() => setElegida(p.id)}
              onKeyDown={(e) => alTeclear(e, i)}
              className={`kp-toque kp-foco shrink-0 whitespace-nowrap rounded-[9px] px-3 py-1.5 text-xs font-semibold ${
                sel ? 'bg-[#EEF2F8] text-[#0A1428]' : 'text-[var(--color-text-secondary-dark)] hover:text-[var(--color-text-primary-dark)]'
              }`}
            >
              {p.etiqueta}
            </button>
          );
        })}
      </div>

      <div id={idPanel} role="tabpanel" aria-labelledby={idPestana(actual)} className="relative">
        <div className="@min-[34rem]/saldo:flex @min-[34rem]/saldo:items-end @min-[34rem]/saldo:justify-between @min-[34rem]/saldo:gap-6">
          <div className="min-w-0 @min-[34rem]/saldo:flex-1">
            <div className="mt-4 flex items-center gap-2">
              <p className="min-w-0 truncate text-[13px] text-[var(--color-text-secondary-dark)]">{lectura.etiqueta}</p>
              <button
                type="button"
                onClick={alternarOculto}
                aria-pressed={oculto}
                aria-label={t('saldo_ocultar')}
                className="kp-toque kp-foco -my-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-[var(--color-text-secondary-dark)] hover:text-[var(--color-text-primary-dark)] -ml-2"
              >
                {oculto ? <IconosLinea.OjoTachado size={18} /> : <IconosLinea.Ojo size={18} />}
              </button>
              <button
                type="button"
                onClick={onAgregarDinero}
                className="kp-toque kp-foco ml-auto flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-white/[0.08] pl-2 pr-3 text-xs font-semibold text-[var(--color-text-primary-dark)] shadow-[inset_0_1px_0_rgba(255,255,255,0.10),inset_0_0_0_1px_rgba(255,255,255,0.08)] hover:bg-white/[0.13] @max-[19rem]/saldo:w-9 @max-[19rem]/saldo:justify-center @max-[19rem]/saldo:p-0"
              >
                <IconosLinea.AgregarDinero size={18} />
                <span className="@max-[19rem]/saldo:sr-only">{t('add_money')}</span>
              </button>
            </div>

            <div key={`${actual}-${oculto}`} className="kp-cifra-entra">
              <p className={`kp-num mt-1.5 whitespace-nowrap font-medium leading-none tracking-[-0.045em] ${tamanoCifra}`}>
                {oculto ? (
                  // La linea de abajo ya dice "Saldo oculto" (y la lee el
                  // lector de pantalla): aqui solo los puntos.
                  <span aria-hidden="true">••••••</span>
                ) : partes === null ? (
                  // Sin dato: un guion, nunca un cero.
                  <span>—</span>
                ) : (
                  <>
                    {partes.signo}
                    <span className="mr-[3px] align-[0.38em] text-[0.55em] text-[var(--color-text-secondary-dark)]">{partes.simbolo}</span>
                    <span>{partes.entero}</span>
                    <span className="text-[0.55em] text-[var(--color-text-muted-dark)]">{partes.decimales}</span>
                  </>
                )}
              </p>
              <p className="kp-num mt-2.5 min-h-[1.25rem] text-[13px] leading-snug text-[var(--color-text-secondary-dark)]">
                {oculto ? t('saldo_oculto') : lectura.detalle}
              </p>
            </div>
          </div>

          <nav
            aria-label={t('quick_actions')}
            className="mt-5 flex justify-between @min-[26rem]/saldo:justify-start @min-[26rem]/saldo:gap-5 @min-[34rem]/saldo:mt-0 @min-[34rem]/saldo:shrink-0 @min-[34rem]/saldo:gap-3"
          >
            {acciones.map((a, i) => {
              const Icono = ICONO_DE_ACCION[a.id];
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={a.onClick}
                  aria-label={a.nombreAccesible}
                  className="kp-toque kp-foco group flex w-[68px] flex-col items-center gap-[7px] rounded-2xl"
                >
                  <span
                    className={`flex h-[52px] w-[52px] items-center justify-center rounded-[17px] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.10),inset_0_0_0_1px_rgba(255,255,255,0.06)] transition-colors ${
                      i === 0 ? 'bg-[var(--color-primary-fill)] group-hover:bg-[var(--color-primary-hover)]' : 'bg-white/[0.07] group-hover:bg-white/[0.12]'
                    }`}
                  >
                    <Icono size={24} />
                  </span>
                  <span className="text-center text-xs font-medium leading-tight text-[#C9D4E6]">{a.etiqueta}</span>
                </button>
              );
            })}
          </nav>
        </div>
      </div>
    </section>
  );
};

export type { Accion as AccionDeSaldo };
