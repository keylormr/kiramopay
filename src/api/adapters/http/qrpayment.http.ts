import type {
  IQRPaymentRepository,
  QRMerchant,
  QRPaymentCode,
  QRPayment,
  MerchantVerificationStatus,
  MerchantRole,
  StaffMember,
  MerchantLocation,
  CatalogItem,
  BusinessReport,
  BusinessReportBucket,
  BusinessReportDay,
  RegisterMerchantRequest,
  CreateQRCodeRequest,
  ScanQRPayRequest,
  QRCharge,
  QRChargeStatus,
  CreateChargeRequest,
  ResolvedQR,
  BusinessReportComparison,
  PeriodoDeVentas,
  ResumenDelComercio,
  ResumenDelPeriodo,
  RetiroDelComercio,
  TotalDelDia,
  TotalesDeVentas,
  VentasPorMoneda,
} from '../../repositories/qrpayment.repository';
import type { PlanComercio } from '../../repositories/plans.repository';
import type { ApiResponse, ArchivoDescargado } from '../../types';
import { apiSuccess } from '../../types';
import { falla } from './falla';
import { normalizarPlanComercio } from '../../../utils/planes';
import { HttpClient } from './client';

interface MerchantDTO {
  id: string;
  name: string;
  description: string;
  category: string;
  qr_code: string;
  active: boolean;
  cedula?: string;
  cedula_type?: string;
  legal_name?: string;
  verification_status?: string;
  rejection_reason?: string;
  commission_bps?: number;
  comision_efectiva_bps?: number;
  promo_hasta?: string | null;
  plan?: string;
  role?: string;
  closed_at?: string | null;
  closed_by?: string;
  closure_reason?: string;
  owner_name?: string;
}

function mapMerchant(d: MerchantDTO): QRMerchant {
  return {
    id: d.id,
    name: d.name,
    description: d.description,
    category: d.category,
    qrCode: d.qr_code,
    active: d.active,
    cedula: d.cedula ?? '',
    cedulaType: (d.cedula_type === 'juridica' ? 'juridica' : 'fisica'),
    legalName: d.legal_name ?? '',
    verificationStatus: (d.verification_status as MerchantVerificationStatus) ?? 'pending',
    rejectionReason: d.rejection_reason || undefined,
    commissionBps: d.commission_bps ?? 0,
    // Lo que se cobra hoy lo decide el servidor (promocion incluida). Si no lo
    // manda, la unica verdad disponible es la comision fijada.
    comisionEfectivaBps: typeof d.comision_efectiva_bps === 'number' ? d.comision_efectiva_bps : d.commission_bps ?? 0,
    promoHasta: d.promo_hasta || null,
    plan: normalizarPlanComercio(d.plan),
    // Endpoints that return a single merchant (register/update/admin) are all
    // owner or admin flows, so owner is the right default when absent.
    role: (d.role as MerchantRole) || 'owner',
    // Un servidor anterior no manda el cierre: el comercio se lee abierto.
    closedAt: d.closed_at || null,
    closedBy: d.closed_by || undefined,
    closureReason: d.closure_reason || undefined,
    ownerName: d.owner_name || undefined,
  };
}

interface StaffDTO {
  id: string;
  merchant_id: string;
  user_id: string;
  first_name: string;
  last_name: string;
  role: string;
  status: string;
  location_id?: string;
  created_at: string;
}

function mapStaff(d: StaffDTO): StaffMember {
  return {
    id: d.id,
    merchantId: d.merchant_id,
    userId: d.user_id,
    firstName: d.first_name,
    lastName: d.last_name,
    role: d.role === 'manager' ? 'manager' : 'cashier',
    status: d.status === 'revoked' ? 'revoked' : 'active',
    locationId: d.location_id || undefined,
    createdAt: d.created_at,
  };
}

interface LocationDTO {
  id: string;
  merchant_id: string;
  name: string;
  address: string;
  active: boolean;
}

function mapLocation(d: LocationDTO): MerchantLocation {
  return { id: d.id, merchantId: d.merchant_id, name: d.name, address: d.address, active: d.active };
}

interface CatalogItemDTO {
  id: string;
  merchant_id: string;
  name: string;
  price_minor: number;
  currency: string;
  active: boolean;
  sort_order: number;
}

