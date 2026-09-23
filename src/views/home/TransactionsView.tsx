import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useApp } from '@/hooks/useApp';
import { getApiLayer } from '@/api';
import { useLanguage } from '@/i18n/LanguageContext';
import { txTitle } from '@/utils/txTitle';
import { fechaCorta } from '@/utils/fechaPlazo';
import { Icons } from '@/components/Icons';
import { BottomSheet } from '@/components/BottomSheet';
import { TransactionDetailSheet } from '@/components/TransactionDetailSheet';
import {
  estiloDeCategoria,
  etiquetaDeCategoria,
  normalizarCategoria,
  type CategoriaMovimiento,
} from '@/utils/categoriaMovimiento';
import {
  exportTransactionsCSV,
  exportTransactionsJSON,
  copyTransactionsToClipboard,
  shareTransactions,
} from '@/utils/export';
import type { Transaction } from '@/types';

// Filas viejas del backend pueden llegar sin moneda; se asume la del pais.
const ccyDe = (tx: Transaction) => tx.ccy || 'CRC';

// El tope del servidor por pagina.
const TAMANO_PAGINA = 100;

// Las tres tarjetas de resumen comparten el ancho de la pantalla, asi que el
// monto tenia `truncate` y salia "+₡8,075…". Mientras los totales cubrian 50
// filas eso rara vez pasaba; cubriendo el historial completo es lo normal, y un
// total a medias no es un total. Se achica la letra en vez de cortar el numero.
//
// La escalera solo aplica en pantalla angosta: apretadas contra los 390px del
// telefono las tres tarjetas dejan unos 85px al numero. De `sm` en adelante hay
// ancho de sobra y el monto vuelve a su tamano normal.
function claseDeMonto(texto: string): string {
  const escalera =
    texto.length > 13 ? 'text-[10px]' : texto.length > 11 ? 'text-xs' : texto.length > 9 ? 'text-sm' : 'text-base';
  return `${escalera} sm:text-base`;
}

// Cuanto se espera antes de preguntarle al servidor. Sin esta espera, cada
// tecla seria una consulta.
const ESPERA_BUSQUEDA_MS = 350;

