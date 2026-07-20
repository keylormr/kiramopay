import type {
  IQRPaymentRepository,
  QRMerchant,
  QRPaymentCode,
  QRPayment,
  StaffMember,
  MerchantLocation,
  CatalogItem,
  RegisterMerchantRequest,
  CreateQRCodeRequest,
  ScanQRPayRequest,
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

  async createQRCode(request: CreateQRCodeRequest): Promise<ApiResponse<QRPaymentCode>> {
    const id = `qr-${Date.now()}`;
    const code: QRPaymentCode = {
      id,
      type: request.type as QRPaymentCode['type'],
      amount: request.amount ?? 0,
      currency: request.currency,
      note: request.note,
      qrData: JSON.stringify({
        id,
        type: request.type,
        amount: request.amount,
        currency: request.currency,
        merchantId: request.merchantId,
        locationId: request.locationId,
      }),
      singleUse: request.singleUse,
      used: false,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      merchantId: request.merchantId,
      locationId: request.locationId,
    };
    const state = getState();
    const codes: QRPaymentCode[] = state?.qrCodes ?? [];
    codes.unshift(code);
    saveField('qrCodes', codes);
    return apiSuccess(code);
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