function mapCatalogItem(d: CatalogItemDTO): CatalogItem {
  return {
    id: d.id,
    merchantId: d.merchant_id,
    name: d.name,
    price: d.price_minor / 100, // minor -> major
    currency: d.currency,
    active: d.active,
    sortOrder: d.sort_order,
  };
}

interface PaymentDTO {
  id: string;
  qr_code_id: string;
  payer_id: string;
  receiver_id: string;
  merchant_id: string;
  location_id?: string;
  collected_by?: string;
  amount: number;
  fee?: number;
  currency: string;
  status: string;
  note: string;
  tx_id?: string;
  created_at: string;
  payer_name?: string;
  location_name?: string;
  collector_name?: string;
}

function mapPayment(d: PaymentDTO): QRPayment {
  return {
    id: d.id,
    qrCodeId: d.qr_code_id,
    payerId: d.payer_id,
    receiverId: d.receiver_id,
    merchantId: d.merchant_id || undefined,
    locationId: d.location_id || undefined,
    collectedBy: d.collected_by || undefined,
    amount: d.amount / 100,
    fee: (d.fee ?? 0) / 100,
    currency: d.currency,
    status: d.status as QRPayment['status'],
    note: d.note || undefined,
    txId: d.tx_id || undefined,
    createdAt: d.created_at,
    // Un nombre que el servidor no dio queda sin definir: la pantalla lo dice
    // ("No disponible"), no pinta uno vacio ni inventado.
    payerName: d.payer_name || undefined,
    locationName: d.location_name || undefined,
    collectorName: d.collector_name || undefined,
  };
}

interface TotalesDTO { gross: number; fee: number; net: number; count: number }
interface VariacionDTO extends TotalesDTO {
  gross_pct: number | null; net_pct: number | null; count_pct: number | null;
}
interface VentasPorMonedaDTO extends TotalesDTO {
  currency: string; previous?: TotalesDTO; delta?: VariacionDTO;
}
interface ResumenDelPeriodoDTO {
  period: string; from: string; to: string; previous_from?: string; previous_to?: string;
  currencies: VentasPorMonedaDTO[] | null;
}

// Del servidor llegan centimos; la aplicacion trabaja en unidades.
const enUnidades = (t: TotalesDTO): TotalesDeVentas => ({
  gross: t.gross / 100, fee: t.fee / 100, net: t.net / 100, count: t.count,
});
const porcentaje = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function mapVentasPorMoneda(d: VentasPorMonedaDTO): VentasPorMoneda {
  const out: VentasPorMoneda = { currency: d.currency, ...enUnidades(d) };
  if (d.previous) out.previous = enUnidades(d.previous);
  if (d.delta) {
    out.delta = {
      ...enUnidades(d.delta),
      grossPct: porcentaje(d.delta.gross_pct),
      netPct: porcentaje(d.delta.net_pct),
      countPct: porcentaje(d.delta.count_pct),
    };
  }
  return out;
}

function mapResumenDelPeriodo(d: ResumenDelPeriodoDTO): ResumenDelPeriodo {
  return {
    period: d.period as PeriodoDeVentas,
    from: d.from,
    to: d.to,
    previousFrom: d.previous_from || undefined,
    previousTo: d.previous_to || undefined,
    // Una lista vacia es un dato (el periodo no tuvo ventas); un null del
    // servidor se lee igual.
    currencies: (d.currencies ?? []).map(mapVentasPorMoneda),
  };
}

interface QRCodeDTO {
  id: string;
  type: string;
  amount: number;
  currency: string;
  note: string;
  qr_data: string;
  single_use: boolean;
  used: boolean;
  expires_at: string;
  merchant_id?: string;
  location_id?: string;
  status?: string;
}

interface ChargeDTO {
  id: string;
  qr_code_id: string;
  merchant_id?: string;
  location_id?: string;
  created_by: string;
  amount: number;
  currency: string;
  note?: string;
  channel: string;
  status: string;
  qr_data: string;
  expires_at: string;
  paid_by?: string;
  paid_at?: string;
  superseded_by?: string;
  created_at: string;
}

function mapCharge(d: ChargeDTO): QRCharge {
  return {
    id: d.id,
    qrCodeId: d.qr_code_id,
    merchantId: d.merchant_id || undefined,
    locationId: d.location_id || undefined,
    createdBy: d.created_by,
    amount: (d.amount || 0) / 100,
    currency: d.currency,
    note: d.note || undefined,
    channel: (d.channel as QRCharge['channel']) || 'counter',
    status: d.status as QRCharge['status'],
    qrData: d.qr_data,
    expiresAt: d.expires_at,
    paidBy: d.paid_by || undefined,
    paidAt: d.paid_at || undefined,
    supersededBy: d.superseded_by || undefined,
    createdAt: d.created_at,
  };
}

