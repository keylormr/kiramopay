import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '@/hooks/useApp';
import { useLanguage } from '../../i18n/LanguageContext';
import { Icons } from '../../components/Icons';
import { Zap, Droplets, Smartphone, Wifi, Tv, FileText, LayoutGrid } from 'lucide-react';
import { Icono3D } from '../../components/arte3d/Arte3D';
import type { NombreIcono3D } from '../../components/arte3d/catalogo';
import { EstadoVacio } from '../../components/EstadoVacio';
import { Monto, BotonOcultarMontos } from '../../components/montos/MontoOcultable';
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
// dibujo. QUE empresas y QUE operadores se ofrecen no vive aqui: sale del
// servidor (GET /services/providers). La lista que estaba escrita a mano tenia
// 15 empresas y 11 de ellas no existian alla: cada una respondia
// INVALID_PROVIDER, que la persona leia como "No se pudo completar la accion".
// El dibujo es el icono 3D de la categoria del servicio (no hay logos de
// terceros: las marcas no se dibujan sin licencia).
interface Dibujo {
  arte: NombreIcono3D;
}

const DIBUJO_DE_EMPRESA: Record<string, Dibujo> = {
  ice: { arte: 'luz' },
  cnfl: { arte: 'luz' },
  esph: { arte: 'luz' },
  coopelesca: { arte: 'luz' },
  aya: { arte: 'agua' },
  'esph-agua': { arte: 'agua' },
  kolbi: { arte: 'telefonia' },
  claro: { arte: 'telefonia' },
  movistar: { arte: 'telefonia' },
  tigo: { arte: 'internet' },
  liberty: { arte: 'cable' },
  cabletica: { arte: 'cable' },
};

// Una empresa nueva del servidor, sin dibujo propio, toma el de su categoria.
const ARTE_DE_CATEGORIA: Record<string, NombreIcono3D> = {
  electricity: 'luz',
  water: 'agua',
  telecom: 'telefonia',
  internet: 'internet',
  cable: 'cable',
  other: 'factura',
};

const DIBUJO_GENERICO: Dibujo = { arte: 'factura' };

const dibujoDeEmpresa = (codigo: string, categoria?: string): Dibujo =>
  DIBUJO_DE_EMPRESA[codigo] ??
  (categoria && ARTE_DE_CATEGORIA[categoria] ? { arte: ARTE_DE_CATEGORIA[categoria] } : undefined) ??
  DIBUJO_GENERICO;

// Los montos de recarga que se ofrecen por operador. Tampoco son una lista de
// operadores: un operador que el servidor ofrece y no esta aqui usa los montos
// de abajo.
const MONTOS_POR_DEFECTO = [1000, 2000, 5000, 10000, 20000];
const OPERADOR_CONOCIDO: Record<string, { montos: number[] }> = {
  kolbi: { montos: [1000, 2000, 3000, 5000, 10000, 20000] },
  claro: { montos: [1000, 2000, 5000, 10000, 15000, 20000] },
  movistar: { montos: [1000, 2000, 5000, 10000, 20000] },
};

const dibujoDeOperador = (codigo: string): Dibujo & { montos: number[] } => ({
  arte: 'recarga',
  montos: OPERADOR_CONOCIDO[codigo]?.montos ?? MONTOS_POR_DEFECTO,
});

