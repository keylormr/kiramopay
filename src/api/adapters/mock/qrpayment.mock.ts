import type {
  IQRPaymentRepository,
  QRMerchant,
  QRPaymentCode,
  QRPayment,
  StaffMember,
  MerchantLocation,
  CatalogItem,
  BusinessReport,
  BusinessReportBucket,
  RegisterMerchantRequest,
  CreateQRCodeRequest,
  ScanQRPayRequest,
  QRCharge,
  QRChargeStatus,
  CreateChargeRequest,
  ResolvedQR,
  PeriodoDeVentas,
  ResumenDelComercio,
  RetiroDelComercio,
  TotalDelDia,
  VentasPorMoneda,
} from '../../repositories/qrpayment.repository';
import type { PlanComercio } from '../../repositories/plans.repository';
import { VENTAS_POR_PAGINA } from '../../repositories/qrpayment.repository';
import type { ApiResponse, ArchivoDescargado } from '../../types';
import { apiSuccess, apiError, apiErrorConDetalle } from '../../types';

const STORAGE_KEY = 'kiramopay_app_state';

// Los rotulos del CSV del reporte en cada idioma, los mismos que escribe el
// servidor (backend/internal/qrpayment/reporte.go, rotulosPorIdioma). Sin
// idioma, o con uno que no esta, en espanol como el servidor.
const ROTULOS_CSV: Record<string, { encabezado: string; dia: string; total: string; archivo: string }> = {
  es: { encabezado: 'seccion,desde,hasta,clave,nombre,bruto,comision,neto,cobros', dia: 'dia', total: 'total', archivo: 'reporte' },
  en: { encabezado: 'section,from,to,key,name,gross,fee,net,payments', dia: 'day', total: 'total', archivo: 'report' },
  fr: { encabezado: 'section,du,au,cle,nom,brut,commission,net,encaissements', dia: 'jour', total: 'total', archivo: 'rapport' },
  pt: { encabezado: 'secao,de,ate,chave,nome,bruto,comissao,liquido,cobrancas', dia: 'dia', total: 'total', archivo: 'relatorio' },
  'zh-cn': { encabezado: '分组,开始,结束,标识,名称,总额,手续费,净额,笔数', dia: '日', total: '合计', archivo: 'report' },
  ja: { encabezado: '区分,開始,終了,キー,名前,総額,手数料,純額,件数', dia: '日', total: '合計', archivo: 'report' },
  hi: { encabezado: 'खंड,से,तक,कुंजी,नाम,सकल,शुल्क,शुद्ध,भुगतान', dia: 'दिन', total: 'कुल', archivo: 'report' },
};
const DEFAULT_COMMISSION_BPS = 50; // 0.50%

// ── Periodos del comercio (hoy, 7 dias, este mes, mes anterior) ──────────────
// Lo mismo que calcula el servidor (backend/internal/qrpayment/periodo.go), pero
// en la zona del dispositivo: la demo no tiene servidor que la cuente.
interface VentanaMock { desde: Date; hasta: Date; antDesde: Date; antHasta: Date }

function ventanaDelPeriodo(periodo: PeriodoDeVentas, ahora: Date = new Date()): VentanaMock {
  const medianoche = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
  const atras = (d: Date, dias: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() - dias, d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds());
  const inicioDeMes = new Date(ahora.getFullYear(), ahora.getMonth(), 1);
  if (periodo === 'week') {
    const desde = atras(medianoche, 6);
    return { desde, hasta: ahora, antDesde: atras(desde, 7), antHasta: atras(ahora, 7) };
  }
  if (periodo === 'month') {
    const mismoPunto = new Date(ahora.getFullYear(), ahora.getMonth() - 1, ahora.getDate(), ahora.getHours(), ahora.getMinutes(), ahora.getSeconds());
    return {
      desde: inicioDeMes,
      hasta: ahora,
      antDesde: new Date(ahora.getFullYear(), ahora.getMonth() - 1, 1),
      antHasta: mismoPunto > inicioDeMes ? inicioDeMes : mismoPunto,
    };
  }
  if (periodo === 'prev_month') {
    const desde = new Date(ahora.getFullYear(), ahora.getMonth() - 1, 1);
    return { desde, hasta: inicioDeMes, antDesde: new Date(ahora.getFullYear(), ahora.getMonth() - 2, 1), antHasta: desde };
  }
  return { desde: medianoche, hasta: ahora, antDesde: atras(medianoche, 1), antHasta: atras(ahora, 1) };
}

const claveDeDiaLocal = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const enVentana = (iso: string, desde: Date, hasta: Date) => {
  const t = new Date(iso).getTime();
  return t >= desde.getTime() && t < hasta.getTime();
};

function getState() {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : null;
  } catch {
    return null;
  }
}