function mapCode(d: QRCodeDTO): QRPaymentCode {
  return {
    id: d.id,
    type: d.type as QRPaymentCode['type'],
    amount: d.amount / 100,
    currency: d.currency,
    note: d.note || undefined,
    qrData: d.qr_data,
    singleUse: d.single_use,
    used: d.used,
    expiresAt: d.expires_at || undefined,
    merchantId: d.merchant_id || undefined,
    locationId: d.location_id || undefined,
    status: (d.status as QRPaymentCode['status']) || undefined,
  };
}

export class HttpQRPaymentRepository implements IQRPaymentRepository {
  constructor(private client: HttpClient) {}

  async updateMerchant(merchantId: string, request: RegisterMerchantRequest): Promise<ApiResponse<QRMerchant>> {
    const res = await this.client.patch<MerchantDTO>(`/api/v1/qr/merchants/${merchantId}`, {
      name: request.name,
      description: request.description,
      category: request.category,
      cedula: request.cedula,
      cedula_type: request.cedulaType,
      legal_name: request.legalName,
    });

    if (!res.success || !res.data) return falla(res, 'UPDATE_FAILED');
    return apiSuccess(mapMerchant(res.data));
  }

  async getMerchantBalance(merchantId: string, currency = 'CRC'): Promise<ApiResponse<number>> {
    const res = await this.client.get<{ balance: number; currency: string }>(
      `/api/v1/qr/merchants/${merchantId}/balance?currency=${currency}`,
    );
    if (!res.success || !res.data) return falla(res, 'FETCH_FAILED');
    return apiSuccess(res.data.balance / 100); // minor units -> major
  }

  async withdrawMerchant(
    merchantId: string,
    amount: number,
    currency: string,
    idempotencyKey: string,
  ): Promise<ApiResponse<{ repetida: boolean }>> {
    const res = await this.client.post<{ replayed?: boolean }>(`/api/v1/qr/merchants/${merchantId}/withdraw`, {
      amount: Math.round(amount * 100), // major -> minor units
      currency,
      idempotency_key: idempotencyKey,
    });
    // El codigo pasa tal cual: la pantalla necesita distinguir la red que se
    // corto (NETWORK_ERROR: el retiro pudo haber salido y el reintento lleva
    // la misma llave) de la llave que ya es de otro retiro (LLAVE_REUTILIZADA).
    if (!res.success) return falla(res, 'WITHDRAW_FAILED');
    // La repeticion de un retiro que ya estaba hecho bajo la llave: la pantalla
    // no se la da al dueño por un retiro nuevo.
    return apiSuccess({ repetida: res.data?.replayed === true });
  }

  async registerMerchant(request: RegisterMerchantRequest): Promise<ApiResponse<QRMerchant>> {
    const res = await this.client.post<MerchantDTO>('/api/v1/qr/merchant', {
      name: request.name,
      description: request.description,
      category: request.category,
      cedula: request.cedula,
      cedula_type: request.cedulaType,
      legal_name: request.legalName,
    });

    if (!res.success || !res.data) return falla(res, 'REGISTER_FAILED');
    return apiSuccess(mapMerchant(res.data));
  }

  async getMerchants(): Promise<ApiResponse<QRMerchant[]>> {
    const res = await this.client.get<MerchantDTO[]>('/api/v1/qr/merchants');
    if (!res.success || !res.data) return falla(res, 'FETCH_FAILED');
    return apiSuccess(res.data.map(mapMerchant));
  }

  async createQRCode(request: CreateQRCodeRequest): Promise<ApiResponse<QRPaymentCode>> {
    const res = await this.client.post<QRCodeDTO>('/api/v1/qr/codes', {
      type: request.type,
      amount: request.amount ? request.amount * 100 : 0,
      currency: request.currency,
      note: request.note,
      single_use: request.singleUse,
      merchant_id: request.merchantId,
      location_id: request.locationId,
    });

    if (!res.success || !res.data) return falla(res, 'CREATE_FAILED');
    return apiSuccess(mapCode(res.data));
  }

