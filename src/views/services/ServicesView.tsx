import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '@/hooks/useApp';
import { useLanguage } from '../../i18n/LanguageContext';
import { Icons } from '../../components/Icons';
import {
  Zap, Lightbulb, PlugZap, UtilityPole, Droplets, ShowerHead, Smartphone,
  Signal, PhoneCall, Wifi, Tv, MonitorPlay, Cross, ShieldCheck, CarFront,
  LayoutGrid, FileText,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ServiceCatalog, ServiceOperatorInfo, ServiceProviderInfo } from '@/api';
import { BottomSheet } from '../../components/BottomSheet';
import { Button } from '../../components/ui/Button';
import { MfaChallengeSheet } from '../../components/MfaChallengeSheet';
import { CampoMonto } from '../../components/CampoMonto';
import { getApiLayer, MFA_REQUIRED } from '@/api';
import { refreshAccounts, refreshTransactions } from '@/services/dataSync';
import { llaveDelIntento, soltarIntento } from '@/services/intentoPendiente';
import { fechaCorta } from '@/utils/fechaPlazo';
import { mensajeDeRechazo } from '@/i18n/mensajesDeError';
import {
  CLAVES_DEL_RECHAZO_DEL_RECIBO,
  CLAVES_DEL_RECHAZO_DE_LA_RECARGA,
  CLAVE_GENERICA_DEL_SERVICIO,
} from './rechazosDelServicio';
import {
  AMBITO_DEL_RECIBO,
  AMBITO_DE_LA_RECARGA,
  firmaDelRecibo,
  firmaDeLaRecarga,
  llaveNueva,
} from './llaveDelServicio';

// Lo unico que la pantalla sabe por su cuenta de cada empresa u operador es su
// dibujo y su color. QUE empresas y QUE operadores se ofrecen no vive aqui: sale
// del servidor (GET /services/providers). La lista que estaba escrita a mano
// tenia 15 empresas y 11 de ellas no existian alla: cada una respondia
// INVALID_PROVIDER, que la persona leia como "No se pudo completar la accion".
interface Dibujo {
  logo: LucideIcon;
  color: string;
}

const DIBUJO_DE_EMPRESA: Record<string, Dibujo> = {
  ice: { logo: Zap, color: 'from-yellow-500 to-orange-500' },
  cnfl: { logo: Lightbulb, color: 'from-yellow-400 to-yellow-600' },
  esph: { logo: PlugZap, color: 'from-green-500 to-emerald-600' },
  coopelesca: { logo: UtilityPole, color: 'from-blue-500 to-blue-600' },
  aya: { logo: Droplets, color: 'from-blue-400 to-cyan-500' },
  'esph-agua': { logo: ShowerHead, color: 'from-cyan-400 to-blue-500' },
  kolbi: { logo: Smartphone, color: 'from-green-500 to-green-600' },
  claro: { logo: Signal, color: 'from-red-500 to-red-600' },
  movistar: { logo: PhoneCall, color: 'from-blue-500 to-indigo-600' },
  tigo: { logo: Wifi, color: 'from-blue-600 to-blue-700' },
  liberty: { logo: Tv, color: 'from-purple-500 to-purple-600' },
  cabletica: { logo: MonitorPlay, color: 'from-orange-500 to-red-500' },
  ccss: { logo: Cross, color: 'from-green-600 to-emerald-700' },
  ins: { logo: ShieldCheck, color: 'from-blue-700 to-blue-800' },
  marchamo: { logo: CarFront, color: 'from-gray-600 to-gray-700' },
};

// Una empresa nueva del servidor, sin dibujo propio, toma el de su categoria.
const DIBUJO_DE_CATEGORIA: Record<string, Dibujo> = {
  electricity: { logo: Zap, color: 'from-yellow-500 to-orange-500' },
  water: { logo: Droplets, color: 'from-blue-400 to-cyan-500' },
  telecom: { logo: Smartphone, color: 'from-green-500 to-green-600' },
  internet: { logo: Wifi, color: 'from-blue-600 to-blue-700' },
};

const DIBUJO_GENERICO: Dibujo = { logo: FileText, color: 'from-gray-500 to-gray-600' };

const dibujoDeEmpresa = (codigo: string, categoria?: string): Dibujo =>
  DIBUJO_DE_EMPRESA[codigo] ?? (categoria ? DIBUJO_DE_CATEGORIA[categoria] : undefined) ?? DIBUJO_GENERICO;

// Los montos de recarga que se ofrecen por operador. Tampoco son una lista de
// operadores: un operador que el servidor ofrece y no esta aqui usa los montos
// de abajo.
const MONTOS_POR_DEFECTO = [1000, 2000, 5000, 10000, 20000];
const OPERADOR_CONOCIDO: Record<string, Dibujo & { montos: number[] }> = {
  kolbi: { logo: Smartphone, color: 'from-green-500 to-green-600', montos: [1000, 2000, 3000, 5000, 10000, 20000] },
  claro: { logo: Signal, color: 'from-red-500 to-red-600', montos: [1000, 2000, 5000, 10000, 15000, 20000] },
  movistar: { logo: PhoneCall, color: 'from-blue-500 to-blue-600', montos: [1000, 2000, 5000, 10000, 20000] },
};

