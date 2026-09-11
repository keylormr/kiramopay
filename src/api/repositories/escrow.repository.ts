import type { ApiResponse } from '../types';

/** Workflow state of an escrow agreement (mirrors backend internal/escrow). */
export type EscrowStatus =
  | 'pending'
  | 'funded'
  | 'released'
  | 'refunded'
  | 'disputed'
  | 'cancelled';

export interface EscrowAgreement {
  id: string;
  buyerId: string;
  sellerId: string;
  amountMinor: number;
  currency: string;
  status: EscrowStatus;
  description: string;
  disputeReason?: string;
  createdAt: string;
  updatedAt: string;
  /** Cuando el vendedor marco la entrega. */
  deliveredAt?: string;
  /** Plazo del vendedor para marcar la entrega; si vence, se le devuelve al comprador. */
  deliverBy?: string;
  /** Plazo del comprador para liberar o reclamar; si vence, se le paga al vendedor. */
  reviewBy?: string;
  /** Si lo cerro un vencimiento: 'entrega' o 'revision'. */
  closedByExpiry?: 'entrega' | 'revision';
  /** Cuando se abrio la disputa. */
  disputedAt?: string;
}

/** Una pagina de la cola del arbitro, con el tamano de la cola entera. */
export interface EscrowAdminPage {
  agreements: EscrowAgreement[];
  total: number;
  /** El filtro que aplico el servidor: sin pedir uno, 'disputed'. */
  status: EscrowStatus | 'all';
}

export interface CreateEscrowRequest {
  /**
   * Telefono del vendedor. El servidor lo resuelve a una cuenta real y
   * rechaza el acuerdo si no hay ninguna.
   *
   * La pantalla pedia el UUID del vendedor, y ninguna pantalla de la
   * aplicacion muestra el UUID de nadie: no habia forma de crear un acuerdo
   * con una persona real.
   */
  sellerPhone?: string;
  /** Id interno del vendedor. Se mantiene para los clientes B2B. */
  sellerId?: string;
  amountMinor: number;
  currency?: string;
  description: string;
}

/**
 * Escrow repository — ledger-backed buyer-funded payment holds. Like auth/mfa
 * this ALWAYS talks to the real backend (it moves money); there is no mock
 * adapter.
 */
export interface IEscrowRepository {
  /** List the caller's agreements (as buyer or seller), newest first. */
  list(limit?: number): Promise<ApiResponse<EscrowAgreement[]>>;
  /** Get one agreement (parties only). */
  get(id: string): Promise<ApiResponse<EscrowAgreement>>;
  /** Create a pending agreement (caller = buyer; no money moves yet). */
  create(req: CreateEscrowRequest): Promise<ApiResponse<EscrowAgreement>>;
  /** Fund the agreement (buyer only; debits buyer → escrow). */
  fund(id: string): Promise<ApiResponse<EscrowAgreement>>;
  /** Release held funds to the seller (buyer only). */
  release(id: string): Promise<ApiResponse<EscrowAgreement>>;
  /** Return held funds to the buyer (seller only). */
  refund(id: string): Promise<ApiResponse<EscrowAgreement>>;
  /** Freeze a funded agreement pending admin resolution (either party). */
  dispute(id: string, reason: string): Promise<ApiResponse<EscrowAgreement>>;
  /** Cancel a pending (unfunded) agreement (either party). */
  cancel(id: string): Promise<ApiResponse<EscrowAgreement>>;
  /**
   * El vendedor marca que entrego. Arranca el plazo del comprador para liberar
   * o reclamar (reviewBy).
   */
  deliver(id: string): Promise<ApiResponse<EscrowAgreement>>;

  // ── Arbitro (rutas /admin, la reja es el rol en el servidor) ──
  /** La cola: sin estado, solo las disputas abiertas, la mas vieja primero. */
  adminList(status?: EscrowStatus | 'all', limit?: number, offset?: number): Promise<ApiResponse<EscrowAdminPage>>;
  /** Resuelve una disputa a favor de una de las partes. */
  adminResolve(id: string, outcome: 'released' | 'refunded'): Promise<ApiResponse<EscrowAgreement>>;
}