  async getQRCodes(): Promise<ApiResponse<QRPaymentCode[]>> {
    const res = await this.client.get<QRCodeDTO[]>('/api/v1/qr/codes');
    if (!res.success || !res.data) return falla(res, 'FETCH_FAILED');
    return apiSuccess(res.data.map(mapCode));
  }

  async scanAndPay(request: ScanQRPayRequest): Promise<ApiResponse<QRPayment>> {
    const res = await this.client.post<PaymentDTO>('/api/v1/qr/pay', {
      qr_data: request.qrData,
      amount: request.amount ? request.amount * 100 : 0,
      currency: request.currency,
      charge_id: request.chargeId,
      idempotency_key: request.idempotencyKey,
    });

    // El codigo del servidor se conserva. Reescribirlo a PAYMENT_FAILED borraba
    // COBRO_REEMPLAZADO, COBRO_YA_PAGADO, QR_REVOCADO y los demas: la pantalla
    // decia "no se pudo pagar" sin poder explicar por que.
    if (!res.success || !res.data) {
      return falla(res, 'PAYMENT_FAILED');
    }
    return apiSuccess(mapPayment(res.data));
  }

  // ── El QR reciclable ──────────────────────────────────────────────────────

  async getMyCode(currency = 'CRC'): Promise<ApiResponse<QRPaymentCode>> {
    const res = await this.client.get<QRCodeDTO>(`/api/v1/qr/codes/me?currency=${encodeURIComponent(currency)}`);
    if (!res.success || !res.data) {
      return falla(res, 'FETCH_FAILED');
    }
    return apiSuccess(mapCode(res.data));
  }

  async getMerchantCode(
    merchantId: string,
    opts: { locationId?: string; currency?: string } = {},
  ): Promise<ApiResponse<QRPaymentCode>> {
    const q = new URLSearchParams({ currency: opts.currency || 'CRC' });
    if (opts.locationId) q.set('location_id', opts.locationId);
    const res = await this.client.get<QRCodeDTO>(`/api/v1/qr/merchants/${merchantId}/code?${q.toString()}`);
    if (!res.success || !res.data) {
      return falla(res, 'FETCH_FAILED');
    }
    return apiSuccess(mapCode(res.data));
  }

  async revokeCode(codeId: string): Promise<ApiResponse<void>> {
    const res = await this.client.post<void>(`/api/v1/qr/codes/${codeId}/revoke`, {});
    if (!res.success) return falla(res, 'REVOKE_FAILED');
    return apiSuccess(undefined as void);
  }

  async resolveQr(qrData: string): Promise<ApiResponse<ResolvedQR>> {
    interface ResolveDTO {
      kind: string; payee_name?: string; merchant_name?: string; location_name?: string;
      currency: string; amount: number; note?: string; status?: string;
      expires_at?: string; charge_id?: string; qr_code_id: string;
    }
    const res = await this.client.post<ResolveDTO>('/api/v1/qr/resolve', { qr_data: qrData });
    if (!res.success || !res.data) {
      return falla(res, 'RESOLVE_FAILED');
    }
    const d = res.data;
    return apiSuccess({
      kind: d.kind as ResolvedQR['kind'],
      payeeName: d.payee_name || undefined,
      merchantName: d.merchant_name || undefined,
      locationName: d.location_name || undefined,
      currency: d.currency,
      amount: (d.amount || 0) / 100,
      note: d.note || undefined,
      status: d.status || undefined,
      expiresAt: d.expires_at || undefined,
      chargeId: d.charge_id || undefined,
      qrCodeId: d.qr_code_id,
    });
  }

  async createCharge(request: CreateChargeRequest): Promise<ApiResponse<QRCharge>> {
    const res = await this.client.post<ChargeDTO>('/api/v1/qr/charges', {
      qr_code_id: request.qrCodeId,
      amount: Math.round(request.amount * 100),
      note: request.note,
      channel: request.channel,
      replaces: request.replaces,
    });
    if (!res.success || !res.data) {
      return falla(res, 'CHARGE_FAILED');
    }
    return apiSuccess(mapCharge(res.data));
  }

  async getCharge(chargeId: string): Promise<ApiResponse<QRCharge>> {
    const res = await this.client.get<ChargeDTO>(`/api/v1/qr/charges/${chargeId}`);
    if (!res.success || !res.data) {
      return falla(res, 'FETCH_FAILED');
    }
    return apiSuccess(mapCharge(res.data));
  }

