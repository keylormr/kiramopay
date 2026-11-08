import React, { useEffect, useMemo, useRef, useState } from 'react';
import { OverlayShell } from '@/components/OverlayShell';
import { Icons } from '@/components/Icons';
import { Button } from '@/components/ui';
import { useLanguage } from '@/i18n/LanguageContext';
import { rellenar } from '@/utils/planes';
import { formatMoney, type CurrencyCode } from '@/utils/money';
import { entregarArchivo, type EstadoExport } from '@/utils/entregarArchivo';
import { leerEstadoDeCuenta, leerIngresos, type Lectura } from './lector';
import { mesesDe, monedasDe, sumar } from './ingresos';
import { construirCsv } from './csvSalida';
import { ErrorDeLectura, type CodigoError, type Ingreso } from './tipos';

interface Props {
  onClose: () => void;
}

type Fase = 'inicio' | 'leyendo' | 'columnas' | 'resumen' | 'error';

interface Seleccion {
  fecha: number | null;
  descripcion: number | null;
  ingreso: number | null;
  moneda: number | null;
}

const CLAVE_DE_ERROR: Record<CodigoError, string> = {
  PDF: 'contador_err_pdf',
  XLS_VIEJO: 'contador_err_xls',
  GRANDE: 'contador_err_grande',
  MUCHAS_FILAS: 'contador_err_filas',
  SIN_COBROS: 'contador_err_sin_cobros',
  ILEGIBLE: 'contador_err_ilegible',
};

const ACEPTA = '.xlsx,.xls,.csv,.txt,.tsv,.html,.htm,text/csv,text/plain,text/html,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel';

const CAMPO =
  'w-full min-h-11 rounded-xl border border-[var(--color-border)] dark:border-[var(--color-border-dark)] bg-[var(--color-surface-2)] dark:bg-[var(--color-surface-2-dark)] px-3 text-sm uv-text-primary uv-focus-ring';

/**
 * Resumen para el contador. Lee el estado de cuenta que la persona bajo de su
 * banco, separa los cobros SINPE y arma el CSV del mes. No mueve dinero, no
 * calcula impuestos y no emite facturas.
 *
 * El archivo vive solo en el estado de este componente: no se envia al
 * servidor ni se guarda en el almacenamiento del navegador.
 */
