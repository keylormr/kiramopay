// Consultas directas al Postgres del runner, para mirar el libro contable (que
// la API no expone). Usa `psql` con las variables PGHOST, PGPORT, PGUSER,
// PGPASSWORD y PGDATABASE del entorno. Solo LEE: el recorrido nunca escribe en
// la base.
import { execFileSync } from 'node:child_process';

/** Corre una consulta (sin `;` final) y devuelve las filas como objetos. */
export function consultar(sql) {
  const salida = execFileSync(
    'psql',
    ['-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', `SELECT COALESCE(json_agg(t), '[]'::json) FROM (${sql}) t`],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
  );
  return JSON.parse(salida.trim());
}

/** Saldo firmado de una cuenta del libro por su codigo (0 si no existe). */
export function saldoCuenta(codigo) {
  const filas = consultar(
    `SELECT balance_minor::bigint AS saldo FROM ledger_account_balances WHERE code = '${codigo.replace(/'/g, "''")}'`,
  );
  return filas.length ? Number(filas[0].saldo) : 0;
}

/** Saldo de la cuenta de billetera de una persona en el libro. */
export function saldoLibroDe(userId, moneda) {
  const filas = consultar(
    `SELECT balance_minor::bigint AS saldo FROM ledger_account_balances
      WHERE user_id = '${userId}' AND currency = '${moneda}' AND type = 'user_wallet'`,
  );
  return filas.length ? Number(filas[0].saldo) : 0;
}

/** Billeteras cuyo saldo guardado no coincide con el libro. Debe ser []. */
export function derivaDeBilleteras() {
  return consultar(
    `SELECT w.user_id, u.username, d.cache_crc::bigint, d.journal_crc::bigint, d.drift_crc::bigint,
            d.cache_usd::bigint, d.journal_usd::bigint, d.drift_usd::bigint
       FROM wallet_journal_drift d
       JOIN wallets w ON w.user_id = d.user_id
       JOIN users u ON u.id = d.user_id
      WHERE d.drift_crc <> 0 OR d.drift_usd <> 0`,
  );
}

/** Asientos cuyos debitos no igualan a los creditos por moneda. Debe ser []. */
export function asientosDescuadrados() {
  return consultar(
    `SELECT posting_id, currency,
            SUM(CASE WHEN direction = 'debit' THEN amount_minor ELSE -amount_minor END)::bigint AS diferencia
       FROM journal_entries
      GROUP BY posting_id, currency
     HAVING SUM(CASE WHEN direction = 'debit' THEN amount_minor ELSE -amount_minor END) <> 0`,
  );
}

/** Debitos y creditos totales por moneda. */
export function sumasPorMoneda() {
  return consultar(
    `SELECT currency,
            SUM(CASE WHEN direction = 'debit' THEN amount_minor ELSE 0 END)::bigint AS debitos,
            SUM(CASE WHEN direction = 'credit' THEN amount_minor ELSE 0 END)::bigint AS creditos
       FROM journal_entries GROUP BY currency ORDER BY currency`,
  );
}

/**
 * Lineas del libro de un asiento, buscado por su llave de idempotencia exacta
 * o por `tx_id` (con `{tx: '<uuid>'}`). Devuelve [{codigo, direccion, monto,
 * moneda, descripcion, llave}].
 */
export function asiento({ llave, tx, llavePrefijo } = {}) {
  const condicion = llave
    ? `p.idempotency_key = '${llave.replace(/'/g, "''")}'`
    : tx
      ? `p.tx_id = '${tx}'`
      : `p.idempotency_key LIKE '${llavePrefijo.replace(/'/g, "''")}%'`;
  return consultar(
    `SELECT a.code AS codigo, e.direction AS direccion, e.amount_minor::bigint AS monto, e.currency AS moneda,
            p.description AS descripcion, p.idempotency_key AS llave
       FROM journal_postings p
       JOIN journal_entries e ON e.posting_id = p.id
       JOIN ledger_accounts a ON a.id = e.account_id
      WHERE ${condicion}
      ORDER BY e.direction, a.code`,
  );
}

/** Busca la linea de un asiento por cuenta y direccion. */
export function lineaDe(lineas, codigo, direccion) {
  return lineas.find((l) => l.codigo === codigo && l.direccion === direccion);
}

/** Codigo de la cuenta de billetera de una persona. */
export const cuentaUsuario = (userId, moneda) => `USER:${userId}:${moneda}`;

/** Cuantos asientos hay en total (para saber si una operacion no escribio nada). */
export function totalAsientos() {
  return Number(consultar('SELECT COUNT(*)::bigint AS n FROM journal_postings')[0].n);
}