  async cancelCharge(chargeId: string): Promise<ApiResponse<void>> {
    const res = await this.client.del<void>(`/api/v1/qr/charges/${chargeId}`);
    if (!res.success) return falla(res, 'CANCEL_FAILED');
    return apiSuccess(undefined as void);
  }

  async listCharges(status?: QRChargeStatus): Promise<ApiResponse<QRCharge[]>> {
    const q = status ? `?status=${encodeURIComponent(status)}` : '';
    const res = await this.client.get<ChargeDTO[]>(`/api/v1/qr/charges${q}`);
    if (!res.success || !res.data) {
      return falla(res, 'FETCH_FAILED');
    }
    return apiSuccess(res.data.map(mapCharge));
  }

  async getPaymentHistory(): Promise<ApiResponse<QRPayment[]>> {
    const res = await this.client.get<PaymentDTO[]>('/api/v1/qr/history');
    if (!res.success || !res.data) return falla(res, 'FETCH_FAILED');
    return apiSuccess(res.data.map(mapPayment));
  }

  async getMerchantPayments(
    merchantId: string,
    opciones?: { antesDe?: string; periodo?: PeriodoDeVentas },
  ): Promise<ApiResponse<QRPayment[]>> {
    const q: string[] = [];
    // El periodo viaja con la zona horaria de la persona: lo cuenta el servidor.
    if (opciones?.periodo) q.push(`period=${opciones.periodo}`, `tz=${new Date().getTimezoneOffset()}`);
    if (opciones?.antesDe) q.push(`before=${encodeURIComponent(opciones.antesDe)}`);
    const consulta = q.length ? `?${q.join('&')}` : '';
    const res = await this.client.get<PaymentDTO[]>(`/api/v1/qr/merchants/${merchantId}/payments${consulta}`);
    if (!res.success || !res.data) return falla(res, 'FETCH_FAILED');
    return apiSuccess(res.data.map(mapPayment));
  }

  async getMerchantSummary(merchantId: string): Promise<ApiResponse<ResumenDelComercio>> {
    const tz = new Date().getTimezoneOffset();
    const res = await this.client.get<{ plan?: string; periods: ResumenDelPeriodoDTO[] | null }>(
      `/api/v1/qr/merchants/${merchantId}/summary?tz=${tz}`,
    );
    if (!res.success || !res.data) return falla(res, 'FETCH_FAILED');
    return apiSuccess({
      plan: normalizarPlanComercio(res.data.plan),
      periods: (res.data.periods ?? []).map(mapResumenDelPeriodo),
    });
  }

  async getMerchantDailyTotals(merchantId: string, periodo: PeriodoDeVentas): Promise<ApiResponse<TotalDelDia[]>> {
    const tz = new Date().getTimezoneOffset();
    const res = await this.client.get<Array<TotalesDTO & { date: string; currency: string }> | null>(
      `/api/v1/qr/merchants/${merchantId}/payments/daily?period=${periodo}&tz=${tz}`,
    );
    if (!res.success || !res.data) return falla(res, 'FETCH_FAILED');
    return apiSuccess(res.data.map((d) => ({ date: d.date, currency: d.currency, ...enUnidades(d) })));
  }

  async getMerchantWithdrawals(merchantId: string, periodo: PeriodoDeVentas): Promise<ApiResponse<RetiroDelComercio[]>> {
    const tz = new Date().getTimezoneOffset();
    const res = await this.client.get<Array<{
      id: string; amount: number; currency: string; status: string; withdrawn_by_name?: string; created_at: string;
    }> | null>(`/api/v1/qr/merchants/${merchantId}/withdrawals?period=${periodo}&tz=${tz}`);
    if (!res.success || !res.data) return falla(res, 'FETCH_FAILED');
    return apiSuccess(res.data.map((d) => ({
      id: d.id,
      amount: d.amount / 100,
      currency: d.currency,
      status: d.status,
      withdrawnByName: d.withdrawn_by_name || undefined,
      createdAt: d.created_at,
    })));
  }