const dibujoDeOperador = (codigo: string): Dibujo & { montos: number[] } =>
  OPERADOR_CONOCIDO[codigo] ?? { ...DIBUJO_GENERICO, logo: Smartphone, montos: MONTOS_POR_DEFECTO };

/** Una empresa tal como la pinta la pantalla: lo del servidor mas su dibujo. */
type Empresa = ServiceProviderInfo & Dibujo;
type Operador = ServiceOperatorInfo & Dibujo & { montos: number[] };

// El servidor niega el cobro con este codigo cuando no hay convenio con la
// empresa o el operador: no hay a quien entregarle la plata, asi que no la
// debita. La pantalla lo explica en vez de mostrar un error generico.
const SIN_CONVENIO = 'SIN_CONVENIO';

// Las categorias que la pantalla sabe nombrar. Se ofrecen solo las que tienen
// empresas en la lista del servidor: un filtro sin empresas era una lista vacia.
const CATEGORIAS = [
  { id: 'electricity', label: 'cat_electricity', icon: Zap },
  { id: 'water', label: 'cat_water', icon: Droplets },
  { id: 'telecom', label: 'cat_telecom', icon: Smartphone },
  { id: 'internet', label: 'cat_internet', icon: Wifi },
  { id: 'cable', label: 'cat_cable', icon: Tv },
  { id: 'other', label: 'cat_other', icon: FileText },
];

// Una categoria que la pantalla no nombra (seguros, por ejemplo) cae en "otros".
const categoriaDe = (empresa: ServiceProviderInfo): string =>
  CATEGORIAS.some((c) => c.id === empresa.category) ? empresa.category : 'other';

// Pide la lista al servidor. null si no llego: la red, o una respuesta sin datos.
async function pedirCatalogo(): Promise<ServiceCatalog | null> {
  try {
    const res = await getApiLayer().services.getCatalog();
    return res.success && res.data ? res.data : null;
  } catch {
    return null;
  }
}

// Lo que la pantalla sabe de la lista del servidor. Sin lista no hay nada que
// ofrecer, y no se inventa una: o se esta pidiendo, o fallo y se puede repetir.
type EstadoDelCatalogo =
  | { estado: 'cargando' }
  | { estado: 'error' }
  | { estado: 'listo'; datos: ServiceCatalog };