function saveField(field: string, value: unknown) {
  const state = getState() || {};
  state[field] = value;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function readMerchants(): QRMerchant[] {
  const state = getState();
  const list = Array.isArray(state?.qrMerchants) ? state.qrMerchants : [];
  // Merchants stored by older mock versions have no role; in the mock the
  // current user owns everything they created.
  return list.map((m: QRMerchant) => ({ ...m, role: m.role ?? 'owner' }));
}

function readList<T>(field: string): T[] {
  const state = getState();
  return Array.isArray(state?.[field]) ? state[field] : [];
}

/**
 * codigoPermanente es el get-or-create del mock: la MISMA fila en llamadas
 * sucesivas, que es justo lo que el backend garantiza con su indice unico
 * parcial por (persona, moneda) y por (comercio, sucursal, moneda).
 */
function codigoPermanente(spec: {
  currency: string;
  type: QRPaymentCode['type'];
  merchantId?: string;
  locationId?: string;
}): QRPaymentCode {
  const codes: QRPaymentCode[] = getState()?.qrCodes ?? [];
  const vivo = codes.find(
    (c) =>
      c.status !== 'revoked' &&
      c.currency === spec.currency &&
      (c.merchantId || '') === (spec.merchantId || '') &&
      (c.locationId || '') === (spec.locationId || ''),
  );
  if (vivo) return vivo;

  const id = `qr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const code: QRPaymentCode = {
    id,
    type: spec.type,
    amount: 0,
    currency: spec.currency,
    qrData: JSON.stringify({
      id,
      type: spec.type,
      amount: 0,
      currency: spec.currency,
      merchantId: spec.merchantId,
      locationId: spec.locationId,
    }),
    singleUse: false,
    used: false,
    merchantId: spec.merchantId,
    locationId: spec.locationId,
    status: 'active',
  };
  codes.unshift(code);
  saveField('qrCodes', codes);
  return code;
}

/** Viste un cobro con la forma vieja, igual que hace el servidor con las apps
 * que todavia llaman a POST /qr/codes con monto. */
function chargeComoCodigo(c: QRCharge): QRPaymentCode {
  return {
    id: c.id,
    type: c.merchantId ? 'merchant_fixed' : 'p2p_request',
    amount: c.amount,
    currency: c.currency,
    note: c.note,
    qrData: c.qrData,
    singleUse: true,
    used: c.status === 'paid',
    expiresAt: c.expiresAt,
    merchantId: c.merchantId,
    locationId: c.locationId,
    status: 'active',
  };
}

export class MockQRPaymentRepository implements IQRPaymentRepository {
  async registerMerchant(request: RegisterMerchantRequest): Promise<ApiResponse<QRMerchant>> {
    const merchant: QRMerchant = {
      id: `merch-${Date.now()}`,
      name: request.name,
      description: request.description,
      category: request.category,
      qrCode: `MRC-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
      active: true,
      cedula: request.cedula,
      cedulaType: request.cedulaType,
      legalName: request.legalName,
      // The mock has no admin, so it auto-verifies to keep the demo flow working.
      verificationStatus: 'verified',
      commissionBps: DEFAULT_COMMISSION_BPS,
      comisionEfectivaBps: DEFAULT_COMMISSION_BPS,
      promoHasta: null,
      plan: 'base',
      role: 'owner',
    };
    const merchants = readMerchants();
    merchants.push(merchant);
    saveField('qrMerchants', merchants);
    return apiSuccess(merchant);
  }

  async getMerchants(): Promise<ApiResponse<QRMerchant[]>> {
    // Como el servidor: un comercio cerrado ya no aparece en la lista propia.
    return apiSuccess(readMerchants().filter((m) => !m.closedAt));
  }

  async getMerchantBalance(merchantId: string): Promise<ApiResponse<number>> {
    // Mock balance = collected minus fees, derived from the stored payments so
    // it behaves like the real journal-derived figure.
    const state = getState();
    const payments: Array<{ merchantId?: string; amount: number; fee: number }> =
      state?.qrPayments ?? [];
    const withdrawn: number = state?.merchantWithdrawn?.[merchantId] ?? 0;
    const collected = payments
      .filter((p) => p.merchantId === merchantId)
      .reduce((s, p) => s + (p.amount - p.fee), 0);
    return apiSuccess(collected - withdrawn);
  }

  async withdrawMerchant(merchantId: string, amount: number, currency = 'CRC'): Promise<ApiResponse<{ repetida: boolean }>> {
    const state = getState();
    const withdrawn: Record<string, number> = state?.merchantWithdrawn ?? {};
    withdrawn[merchantId] = (withdrawn[merchantId] ?? 0) + amount;
    saveField('merchantWithdrawn', withdrawn);
    // El retiro tambien es un movimiento del comercio.
    const retiros = readList<RetiroDelComercio & { merchantId: string }>('qrWithdrawals');
    retiros.push({
      id: `wd-${Date.now()}`, merchantId, amount, currency, status: 'completed',
      withdrawnByName: 'Demo', createdAt: new Date().toISOString(),
    });
    saveField('qrWithdrawals', retiros);
    return apiSuccess({ repetida: false });
  }

  async updateMerchant(merchantId: string, request: RegisterMerchantRequest): Promise<ApiResponse<QRMerchant>> {
    const merchants = readMerchants();
    const idx = merchants.findIndex((m) => m.id === merchantId);
    if (idx === -1) return apiError('NOT_FOUND', 'Merchant not found');
    const current = merchants[idx];
    // Mirror the backend rule: changing legal identity returns the shop to review.
    const identityChanged =
      request.cedula !== current.cedula || request.legalName !== current.legalName;
    merchants[idx] = {
      ...current,
      name: request.name,
      description: request.description,
      category: request.category,
      cedula: request.cedula,
      cedulaType: request.cedulaType,
      legalName: request.legalName,
      verificationStatus:
        identityChanged || current.verificationStatus === 'rejected'
          ? 'pending'
          : current.verificationStatus,
    };
    saveField('qrMerchants', merchants);
    return apiSuccess(merchants[idx]);
  }

  // Enruta por MONTO, igual que el servidor: con monto emite un cobro, sin
  // monto devuelve el codigo permanente. Si el mock siguiera creando un codigo
  // nuevo en cada llamada, las pruebas de vista pasarian en verde sobre un
  // contrato que el backend ya no tiene — este repositorio ya se quemo con un
  // stub que respondia exito a todo.
  async createQRCode(request: CreateQRCodeRequest): Promise<ApiResponse<QRPaymentCode>> {
    const code = request.merchantId
      ? await this.getMerchantCode(request.merchantId, { locationId: request.locationId, currency: request.currency })
      : await this.getMyCode(request.currency);
    if (!code.success || !code.data) return code;
    if (!request.amount || request.amount <= 0) return code;

    const cobro = await this.createCharge({
      qrCodeId: code.data.id,
      amount: request.amount,
      note: request.note,
      channel: request.merchantId ? 'counter' : 'link',
    });
    if (!cobro.success || !cobro.data) return apiError(cobro.error?.code || 'CREATE_FAILED', cobro.error?.message || 'Failed');
    return apiSuccess(chargeComoCodigo(cobro.data));
  }

  // ── El QR reciclable ──────────────────────────────────────────────────────

  async getMyCode(currency = 'CRC'): Promise<ApiResponse<QRPaymentCode>> {
    return apiSuccess(codigoPermanente({ currency, type: 'p2p_receive' }));
  }

  async getMerchantCode(
    merchantId: string,
    opts: { locationId?: string; currency?: string } = {},
  ): Promise<ApiResponse<QRPaymentCode>> {
    return apiSuccess(codigoPermanente({
      currency: opts.currency || 'CRC',
      type: 'merchant_dynamic',
      merchantId,
      locationId: opts.locationId,
    }));
  }

  async revokeCode(codeId: string): Promise<ApiResponse<void>> {
    const codes: QRPaymentCode[] = getState()?.qrCodes ?? [];
    const idx = codes.findIndex((c) => c.id === codeId);
    if (idx === -1) return apiError('QR_INVALIDO', 'codigo no encontrado');
    codes[idx] = { ...codes[idx], status: 'revoked' };
    saveField('qrCodes', codes);
    return apiSuccess(undefined as void);
  }

  async resolveQr(qrData: string): Promise<ApiResponse<ResolvedQR>> {
    let info: { id?: string; chargeId?: string };
    try {
      info = JSON.parse(qrData);
    } catch {
      return apiError('QR_INVALIDO', 'Codigo QR invalido');
    }
    const cobros: QRCharge[] = getState()?.qrCharges ?? [];
    const cobro = info.chargeId ? cobros.find((c) => c.id === info.chargeId) : undefined;
    const codes: QRPaymentCode[] = getState()?.qrCodes ?? [];
    const code = codes.find((c) => c.id === (cobro ? cobro.qrCodeId : info.id));
    if (!code) return apiError('QR_INVALIDO', 'Codigo QR invalido');
    if (code.status === 'revoked') return apiError('QR_REVOCADO', 'codigo retirado');
    return apiSuccess({
      kind: cobro ? 'charge' : 'code',
      payeeName: code.merchantId ? undefined : 'Cuenta demo',
      merchantName: code.merchantId ? 'Comercio demo' : undefined,
      currency: code.currency,
      amount: cobro ? cobro.amount : 0,
      note: cobro?.note,
      status: cobro?.status,
      expiresAt: cobro?.expiresAt,
      chargeId: cobro?.id,
      qrCodeId: code.id,
    });
  }

  async createCharge(request: CreateChargeRequest): Promise<ApiResponse<QRCharge>> {
    const cobros: QRCharge[] = getState()?.qrCharges ?? [];
    if (request.replaces) {
      const idx = cobros.findIndex((c) => c.id === request.replaces);
      if (idx === -1) return apiError('QR_INVALIDO', 'cobro no encontrado');
      // La rama del doble cobro: sobre un cobro ya pagado NO se emite el nuevo.
      if (cobros[idx].status === 'paid') return apiError('COBRO_YA_PAGADO', 'ese cobro ya fue pagado');
      if (cobros[idx].status !== 'pending') return apiError('COBRO_CANCELADO', 'ese cobro ya no esta activo');
    }
    const codes: QRPaymentCode[] = getState()?.qrCodes ?? [];
    const code = codes.find((c) => c.id === request.qrCodeId);
    if (!code) return apiError('QR_INVALIDO', 'codigo no encontrado');

    const id = `charge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const canal = request.channel || 'counter';
    const cobro: QRCharge = {
      id,
      qrCodeId: code.id,
      merchantId: code.merchantId,
      locationId: code.locationId,
      createdBy: 'current-user',
      amount: request.amount,
      currency: code.currency,
      note: request.note,
      channel: canal,
      status: 'pending',
      qrData: JSON.stringify({ id: code.id, chargeId: id, amount: request.amount, type: code.type, merchantId: code.merchantId }),
      expiresAt: new Date(Date.now() + (canal === 'link' ? 24 * 60 * 60 * 1000 : 30 * 60 * 1000)).toISOString(),
      createdAt: new Date().toISOString(),
    };
    if (request.replaces) {
      const idx = cobros.findIndex((c) => c.id === request.replaces);
      cobros[idx] = { ...cobros[idx], status: 'superseded', supersededBy: id };
    }
    cobros.unshift(cobro);
    saveField('qrCharges', cobros);
    return apiSuccess(cobro);
  }

  async getCharge(chargeId: string): Promise<ApiResponse<QRCharge>> {
    const cobros: QRCharge[] = getState()?.qrCharges ?? [];
    const c = cobros.find((x) => x.id === chargeId);
    if (!c) return apiError('QR_INVALIDO', 'cobro no encontrado');
    return apiSuccess(c);
  }

  async cancelCharge(chargeId: string): Promise<ApiResponse<void>> {
    const cobros: QRCharge[] = getState()?.qrCharges ?? [];
    const idx = cobros.findIndex((c) => c.id === chargeId);
    if (idx === -1) return apiError('QR_INVALIDO', 'cobro no encontrado');
    if (cobros[idx].status === 'paid') return apiError('COBRO_YA_PAGADO', 'ese cobro ya fue pagado');
    if (cobros[idx].status !== 'pending') return apiError('COBRO_CANCELADO', 'ese cobro ya no esta activo');
    cobros[idx] = { ...cobros[idx], status: 'cancelled' };
    saveField('qrCharges', cobros);
    return apiSuccess(undefined as void);
  }

  async listCharges(status?: QRChargeStatus): Promise<ApiResponse<QRCharge[]>> {
    const cobros: QRCharge[] = getState()?.qrCharges ?? [];
    return apiSuccess(status ? cobros.filter((c) => c.status === status) : cobros);
  }

  async getQRCodes(): Promise<ApiResponse<QRPaymentCode[]>> {
    const state = getState();
    return apiSuccess(state?.qrCodes ?? []);
  }

  async scanAndPay(request: ScanQRPayRequest): Promise<ApiResponse<QRPayment>> {
    let qrInfo: { id?: string; amount?: number; type?: string; merchantId?: string; locationId?: string };
    try {
      qrInfo = JSON.parse(request.qrData);
    } catch {
      // El mismo codigo que el servidor, para que la pantalla lo traduzca.
      return apiError('QR_INVALIDO', 'Codigo QR invalido');
    }

    const amount = request.amount ?? qrInfo.amount ?? 0;
    // Mirror the server: merchant codes carry a commission absorbed by the merchant.
    // The backend computes the fee in centimos (floored), so compute it there too
    // and express it back in colones — the unit the mock stores amounts in.
    const isMerchant = qrInfo.type === 'merchant_fixed' || qrInfo.type === 'merchant_dynamic';
    const fee = isMerchant ? Math.floor((amount * 100 * DEFAULT_COMMISSION_BPS) / 10000) / 100 : 0;

    const payment: QRPayment = {
      id: `qrpay-${Date.now()}`,
      qrCodeId: qrInfo.id ?? 'unknown',
      payerId: 'current-user',
      receiverId: 'merchant',
      merchantId: qrInfo.merchantId,
      locationId: qrInfo.locationId,
      collectedBy: qrInfo.merchantId ? 'current-user' : undefined,
      amount,
      fee,
      currency: request.currency,
      status: 'completed',
      createdAt: new Date().toISOString(),
    };
    const state = getState();
    const payments: QRPayment[] = state?.qrPayments ?? [];
    payments.unshift(payment);
    saveField('qrPayments', payments);
    return apiSuccess(payment);
  }

  async getPaymentHistory(): Promise<ApiResponse<QRPayment[]>> {
    const state = getState();
    return apiSuccess(state?.qrPayments ?? []);
  }

  async getMerchantPayments(
    merchantId: string,
    opciones?: { antesDe?: string; periodo?: PeriodoDeVentas },
  ): Promise<ApiResponse<QRPayment[]>> {
    const ventana = opciones?.periodo ? ventanaDelPeriodo(opciones.periodo) : null;
    const ventas = readList<QRPayment>('qrPayments')
      .filter((p) => p.merchantId === merchantId && (!ventana || enVentana(p.createdAt, ventana.desde, ventana.hasta)))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    const desde = opciones?.antesDe ? ventas.findIndex((p) => p.id === opciones.antesDe) + 1 : 0;
    if (opciones?.antesDe && desde === 0) return apiSuccess([]);
    return apiSuccess(ventas.slice(desde, desde + VENTAS_POR_PAGINA));
  }

  private ventasCompletadas(merchantId: string, desde: Date, hasta: Date): QRPayment[] {
    return readList<QRPayment>('qrPayments').filter(
      (p) => p.merchantId === merchantId && p.status === 'completed' && enVentana(p.createdAt, desde, hasta),
    );
  }

  private porMoneda(ventas: QRPayment[]): Map<string, { gross: number; fee: number; count: number }> {
    const m = new Map<string, { gross: number; fee: number; count: number }>();
    for (const p of ventas) {
      const b = m.get(p.currency) ?? { gross: 0, fee: 0, count: 0 };
      b.gross += p.amount;
      b.fee += p.fee;
      b.count += 1;
      m.set(p.currency, b);
    }
    return m;
  }

  async getMerchantSummary(merchantId: string): Promise<ApiResponse<ResumenDelComercio>> {
    const comercio = readMerchants().find((m) => m.id === merchantId);
    if (!comercio) return apiError('NOT_FOUND', 'merchant not found');
    const analitica = comercio.plan === 'analitica' && comercio.role !== 'cashier';
    const periodos: PeriodoDeVentas[] = comercio.role === 'cashier' ? ['today'] : ['today', 'week', 'month', 'prev_month'];
    return apiSuccess({
      plan: comercio.plan === 'analitica' ? 'analitica' : 'base',
      periods: periodos.map((period) => {
        const v = ventanaDelPeriodo(period);
        const ahora = this.porMoneda(this.ventasCompletadas(merchantId, v.desde, v.hasta));
        const antes = this.porMoneda(this.ventasCompletadas(merchantId, v.antDesde, v.antHasta));
        const monedas = [...new Set([...ahora.keys(), ...(analitica ? antes.keys() : [])])].sort();
        const currencies: VentasPorMoneda[] = monedas.map((currency) => {
          const a = ahora.get(currency) ?? { gross: 0, fee: 0, count: 0 };
          const fila: VentasPorMoneda = { currency, gross: a.gross, fee: a.fee, net: a.gross - a.fee, count: a.count };
          if (analitica) {
            const b = antes.get(currency) ?? { gross: 0, fee: 0, count: 0 };
            const pct = (x: number, y: number) => (y === 0 ? null : Math.round(((x - y) * 10000) / y) / 100);
            fila.previous = { gross: b.gross, fee: b.fee, net: b.gross - b.fee, count: b.count };
            fila.delta = {
              gross: a.gross - b.gross, fee: a.fee - b.fee, net: fila.net - fila.previous.net, count: a.count - b.count,
              grossPct: pct(a.gross, b.gross), netPct: pct(fila.net, fila.previous.net), countPct: pct(a.count, b.count),
            };
          }
          return fila;
        });
        return { period, from: claveDeDiaLocal(v.desde), to: claveDeDiaLocal(new Date(v.hasta.getTime() - 1)), currencies };
      }),
    });
  }

  async getMerchantDailyTotals(merchantId: string, periodo: PeriodoDeVentas): Promise<ApiResponse<TotalDelDia[]>> {
    const v = ventanaDelPeriodo(periodo);
    const filas = new Map<string, TotalDelDia>();
    for (const p of this.ventasCompletadas(merchantId, v.desde, v.hasta)) {
      const date = claveDeDiaLocal(new Date(p.createdAt));
      const clave = `${date}|${p.currency}`;
      const f = filas.get(clave) ?? { date, currency: p.currency, gross: 0, fee: 0, net: 0, count: 0 };
      f.gross += p.amount;
      f.fee += p.fee;
      f.net = f.gross - f.fee;
      f.count += 1;
      filas.set(clave, f);
    }
    return apiSuccess([...filas.values()].sort((a, b) => (a.date === b.date ? a.currency.localeCompare(b.currency) : a.date < b.date ? 1 : -1)));
  }

  async getMerchantWithdrawals(merchantId: string, periodo: PeriodoDeVentas): Promise<ApiResponse<RetiroDelComercio[]>> {
    const v = ventanaDelPeriodo(periodo);
    return apiSuccess(
      readList<RetiroDelComercio & { merchantId?: string }>('qrWithdrawals')
        .filter((r) => r.merchantId === merchantId && enVentana(r.createdAt, v.desde, v.hasta))
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))),
    );
  }

  async getMerchantReport(merchantId: string, days: number): Promise<ApiResponse<BusinessReport>> {
    const since = new Date();
    since.setHours(0, 0, 0, 0);
    since.setDate(since.getDate() - (days - 1));
    const sales = readList<QRPayment>('qrPayments').filter(
      (p) => p.merchantId === merchantId && new Date(p.createdAt) >= since,
    );
    const locations = readList<MerchantLocation>('qrLocations');

    const daily = new Map<string, { gross: number; fee: number; count: number }>();
    const byLoc = new Map<string, { gross: number; fee: number; count: number }>();
    const byCol = new Map<string, { gross: number; fee: number; count: number }>();
    const bump = (m: Map<string, { gross: number; fee: number; count: number }>, k: string, p: QRPayment) => {
      const b = m.get(k) ?? { gross: 0, fee: 0, count: 0 };
      b.gross += p.amount;
      b.fee += p.fee;
      b.count += 1;
      m.set(k, b);
    };
    for (const p of sales) {
      const d = new Date(p.createdAt);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      bump(daily, key, p);
      bump(byLoc, p.locationId ?? '', p);
      bump(byCol, p.collectedBy ?? '', p);
    }
    const toBuckets = (m: Map<string, { gross: number; fee: number; count: number }>, labelOf: (k: string) => string): BusinessReportBucket[] =>
      [...m.entries()]
        .map(([key, v]) => ({ key: key || undefined, label: labelOf(key) || undefined, gross: v.gross, fee: v.fee, net: v.gross - v.fee, count: v.count }))
        .sort((a, b) => b.gross - a.gross);
    const totals = sales.reduce(
      (t, p) => ({ ...t, gross: t.gross + p.amount, fee: t.fee + p.fee, count: t.count + 1 }),
      { gross: 0, fee: 0, net: 0, count: 0 },
    );
    totals.net = totals.gross - totals.fee;

    return apiSuccess({
      days,
      totals,
      plan: readMerchants().find((m) => m.id === merchantId)?.plan ?? 'base',
      daily: [...daily.entries()]
        .map(([date, v]) => ({ date, gross: v.gross, fee: v.fee, net: v.gross - v.fee, count: v.count }))
        .sort((a, b) => (a.date < b.date ? -1 : 1)),
      byLocation: toBuckets(byLoc, (k) => locations.find((l) => l.id === k)?.name ?? ''),
      byCollector: toBuckets(byCol, (k) => (k ? 'Demo' : '')),
    });
  }

  // ── Team (mock: the demo user owns everything, staff are stored locally) ───

  async getStaff(merchantId: string): Promise<ApiResponse<StaffMember[]>> {
    return apiSuccess(readList<StaffMember>('qrStaff').filter((s) => s.merchantId === merchantId));
  }

  async addStaff(
    merchantId: string,
    cedula: string,
    role: 'cashier' | 'manager',
    locationId?: string,
  ): Promise<ApiResponse<StaffMember>> {
    if (!cedula.trim()) return apiError('ADD_STAFF_FAILED', 'cedula is required');
    const staff = readList<StaffMember>('qrStaff');
    const existing = staff.find((s) => s.merchantId === merchantId && s.userId === `user-${cedula}`);
    if (existing) {
      existing.role = role;
      existing.status = 'active';
      existing.locationId = locationId;
      saveField('qrStaff', staff);
      return apiSuccess(existing);
    }
    const member: StaffMember = {
      id: `staff-${Date.now()}`,
      merchantId,
      userId: `user-${cedula}`,
      firstName: 'Empleado',
      lastName: cedula.slice(-4),
      role,
      status: 'active',
      locationId,
      createdAt: new Date().toISOString(),
    };
    staff.push(member);
    saveField('qrStaff', staff);
    return apiSuccess(member);
  }

  async updateStaff(
    merchantId: string,
    staffId: string,
    role: 'cashier' | 'manager',
    locationId?: string,
  ): Promise<ApiResponse<StaffMember>> {
    const staff = readList<StaffMember>('qrStaff');
    const member = staff.find((s) => s.id === staffId && s.merchantId === merchantId);
    if (!member) return apiError('NOT_FOUND', 'Staff member not found');
    member.role = role;
    member.locationId = locationId;
    saveField('qrStaff', staff);
    return apiSuccess(member);
  }

  async revokeStaff(merchantId: string, staffId: string): Promise<ApiResponse<void>> {
    const staff = readList<StaffMember>('qrStaff');
    const member = staff.find((s) => s.id === staffId && s.merchantId === merchantId);
    if (!member) return apiError('NOT_FOUND', 'Staff member not found');
    member.status = 'revoked';
    saveField('qrStaff', staff);
    return apiSuccess(undefined as unknown as void);
  }

  // ── Locations ──────────────────────────────────────────────────────────────

  async getLocations(merchantId: string): Promise<ApiResponse<MerchantLocation[]>> {
    return apiSuccess(readList<MerchantLocation>('qrLocations').filter((l) => l.merchantId === merchantId));
  }

  async createLocation(merchantId: string, name: string, address: string): Promise<ApiResponse<MerchantLocation>> {
    if (!name.trim()) return apiError('CREATE_LOCATION_FAILED', 'location name is required');
    const locations = readList<MerchantLocation>('qrLocations');
    const loc: MerchantLocation = { id: `loc-${Date.now()}`, merchantId, name: name.trim(), address, active: true };
    locations.push(loc);
    saveField('qrLocations', locations);
    return apiSuccess(loc);
  }

  async updateLocation(
    merchantId: string,
    locationId: string,
    patch: { name?: string; address?: string; active?: boolean },
  ): Promise<ApiResponse<MerchantLocation>> {
    const locations = readList<MerchantLocation>('qrLocations');
    const loc = locations.find((l) => l.id === locationId && l.merchantId === merchantId);
    if (!loc) return apiError('NOT_FOUND', 'Location not found');
    if (patch.name?.trim()) loc.name = patch.name.trim();
    if (patch.address !== undefined) loc.address = patch.address;
    if (patch.active !== undefined) loc.active = patch.active;
    saveField('qrLocations', locations);
    return apiSuccess(loc);
  }

  // ── Catalog ────────────────────────────────────────────────────────────────

  async getCatalog(merchantId: string): Promise<ApiResponse<CatalogItem[]>> {
    return apiSuccess(readList<CatalogItem>('qrCatalog').filter((c) => c.merchantId === merchantId));
  }

  async createCatalogItem(
    merchantId: string,
    item: { name: string; price: number; currency?: string },
  ): Promise<ApiResponse<CatalogItem>> {
    if (!item.name.trim()) return apiError('CREATE_ITEM_FAILED', 'item name is required');
    if (!(item.price > 0)) return apiError('CREATE_ITEM_FAILED', 'price must be positive');
    const catalog = readList<CatalogItem>('qrCatalog');
    const created: CatalogItem = {
      id: `item-${Date.now()}`,
      merchantId,
      name: item.name.trim(),
      price: item.price,
      currency: item.currency ?? 'CRC',
      active: true,
      sortOrder: catalog.length,
    };
    catalog.push(created);
    saveField('qrCatalog', catalog);
    return apiSuccess(created);
  }

  async updateCatalogItem(
    merchantId: string,
    itemId: string,
    patch: { name?: string; price?: number; active?: boolean; sortOrder?: number },
  ): Promise<ApiResponse<CatalogItem>> {
    const catalog = readList<CatalogItem>('qrCatalog');
    const item = catalog.find((c) => c.id === itemId && c.merchantId === merchantId);
    if (!item) return apiError('NOT_FOUND', 'Catalog item not found');
    if (patch.name?.trim()) item.name = patch.name.trim();
    if (patch.price !== undefined) {
      if (!(patch.price > 0)) return apiError('UPDATE_ITEM_FAILED', 'price must be positive');
      item.price = patch.price;
    }
    if (patch.active !== undefined) item.active = patch.active;
    if (patch.sortOrder !== undefined) item.sortOrder = patch.sortOrder;
    saveField('qrCatalog', catalog);
    return apiSuccess(item);
  }

  async deleteCatalogItem(merchantId: string, itemId: string): Promise<ApiResponse<void>> {
    const catalog = readList<CatalogItem>('qrCatalog');
    const idx = catalog.findIndex((c) => c.id === itemId && c.merchantId === merchantId);
    if (idx === -1) return apiError('NOT_FOUND', 'Catalog item not found');
    catalog.splice(idx, 1);
    saveField('qrCatalog', catalog);
    return apiSuccess(undefined as unknown as void);
  }

  // ── Admin ──────────────────────────────────────────────────────────────────

  async listPendingMerchants(): Promise<ApiResponse<QRMerchant[]>> {
    return apiSuccess(readMerchants().filter((m) => m.verificationStatus === 'pending' && !m.closedAt));
  }

  async approveMerchant(merchantId: string): Promise<ApiResponse<QRMerchant>> {
    return this.setStatus(merchantId, 'verified', '');
  }

  async rejectMerchant(merchantId: string, reason: string): Promise<ApiResponse<QRMerchant>> {
    return this.setStatus(merchantId, 'rejected', reason);
  }

  async setMerchantCommission(merchantId: string, commissionBps: number): Promise<ApiResponse<QRMerchant>> {
    const merchants = readMerchants();
    const idx = merchants.findIndex((m) => m.id === merchantId);
    if (idx === -1) return apiError('NOT_FOUND', 'Merchant not found');
    merchants[idx] = { ...merchants[idx], commissionBps };
    saveField('qrMerchants', merchants);
    return apiSuccess(merchants[idx]);
  }

  async setMerchantPlan(merchantId: string, plan: PlanComercio): Promise<ApiResponse<QRMerchant>> {
    const merchants = readMerchants();
    const idx = merchants.findIndex((m) => m.id === merchantId);
    if (idx === -1) return apiError('MERCHANT_NOT_FOUND', 'merchant not found');
    merchants[idx] = { ...merchants[idx], plan };
    saveField('qrMerchants', merchants);
    return apiSuccess(merchants[idx]);
  }

  async listAllMerchants(busqueda?: string): Promise<ApiResponse<QRMerchant[]>> {
    const q = busqueda?.trim().toLowerCase() ?? '';
    const todos = readMerchants();
    if (!q) return apiSuccess(todos);
    return apiSuccess(todos.filter((m) =>
      m.name.toLowerCase().includes(q) || m.legalName.toLowerCase().includes(q) || m.id.toLowerCase() === q));
  }

  async listClosedMerchants(): Promise<ApiResponse<QRMerchant[]>> {
    const cerrados = readMerchants().filter((m) => !!m.closedAt);
    cerrados.sort((a, b) => String(b.closedAt).localeCompare(String(a.closedAt)));
    return apiSuccess(cerrados.map((m) => ({ ...m, role: 'owner' as const })));
  }

  async closeMerchantAsAdmin(merchantId: string, reason: string): Promise<ApiResponse<QRMerchant>> {
    const motivo = reason.trim();
    if (!motivo) return apiError('CLOSURE_REASON_REQUIRED', 'a reason is required to close a merchant');
    return this.cerrar(merchantId, motivo, 'admin');
  }

  async closeMerchant(merchantId: string, confirmacion: { password: string }): Promise<ApiResponse<QRMerchant>> {
    // El mock no guarda contrasenas: solo exige que se escriba una.
    if (!confirmacion.password) return apiError('CURRENT_PASSWORD_INVALID', 'current password is incorrect');
    return this.cerrar(merchantId, 'owner_request', 'owner');
  }

  // Las mismas reglas que el servidor: con saldo no se cierra, y cerrado no se
  // cierra dos veces. El comercio se marca; nunca se borra.
  private async cerrar(merchantId: string, motivo: string, quien: string): Promise<ApiResponse<QRMerchant>> {
    const merchants = readMerchants();
    const idx = merchants.findIndex((m) => m.id === merchantId);
    if (idx === -1) return apiError('MERCHANT_NOT_FOUND', 'merchant not found');
    if (merchants[idx].closedAt) return apiError('MERCHANT_CLOSED', 'merchant is closed');
    const saldo = await this.getMerchantBalance(merchantId);
    if (saldo.success && (saldo.data ?? 0) > 0) {
      return apiErrorConDetalle('MERCHANT_HAS_BALANCE', 'the business balance must be withdrawn before closing', {
        balances: [{ currency: 'CRC', amount: Math.round((saldo.data ?? 0) * 100) }],
      });
    }
    merchants[idx] = {
      ...merchants[idx],
      active: false,
      closedAt: new Date().toISOString(),
      closedBy: quien,
      closureReason: motivo,
    };
    saveField('qrMerchants', merchants);
    return apiSuccess(merchants[idx]);
  }

  // El mock arma el mismo CSV que el servidor (columnas, BOM, montos en
  // unidades) y responde PLAN_REQUIRED sin el plan, para que la pantalla se
  // pueda probar sin backend.
  async exportMerchantReportCsv(
    merchantId: string,
    days: number,
    idioma?: string,
    periodo?: PeriodoDeVentas,
  ): Promise<ApiResponse<ArchivoDescargado>> {
    const merchant = readMerchants().find((m) => m.id === merchantId);
    if (!merchant) return apiError('NOT_FOUND', 'merchant not found');
    if (merchant.plan !== 'analitica') {
      return apiErrorConDetalle('PLAN_REQUIRED', 'plan analitica required', { plan_requerido: 'analitica' });
    }
    if (periodo) {
      // El periodo se arma con los totales de cada dia, que la demo ya sabe dar.
      const dias = await this.getMerchantDailyTotals(merchantId, periodo);
      if (!dias.success || !dias.data) return apiError('EXPORT_FAILED', 'export failed');
      const rotulos = ROTULOS_CSV[idioma ?? ''] ?? ROTULOS_CSV.es;
      const dinero = (v: number) => v.toFixed(2);
      const total = dias.data.reduce((t, d) => ({ gross: t.gross + d.gross, fee: t.fee + d.fee, count: t.count + d.count }), { gross: 0, fee: 0, count: 0 });
      const lineas = [
        rotulos.encabezado,
        ...dias.data.map((d) => `${rotulos.dia},${d.date},${d.date},,,${dinero(d.gross)},${dinero(d.fee)},${dinero(d.net)},${d.count}`),
        `${rotulos.total},,,,,${dinero(total.gross)},${dinero(total.fee)},${dinero(total.gross - total.fee)},${total.count}`,
      ];
      return apiSuccess({
        blob: new Blob([`${String.fromCharCode(0xfeff)}${lineas.join('\r\n')}`], { type: 'text/csv;charset=utf-8' }),
        nombre: `${rotulos.archivo}-${periodo}.csv`,
      });
    }
    const rep = await this.getMerchantReport(merchantId, days);
    if (!rep.success || !rep.data) return apiError('EXPORT_FAILED', 'export failed');
    const monto = (v: number) => v.toFixed(2);
    const rot = ROTULOS_CSV[idioma ?? ''] ?? ROTULOS_CSV.es;
    const filas = [
      rot.encabezado,
      ...rep.data.daily.map((d) => `${rot.dia},${d.date},${d.date},,,${monto(d.gross)},${monto(d.fee)},${monto(d.net)},${d.count}`),
      `${rot.total},,,,,${monto(rep.data.totals.gross)},${monto(rep.data.totals.fee)},${monto(rep.data.totals.net)},${rep.data.totals.count}`,
    ];
    return apiSuccess({
      blob: new Blob([`${String.fromCharCode(0xfeff)}${filas.join('\r\n')}`], { type: 'text/csv;charset=utf-8' }),
      nombre: `${rot.archivo}-${days}.csv`,
    });
  }

  private setStatus(
    merchantId: string,
    status: QRMerchant['verificationStatus'],
    reason: string,
  ): ApiResponse<QRMerchant> {
    const merchants = readMerchants();
    const idx = merchants.findIndex((m) => m.id === merchantId);
    if (idx === -1) return apiError('NOT_FOUND', 'Merchant not found');
    merchants[idx] = { ...merchants[idx], verificationStatus: status, rejectionReason: reason || undefined };
    saveField('qrMerchants', merchants);
    return apiSuccess(merchants[idx]);
  }
}