  async getMerchantReport(merchantId: string, days: number): Promise<ApiResponse<BusinessReport>> {
    // The tz offset makes the server bucket days by the USER's calendar.
    const tz = new Date().getTimezoneOffset();
    interface BucketDTO { key?: string; label?: string; gross: number; fee: number; net: number; count: number }
    interface DayDTO { date: string; gross: number; fee: number; net: number; count: number }
    interface DeltaDTO { gross: number; fee: number; net: number; count: number; gross_pct: number | null; net_pct: number | null; count_pct: number | null }
    interface ComparisonDTO { previous_from: string; previous_to: string; previous_totals: BucketDTO; delta: DeltaDTO }
    interface ReportDTO {
      days: number; from?: string; to?: string; totals: BucketDTO; daily: DayDTO[] | null;
      by_location: BucketDTO[] | null; by_collector: BucketDTO[] | null; plan?: string; comparison?: ComparisonDTO | null;
    }
    const res = await this.client.get<ReportDTO>(`/api/v1/qr/merchants/${merchantId}/report?days=${days}&tz=${tz}`);
    if (!res.success || !res.data) return falla(res, 'FETCH_FAILED');
    const bucket = (b: BucketDTO): BusinessReportBucket => ({
      key: b.key || undefined,
      label: b.label || undefined,
      gross: b.gross / 100,
      fee: b.fee / 100,
      net: b.net / 100,
      count: b.count,
    });
    const day = (d: DayDTO): BusinessReportDay => ({
      date: d.date, gross: d.gross / 100, fee: d.fee / 100, net: d.net / 100, count: d.count,
    });
    const pct = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    const c = res.data.comparison;
    const comparison: BusinessReportComparison | undefined = c && c.previous_totals && c.delta
      ? {
          previousFrom: c.previous_from,
          previousTo: c.previous_to,
          previousTotals: bucket(c.previous_totals),
          delta: {
            gross: c.delta.gross / 100,
            fee: c.delta.fee / 100,
            net: c.delta.net / 100,
            count: c.delta.count,
            grossPct: pct(c.delta.gross_pct),
            netPct: pct(c.delta.net_pct),
            countPct: pct(c.delta.count_pct),
          },
        }
      : undefined;
    return apiSuccess({
      days: res.data.days,
      from: res.data.from,
      to: res.data.to,
      totals: bucket(res.data.totals),
      daily: (res.data.daily ?? []).map(day),
      byLocation: (res.data.by_location ?? []).map(bucket),
      byCollector: (res.data.by_collector ?? []).map(bucket),
      plan: normalizarPlanComercio(res.data.plan),
      comparison,
    });
  }

  async exportMerchantReportCsv(
    merchantId: string,
    days: number,
    idioma?: string,
    periodo?: PeriodoDeVentas,
  ): Promise<ApiResponse<ArchivoDescargado>> {
    const tz = new Date().getTimezoneOffset();
    const lang = idioma ? `&lang=${encodeURIComponent(idioma)}` : '';
    // Con periodo, el servidor exporta ese periodo y `days` no cuenta.
    const ventana = periodo ? `period=${periodo}` : `days=${days}`;
    // Se pide como archivo: un 200 es el CSV tal cual; un 403 PLAN_REQUIRED o
    // un 404 llegan como el sobre de error de siempre, con su codigo.
    const res = await this.client.getArchivo(
      `/api/v1/qr/merchants/${encodeURIComponent(merchantId)}/report.csv?${ventana}&tz=${tz}${lang}`,
    );
    if (!res.success || !res.data) {
      return falla(res, 'EXPORT_FAILED');
    }
    return apiSuccess({
      blob: res.data.blob,
      nombre: res.data.nombre || (periodo ? `reporte-${periodo}.csv` : `reporte-${days}-dias.csv`),
    });
  }

  // ── Team ───────────────────────────────────────────────────────────────────

  async getStaff(merchantId: string): Promise<ApiResponse<StaffMember[]>> {
    const res = await this.client.get<StaffDTO[]>(`/api/v1/qr/merchants/${merchantId}/staff`);
    if (!res.success || !res.data) return falla(res, 'FETCH_FAILED');
    return apiSuccess(res.data.map(mapStaff));
  }

  async addStaff(merchantId: string, cedula: string, role: 'cashier' | 'manager', locationId?: string): Promise<ApiResponse<StaffMember>> {
    const res = await this.client.post<StaffDTO>(`/api/v1/qr/merchants/${merchantId}/staff`, {
      cedula, role, location_id: locationId,
    });
    // El codigo del servidor pasa: la hoja del equipo traduce
    // STAFF_CEDULA_NOT_FOUND por codigo, y pisado con el de aqui decia
    // "No se pudo completar la accion" a una cedula sin cuenta.
    if (!res.success || !res.data) return falla(res, 'ADD_STAFF_FAILED');
    return apiSuccess(mapStaff(res.data));
  }