export const TransactionsView: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { state } = useApp();
  const { t } = useLanguage();
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<CategoriaMovimiento | null>(null);
  const [showExportSheet, setShowExportSheet] = useState(false);
  // El aviso lleva su tipo: un "Error" pintado con el check verde del exito
  // decia que la copia habia funcionado.
  const [toast, setToast] = useState<{ texto: string; tipo: 'ok' | 'error' } | null>(null);
  // Detalle del movimiento tocado. `detalleAbierto` va aparte para que la hoja
  // conserve su contenido mientras se anima al cerrarse.
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);
  const [detalleAbierto, setDetalleAbierto] = useState(false);

  const showToast = (texto: string, tipo: 'ok' | 'error' = 'ok') => {
    setToast({ texto, tipo });
    setTimeout(() => setToast(null), 2500);
  };

  const abrirDetalle = (tx: Transaction) => {
    setSelectedTx(tx);
    setDetalleAbierto(true);
  };

  // La busqueda la resuelve el SERVIDOR, sobre TODO el historial.
  //
  // Antes esta pantalla filtraba `state.transactions`, que son las ultimas 50
  // filas que sincronizo la aplicacion: un movimiento del mes pasado no
  // aparecia por mas que se escribiera su nombre exacto, y —peor— las tarjetas
  // de arriba sumaban esas mismas 50 filas y presentaban el resultado como si
  // fuera el total del periodo.
  //
  // `consulta` es el texto ya asentado; `search` es lo que se esta tecleando.
  const [consulta, setConsulta] = useState('');
  const [pagina, setPagina] = useState<{ clave: string; txs: Transaction[]; total: number } | null>(null);
  const [cargando, setCargando] = useState(false);
  // Por que se esta buscando solo en lo guardado en este dispositivo.
  //
  // Antes era un booleano y el aviso decia siempre "Sin conexion con el
  // servidor". Un 429 caia ahi: el servidor SI habia respondido —hay demasiado
  // trafico y hay que esperar un momento— y la pantalla mandaba a revisar la
  // conexion, que esta perfecta. El respaldo local es el mismo en los dos
  // casos; lo que cambia es que se dice.
  const [motivoLocal, setMotivoLocal] = useState<'sin_red' | 'demasiado_trafico' | null>(null);
  const modoLocal = motivoLocal !== null;

  useEffect(() => {
    const id = setTimeout(() => setConsulta(search.trim()), ESPERA_BUSQUEDA_MS);
    return () => clearTimeout(id);
  }, [search]);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      setCargando(true);
      try {
        const res = await getApiLayer().transactions.listTransactions({
          limit: TAMANO_PAGINA,
          offset: 0,
          search: consulta || undefined,
        });
        if (cancelado) return;
        if (!res.success || !res.data) {
          // Sin servidor no hay forma de buscar sobre el historial completo. Se
          // cae a lo que este dispositivo tiene guardado Y SE DICE: un resultado
          // parcial presentado como completo es peor que no tener buscador.
          // RATE_LIMITED no es falta de red: el servidor contesto que hay
          // demasiado trafico, y eso se arregla esperando, no revisando el WiFi.
          setMotivoLocal(res.error?.code === 'RATE_LIMITED' ? 'demasiado_trafico' : 'sin_red');
          setPagina(null);
          return;
        }
        setMotivoLocal(null);
        setPagina({ clave: consulta, txs: res.data.transactions, total: res.data.total });
      } catch {
        // Una excepcion aqui no la produce un rechazo del servidor (el cliente
        // HTTP los devuelve en el sobre): es que la peticion no llego.
        if (cancelado) return;
        setMotivoLocal('sin_red');
        setPagina(null);
      } finally {
        if (!cancelado) setCargando(false);
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [consulta]);

  // Movimientos que llegan con la pantalla abierta.
  //
  // Desde que la lista la trae el servidor (#182), la pantalla dejo de mirar
  // el estado local: un SINPE que entraba mientras estaba abierta no aparecia
  // hasta cerrarla y volver a abrirla. El estado local si se entera (lo
  // refresca la sincronizacion al llegar el aviso por WebSocket), asi que
  // cuando cambia su movimiento mas reciente se vuelve a pedir la primera
  // pagina y se FUNDE con lo que hay: los nuevos arriba, los que ya estaban
  // con sus datos al dia, y las paginas que la persona ya cargo no se pierden.
  const masRecienteLocal = state.transactions[0]?.id;
  const recienteVisto = useRef(masRecienteLocal);
  useEffect(() => {
    if (!masRecienteLocal || masRecienteLocal === recienteVisto.current) return;
    recienteVisto.current = masRecienteLocal;
    let cancelado = false;
    (async () => {
      const res = await getApiLayer().transactions.listTransactions({
        limit: TAMANO_PAGINA,
        offset: 0,
        search: consulta || undefined,
      });
      if (cancelado || !res.success || !res.data) return;
      const datos = res.data;
      setPagina((prev) => {
        if (!prev || prev.clave !== consulta) return prev;
        const frescos = new Map(datos.transactions.map((tx) => [tx.id, tx]));
        const previos = new Set(prev.txs.map((tx) => tx.id));
        const nuevos = datos.transactions.filter((tx) => !previos.has(tx.id));
        return {
          clave: prev.clave,
          txs: [...nuevos, ...prev.txs.map((tx) => frescos.get(tx.id) ?? tx)],
          total: datos.total,
        };
      });
    })();
    return () => {
      cancelado = true;
    };
  }, [masRecienteLocal, consulta]);

  const cargarMas = useCallback(async () => {
    if (!pagina || cargando) return;
    const clave = pagina.clave;
    const desde = pagina.txs.length;
    setCargando(true);
    try {
      const res = await getApiLayer().transactions.listTransactions({
        limit: TAMANO_PAGINA,
        offset: desde,
        search: clave || undefined,
      });
      if (!res.success || !res.data) return;
      const datos = res.data;
      setPagina((prev) => {
        // Si mientras tanto cambio la busqueda, esta respuesta ya no es de esta
        // pantalla.
        if (!prev || prev.clave !== clave) return prev;
        // Se acumula POR ID: OFFSET no es estable frente a escrituras. Un
        // movimiento que entra entre dos paginas corre a todos los demas, asi
        // que una fila ya traida volveria a llegar y se contaria dos veces en
        // los totales de arriba.
        const porId = new Map(prev.txs.map((tx) => [tx.id, tx]));
        for (const tx of datos.transactions) porId.set(tx.id, tx);
        return { clave, txs: [...porId.values()], total: datos.total };
      });
    } catch {
      // Se queda con lo que ya se habia traido.
    } finally {
      setCargando(false);
    }
  }, [pagina, cargando]);

  // Derived data
  const allTransactions = pagina ? pagina.txs : state.transactions;
  // Los chips salen de la categoria NORMALIZADA (utils/categoriaMovimiento): un
  // slug desconocido cuenta como "otros" en vez de imprimirse crudo.
  const categories = useMemo(() => {
    const cats = new Set<CategoriaMovimiento>();
    allTransactions.forEach((tx) => cats.add(normalizarCategoria(tx.category)));
    return Array.from(cats);
  }, [allTransactions]);

  // La lista en pantalla corresponde a lo que esta escrito en el buscador?
  // Mientras la busqueda espera su turno o viaja al servidor, la pagina anterior
  // sigue en memoria: pintarla hacia creer que el filtro no habia funcionado
  // (36 filas visibles con "zzz" escrito, durante segundos).
  const buscando = !modoLocal && (pagina ? pagina.clave : '') !== search.trim();

  const filtered = useMemo(() => {
    let txs = allTransactions;
    if (selectedCategory) {
      txs = txs.filter((tx) => normalizarCategoria(tx.category) === selectedCategory);
    }
    // El texto lo filtra el servidor. Aca solo se vuelve a filtrar cuando NO
    // hubo servidor y se esta mostrando lo guardado en el dispositivo: filtrar
    // dos veces descartaria filas que el servidor encontro por campos que el
    // cliente no tiene (el telefono de la contraparte, la referencia externa).
    if (modoLocal && consulta) {
      const q = consulta.toLowerCase();
      txs = txs.filter(
        (tx) =>
          txTitle(tx, t).toLowerCase().includes(q) ||
          etiquetaDeCategoria(tx.category, t).toLowerCase().includes(q) ||
          tx.amount.toString().includes(q),
      );
    }
    return txs;
    // `t` entra en las dependencias porque la búsqueda del respaldo local
    // compara contra el título resuelto, que depende del idioma activo.
  }, [allTransactions, selectedCategory, modoLocal, consulta, t]);

  // Las tarjetas de resumen rotulan UNA moneda, asi que suman UNA moneda. Cada
  // fila de la lista ya se formatea con su propia tx.ccy; los totales sumaban
  // colones y dolares 1:1 y los rotulaban con la moneda base, que se cambia con
  // un toque en el home. Se rotula la moneda base; solo si no hay ni un
  // movimiento en ella se cae a la mas frecuente, para no mostrar ceros.
  const { resumenCcy, enResumenCcy, otrasMonedas } = useMemo(() => {
    const counts = new Map<string, number>();
    for (const tx of filtered) {
      const c = ccyDe(tx);
      counts.set(c, (counts.get(c) || 0) + 1);
    }
    const base = state.baseCurrency || 'CRC';
    let ccy = base;
    if (!counts.has(base) && counts.size > 0) {
      ccy = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    }
    const enCcy = filtered.filter((tx) => ccyDe(tx) === ccy);
    return {
      resumenCcy: ccy,
      enResumenCcy: enCcy,
      otrasMonedas: filtered.length - enCcy.length,
    };
  }, [filtered, state.baseCurrency]);

  const totalIncome = useMemo(
    () => enResumenCcy.filter((tx) => tx.amount > 0).reduce((s, tx) => s + tx.amount, 0),
    [enResumenCcy],
  );
  const totalExpenses = useMemo(
    () => enResumenCcy.filter((tx) => tx.amount < 0).reduce((s, tx) => s + Math.abs(tx.amount), 0),
    [enResumenCcy],
  );
  const net = totalIncome - totalExpenses;

  const formatCurrency = (amount: number, ccy?: string) => {
    try {
      return new Intl.NumberFormat('en-US', { style: 'currency', currencyDisplay: 'narrowSymbol', currency: ccy || 'CRC' }).format(amount);
    } catch {
      return `${amount.toFixed(2)} ${ccy || ''}`;
    }
  };

  // Export handlers. Lo exportado se titula igual que la pantalla: un SINPE sin
  // contraparte ni nota trae el titulo vacio y la fila del archivo quedaba sin
  // nombre, mientras la lista lo mostraba como "Transferencia SINPE enviada".
  const conTitulos = () => filtered.map((tx) => ({ ...tx, title: txTitle(tx, t) }));
  const handleExportCSV = () => {
    exportTransactionsCSV(conTitulos());
    setShowExportSheet(false);
    showToast(t('export_success'));
  };
  const handleExportJSON = () => {
    exportTransactionsJSON(conTitulos());
    setShowExportSheet(false);
    showToast(t('export_success'));
  };
  const handleCopy = async () => {
    const ok = await copyTransactionsToClipboard(conTitulos());
    setShowExportSheet(false);
    if (ok) showToast(t('copied_to_clipboard'));
    else showToast(t('export_copy_failed'), 'error');
  };
  const handleShare = async () => {
    await shareTransactions(conTitulos());
    setShowExportSheet(false);
  };

  return (
    // La entrada usa la misma clase que el resto de las pantallas superpuestas
    // (Ahorros, Analisis, etc.). Antes traia `animate-onboard-slide`, la unica
    // animacion de la app que de verdad anima la OPACIDAD (0 a 1 en 0.5s): con
    // Inicio todavia montado detras, esos primeros cientos de milisegundos se
    // veian los dos a la vez, transparentados uno sobre el otro. Al quedar
    // opaca desde el primer frame, no hay nada detras que se pueda transparentar.
    <div className="fixed inset-0 z-50 bg-[var(--color-background)] dark:bg-[var(--color-background-dark)] animate-in slide-in-from-right duration-200 flex flex-col">
      {/* Header */}
      <div className="sticky top-0 z-10 uv-surface-1/80 backdrop-blur-md border-b border-[var(--color-border)] dark:border-[var(--color-border-dark)] px-4 h-14 flex items-center justify-between flex-shrink-0">
        <button
          onClick={onClose}
          className="p-2 -ml-2 rounded-full hover:bg-[var(--color-surface-muted)] dark:hover:bg-[var(--color-surface-muted-dark)] transition-colors uv-text-primary"
          aria-label={t('back')}
        >
          <Icons.ChevronLeft size={20} />
        </button>
        <h1 className="text-lg font-bold uv-text-primary tracking-tight">{t('recent_transactions')}</h1>
        <button
          onClick={() => setShowExportSheet(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--color-primary-soft)] text-[var(--color-primary)] rounded-lg text-sm font-semibold hover:bg-[var(--color-primary)] hover:text-white transition-colors"
          aria-label={t('export_options')}
        >
          <Icons.Download size={16} />
          {t('export_transactions')}
        </button>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto pb-8">
        {/* Summary Cards */}
        <div className="px-4 pt-4 pb-2">
          <div className="grid grid-cols-3 gap-3">
            {/* Income */}
            <div className="uv-surface-1 rounded-2xl p-2.5 uv-shadow-soft overflow-hidden">
              <div className="flex items-center gap-1.5 mb-2">
                <div className="w-6 h-6 rounded-full bg-[var(--color-success-soft)] flex items-center justify-center">
                  <Icons.ArrowDownLeft size={12} className="text-[var(--color-success)]" />
                </div>
                <span className="text-[10px] font-bold text-[var(--color-success)] uppercase tracking-wider">{t('income')}</span>
              </div>
              <div
                className={`font-extrabold text-[var(--color-success)] whitespace-nowrap tabular-nums ${claseDeMonto(
                  `+${formatCurrency(totalIncome, resumenCcy)}`,
                )}`}
              >
                +{formatCurrency(totalIncome, resumenCcy)}
              </div>
            </div>

            {/* Expenses */}
            <div className="uv-surface-1 rounded-2xl p-2.5 uv-shadow-soft overflow-hidden">
              <div className="flex items-center gap-1.5 mb-2">
                <div className="w-6 h-6 rounded-full bg-[var(--color-danger-soft)] flex items-center justify-center">
                  <Icons.ArrowUpRight size={12} className="text-[var(--color-danger)]" />
                </div>
                <span className="text-[10px] font-bold text-[var(--color-danger)] uppercase tracking-wider">{t('expenses')}</span>
              </div>
              <div
                className={`font-extrabold text-[var(--color-danger)] whitespace-nowrap tabular-nums ${claseDeMonto(
                  `-${formatCurrency(totalExpenses, resumenCcy)}`,
                )}`}
              >
                -{formatCurrency(totalExpenses, resumenCcy)}
              </div>
            </div>

            {/* Net */}
            <div className="uv-surface-1 rounded-2xl p-2.5 uv-shadow-soft overflow-hidden">
              <div className="flex items-center gap-1.5 mb-2">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center ${
                  net >= 0 ? 'bg-[var(--color-primary-soft)]' : 'bg-[var(--color-warning-soft)]'
                }`}>
                  <Icons.TrendingUp size={12} className={net >= 0 ? 'text-[var(--color-primary)]' : 'text-[var(--color-warning)]'} />
                </div>
                <span className={`text-[10px] font-bold uppercase tracking-wider ${
                  net >= 0 ? 'text-[var(--color-primary)]' : 'text-[var(--color-warning)]'
                }`}>{t('net_balance')}</span>
              </div>
              <div
                className={`font-extrabold whitespace-nowrap tabular-nums ${
                  net >= 0 ? 'text-[var(--color-primary)]' : 'text-[var(--color-warning)]'
                } ${claseDeMonto(`${net >= 0 ? '+' : ''}${formatCurrency(net, resumenCcy)}`)}`}
              >
                {net >= 0 ? '+' : ''}{formatCurrency(net, resumenCcy)}
              </div>
            </div>
          </div>

          {/* Los movimientos en otra moneda siguen en la lista con su propia
              moneda, pero quedan fuera de estos totales: se dice. */}
          {otrasMonedas > 0 && (
            <p className="mt-2 px-1 text-xs uv-text-muted">
              {t('other_currency_note').replace('{n}', String(otrasMonedas))}
            </p>
          )}

          {/* Que tanto del historial cubren estos totales. Un subtotal de la
              primera pagina presentado como el total del periodo es un numero
              falso, y es lo que esta pantalla hacia. */}
          {pagina && filtered.length < pagina.total && (
            <p className="mt-2 px-1 text-xs uv-text-muted">
              {t('tx_totals_scope')
                .replace('{shown}', String(filtered.length))
                .replace('{total}', String(pagina.total))}
            </p>
          )}
          {pagina && pagina.txs.length < pagina.total && (
            <button
              onClick={cargarMas}
              disabled={cargando}
              className="mt-2 px-3 py-1.5 rounded-lg bg-[var(--color-primary-soft)] text-[var(--color-primary)] text-xs font-bold disabled:opacity-60"
            >
              {cargando ? t('loading') : t('tx_load_more')}
            </button>
          )}
          {motivoLocal && (
            <p className="mt-2 px-1 text-xs text-[var(--color-warning)]">
              {t(motivoLocal === 'demasiado_trafico' ? 'tx_local_only_rate' : 'tx_local_only')}
            </p>
          )}
        </div>

        {/* Search Bar */}
        <div className="px-4 py-2">
          <div className="relative">
            <Icons.Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 uv-text-muted" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('search_transactions')}
              className="w-full bg-[var(--color-surface-1)] dark:bg-[var(--color-surface-2-dark)] border border-[var(--color-border)] dark:border-[var(--color-border-dark)] uv-text-primary pl-10 pr-4 py-2.5 rounded-xl text-sm font-medium outline-none placeholder:uv-text-muted focus:border-[var(--color-primary)] focus:ring-[3px] focus:ring-[var(--color-primary-soft)] transition-all"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 uv-text-muted hover:uv-text-primary"
              >
                <Icons.X size={14} />
              </button>
            )}
          </div>
        </div>

        {/* Category Chips */}
        {categories.length > 0 && (
          <div className="px-4 py-2">
            <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
              <button
                onClick={() => setSelectedCategory(null)}
                className={`flex-shrink-0 px-3.5 py-1.5 rounded-full text-xs font-bold transition-all ${
                  selectedCategory === null
                    ? 'bg-[var(--color-primary)] text-white uv-shadow-primary'
                    : 'uv-surface-1 uv-text-secondary uv-shadow-soft'
                }`}
              >
                {t('all_categories')}
              </button>
              {categories.map((cat) => {
                const style = estiloDeCategoria(cat);
                const isActive = selectedCategory === cat;
                return (
                  <button
                    key={cat}
                    onClick={() => setSelectedCategory(isActive ? null : cat)}
                    aria-pressed={isActive}
                    className={`flex-shrink-0 flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-bold transition-all ${
                      isActive
                        ? 'bg-[var(--color-primary)] text-white uv-shadow-primary'
                        : `${style.bg} ${style.text}`
                    }`}
                  >
                    <style.icon size={12} aria-hidden="true" />
                    {etiquetaDeCategoria(cat, t)}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Transaction Count */}
        <div className="px-4 py-1" aria-live="polite">
          <span className="text-xs font-semibold uv-text-muted uppercase tracking-wider">
            {buscando
              ? t('tx_searching')
              : `${filtered.length} ${filtered.length === 1 ? t('num_transactions_one') : t('num_transactions')}`}
          </span>
        </div>

        {/* Transactions List */}
        {buscando ? (
          <div className="px-4 space-y-2 pt-1" aria-busy="true">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-[4.5rem] rounded-2xl uv-surface-1 uv-shadow-soft animate-pulse motion-reduce:animate-none"
              />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 uv-text-muted">
            <div className="w-20 h-20 rounded-3xl uv-surface-2 flex items-center justify-center mb-4">
              <Icons.Receipt size={32} className="opacity-40" />
            </div>
            <p className="text-lg font-bold mb-1 uv-text-primary">{t('no_transactions_yet')}</p>
            <p className="text-sm">{search ? t('search_transactions') : ''}</p>
          </div>
        ) : (
          <div className="px-4 space-y-2 pt-1">
            {filtered.map((tx) => (
              <TransactionCard key={tx.id} tx={tx} formatCurrency={formatCurrency} onOpen={() => abrirDetalle(tx)} />
            ))}
          </div>
        )}
      </div>

      {/* Export Bottom Sheet */}
      <BottomSheet
        isOpen={showExportSheet}
        onClose={() => setShowExportSheet(false)}
        title={t('export_options')}
      >
        <div className="space-y-2 pb-2">
          {/* Excel CSV */}
          <ExportOption
            icon={<Icons.FileText size={22} />}
            iconBg="bg-green-100 dark:bg-green-900/30 text-green-600"
            title={t('export_excel')}
            subtitle={t('export_excel_desc')}
            onClick={handleExportCSV}
          />
          {/* JSON */}
          <ExportOption
            icon={<Icons.Hash size={22} />}
            iconBg="bg-blue-100 dark:bg-blue-900/30 text-blue-600"
            title={t('export_json')}
            subtitle={t('export_json_desc')}
            onClick={handleExportJSON}
          />
          {/* Copy */}
          <ExportOption
            icon={<Icons.Copy size={22} />}
            iconBg="bg-purple-100 dark:bg-purple-900/30 text-purple-600"
            title={t('copy_transactions')}
            subtitle={t('copy_transactions_desc')}
            onClick={handleCopy}
          />
          {/* Share */}
          <ExportOption
            icon={<Icons.Share size={22} />}
            iconBg="bg-orange-100 dark:bg-orange-900/30 text-orange-600"
            title={t('share_transactions')}
            subtitle={t('share_transactions_desc')}
            onClick={handleShare}
          />
        </div>
      </BottomSheet>

      {/* Toast notification */}
      {toast && (
        <div role="status" className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[200] animate-fade-in-scale">
          <div className="bg-[var(--color-navy-900)] text-white px-5 py-3 rounded-2xl uv-shadow-floating flex items-center gap-2.5 text-sm font-bold">
            {toast.tipo === 'error' ? (
              <Icons.AlertCircle size={18} aria-hidden="true" className="shrink-0 text-red-300" />
            ) : (
              <Icons.CheckCircle size={18} aria-hidden="true" className="shrink-0 text-[var(--color-success)]" />
            )}
            {toast.texto}
          </div>
        </div>
      )}

      {/* Detalle del movimiento: la misma hoja que abre Inicio. */}
      <TransactionDetailSheet tx={selectedTx} isOpen={detalleAbierto} onClose={() => setDetalleAbierto(false)} />
    </div>
  );
};

// --- Sub-components ---

const TransactionCard: React.FC<{
  tx: Transaction;
  formatCurrency: (amount: number, ccy?: string) => string;
  onOpen: () => void;
}> = ({ tx, formatCurrency, onOpen }) => {
  const { t, language } = useLanguage();
  const style = estiloDeCategoria(tx.category);
  const Icon = style.icon;
  const incoming = tx.amount > 0;
  const completado = (tx.status ?? 'completed') === 'completed';

  // Un boton de verdad: la fila parecia tocable (cursor, sombra al pasar) y no
  // abria nada, ni con el dedo ni con el teclado.
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full text-left flex items-center gap-3 px-4 py-3.5 uv-surface-1 rounded-2xl uv-shadow-soft hover:uv-shadow-elevated transition-all group uv-focus-ring"
    >
      {/* Category Icon */}
      <span className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${style.bg} ${style.text} group-hover:scale-105 transition-transform`}>
        <Icon size={20} aria-hidden="true" />
      </span>

      {/* Info */}
      <span className="flex-1 min-w-0">
        <span className="block font-semibold uv-text-primary text-sm truncate">
          {txTitle(tx, t)}
        </span>
        <span className="text-xs uv-text-muted flex items-center gap-1.5 mt-0.5">
          <Icons.Clock size={10} aria-hidden="true" />
          <span>{fechaCorta(tx.dateISO, language) || tx.date}</span>
          <span className="opacity-40" aria-hidden="true">·</span>
          <span className={style.text}>{etiquetaDeCategoria(tx.category, t)}</span>
        </span>
      </span>

      {/* Amount */}
      <span className="text-right flex-shrink-0">
        <span className={`block font-extrabold text-sm tabular-nums ${incoming ? 'text-[var(--color-success)]' : 'uv-text-primary'}`}>
          {incoming ? '+' : ''}{formatCurrency(tx.amount, tx.ccy)}
        </span>
        <span className={`text-[10px] font-bold mt-0.5 px-1.5 py-0.5 rounded-md inline-flex items-center gap-0.5 ${
          completado ? 'uv-chip-success' : 'uv-chip-warning'
        }`}>
          {completado ? <Icons.Check size={10} aria-hidden="true" /> : <Icons.Clock size={10} aria-hidden="true" />}
          {completado ? t('tx_status_completed') : t('pending')}
        </span>
      </span>
    </button>
  );
};

const ExportOption: React.FC<{
  icon: React.ReactNode;
  iconBg: string;
  title: string;
  subtitle: string;
  onClick: () => void;
}> = ({ icon, iconBg, title, subtitle, onClick }) => (
  <button
    onClick={onClick}
    className="w-full flex items-center gap-4 p-4 rounded-2xl uv-surface-1 uv-shadow-soft hover:uv-shadow-elevated transition-all active:scale-[0.98] text-left"
  >
    <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${iconBg}`}>
      {icon}
    </div>
    <div className="flex-1 min-w-0">
      <div className="font-bold uv-text-primary text-sm">{title}</div>
      <div className="text-xs uv-text-muted mt-0.5">{subtitle}</div>
    </div>
    <Icons.ChevronRight size={16} className="uv-text-muted flex-shrink-0" />
  </button>
);