// La placa donde se apoya un icono 3D: vidrio oscuro con borde fino, como las
// del resto del rediseno. El icono ocupa algo mas de la mitad (nunca menos de 28).
const PlacaDeArte: React.FC<{ arte: NombreIcono3D; lado?: number; icono?: number; className?: string }> = ({
  arte,
  lado = 44,
  icono = 30,
  className = '',
}) => (
  <div
    style={{ width: lado, height: lado }}
    className={`flex shrink-0 items-center justify-center rounded-[16px] bg-[var(--color-surface-2)] shadow-[inset_0_0_0_1px_var(--color-border-strong)] dark:bg-[var(--color-surface-2-dark)] dark:shadow-[inset_0_0_0_1px_var(--color-border-strong-dark)] ${className}`}
  >
    <Icono3D nombre={arte} tamano={icono} />
  </div>
);

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
    <p role="alert" className="text-[var(--color-danger)] dark:text-[var(--color-danger-strong-dark)] text-sm mb-3 text-center">
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

  const clasePestana = (activa: boolean) =>
    `kp-toque kp-foco flex flex-1 items-center justify-center gap-1.5 rounded-[14px] py-2.5 text-xs font-semibold transition-colors duration-[var(--kp-mov-estado)] ease-kp ${
      activa
        ? 'bg-white shadow-sm dark:bg-[var(--color-surface-3-dark)] uv-text-primary'
        : 'text-gray-500 dark:text-[var(--color-text-secondary-dark)]'
    }`;

  const claseCarta =
    'kp-toque kp-foco uv-surface-1 rounded-[20px] border border-[var(--color-border)] dark:border-[var(--color-border-dark)] transition-colors duration-[var(--kp-mov-estado)] ease-kp hover:border-primary dark:hover:border-primary disabled:opacity-50 disabled:hover:border-[var(--color-border)]';

  const claseLista =
    'uv-surface-1 rounded-[20px] divide-y divide-[var(--color-border)] dark:divide-[var(--color-border-dark)]';

  return (
    <div className="@container/servicios pb-24 pt-4 space-y-6 px-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold uv-text-primary">
          {t('nav_services')}
        </h1>
        {/* El ojo va junto al saldo, a la vista en las tres pestanas: antes
            solo estaba en Historial y desde Servicios no habia como destapar. */}
        <div className="flex items-center gap-1">
          <div className="text-right">
            <p className="text-xs text-gray-500">{t('available')}</p>
            <p className="text-lg font-semibold uv-text-primary">
              <Monto>{formatCurrency(balance)}</Monto>
            </p>
          </div>
          <BotonOcultarMontos className="-mr-2" />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)] p-1 rounded-[18px]" role="tablist">
        <button
          onClick={() => { setActiveTab('services'); setAvisoDeLista(''); }}
          role="tab"
          aria-selected={activeTab === 'services'}
          className={clasePestana(activeTab === 'services')}
        >
          <Icons.FileText size={14} />
          {t('nav_services')}
        </button>
        <button
          onClick={() => { setActiveTab('recharge'); setAvisoDeLista(''); }}
          role="tab"
          aria-selected={activeTab === 'recharge'}
          className={clasePestana(activeTab === 'recharge')}
        >
          <Icons.Phone size={14} />
          {t('recharge_label')}
        </button>
        <button
          onClick={() => setActiveTab('history')}
          role="tab"
          aria-selected={activeTab === 'history'}
          className={clasePestana(activeTab === 'history')}
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
              <h3 className="text-sm font-semibold uv-text-muted mb-3">
                {t('my_services')}
              </h3>
              <div className="flex gap-3 overflow-x-auto no-scrollbar pb-2">
                {guardadosOfrecidos.map(({ saved, empresa: provider }) => {
                  return (
                    <button
                      key={saved.id}
                      onClick={() => handleSelectProvider(provider)}
                      disabled={!conveniosActivos}
                      className={`min-w-[140px] p-4 text-left ${claseCarta}`}
                    >
                      <PlacaDeArte arte={provider.arte} lado={44} icono={32} className="mb-2" />
                      <div className="text-left">
                        <p className="font-semibold uv-text-primary text-sm truncate">
                          {saved.nickname || provider.name}
                        </p>
                        <p className="text-xs text-gray-500">{saved.clientId}</p>
                        {saved.lastAmount && (
                          <p className="text-sm font-semibold text-orange-500 mt-1">
                            <Monto>{formatCurrency(saved.lastAmount)}</Monto>
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
            <EstadoVacio icono="factura" titulo={t('services_no_providers')} className="uv-surface-1 rounded-[20px]" />
          )}

          {datosDelCatalogo && empresas.length > 0 && (
            <div className={`flex flex-col gap-6 @min-[44rem]/servicios:grid @min-[44rem]/servicios:grid-cols-[16rem_minmax(0,1fr)] @min-[44rem]/servicios:items-start`}>
              {/* Filtros: arriba en el telefono, a un lado en pantalla ancha */}
              <div className="space-y-4">
                {/* Búsqueda */}
                <div className="relative">
                  <Icons.Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={t('search_service')}
                    className="kp-foco w-full bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)] pl-11 pr-4 py-3 rounded-[16px] outline-none uv-text-primary placeholder-gray-400"
                  />
                </div>

                {/* Categorías: solo las que tienen empresas */}
                {categoriasOfrecidas.length > 1 && (
                  <div className={`flex gap-2 overflow-x-auto no-scrollbar pb-2 @min-[44rem]/servicios:flex-col @min-[44rem]/servicios:overflow-visible @min-[44rem]/servicios:pb-0`} role="tablist" aria-label={t('nav_services')}>
                    {[{ id: 'all', label: 'cat_all', icon: LayoutGrid }, ...categoriasOfrecidas].map((cat) => (
                      <button
                        key={cat.id}
                        onClick={() => setSelectedCategory(cat.id)}
                        role="tab"
                        aria-selected={categoriaActiva === cat.id}
                        className={`kp-toque kp-foco flex items-center gap-2 px-4 py-2 rounded-full whitespace-nowrap text-sm font-medium transition-colors duration-[var(--kp-mov-estado)] ease-kp @min-[44rem]/servicios:w-full @min-[44rem]/servicios:rounded-[16px] @min-[44rem]/servicios:py-3 ${
                          categoriaActiva === cat.id
                            ? 'bg-[var(--color-primary-fill)] hover:bg-[var(--color-primary-hover)] text-white'
                            : 'bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)] uv-text-secondary'
                        }`}
                      >
                        <cat.icon size={15} />
                        {t(cat.label)}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Lista de proveedores */}
              {filteredProviders.length === 0 ? (
                <EstadoVacio
                  icono="factura"
                  titulo={t('help_no_results')}
                  descripcion={t('help_no_results_desc')}
                  className="uv-surface-1 rounded-[20px]"
                />
              ) : (
                <div className="grid grid-cols-2 gap-3 @min-[60rem]/servicios:grid-cols-3">
                  {filteredProviders.map((provider) => (
                    <button
                      key={provider.code}
                      onClick={() => handleSelectProvider(provider)}
                      disabled={!conveniosActivos}
                      className={`p-4 text-left ${claseCarta}`}
                    >
                      <PlacaDeArte arte={provider.arte} lado={56} icono={40} className="mb-3" />
                      <p className="font-semibold uv-text-primary break-words">{provider.name}</p>
                      <p className="text-xs text-gray-500">{provider.code.toUpperCase()}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {activeTab === 'recharge' && (
        <div className="flex flex-col gap-6">
          {estadoDelCatalogo}
          {avisoSinConvenios}
          {avisoDeListaVieja}

          <div className={`flex flex-col gap-6 @min-[44rem]/servicios:grid @min-[44rem]/servicios:grid-cols-2 @min-[44rem]/servicios:items-start`}>
            {/* Operadores */}
            {datosDelCatalogo && operadores.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold uv-text-muted mb-3">
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
                      className={`p-4 text-center ${claseCarta}`}
                    >
                      <PlacaDeArte arte={op.arte} lado={56} icono={40} className="mx-auto mb-2" />
                      <p className="font-semibold uv-text-primary break-words">{op.name}</p>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Recargas recientes */}
            {state.rechargeHistory.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold uv-text-muted mb-3">
                  {t('recent_recharges')}
                </h3>
                <div className={claseLista}>
                  {state.rechargeHistory.slice(0, 5).map((recharge) => {
                    const op = dibujoDeOperador(recharge.operatorId);
                    return (
                      <div key={recharge.id} className="flex items-center p-4 gap-3">
                        <PlacaDeArte arte={op.arte} lado={44} icono={32} />
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold uv-text-primary">{recharge.phone}</p>
                          <p className="text-sm text-gray-500">{fechaCorta(recharge.dateISO, language) || recharge.date}</p>
                        </div>
                        <p className="font-semibold uv-text-primary">
                          <Monto>{formatCurrency(recharge.amount)}</Monto>
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'history' && (
        <div className={`flex flex-col gap-6 @min-[44rem]/servicios:grid @min-[44rem]/servicios:grid-cols-2 @min-[44rem]/servicios:items-start`}>
          {/* Pagos de servicios */}
          <div>
            <h3 className="mb-3 text-sm font-semibold uv-text-muted">
              {t('service_payments')}
            </h3>
            {state.billHistory.length === 0 ? (
              <EstadoVacio icono="factura" titulo={t('no_service_payments')} className="uv-surface-1 rounded-[20px]" />
            ) : (
              <div className={claseLista}>
                {state.billHistory.map((bill) => {
                  const provider = dibujoDeEmpresa(bill.providerId);
                  return (
                    <div key={bill.id} className="flex items-center p-4 gap-3">
                      <PlacaDeArte arte={provider.arte} lado={44} icono={32} />
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold uv-text-primary">{bill.providerName}</p>
                        <p className="text-sm text-gray-500">{t('client_label')}: {bill.clientId}</p>
                        <p className="text-xs text-gray-400">{bill.period}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold uv-text-primary">
                          <Monto>{formatCurrency(bill.amount)}</Monto>
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

          {/* Recargas: el titulo ocupa la misma altura que el del lado, que lleva el ojo */}
          <div>
            <div className="flex items-center min-h-11 mb-3">
              <h3 className="text-sm font-semibold uv-text-muted">
                {t('recharge_label')}
              </h3>
            </div>
            {state.rechargeHistory.length === 0 ? (
              <EstadoVacio icono="recarga" titulo={t('no_recharges_yet')} className="uv-surface-1 rounded-[20px]" />
            ) : (
              <div className={claseLista}>
                {state.rechargeHistory.map((recharge) => {
                  const op = dibujoDeOperador(recharge.operatorId);
                  return (
                    <div key={recharge.id} className="flex items-center p-4 gap-3">
                      <PlacaDeArte arte={op.arte} lado={44} icono={32} />
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold uv-text-primary">{nombreDelOperador(recharge.operatorId)}</p>
                        <p className="text-sm text-gray-500">+506 {recharge.phone}</p>
                        <p className="text-xs text-gray-400">{fechaCorta(recharge.dateISO, language) || recharge.date}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold uv-text-primary">
                          <Monto>{formatCurrency(recharge.amount)}</Monto>
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
              <PlacaDeArte arte={selectedProvider.arte} lado={56} icono={40} />
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
              <PlacaDeArte arte={selectedOperator.arte} lado={56} icono={40} />
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
                      ? 'bg-[var(--color-primary-fill)] hover:bg-[var(--color-primary-hover)] text-white'
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
          <h2 className="text-2xl font-semibold uv-text-primary mb-2">
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
              <p className="text-4xl font-semibold uv-text-primary">
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