export const ServicesView: React.FC = () => {
  const { state, dispatch } = useApp();
  const { t, language } = useLanguage();
  const [activeTab, setActiveTab] = useState<'services' | 'recharge' | 'history'>('services');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Sheet states
  const [showPaymentSheet, setShowPaymentSheet] = useState(false);
  const [showRechargeSheet, setShowRechargeSheet] = useState(false);
  const [showSuccessSheet, setShowSuccessSheet] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<Empresa | null>(null);
  const [selectedOperator, setSelectedOperator] = useState<Operador | null>(null);

  // La lista de empresas y operadores, y si el cobro se puede entregar, vienen
  // del servidor. `pedido` descarta la respuesta de una peticion que ya quedo
  // atras (se repitio mientras la anterior seguia en vuelo).
  const [catalogo, setCatalogo] = useState<EstadoDelCatalogo>({ estado: 'cargando' });
  const pedido = useRef(0);
  const montado = useRef(true);
  // El servidor nego una empresa o un operador que la lista tenia: la lista
  // estaba vieja. Si al repetirla ya no esta, el formulario se cierra y este
  // aviso queda sobre la lista.
  const [avisoDeLista, setAvisoDeLista] = useState('');

  // Form states
  const [clientId, setClientId] = useState('');
  const [billAmount, setBillAmount] = useState('');
  const [rechargePhone, setRechargePhone] = useState('');
  const [rechargeAmount, setRechargeAmount] = useState<number | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [actionError, setActionError] = useState('');
  // La negativa por falta de convenio no es un fallo del usuario ni de su
  // saldo: se muestra en tono neutro, no en el rojo de los errores.
  const [actionBlocked, setActionBlocked] = useState(false);
  // Desafio de MFA para montos altos: 'pendingAction' recuerda que operacion
  // reintentar cuando el codigo se verifica.
  const [showMfa, setShowMfa] = useState(false);
  const [pendingAction, setPendingAction] = useState<'bill' | 'recharge' | null>(null);
  // La llave del pago que pidio el segundo factor: el reintento tras verificar
  // la vuelve a tomar por su firma, y cancelar la suelta (el servidor lo pide
  // antes de cobrar, asi que no se cobro nada).
  const [llaveDelMfa, setLlaveDelMfa] = useState<{ ambito: string; llave: string } | null>(null);
  const [lastPayment, setLastPayment] = useState<{ type: string; amount: number; detail: string } | null>(null);
  // La repeticion: el servidor contesto con un pago que YA estaba hecho bajo la
  // llave (el reintento tras un corte). La hoja lo dice asi, no "pago exitoso".
  const [pagoYaHecho, setPagoYaHecho] = useState(false);
  const persona = state.user?.id ?? '';

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currencyDisplay: 'narrowSymbol', currency: 'CRC' }).format(amount);
  };

  const crcAccount = state.accounts.find(a => a.ccy === 'CRC');
  const balance = crcAccount?.balance || 0;

  // La primera carga, al abrir la pantalla.
  useEffect(() => {
    montado.current = true;
    const mio = ++pedido.current;
    void (async () => {
      const datos = await pedirCatalogo();
      if (!montado.current || mio !== pedido.current) return;
      setCatalogo(datos ? { estado: 'listo', datos } : { estado: 'error' });
    })();
    return () => {
      montado.current = false;
    };
  }, []);

  // Repetir la peticion desde un toque o tras un rechazo. `conservar`: sin
  // tirar la lista que ya se tiene, de modo que si falla la de antes sigue a la
  // vista; sin ello, un fallo muestra el error. Devuelve la lista nueva, o null
  // si no llego o ya quedo atras.
  const cargarCatalogo = useCallback(async (conservar: boolean): Promise<ServiceCatalog | null> => {
    const mio = ++pedido.current;
    const datos = await pedirCatalogo();
    if (!montado.current || mio !== pedido.current) return null;
    if (datos) setCatalogo({ estado: 'listo', datos });
    else if (!conservar) setCatalogo({ estado: 'error' });
    return datos;
  }, []);

  const reintentarCatalogo = () => {
    setCatalogo({ estado: 'cargando' });
    cargarCatalogo(false).catch(() => {});
  };

  const datosDelCatalogo = catalogo.estado === 'listo' ? catalogo.datos : null;
  // Sin la lista, ni se sabe si hay convenio: no se ofrece nada que cobrar.
  const conveniosActivos = datosDelCatalogo?.agreementsActive === true;

  const empresas = useMemo<Empresa[]>(
    () => (datosDelCatalogo?.providers ?? []).map((p) => ({ ...p, ...dibujoDeEmpresa(p.code, p.category) })),
    [datosDelCatalogo],
  );
  const operadores = useMemo<Operador[]>(
    () => (datosDelCatalogo?.operators ?? []).map((o) => ({ ...o, ...dibujoDeOperador(o.code) })),
    [datosDelCatalogo],
  );
  const categoriasOfrecidas = useMemo(() => {
    const presentes = new Set(empresas.map(categoriaDe));
    return CATEGORIAS.filter((c) => presentes.has(c.id));
  }, [empresas]);

  // Si la lista se actualizo y la categoria elegida ya no tiene empresas, se
  // vuelve a "todos" en vez de dejar un filtro vacio sin salida.
  const categoriaActiva =
    selectedCategory === 'all' || categoriasOfrecidas.some((c) => c.id === selectedCategory)
      ? selectedCategory
      : 'all';

  const filteredProviders = empresas.filter(p => {
    const matchesCategory = categoriaActiva === 'all' || categoriaDe(p) === categoriaActiva;
    const matchesSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.code.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  // Los servicios guardados cuya empresa el servidor ya no acepta no se
  // ofrecen: tocarlos terminaria en INVALID_PROVIDER.
  const guardadosOfrecidos = state.savedServices.flatMap((saved) => {
    const empresa = empresas.find((p) => p.code === saved.providerId);
    return empresa ? [{ saved, empresa }] : [];
  });

  const nombreDelOperador = (codigo: string) =>
    operadores.find((o) => o.code === codigo)?.name ?? t('recharge_label');

  // El servidor dijo que la empresa o el operador no existe: la lista de la
  // pantalla estaba vieja. Se vuelve a pedir; si el elegido ya no esta, no hay
  // nada que corregir en el formulario: se cierra y el aviso queda sobre la
  // lista nueva, para que la persona elija otra.
  const repetirListaTrasRechazo = async (tipo: 'empresa' | 'operador', codigo: string, mensaje: string) => {
    const nueva = await cargarCatalogo(true);
    if (!nueva) return;
    const sigue = tipo === 'empresa'
      ? nueva.providers.some((p) => p.code === codigo)
      : nueva.operators.some((o) => o.code === codigo);
    if (sigue) return;
    setActionError('');
    setActionBlocked(false);
    setAvisoDeLista(mensaje);
    if (tipo === 'empresa') {
      setShowPaymentSheet(false);
      setSelectedProvider(null);
    } else {
      setShowRechargeSheet(false);
      setSelectedOperator(null);
    }
  };

  const handleSelectProvider = (provider: Empresa) => {
    // Sin convenios no hay a quien entregarle el pago: no se abre un formulario
    // para llenar algo que el servidor va a negar. El aviso ya esta a la vista.
    if (!conveniosActivos) return;
    setSelectedProvider(provider);
    // El aviso nombra a la empresa: no puede sobrevivir al cambio de proveedor.
    setActionError('');
    setActionBlocked(false);
    setAvisoDeLista('');
    // Check if user has saved this service
    const saved = state.savedServices.find(s => s.providerId === provider.code);
    if (saved) {
      setClientId(saved.clientId);
      setBillAmount(saved.lastAmount?.toString() || '');
    }
    setShowPaymentSheet(true);
  };

  // Periodo facturado. El backend lo guarda como etiqueta, asi que se arma con
  // el mes en curso en el idioma del usuario en vez de la constante que estaba
  // escrita a mano ("Diciembre 2024").
  const periodoActual = () =>
    new Intl.DateTimeFormat(language, { month: 'long', year: 'numeric' }).format(new Date());

  const handlePayService = async () => {
    if (!clientId || !billAmount || !selectedProvider || isProcessing) return;
    const amount = parseFloat(billAmount);
    if (!(amount > 0)) {
      // Defensa: el boton de abajo ya queda deshabilitado con un monto
      // invalido. Si algun dia se dispara desde otro lado (Enter, reintento
      // tras MFA), que la persona vea por que no paso nada.
      setActionBlocked(false);
      setActionError(t('bill_invalid_amount'));
      return;
    }

    setIsProcessing(true);
    setActionError('');
    setActionBlocked(false);
    // La llave va atada a lo que se paga: el mismo recibo, el mismo cliente y
    // el mismo monto la vuelven a tomar (ver llaveDelServicio).
    const llave = llaveDelIntento(
      persona,
      AMBITO_DEL_RECIBO,
      firmaDelRecibo(selectedProvider.code, clientId, amount),
      llaveNueva,
    );
    const res = await getApiLayer().services.payBill({
      providerId: selectedProvider.code,
      providerName: selectedProvider.name,
      clientId,
      amount,
      period: periodoActual(),
      idempotencyKey: llave,
    });
    setIsProcessing(false);

    if (!res.success || !res.data) {
      // Monto alto: pedir el codigo y reintentar. Antes este flujo ni siquiera
      // llamaba al servidor, asi que el desafio no tenia donde aparecer.
      if (res.error?.code === MFA_REQUIRED) {
        setLlaveDelMfa({ ambito: AMBITO_DEL_RECIBO, llave });
        setPendingAction('bill');
        setShowMfa(true);
        return;
      }
      if (res.error?.code === SIN_CONVENIO) {
        setActionBlocked(true);
        setActionError(t('bill_no_agreement'));
        return;
      }
      // La llave ya es de otro pago: el siguiente intento necesita otra. Ante
      // cualquier otro error se conserva: sin respuesta, el pago pudo salir.
      if (res.error?.code === 'LLAVE_REUTILIZADA') soltarIntento(persona, AMBITO_DEL_RECIBO, llave);
      const mensaje = mensajeDeRechazo(res.error, CLAVES_DEL_RECHAZO_DEL_RECIBO, CLAVE_GENERICA_DEL_SERVICIO, t);
      setActionError(mensaje);
      // La empresa no existe en el servidor: la lista estaba vieja.
      if (res.error?.code === 'INVALID_PROVIDER') {
        repetirListaTrasRechazo('empresa', selectedProvider.code, mensaje).catch(() => {});
      }
      return;
    }
    // El pago salio, o ya estaba hecho: el siguiente es otro y lleva otra llave.
    soltarIntento(persona, AMBITO_DEL_RECIBO, llave);

    // La repeticion no se anota: seria la fila doble y el saldo descontado dos
    // veces hasta la siguiente carga. La app no se habia enterado de aquel
    // pago, asi que el saldo y los movimientos se traen del servidor.
    const repetido = res.data.repetida === true;
    if (repetido) {
      refreshAccounts().catch(() => {});
      refreshTransactions().catch(() => {});
    } else {
      dispatch({ type: 'ADD_BILL_PAYMENT', payload: res.data });
    }
    setPagoYaHecho(repetido);
    setLastPayment({
      type: 'service',
      amount,
      detail: `${selectedProvider.name} - ${clientId}`,
    });
    setShowPaymentSheet(false);
    setShowSuccessSheet(true);
    // El pago debita la billetera: refrescar el saldo global.
    if (!repetido) refreshAccounts().catch(() => {});

    setClientId('');
    setBillAmount('');
    setSelectedProvider(null);
  };

  const handleRecharge = async () => {
    if (!rechargePhone || !rechargeAmount || !selectedOperator || isProcessing) return;

    setIsProcessing(true);
    setActionError('');
    setActionBlocked(false);
    const llave = llaveDelIntento(
      persona,
      AMBITO_DE_LA_RECARGA,
      firmaDeLaRecarga(selectedOperator.code, rechargePhone, rechargeAmount),
      llaveNueva,
    );
    const res = await getApiLayer().services.recharge({
      operatorId: selectedOperator.code,
      phone: rechargePhone,
      amount: rechargeAmount,
      idempotencyKey: llave,
    });
    setIsProcessing(false);

    if (!res.success || !res.data) {
      if (res.error?.code === MFA_REQUIRED) {
        setLlaveDelMfa({ ambito: AMBITO_DE_LA_RECARGA, llave });
        setPendingAction('recharge');
        setShowMfa(true);
        return;
      }
      if (res.error?.code === SIN_CONVENIO) {
        setActionBlocked(true);
        setActionError(t('recharge_no_agreement'));
        return;
      }
      if (res.error?.code === 'LLAVE_REUTILIZADA') soltarIntento(persona, AMBITO_DE_LA_RECARGA, llave);
      const mensaje = mensajeDeRechazo(res.error, CLAVES_DEL_RECHAZO_DE_LA_RECARGA, CLAVE_GENERICA_DEL_SERVICIO, t);
      setActionError(mensaje);
      if (res.error?.code === 'INVALID_OPERATOR') {
        repetirListaTrasRechazo('operador', selectedOperator.code, mensaje).catch(() => {});
      }
      return;
    }
    soltarIntento(persona, AMBITO_DE_LA_RECARGA, llave);

    // Como el recibo: la repeticion no se anota otra vez.
    const repetido = res.data.repetida === true;
    if (repetido) {
      refreshAccounts().catch(() => {});
      refreshTransactions().catch(() => {});
    } else {
      dispatch({ type: 'ADD_RECHARGE', payload: res.data });
    }
    setPagoYaHecho(repetido);
    setLastPayment({
      type: 'recharge',
      amount: rechargeAmount,
      detail: `${selectedOperator.name} - ${rechargePhone}`,
    });
    setShowRechargeSheet(false);
    setShowSuccessSheet(true);
    if (!repetido) refreshAccounts().catch(() => {});

    setRechargePhone('');
    setRechargeAmount(null);
    setSelectedOperator(null);
  };

  const mensajeAccion = !actionError ? null : actionBlocked ? (
    <div role="status" className="uv-surface-2 rounded-xl p-4 text-sm uv-text-secondary text-center">
      {actionError}
    </div>
  ) : (
    <p role="alert" className="text-[var(--color-danger)] text-sm mb-3 text-center">
      {actionError}
    </p>
  );

  // Lo que se ve mientras la lista no esta (o no llego). Sirve a Servicios y a
  // Recargas: las dos dependen de lo que el servidor ofrece.
  const estadoDelCatalogo =
    catalogo.estado === 'cargando' ? (
      <p role="status" className="uv-text-muted text-center py-8">{t('loading')}</p>
    ) : catalogo.estado === 'error' ? (
      <div className="uv-surface-1 rounded-2xl p-6 text-center space-y-4">
        <p role="alert" className="uv-text-secondary">{t('services_catalog_error')}</p>
        <Button variant="secondary" size="md" onClick={reintentarCatalogo}>
          {t('error_retry')}
        </Button>
      </div>
    ) : null;

  // En produccion todavia no hay convenio con las empresas ni con los
  // operadores: pagar responderia SIN_CONVENIO. Se avisa antes de que la persona
  // llene nada, en vez de despues de tocar Pagar.
  const avisoSinConvenios = datosDelCatalogo && !conveniosActivos ? (
    <div role="status" className="uv-surface-2 rounded-2xl p-4 space-y-1">
      <p className="font-bold uv-text-primary text-sm">{t('services_unavailable_title')}</p>
      <p className="text-sm uv-text-secondary">{t('services_unavailable_hint')}</p>
    </div>
  ) : null;

  const avisoDeListaVieja = avisoDeLista ? (
    <div role="status" className="uv-surface-2 rounded-2xl p-4 text-sm uv-text-secondary">
      {avisoDeLista}
    </div>
  ) : null;

  return (
    <div className="pb-24 pt-4 space-y-6 px-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-black uv-text-primary">
          {t('nav_services')}
        </h1>
        <div className="text-right">
          <p className="text-xs text-gray-500">{t('available')}</p>
          <p className="text-lg font-bold uv-text-primary">
            {formatCurrency(balance)}
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)] p-1 rounded-xl" role="tablist">
        <button
          onClick={() => { setActiveTab('services'); setAvisoDeLista(''); }}
          role="tab"
          aria-selected={activeTab === 'services'}
          className={`flex-1 py-2.5 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1 ${
            activeTab === 'services'
              ? 'bg-white dark:bg-gray-700 uv-text-primary shadow-sm'
              : 'text-gray-500'
          }`}
        >
          <Icons.FileText size={14} />
          {t('nav_services')}
        </button>
        <button
          onClick={() => { setActiveTab('recharge'); setAvisoDeLista(''); }}
          role="tab"
          aria-selected={activeTab === 'recharge'}
          className={`flex-1 py-2.5 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1 ${
            activeTab === 'recharge'
              ? 'bg-white dark:bg-gray-700 uv-text-primary shadow-sm'
              : 'text-gray-500'
          }`}
        >
          <Icons.Phone size={14} />
          {t('recharge_label')}
        </button>
        <button
          onClick={() => setActiveTab('history')}
          role="tab"
          aria-selected={activeTab === 'history'}
          className={`flex-1 py-2.5 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1 ${
            activeTab === 'history'
              ? 'bg-white dark:bg-gray-700 uv-text-primary shadow-sm'
              : 'text-gray-500'
          }`}
        >
          <Icons.History size={14} />
          {t('history')}
        </button>
      </div>

      {activeTab === 'services' && (
        <>
          {estadoDelCatalogo}
          {avisoSinConvenios}
          {avisoDeListaVieja}

          {/* Servicios guardados */}
          {guardadosOfrecidos.length > 0 && (
            <div>
              <h3 className="text-sm font-bold uv-text-muted uppercase mb-3">
                {t('my_services')}
              </h3>
              <div className="flex gap-3 overflow-x-auto no-scrollbar pb-2">
                {guardadosOfrecidos.map(({ saved, empresa: provider }) => {
                  return (
                    <button
                      key={saved.id}
                      onClick={() => handleSelectProvider(provider)}
                      disabled={!conveniosActivos}
                      className="min-w-[140px] uv-surface-1 rounded-2xl p-4 border border-[var(--color-border)] dark:border-[var(--color-border-dark)] disabled:opacity-50"
                    >
                      <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${provider.color} flex items-center justify-center text-white mb-2`}>
                        <provider.logo size={20} />
                      </div>
                      <div className="text-left">
                        <p className="font-bold uv-text-primary text-sm truncate">
                          {saved.nickname || provider.name}
                        </p>
                        <p className="text-xs text-gray-500">{saved.clientId}</p>
                        {saved.lastAmount && (
                          <p className="text-sm font-bold text-orange-500 mt-1">
                            {formatCurrency(saved.lastAmount)}
                          </p>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {datosDelCatalogo && empresas.length === 0 && (
            <div className="uv-surface-1 rounded-2xl p-8 text-center">
              <Icons.FileText size={48} className="mx-auto text-gray-300 mb-4" />
              <p className="uv-text-muted">{t('services_no_providers')}</p>
            </div>
          )}

          {datosDelCatalogo && empresas.length > 0 && (
            <>
              {/* Búsqueda */}
              <div className="relative">
                <Icons.Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={t('search_service')}
                  className="w-full bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)] pl-11 pr-4 py-3 rounded-xl outline-none uv-text-primary placeholder-gray-400"
                />
              </div>

              {/* Categorías: solo las que tienen empresas */}
              {categoriasOfrecidas.length > 1 && (
                <div className="flex gap-2 overflow-x-auto no-scrollbar pb-2" role="tablist" aria-label={t('nav_services')}>
                  {[{ id: 'all', label: 'cat_all', icon: LayoutGrid }, ...categoriasOfrecidas].map((cat) => (
                    <button
                      key={cat.id}
                      onClick={() => setSelectedCategory(cat.id)}
                      role="tab"
                      aria-selected={categoriaActiva === cat.id}
                      className={`flex items-center gap-2 px-4 py-2 rounded-full whitespace-nowrap text-sm font-medium transition-all ${
                        categoriaActiva === cat.id
                          ? 'bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white'
                          : 'bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)] uv-text-secondary'
                      }`}
                    >
                      <cat.icon size={15} />
                      {t(cat.label)}
                    </button>
                  ))}
                </div>
              )}

              {/* Lista de proveedores */}
              <div className="grid grid-cols-2 gap-3">
                {filteredProviders.map((provider) => (
                  <button
                    key={provider.code}
                    onClick={() => handleSelectProvider(provider)}
                    disabled={!conveniosActivos}
                    className="uv-surface-1 rounded-2xl p-4 border border-[var(--color-border)] dark:border-[var(--color-border-dark)] text-left hover:border-primary dark:hover:border-primary transition-colors disabled:opacity-50 disabled:hover:border-[var(--color-border)]"
                  >
                    <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${provider.color} flex items-center justify-center text-white mb-3`}>
                      <provider.logo size={24} />
                    </div>
                    <p className="font-bold uv-text-primary">{provider.name}</p>
                    <p className="text-xs text-gray-500">{provider.code.toUpperCase()}</p>
                  </button>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {activeTab === 'recharge' && (
        <div className="space-y-6">
          {estadoDelCatalogo}
          {avisoSinConvenios}
          {avisoDeListaVieja}

          {/* Operadores */}
          {datosDelCatalogo && operadores.length > 0 && (
            <div>
              <h3 className="text-sm font-bold uv-text-muted uppercase mb-3">
                {t('select_operator')}
              </h3>
              <div className="grid grid-cols-3 gap-3">
                {operadores.map((op) => (
                  <button
                    key={op.code}
                    onClick={() => {
                      if (!conveniosActivos) return;
                      setSelectedOperator(op);
                      setActionError('');
                      setActionBlocked(false);
                      setAvisoDeLista('');
                      setShowRechargeSheet(true);
                    }}
                    disabled={!conveniosActivos}
                    className="uv-surface-1 rounded-2xl p-4 border border-[var(--color-border)] dark:border-[var(--color-border-dark)] text-center hover:border-primary transition-colors disabled:opacity-50 disabled:hover:border-[var(--color-border)]"
                  >
                    <div className={`w-14 h-14 rounded-xl bg-gradient-to-br ${op.color} flex items-center justify-center text-white mx-auto mb-2`}>
                      <op.logo size={26} />
                    </div>
                    <p className="font-bold uv-text-primary">{op.name}</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Recargas recientes */}
          {state.rechargeHistory.length > 0 && (
            <div>
              <h3 className="text-sm font-bold uv-text-muted uppercase mb-3">
                {t('recent_recharges')}
              </h3>
              <div className="uv-surface-1 rounded-2xl divide-y divide-[var(--color-border)] dark:divide-[var(--color-border-dark)]">
                {state.rechargeHistory.slice(0, 5).map((recharge) => {
                  const op = dibujoDeOperador(recharge.operatorId);
                  return (
                    <div key={recharge.id} className="flex items-center p-4">
                      <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${op.color} flex items-center justify-center text-white mr-3`}>
                        <op.logo size={20} />
                      </div>
                      <div className="flex-1">
                        <p className="font-bold uv-text-primary">{recharge.phone}</p>
                        <p className="text-sm text-gray-500">{fechaCorta(recharge.dateISO, language) || recharge.date}</p>
                      </div>
                      <p className="font-bold uv-text-primary">
                        {formatCurrency(recharge.amount)}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'history' && (
        <div className="space-y-6">
          {/* Pagos de servicios */}
          <div>
            <h3 className="text-sm font-bold uv-text-muted uppercase mb-3">
              {t('service_payments')}
            </h3>
            {state.billHistory.length === 0 ? (
              <div className="uv-surface-1 rounded-2xl p-8 text-center">
                <Icons.FileText size={48} className="mx-auto text-gray-300 mb-4" />
                <p className="uv-text-muted">{t('no_service_payments')}</p>
              </div>
            ) : (
              <div className="uv-surface-1 rounded-2xl divide-y divide-[var(--color-border)] dark:divide-[var(--color-border-dark)]">
                {state.billHistory.map((bill) => {
                  const provider = dibujoDeEmpresa(bill.providerId);
                  return (
                    <div key={bill.id} className="flex items-center p-4">
                      <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${provider.color} flex items-center justify-center text-white mr-3`}>
                        <provider.logo size={20} />
                      </div>
                      <div className="flex-1">
                        <p className="font-bold uv-text-primary">{bill.providerName}</p>
                        <p className="text-sm text-gray-500">{t('client_label')}: {bill.clientId}</p>
                        <p className="text-xs text-gray-400">{bill.period}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-bold uv-text-primary">
                          {formatCurrency(bill.amount)}
                        </p>
                        <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
                          {t('paid')}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Recargas */}
          <div>
            <h3 className="text-sm font-bold uv-text-muted uppercase mb-3">
              {t('recharge_label')}
            </h3>
            {state.rechargeHistory.length === 0 ? (
              <div className="uv-surface-1 rounded-2xl p-8 text-center">
                <Icons.Phone size={48} className="mx-auto text-gray-300 mb-4" />
                <p className="uv-text-muted">{t('no_recharges_yet')}</p>
              </div>
            ) : (
              <div className="uv-surface-1 rounded-2xl divide-y divide-[var(--color-border)] dark:divide-[var(--color-border-dark)]">
                {state.rechargeHistory.map((recharge) => {
                  const op = dibujoDeOperador(recharge.operatorId);
                  return (
                    <div key={recharge.id} className="flex items-center p-4">
                      <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${op.color} flex items-center justify-center text-white mr-3`}>
                        <op.logo size={20} />
                      </div>
                      <div className="flex-1">
                        <p className="font-bold uv-text-primary">{nombreDelOperador(recharge.operatorId)}</p>
                        <p className="text-sm text-gray-500">+506 {recharge.phone}</p>
                        <p className="text-xs text-gray-400">{fechaCorta(recharge.dateISO, language) || recharge.date}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-bold uv-text-primary">
                          {formatCurrency(recharge.amount)}
                        </p>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          recharge.status === 'completed'
                            ? 'bg-green-100 text-green-700'
                            : 'bg-yellow-100 text-yellow-700'
                        }`}>
                          {recharge.status === 'completed' ? t('successful') : t('pending')}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Payment Sheet */}
      <BottomSheet
        isOpen={showPaymentSheet}
        onClose={() => { setShowPaymentSheet(false); setSelectedProvider(null); }}
        title={`${t('pay')} ${selectedProvider?.name || t('nav_services')}`}
      >
        <div className="space-y-6">
          {selectedProvider && (
            <div className="flex items-center gap-4 uv-surface-2 p-4 rounded-xl">
              <div className={`w-14 h-14 rounded-xl bg-gradient-to-br ${selectedProvider.color} flex items-center justify-center text-white`}>
                <selectedProvider.logo size={26} />
              </div>
              <div>
                <p className="font-bold uv-text-primary">{selectedProvider.name}</p>
                <p className="text-sm text-gray-500">{selectedProvider.code.toUpperCase()}</p>
              </div>
            </div>
          )}

          <div>
            <label className="text-sm text-gray-500 font-medium mb-2 block">
              {t('client_number_nis')}
            </label>
            <input
              type="text"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder={t('services_client_id_ph')}
              className="w-full bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)] px-4 py-4 rounded-xl outline-none text-lg font-semibold uv-text-primary"
            />
          </div>

          <div>
            <label className="text-sm text-gray-500 font-medium mb-2 block">
              {t('amount_to_pay')}
            </label>
            <div className="flex items-center gap-2 bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)] px-4 py-4 rounded-xl">
              <span className="text-2xl font-bold text-gray-400">₡</span>
              <CampoMonto
                value={billAmount}
                onChange={setBillAmount}
                placeholder="0"
                className="flex-1 bg-transparent outline-none text-2xl font-bold uv-text-primary"
              />
            </div>
            {parseFloat(billAmount || '0') > balance && (
              <p className="text-red-500 text-sm mt-2">{t('insufficient_funds')}</p>
            )}
          </div>

          {mensajeAccion}
          <Button
            variant="primary"
            size="lg"
            fullWidth
            onClick={handlePayService}
            loading={isProcessing}
            disabled={!clientId || !billAmount || !(parseFloat(billAmount) > 0) || parseFloat(billAmount) > balance}
          >
            {isProcessing ? t('processing_payment') : <>{t('pay')} {billAmount && formatCurrency(parseFloat(billAmount))}</>}
          </Button>
        </div>
      </BottomSheet>

      {/* Recharge Sheet */}
      <BottomSheet
        isOpen={showRechargeSheet}
        onClose={() => { setShowRechargeSheet(false); setSelectedOperator(null); }}
        title={`${t('recharge_label')} ${selectedOperator?.name || ''}`}
      >
        <div className="space-y-6">
          {selectedOperator && (
            <div className="flex items-center gap-4 uv-surface-2 p-4 rounded-xl">
              <div className={`w-14 h-14 rounded-xl bg-gradient-to-br ${selectedOperator.color} flex items-center justify-center text-white`}>
                <selectedOperator.logo size={26} />
              </div>
              <div>
                <p className="font-bold uv-text-primary">{selectedOperator.name}</p>
                <p className="text-sm text-gray-500">{t('prepaid_recharge')}</p>
              </div>
            </div>
          )}

          <div>
            <label className="text-sm text-gray-500 font-medium mb-2 block">
              {t('number_to_recharge')}
            </label>
            <div className="flex gap-2">
              <span className="flex items-center bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)] px-4 rounded-xl text-gray-500">
                +506
              </span>
              <input
                type="tel"
                value={rechargePhone}
                onChange={(e) => setRechargePhone(e.target.value.replace(/\D/g, '').slice(0, 8))}
                placeholder="8888-0000"
                className="flex-1 bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)] px-4 py-4 rounded-xl outline-none text-lg font-semibold uv-text-primary"
              />
            </div>
          </div>

          <div>
            <label className="text-sm text-gray-500 font-medium mb-2 block">
              {t('select_amount')}
            </label>
            <div className="grid grid-cols-3 gap-2">
              {selectedOperator?.montos.map((amt) => (
                <button
                  key={amt}
                  onClick={() => setRechargeAmount(amt)}
                  className={`py-3 rounded-xl font-bold transition-all ${
                    rechargeAmount === amt
                      ? 'bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white'
                      : 'bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)] uv-text-primary'
                  }`}
                >
                  {/* .replace(',00', '') se comia la coma de miles en vez del
                      ".00" final (ej. ₡1,000.00 -> ₡10.00): anclado al final. */}
                  {formatCurrency(amt).replace(/\.00$/, '')}
                </button>
              ))}
            </div>
          </div>

          {mensajeAccion}
          <Button
            variant="primary"
            size="lg"
            fullWidth
            onClick={handleRecharge}
            loading={isProcessing}
            disabled={!rechargePhone || !rechargeAmount || (rechargeAmount || 0) > balance}
          >
            {isProcessing ? t('processing') : <>{t('recharge_label')} {rechargeAmount && formatCurrency(rechargeAmount)}</>}
          </Button>
        </div>
      </BottomSheet>

      {/* Success Sheet */}
      <BottomSheet
        isOpen={showSuccessSheet}
        onClose={() => setShowSuccessSheet(false)}
        title=""
      >
        <div className="text-center py-6">
          <div className="w-20 h-20 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
            <Icons.Check size={40} className="text-green-500" />
          </div>
          <h2 className="text-2xl font-black uv-text-primary mb-2">
            {lastPayment?.type === 'recharge'
              ? t(pagoYaHecho ? 'recharge_ya_hecho' : 'recharge_success')
              : t(pagoYaHecho ? 'bill_ya_hecho' : 'payment_success')}
          </h2>
          <p className={`text-gray-500 ${pagoYaHecho ? 'mb-2' : 'mb-6'}`}>
            {lastPayment?.detail}
          </p>
          {pagoYaHecho && (
            <p className="text-sm uv-text-secondary mb-6">{t('servicio_ya_hecho_desc')}</p>
          )}

          {lastPayment && (
            <div className="uv-surface-2 rounded-2xl p-6 mb-6">
              <p className="text-4xl font-black uv-text-primary">
                {formatCurrency(lastPayment.amount)}
              </p>
            </div>
          )}

          <Button
            variant="primary"
            size="lg"
            fullWidth
            onClick={() => setShowSuccessSheet(false)}
          >
            {t('ready')}
          </Button>
        </div>
      </BottomSheet>

      {/* Desafio de MFA para montos altos. El backend rechaza la operacion con
          MFA_REQUIRED; al verificar el codigo se reintenta la misma. */}
      <MfaChallengeSheet
        isOpen={showMfa}
        confirmLabel={t('mfa_verify_and_pay')}
        onClose={() => {
          setShowMfa(false);
          setPendingAction(null);
          // Sin verificar, el pago no salio: el servidor pide el segundo factor
          // antes de cobrar. Se suelta su llave.
          if (llaveDelMfa) soltarIntento(persona, llaveDelMfa.ambito, llaveDelMfa.llave);
          setLlaveDelMfa(null);
        }}
        onVerified={() => {
          setShowMfa(false);
          const accion = pendingAction;
          setPendingAction(null);
          setLlaveDelMfa(null);
          if (accion === 'bill') handlePayService();
          else if (accion === 'recharge') handleRecharge();
        }}
      />
    </div>
  );
};