  async updateStaff(merchantId: string, staffId: string, role: 'cashier' | 'manager', locationId?: string): Promise<ApiResponse<StaffMember>> {
    const res = await this.client.put<StaffDTO>(`/api/v1/qr/merchants/${merchantId}/staff/${staffId}`, {
      role, location_id: locationId,
    });
    if (!res.success || !res.data) return falla(res, 'UPDATE_STAFF_FAILED');
    return apiSuccess(mapStaff(res.data));
  }

  async revokeStaff(merchantId: string, staffId: string): Promise<ApiResponse<void>> {
    const res = await this.client.del(`/api/v1/qr/merchants/${merchantId}/staff/${staffId}`);
    if (!res.success) return falla(res, 'REVOKE_STAFF_FAILED');
    return apiSuccess(undefined as unknown as void);
  }

  // ── Locations ──────────────────────────────────────────────────────────────

  async getLocations(merchantId: string): Promise<ApiResponse<MerchantLocation[]>> {
    const res = await this.client.get<LocationDTO[]>(`/api/v1/qr/merchants/${merchantId}/locations`);
    if (!res.success || !res.data) return falla(res, 'FETCH_FAILED');
    return apiSuccess(res.data.map(mapLocation));
  }

  async createLocation(merchantId: string, name: string, address: string): Promise<ApiResponse<MerchantLocation>> {
    const res = await this.client.post<LocationDTO>(`/api/v1/qr/merchants/${merchantId}/locations`, { name, address });
    if (!res.success || !res.data) return falla(res, 'CREATE_LOCATION_FAILED');
    return apiSuccess(mapLocation(res.data));
  }

  async updateLocation(
    merchantId: string,
    locationId: string,
    patch: { name?: string; address?: string; active?: boolean },
  ): Promise<ApiResponse<MerchantLocation>> {
    const res = await this.client.put<LocationDTO>(`/api/v1/qr/merchants/${merchantId}/locations/${locationId}`, {
      name: patch.name ?? '',
      address: patch.address ?? '',
      active: patch.active,
    });
    if (!res.success || !res.data) return falla(res, 'UPDATE_LOCATION_FAILED');
    return apiSuccess(mapLocation(res.data));
  }

  // ── Catalog ────────────────────────────────────────────────────────────────

  async getCatalog(merchantId: string): Promise<ApiResponse<CatalogItem[]>> {
    const res = await this.client.get<CatalogItemDTO[]>(`/api/v1/qr/merchants/${merchantId}/catalog`);
    if (!res.success || !res.data) return falla(res, 'FETCH_FAILED');
    return apiSuccess(res.data.map(mapCatalogItem));
  }

  async createCatalogItem(
    merchantId: string,
    item: { name: string; price: number; currency?: string },
  ): Promise<ApiResponse<CatalogItem>> {
    const res = await this.client.post<CatalogItemDTO>(`/api/v1/qr/merchants/${merchantId}/catalog`, {
      name: item.name,
      price_minor: Math.round(item.price * 100), // major -> minor
      currency: item.currency,
    });
    if (!res.success || !res.data) return falla(res, 'CREATE_ITEM_FAILED');
    return apiSuccess(mapCatalogItem(res.data));
  }

  async updateCatalogItem(
    merchantId: string,
    itemId: string,
    patch: { name?: string; price?: number; active?: boolean; sortOrder?: number },
  ): Promise<ApiResponse<CatalogItem>> {
    const res = await this.client.put<CatalogItemDTO>(`/api/v1/qr/merchants/${merchantId}/catalog/${itemId}`, {
      name: patch.name ?? '',
      price_minor: patch.price !== undefined ? Math.round(patch.price * 100) : 0,
      active: patch.active,
      sort_order: patch.sortOrder,
    });
    if (!res.success || !res.data) return falla(res, 'UPDATE_ITEM_FAILED');
    return apiSuccess(mapCatalogItem(res.data));
  }

  async deleteCatalogItem(merchantId: string, itemId: string): Promise<ApiResponse<void>> {
    const res = await this.client.del(`/api/v1/qr/merchants/${merchantId}/catalog/${itemId}`);
    if (!res.success) return falla(res, 'DELETE_ITEM_FAILED');
    return apiSuccess(undefined as unknown as void);
  }

