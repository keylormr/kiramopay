package qrpayment

import (
	"context"
	"time"
)

// Consultas de la interfaz del comercio: los totales por moneda de una ventana,
// los totales de cada dia y los retiros del saldo del negocio.
//
// Todas cuentan solo ventas COMPLETADAS (como el reporte): una devuelta o una
// fallida se ve en el listado de movimientos, pero no es plata vendida.

// totalMoneda son las ventas completadas de una moneda en una ventana, en
// centimos.
type totalMoneda struct {
	Currency string
	Gross    int64
	Fee      int64
	Count    int
}

// TotalesPorMoneda suma las ventas completadas del comercio en [desde, hasta),
// una fila por moneda. Colones y dolares nunca se suman entre si.
func (r *Repository) TotalesPorMoneda(ctx context.Context, merchantID string, desde, hasta time.Time) ([]totalMoneda, error) {
	rows, err := r.db.Query(ctx,
		`SELECT p.currency, COALESCE(SUM(p.amount), 0), COALESCE(SUM(p.fee), 0), COUNT(*)
		   FROM qr_payments p
		  WHERE p.merchant_id = $1::uuid AND p.status = 'completed'
		    AND p.created_at >= $2 AND p.created_at < $3
		  GROUP BY p.currency
		  ORDER BY p.currency`,
		merchantID, desde, hasta)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []totalMoneda
	for rows.Next() {
		var t totalMoneda
		if err := rows.Scan(&t.Currency, &t.Gross, &t.Fee, &t.Count); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// TotalesPorDiaYMoneda agrupa las ventas completadas de [desde, hasta) por dia
// del cliente (tzOffsetMin: minutos al oeste de UTC) y por moneda, el dia mas
// reciente primero.
func (r *Repository) TotalesPorDiaYMoneda(ctx context.Context, merchantID string, desde, hasta time.Time, tzOffsetMin int) ([]TotalDelDia, error) {
	rows, err := r.db.Query(ctx,
		`SELECT ((p.created_at - make_interval(mins => $4))::date)::text, p.currency,
		        COALESCE(SUM(p.amount), 0), COALESCE(SUM(p.fee), 0), COUNT(*)
		   FROM qr_payments p
		  WHERE p.merchant_id = $1::uuid AND p.status = 'completed'
		    AND p.created_at >= $2 AND p.created_at < $3
		  GROUP BY 1, 2
		  ORDER BY 1 DESC, 2 ASC`,
		merchantID, desde, hasta, tzOffsetMin)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []TotalDelDia{}
	for rows.Next() {
		var d TotalDelDia
		if err := rows.Scan(&d.Date, &d.Currency, &d.Gross, &d.Fee, &d.Count); err != nil {
			return nil, err
		}
		d.Net = d.Gross - d.Fee
		out = append(out, d)
	}
	return out, rows.Err()
}

// limiteDeRetiros es el tope de retiros que una consulta devuelve. Un comercio
// retira unas pocas veces por mes; el tope es para que una consulta no crezca
// sin limite, no para cortar lo que de verdad pasa.
const limiteDeRetiros = 200

// RetirosDelComercio son los retiros completados del saldo del negocio hacia la
// cuenta de su dueno en [desde, hasta), el mas reciente primero. Salen de las
// transacciones del dueno: el retiro anota al comercio como contraparte.
func (r *Repository) RetirosDelComercio(ctx context.Context, merchantID string, desde, hasta time.Time) ([]RetiroDelComercio, error) {
	rows, err := r.db.Query(ctx,
		`SELECT t.id::text, t.amount, t.currency, t.status,
		        COALESCE(TRIM(u.first_name || ' ' || u.last_name), ''), t.created_at
		   FROM transactions t
		   LEFT JOIN users u ON u.id = t.user_id
		  WHERE t.type = 'merchant_withdrawal' AND t.counterparty_id = $1::uuid
		    AND t.status = 'completed'
		    AND t.created_at >= $2 AND t.created_at < $3
		  ORDER BY t.created_at DESC, t.id DESC
		  LIMIT $4`,
		merchantID, desde, hasta, limiteDeRetiros)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []RetiroDelComercio{}
	for rows.Next() {
		var w RetiroDelComercio
		if err := rows.Scan(&w.ID, &w.Amount, &w.Currency, &w.Status, &w.WithdrawnByName, &w.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, w)
	}
	return out, rows.Err()
}
