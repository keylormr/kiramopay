// Shared encode/parse for the "share contact via QR" feature. A contact QR is a
// small JSON payload with its own discriminator so the scanner can recognize it
// and add a contact instead of routing it to the payment rail.
//
// The payment QR convention (see qrpayment.mock) is also a JSON string keyed by
// `type` (merchant_fixed / p2p_request / ...); this uses a distinct type value
// so the two never collide.

export interface ContactQrPayload {
  name: string;
  phone: string;
  bank?: string;
}

const CONTACT_QR_TYPE = 'kiramo_contact';

export function encodeContactQr(c: ContactQrPayload): string {
  return JSON.stringify({
    v: 1,
    type: CONTACT_QR_TYPE,
    name: c.name,
    phone: c.phone,
    ...(c.bank ? { bank: c.bank } : {}),
  });
}

/**
 * Returns a contact payload if `raw` is a KiramoPay contact QR, else null.
 * Anything else (payment QRs, arbitrary text, non-JSON) yields null so callers
 * fall through to their normal handling.
 */
export function tryParseContactQr(raw: string): ContactQrPayload | null {
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    if (
      o &&
      o.type === CONTACT_QR_TYPE &&
      typeof o.name === 'string' &&
      typeof o.phone === 'string' &&
      o.name.trim() &&
      o.phone.trim()
    ) {
      return {
        name: o.name.trim().slice(0, 80),
        phone: o.phone.trim().slice(0, 32),
        bank: typeof o.bank === 'string' && o.bank.trim() ? o.bank.trim().slice(0, 40) : undefined,
      };
    }
  } catch {
    // not JSON / not a contact QR
  }
  return null;
}