  // ── Admin ──────────────────────────────────────────────────────────────────

  async listPendingMerchants(): Promise<ApiResponse<QRMerchant[]>> {
    const res = await this.client.get<MerchantDTO[]>('/api/v1/admin/merchants/pending');
    if (!res.success || !res.data) return falla(res, 'FETCH_FAILED');
    return apiSuccess(res.data.map(mapMerchant));
  }

  async approveMerchant(merchantId: string): Promise<ApiResponse<QRMerchant>> {
    const res = await this.client.post<MerchantDTO>(`/api/v1/admin/merchants/${merchantId}/approve`, {});
    if (!res.success || !res.data) return falla(res, 'APPROVE_FAILED');
    return apiSuccess(mapMerchant(res.data));
  }

  async rejectMerchant(merchantId: string, reason: string): Promise<ApiResponse<QRMerchant>> {
    const res = await this.client.post<MerchantDTO>(`/api/v1/admin/merchants/${merchantId}/reject`, { reason });
    if (!res.success || !res.data) return falla(res, 'REJECT_FAILED');
    return apiSuccess(mapMerchant(res.data));
  }

  async setMerchantCommission(merchantId: string, commissionBps: number): Promise<ApiResponse<QRMerchant>> {
    const res = await this.client.patch<MerchantDTO>(`/api/v1/admin/merchants/${merchantId}/commission`, { commission_bps: commissionBps });
    if (!res.success || !res.data) return falla(res, 'SET_COMMISSION_FAILED');
    return apiSuccess(mapMerchant(res.data));
  }

  async setMerchantPlan(merchantId: string, plan: PlanComercio): Promise<ApiResponse<QRMerchant>> {
    // El cuerpo es exactamente {plan}; el codigo del servidor se conserva para
    // que la vista distinga INVALID_ID y MERCHANT_NOT_FOUND de una caida.
    const res = await this.client.patch<MerchantDTO>(
      `/api/v1/admin/merchants/${encodeURIComponent(merchantId)}/plan`,
      { plan },
    );
    if (!res.success || !res.data || Array.isArray(res.data)) {
      return falla(res, 'PLAN_UPDATE_FAILED');
    }
    return apiSuccess(mapMerchant(res.data));
  }

  async listAllMerchants(busqueda?: string): Promise<ApiResponse<QRMerchant[]>> {
    const q = busqueda?.trim();
    const ruta = q ? `/api/v1/admin/merchants?q=${encodeURIComponent(q)}` : '/api/v1/admin/merchants';
    const res = await this.client.get<MerchantDTO[]>(ruta);
    if (!res.success || !Array.isArray(res.data)) return falla(res, 'FETCH_FAILED');
    return apiSuccess(res.data.map(mapMerchant));
  }

  async listClosedMerchants(): Promise<ApiResponse<QRMerchant[]>> {
    const res = await this.client.get<MerchantDTO[]>('/api/v1/qr/merchants?status=closed');
    if (!res.success || !Array.isArray(res.data)) return falla(res, 'FETCH_FAILED');
    return apiSuccess(res.data.map(mapMerchant));
  }

  async closeMerchantAsAdmin(merchantId: string, reason: string): Promise<ApiResponse<QRMerchant>> {
    const res = await this.client.post<MerchantDTO>(
      `/api/v1/admin/merchants/${encodeURIComponent(merchantId)}/close`,
      { reason },
    );
    if (!res.success || !res.data) return falla(res, 'CLOSE_FAILED');
    return apiSuccess(mapMerchant(res.data));
  }

  async closeMerchant(
    merchantId: string,
    confirmacion: { password: string; totpCode?: string },
  ): Promise<ApiResponse<QRMerchant>> {
    // El codigo solo viaja si la persona lo escribio: sin el, el servidor
    // responde TOTP_REQUIRED y la pantalla lo pide.
    const cuerpo: { password: string; totp_code?: string } = { password: confirmacion.password };
    if (confirmacion.totpCode) cuerpo.totp_code = confirmacion.totpCode;
    const res = await this.client.post<MerchantDTO>(
      `/api/v1/qr/merchants/${encodeURIComponent(merchantId)}/close`,
      cuerpo,
    );
    if (!res.success || !res.data) return falla(res, 'CLOSE_FAILED');
    return apiSuccess(mapMerchant(res.data));
  }
}
