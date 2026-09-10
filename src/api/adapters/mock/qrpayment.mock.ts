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
} from '../../repositories/qrpayment.repository';
import type { ApiResponse } from '../../types';
import { apiSuccess, apiError } from '../../types';

const STORAGE_KEY = 'kiramopay_app_state';
const DEFAULT_COMMISSION_BPS = 50; // 0.50%

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
      role: 'owner',
    };
    const merchants = readMerchants();
    merchants.push(merchant);
    saveField('qrMerchants', merchants);
    return apiSuccess(merchant);
  }

  async getMerchants(): Promise<ApiResponse<QRMerchant[]>> {
    return apiSuccess(readMerchants());
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

  async withdrawMerchant(merchantId: string, amount: number): Promise<ApiResponse<void>> {
    const state = getState();
    const withdrawn: Record<string, number> = state?.merchantWithdrawn ?? {};
    withdrawn[merchantId] = (withdrawn[merchantId] ?? 0) + amount;
    saveField('merchantWithdrawn', withdrawn);
    return apiSuccess(undefined as unknown as void);
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
      return apiError('INVALID_QR', 'Codigo QR invalido');
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

  async getMerchantPayments(merchantId: string): Promise<ApiResponse<QRPayment[]>> {
    const payments = readList<QRPayment>('qrPayments');
    return apiSuccess(payments.filter((p) => p.merchantId === merchantId));
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
    return apiSuccess(readMerchants().filter((m) => m.verificationStatus === 'pending'));
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
