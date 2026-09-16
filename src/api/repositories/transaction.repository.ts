import type { ApiResponse } from '../types';
import type { Transaction } from '@/types';

export interface TransactionListParams {
  limit?: number;
  offset?: number;
  /** ISO timestamp; inclusive lower bound on the transaction date. */
  from?: string;
  /** ISO timestamp; exclusive upper bound on the transaction date. */
  to?: string;
  /**
   * Texto libre. Lo resuelve el SERVIDOR contra todo el historial.
   *
   * El buscador de la pantalla de movimientos filtraba el arreglo que el
   * cliente ya tenia en memoria —las ultimas 50 filas—, asi que un movimiento
   * del mes pasado no aparecia y el usuario concluia que no existia.
   */
  search?: string;
}

/** One page of transactions plus the total match count, so callers can page
 * through a window and know when they have everything. */
export interface TransactionPage {
  transactions: Transaction[];
  total: number;
}

/** Rango de dias civiles de Costa Rica: from incluido, to EXCLUIDO. */
export interface TransactionSummaryParams {
  /** 'YYYY-MM-DD' */
  from: string;
  /** 'YYYY-MM-DD', excluido. */
  to: string;
}

/**
 * La suma de los movimientos completados de un dia, en una moneda, de una
 * categoria y una direccion. La direccion y la categoria las decide el
 * adaptador, el mismo que clasifica la lista de movimientos: asi las dos
 * pantallas nunca cuentan el mismo dinero de dos maneras.
 */
export interface SummaryGroup {
  /** Dia civil de Costa Rica, 'YYYY-MM-DD'. */
  date: string;
  ccy: string;
  category: string;
  direction: 'in' | 'out';
  count: number;
  /**
   * Magnitud positiva en CENTIMOS, como la entrega el servidor. Los grupos se
   * suman en enteros y se pasan a colones o dolares solo al mostrarlos: sumar
   * decimales binarios acumula error.
   */
  amountMinor: number;
}

export interface TransactionSummary {
  from: string;
  to: string;
  groups: SummaryGroup[];
  /** Los movimientos mas grandes de cada tipo, con signo como en la lista. */
  top: Transaction[];
  /**
   * Dia civil de Costa Rica del primer movimiento completado de la persona, en
   * todo su historial; null si no tiene ninguno. Un periodo anterior que empieza
   * antes de ese dia esta incompleto y no se compara.
   */
  firstDate: string | null;
}

export interface ITransactionRepository {
  getTransactions(limit?: number): Promise<ApiResponse<Transaction[]>>;
  listTransactions(params: TransactionListParams): Promise<ApiResponse<TransactionPage>>;
  /**
   * Resumen COMPLETO de un rango, calculado por el servidor. La pantalla de
   * analisis lo usa en vez de paginar la lista: con "este año" el techo de
   * paginas se alcanzaba y los totales describian solo una parte del periodo.
   */
  getSummary(params: TransactionSummaryParams): Promise<ApiResponse<TransactionSummary>>;
}