export const ResumenParaContador: React.FC<Props> = ({ onClose }) => {
  const { t, language } = useLanguage();
  const [fase, setFase] = useState<Fase>('inicio');
  const [codigoError, setCodigoError] = useState<CodigoError>('ILEGIBLE');
  const [lectura, setLectura] = useState<Lectura | null>(null);
  const [seleccion, setSeleccion] = useState<Seleccion>({ fecha: null, descripcion: null, ingreso: null, moneda: null });
  const [ingresos, setIngresos] = useState<Ingreso[]>([]);
  const [omitidas, setOmitidas] = useState(0);
  const [mes, setMes] = useState('');
  const [moneda, setMoneda] = useState('');
  // Solo lo que la persona cambio; lo demas sigue a "es SINPE".
  const [marcas, setMarcas] = useState<Record<string, boolean>>({});
  const [otrosAbiertos, setOtrosAbiertos] = useState(false);
  const [entrega, setEntrega] = useState<EstadoExport>('quieto');
  const entregando = useRef(false);
  const lecturaVigente = useRef(0);
  const entrada = useRef<HTMLInputElement>(null);
  const encabezado = useRef<HTMLHeadingElement>(null);
  const primeraVez = useRef(true);

  useEffect(() => () => { lecturaVigente.current += 1; }, []);

  // Al cambiar de paso el foco va al encabezado nuevo.
  useEffect(() => {
    if (primeraVez.current) { primeraVez.current = false; return; }
    encabezado.current?.focus();
  }, [fase]);

  const meses = useMemo(() => mesesDe(ingresos), [ingresos]);
  const monedas = useMemo(() => monedasDe(ingresos), [ingresos]);

  const dinero = (centimos: number, codigo: string) =>
    codigo === 'CRC' || codigo === 'USD'
      ? formatMoney(centimos / 100, codigo as CurrencyCode, { decimals: 2 })
      : `${codigo} ${(centimos / 100).toLocaleString(language, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const etiquetaDeMes = (m: string) => {
    const [a, n] = m.split('-').map(Number);
    const texto = new Intl.DateTimeFormat(language === 'zh-cn' ? 'zh-CN' : language, {
      month: 'long', year: 'numeric', timeZone: 'UTC',
    }).format(new Date(Date.UTC(a, n - 1, 1)));
    return texto.charAt(0).toLocaleUpperCase(language) + texto.slice(1);
  };

  const fechaCorta = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

  const aResumen = (lista: Ingreso[], perdidas: number) => {
    const ms = mesesDe(lista);
    const mn = monedasDe(lista);
    setIngresos(lista);
    setOmitidas(perdidas);
    setMes(ms[ms.length - 1]);
    setMoneda(mn.includes('CRC') ? 'CRC' : mn[0]);
    setMarcas({});
    setOtrosAbiertos(false);
    setEntrega('quieto');
    setFase('resumen');
  };

  const fallar = (e: unknown) => {
    setCodigoError(e instanceof ErrorDeLectura ? e.codigo : 'ILEGIBLE');
    setFase('error');
  };

  const elegir = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const archivo = e.target.files?.[0];
    e.target.value = '';
    if (!archivo) return;
    const turno = ++lecturaVigente.current;
    setFase('leyendo');
    try {
      const l = await leerEstadoDeCuenta(archivo);
      if (turno !== lecturaVigente.current) return;
      setLectura(l);
      const c = l.deteccion.columnas;
      if (l.deteccion.confiable) {
        const r = leerIngresos(l, c);
        aResumen(r.ingresos, r.omitidas);
      } else {
        setSeleccion({ fecha: c.fecha, descripcion: c.descripcion, ingreso: c.credito ?? c.monto, moneda: c.moneda });
        setFase('columnas');
      }
    } catch (err) {
      if (turno === lecturaVigente.current) fallar(err);
    }
  };

  const confirmarColumnas = () => {
    if (!lectura || seleccion.fecha === null || seleccion.ingreso === null) return;
    try {
      const r = leerIngresos(lectura, {
        fecha: seleccion.fecha,
        descripcion: seleccion.descripcion,
        credito: seleccion.ingreso,
        debito: null,
        monto: null,
        moneda: seleccion.moneda,
      });
      aResumen(r.ingresos, r.omitidas);
    } catch (err) {
      fallar(err);
    }
  };

  const esVenta = (x: Ingreso) => marcas[x.id] ?? x.esSinpe;
  const delMes = ingresos.filter((x) => x.mes === mes && x.moneda === moneda);
  const sinpe = delMes.filter((x) => x.esSinpe);
  const otros = delMes.filter((x) => !x.esSinpe);
  const ventas = delMes.filter(esVenta);
  const totalVentas = sumar(ventas);

  const alternar = (x: Ingreso) => {
    setMarcas((m) => ({ ...m, [x.id]: !esVenta(x) }));
    setEntrega('quieto');
  };

  const compartir = async () => {
    if (entregando.current || delMes.length === 0) return;
    entregando.current = true;
    setEntrega('exportando');
    try {
      const csv = construirCsv(delMes, esVenta, {
        fecha: t('contador_csv_fecha'),
        descripcion: t('contador_csv_descripcion'),
        monto: t('contador_csv_monto'),
        moneda: t('contador_csv_moneda'),
        esSinpe: t('contador_csv_sinpe'),
        esVenta: t('contador_csv_venta'),
        si: t('contador_csv_si'),
        no: t('contador_csv_no'),
        totalVentas: t('contador_csv_total'),
        cantidadVentas: t('contador_csv_cantidad'),
      });
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const sufijo = monedas.length > 1 ? `-${moneda}` : '';
      setEntrega(await entregarArchivo(blob, `KiramoPay-${t('contador_archivo')}-${mes}${sufijo}.csv`));
    } catch {
      setEntrega('error');
    } finally {
      entregando.current = false;
    }
  };

  const reiniciar = () => {
    lecturaVigente.current += 1;
    setLectura(null);
    setIngresos([]);
    setMarcas({});
    setEntrega('quieto');
    setFase('inicio');
  };

  const mensajeEntrega: Partial<Record<EstadoExport, { clave: string; ok: boolean }>> = {
    listo: { clave: 'contador_ok_listo', ok: true },
    compartido: { clave: 'contador_ok_compartido', ok: true },
    error: { clave: 'contador_err_envio', ok: false },
    plan: { clave: 'contador_err_envio', ok: false },
    solo_web: { clave: 'contador_err_solo_web', ok: false },
  };
  const aviso = mensajeEntrega[entrega];

  const titulo = 'text-base font-black uv-text-primary outline-none';

  const botonElegir = (variante: 'primary' | 'secondary', clave: string) => (
    <Button
      variant={variante}
      size="lg"
      fullWidth
      onClick={() => entrada.current?.click()}
      leftIcon={<Icons.Upload size={18} aria-hidden="true" />}
    >
      {t(clave)}
    </Button>
  );

  const fila = (x: Ingreso) => {
    const activo = esVenta(x);
    return (
      <li key={x.id} className="flex items-center gap-3 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold uv-text-primary break-words">{x.descripcion || '—'}</p>
          <p className="mt-0.5 text-xs uv-text-muted tabular-nums">
            {fechaCorta(x.fecha)} · <span className="font-semibold uv-text-secondary">{dinero(x.centimos, x.moneda)}</span>
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={activo}
          aria-label={`${t('contador_es_venta')}: ${x.descripcion || fechaCorta(x.fecha)}`}
          onClick={() => alternar(x)}
          className="flex min-h-11 min-w-14 shrink-0 flex-col items-center justify-center gap-1 rounded-xl px-1 uv-focus-ring"
        >
          <span
            aria-hidden="true"
            className={`block h-6 w-11 rounded-full p-0.5 transition-colors motion-reduce:transition-none ${
              activo ? 'bg-[var(--color-primary-fill)]' : 'bg-gray-300 dark:bg-slate-600'
            }`}
          >
            <span
              className={`block h-5 w-5 rounded-full bg-white shadow transition-transform motion-reduce:transition-none ${
                activo ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </span>
          <span aria-hidden="true" className="text-xs uv-text-muted">{t('contador_es_venta')}</span>
        </button>
      </li>
    );
  };

  const divisor = 'divide-y divide-[var(--color-border)] dark:divide-[var(--color-border-dark)]';

  return (
    <OverlayShell title={t('contador_titulo')} onClose={onClose}>
      <div className="pb-24 pt-4 px-4 space-y-5">
        <input
          ref={entrada}
          type="file"
          accept={ACEPTA}
          onChange={(e) => void elegir(e)}
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          data-testid="contador-archivo"
        />

        {fase === 'inicio' && (
          <>
            <p className="text-sm leading-relaxed uv-text-secondary">{t('contador_intro')}</p>
            <div className="flex items-start gap-3 rounded-2xl bg-[var(--color-surface-2)] dark:bg-[var(--color-surface-2-dark)] p-4">
              <Icons.Lock size={18} className="mt-0.5 shrink-0 uv-text-secondary" aria-hidden="true" />
              <p className="text-sm font-semibold uv-text-primary">{t('contador_promesa')}</p>
            </div>
            {botonElegir('primary', 'contador_elegir')}
            <p className="text-xs leading-relaxed uv-text-muted">{t('contador_formatos')}</p>
            <p className="text-sm leading-relaxed uv-text-secondary">{t('contador_nota_hacienda')}</p>
          </>
        )}

        {fase === 'leyendo' && (
          <p role="status" className="py-10 text-center text-sm uv-text-secondary">{t('contador_leyendo')}</p>
        )}

        {fase === 'columnas' && lectura && (
          <section aria-labelledby="contador-cols" className="space-y-4">
            <div>
              <h2 id="contador-cols" ref={encabezado} tabIndex={-1} className={titulo}>{t('contador_cols_titulo')}</h2>
              <p className="mt-1 text-sm leading-relaxed uv-text-secondary">{t('contador_cols_desc')}</p>
            </div>
            {(
              [
                ['fecha', 'contador_col_fecha', false],
                ['descripcion', 'contador_col_descripcion', false],
                ['ingreso', 'contador_col_ingreso', false],
                ['moneda', 'contador_col_moneda', true],
              ] as const
            ).map(([campo, clave, opcional]) => {
              const ancho = Math.max(0, ...lectura.tabla.slice(0, 60).map((f) => f.length));
              const encabezados = lectura.tabla[lectura.deteccion.filaEncabezado] ?? [];
              return (
                <label key={campo} className="block">
                  <span className="mb-1 block text-xs font-semibold uv-text-muted">{t(clave)}</span>
                  <select
                    className={CAMPO}
                    value={seleccion[campo] === null ? '' : String(seleccion[campo])}
                    onChange={(e) =>
                      setSeleccion((s) => ({ ...s, [campo]: e.target.value === '' ? null : Number(e.target.value) }))
                    }
                  >
                    <option value="">{opcional ? t('contador_col_ninguna') : ''}</option>
                    {Array.from({ length: ancho }, (_, i) => (
                      <option key={i} value={i}>
                        {`${i + 1}. ${String(encabezados[i] ?? '').slice(0, 40)}`.trim()}
                      </option>
                    ))}
                  </select>
                </label>
              );
            })}
            <div>
              <h3 className="mb-2 text-xs font-semibold uv-text-muted">{t('contador_vista_previa')}</h3>
              <div className="overflow-x-auto rounded-2xl border border-[var(--color-border)] dark:border-[var(--color-border-dark)]">
                <table className="w-full text-left text-xs uv-text-primary">
                  <tbody className={divisor}>
                    {lectura.tabla
                      .slice(lectura.deteccion.filaEncabezado, lectura.deteccion.filaEncabezado + 4)
                      .map((f, i) => (
                        <tr key={i} className={i === 0 ? 'font-bold bg-[var(--color-surface-2)] dark:bg-[var(--color-surface-2-dark)]' : ''}>
                          {f.slice(0, 8).map((c, j) => (
                            <td key={j} className="max-w-[9rem] truncate whitespace-nowrap px-2.5 py-2">{String(c)}</td>
                          ))}
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
            <Button
              size="lg"
              fullWidth
              onClick={confirmarColumnas}
              disabled={seleccion.fecha === null || seleccion.ingreso === null}
            >
              {t('contador_continuar')}
            </Button>
            <Button variant="ghost" size="lg" fullWidth onClick={reiniciar}>{t('contador_otro_archivo')}</Button>
          </section>
        )}

        {fase === 'error' && (
          <section className="space-y-4">
            <p
              role="alert"
              ref={encabezado as unknown as React.RefObject<HTMLParagraphElement>}
              tabIndex={-1}
              className="rounded-2xl bg-[var(--color-surface-2)] dark:bg-[var(--color-surface-2-dark)] p-4 text-sm font-semibold leading-relaxed text-[var(--color-danger)] dark:text-[var(--color-danger-strong-dark)] outline-none"
            >
              {t(CLAVE_DE_ERROR[codigoError])}
            </p>
            {botonElegir('primary', 'contador_otro_archivo')}
          </section>
        )}

        {fase === 'resumen' && (
          <section className="space-y-5" aria-label={t('contador_titulo')}>
            <div className={`grid grid-cols-1 gap-3 ${monedas.length > 1 ? 'min-[360px]:grid-cols-2' : ''}`}>
              <label className="block">
                <span className="mb-1 block text-xs font-semibold uv-text-muted">{t('contador_mes')}</span>
                <select className={CAMPO} value={mes} onChange={(e) => { setMes(e.target.value); setEntrega('quieto'); }}>
                  {meses.map((m) => <option key={m} value={m}>{etiquetaDeMes(m)}</option>)}
                </select>
              </label>
              {monedas.length > 1 && (
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold uv-text-muted">{t('contador_moneda')}</span>
                  <select className={CAMPO} value={moneda} onChange={(e) => { setMoneda(e.target.value); setEntrega('quieto'); }}>
                    {monedas.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </label>
              )}
            </div>

            <div className="uv-surface-1 rounded-2xl uv-shadow-soft p-4" aria-live="polite" aria-atomic="true">
              <h2 id="contador-total" ref={encabezado} tabIndex={-1} className="text-sm font-semibold uv-text-secondary outline-none">
                {t('contador_total_ventas')}
              </h2>
              <p className="mt-1 text-2xl font-black tracking-tight tabular-nums uv-text-primary">
                {dinero(totalVentas, moneda)}
              </p>
              <p className="mt-0.5 text-sm uv-text-muted">
                {ventas.length === 1 ? t('contador_cantidad_una') : rellenar(t('contador_cantidad_otras'), { n: String(ventas.length) })}
              </p>
            </div>

            <p className="text-xs leading-relaxed uv-text-muted">{t('contador_aviso')}</p>

            <div>
              <h3 className="mb-1 text-xs font-semibold uv-text-muted">{t('contador_lista_sinpe')}</h3>
              {sinpe.length === 0 ? (
                <p className="py-3 text-sm uv-text-secondary">{t('contador_sin_sinpe')}</p>
              ) : (
                <ul className={`uv-surface-1 rounded-2xl uv-shadow-soft px-4 ${divisor}`}>{sinpe.map(fila)}</ul>
              )}
            </div>

            {otros.length > 0 && (
              <div>
                <button
                  type="button"
                  aria-expanded={otrosAbiertos}
                  aria-controls="contador-otros"
                  onClick={() => setOtrosAbiertos((a) => !a)}
                  className="flex min-h-11 w-full items-center justify-between gap-2 rounded-xl px-1 text-left text-sm font-semibold uv-text-primary uv-focus-ring"
                >
                  <span>{rellenar(t('contador_otros'), { n: String(otros.length) })}</span>
                  <Icons.ChevronRight
                    size={18}
                    aria-hidden="true"
                    className={`uv-text-muted transition-transform motion-reduce:transition-none ${otrosAbiertos ? 'rotate-90' : ''}`}
                  />
                </button>
                {otrosAbiertos && (
                  <ul id="contador-otros" className={`mt-1 uv-surface-1 rounded-2xl uv-shadow-soft px-4 ${divisor}`}>
                    {otros.map(fila)}
                  </ul>
                )}
              </div>
            )}

            {omitidas > 0 && (
              <p className="text-xs leading-relaxed uv-text-muted">{rellenar(t('contador_omitidas'), { n: String(omitidas) })}</p>
            )}

            <div className="space-y-3">
              <Button
                size="lg"
                fullWidth
                onClick={() => void compartir()}
                loading={entrega === 'exportando'}
                disabled={delMes.length === 0}
                leftIcon={<Icons.Share size={18} aria-hidden="true" />}
              >
                {t('contador_compartir')}
              </Button>
              <div aria-live="polite">
                {aviso && (
                  <p
                    role={aviso.ok ? 'status' : 'alert'}
                    className={`text-sm ${aviso.ok ? 'text-[var(--color-success-strong)] dark:text-[var(--color-success-strong-dark)]' : 'text-[var(--color-danger)] dark:text-[var(--color-danger-strong-dark)]'}`}
                  >
                    {t(aviso.clave)}
                  </p>
                )}
              </div>
              {botonElegir('secondary', 'contador_otro_archivo')}
            </div>
          </section>
        )}
      </div>
    </OverlayShell>
  );
};
