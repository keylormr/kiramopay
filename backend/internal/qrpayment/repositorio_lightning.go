package qrpayment

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

// Lo que se guarda del cobro con Lightning (migracion 090). Ver lightning.go.

// EsCuentaDemo dice si la cuenta esta marcada como de demostracion. Una cuenta
// que no existe no lo es.
func (r *Repository) EsCuentaDemo(ctx context.Context, userID string) (bool, error) {
	var demo bool
	err := r.db.QueryRow(ctx, `SELECT demo_login FROM users WHERE id = $1`, userID).Scan(&demo)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	return demo, err
}

// LeerMediosDeCobro: sin fila, el comercio no tiene ninguno.
func (r *Repository) LeerMediosDeCobro(ctx context.Context, merchantID string) (*MediosDeCobro, error) {
	var m MediosDeCobro
	err := r.db.QueryRow(ctx,
		`SELECT COALESCE(lightning_address, ''), COALESCE(sinpe_movil, '')
		   FROM merchant_payment_methods WHERE merchant_id = $1`, merchantID).
		Scan(&m.LightningAddress, &m.SinpeMovil)
	if errors.Is(err, pgx.ErrNoRows) {
		return &MediosDeCobro{}, nil
	}
	if err != nil {
		return nil, err
	}
	return &m, nil
}

// GuardarMediosDeCobro deja exactamente esos dos valores; "" es ninguno.
func (r *Repository) GuardarMediosDeCobro(ctx context.Context, merchantID, userID, direccion, sinpe string) error {
	_, err := r.db.Exec(ctx,
		`INSERT INTO merchant_payment_methods (merchant_id, lightning_address, sinpe_movil, updated_by, updated_at)
		 VALUES ($1, NULLIF($2, ''), NULLIF($3, ''), $4, NOW())
		 ON CONFLICT (merchant_id) DO UPDATE
		    SET lightning_address = EXCLUDED.lightning_address,
		        sinpe_movil       = EXCLUDED.sinpe_movil,
		        updated_by        = EXCLUDED.updated_by,
		        updated_at        = NOW()`,
		merchantID, direccion, sinpe, userID)
	return err
}

const facturaLightningCols = `id, charge_id, merchant_id, created_by, lightning_address, invoice,
	payment_hash, amount_msat, sats, fiat_amount, currency, btc_price, btc_usd, usd_rate,
	verify_url, quote_expires_at, invoice_expires_at, status, paid_at, created_at`

func scanFacturaLightning(row pgx.Row) (*CobroLightning, error) {
	var f CobroLightning
	if err := row.Scan(&f.ID, &f.ChargeID, &f.MerchantID, &f.CreatedBy, &f.LightningAddress, &f.Invoice,
		&f.PaymentHash, &f.AmountMsat, &f.Sats, &f.FiatAmount, &f.Currency, &f.BTCPrice, &f.BTCUSD, &f.TasaUSD,
		&f.VerifyURL, &f.QuoteExpiresAt, &f.InvoiceExpiresAt, &f.Status, &f.PaidAt, &f.CreatedAt); err != nil {
		return nil, err
	}
	return &f, nil
}

func listarFacturasLightning(rows pgx.Rows, err error) ([]CobroLightning, error) {
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var lista []CobroLightning
	for rows.Next() {
		f, err := scanFacturaLightning(rows)
		if err != nil {
			return nil, err
		}
		lista = append(lista, *f)
	}
	return lista, rows.Err()
}

// GuardarFacturaLightning inserta la factura y le llena id y fecha.
func (r *Repository) GuardarFacturaLightning(ctx context.Context, f *CobroLightning) error {
	return r.db.QueryRow(ctx,
		`INSERT INTO qr_charge_lightning (charge_id, merchant_id, created_by, lightning_address, invoice,
		        payment_hash, amount_msat, sats, fiat_amount, currency, btc_price, btc_usd, usd_rate,
		        verify_url, quote_expires_at, invoice_expires_at, status)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, 'pending')
		 RETURNING id, created_at`,
		f.ChargeID, f.MerchantID, f.CreatedBy, f.LightningAddress, f.Invoice,
		f.PaymentHash, f.AmountMsat, f.Sats, f.FiatAmount, f.Currency, f.BTCPrice, f.BTCUSD, f.TasaUSD,
		f.VerifyURL, f.QuoteExpiresAt, f.InvoiceExpiresAt).Scan(&f.ID, &f.CreatedAt)
}

// FacturaLightningVigente es la factura pendiente del cobro cuya cotizacion
// sigue vigente despues de `despuesDe`; nil si no hay.
func (r *Repository) FacturaLightningVigente(ctx context.Context, chargeID string, despuesDe time.Time) (*CobroLightning, error) {
	f, err := scanFacturaLightning(r.db.QueryRow(ctx,
		`SELECT `+facturaLightningCols+` FROM qr_charge_lightning
		  WHERE charge_id = $1 AND status = 'pending' AND quote_expires_at > $2
		  ORDER BY created_at DESC LIMIT 1`, chargeID, despuesDe))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return f, err
}

// UltimaFacturaLightning es la factura mas reciente del cobro, pagada primero:
// si una vieja se pago, eso es lo que el cajero tiene que ver.
func (r *Repository) UltimaFacturaLightning(ctx context.Context, chargeID string) (*CobroLightning, error) {
	f, err := scanFacturaLightning(r.db.QueryRow(ctx,
		`SELECT `+facturaLightningCols+` FROM qr_charge_lightning
		  WHERE charge_id = $1
		  ORDER BY (status = 'paid') DESC, created_at DESC LIMIT 1`, chargeID))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return f, err
}

// FacturasLightningPorRevisar RECLAMA las facturas pendientes que hay que
// consultar: las que vencen despues de `vencenDespuesDe` y nadie consulto
// despues de `revisadasAntesDe`. El reclamo (checked_at = ahora) va en el mismo
// UPDATE, con SKIP LOCKED: dos consultas a la vez, o dos instancias, no le
// preguntan dos veces al proveedor por la misma factura. chargeID "" son todas.
func (r *Repository) FacturasLightningPorRevisar(
	ctx context.Context, chargeID string, ahora, vencenDespuesDe, revisadasAntesDe time.Time, lote int,
) ([]CobroLightning, error) {
	if lote <= 0 || lote > 500 {
		lote = 100
	}
	return listarFacturasLightning(r.db.Query(ctx,
		`UPDATE qr_charge_lightning SET checked_at = $5
		  WHERE id IN (SELECT id FROM qr_charge_lightning
		                WHERE status = 'pending'
		                  AND ($1::text = '' OR charge_id = NULLIF($1::text, '')::uuid)
		                  AND invoice_expires_at > $2
		                  AND (checked_at IS NULL OR checked_at < $3)
		                ORDER BY invoice_expires_at
		                LIMIT $4
		                FOR UPDATE SKIP LOCKED)
		 RETURNING `+facturaLightningCols, chargeID, vencenDespuesDe, revisadasAntesDe, lote, ahora))
}

// MarcarFacturaLightningPagada marca pagada la factura y, en la misma
// transaccion, su cobro, si seguia pendiente o se habia vencido. Devuelve si el
// cobro quedo pagado por esta factura.
//
// El cobro vencido se acepta porque la factura puede durar mas que el cobro: si
// el turista pago, la plata llego, y el comprobante tiene que decirlo. Un cobro
// cancelado, reemplazado o pagado por otro medio no se toca: la factura queda
// pagada (el contador la ve) y quien mira la pantalla ve las dos cosas.
func (r *Repository) MarcarFacturaLightningPagada(ctx context.Context, id, preimage string) (bool, error) {
	tx, err := r.db.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var chargeID string
	err = tx.QueryRow(ctx,
		`UPDATE qr_charge_lightning SET status = 'paid', preimage = $2, paid_at = NOW()
		  WHERE id = $1 AND status = 'pending'
		 RETURNING charge_id`, id, preimage).Scan(&chargeID)
	if errors.Is(err, pgx.ErrNoRows) {
		// Ya la marco otra consulta.
		return false, nil
	}
	if err != nil {
		return false, err
	}
	ct, err := tx.Exec(ctx,
		`UPDATE qr_charges SET status = 'paid', paid_at = NOW(), paid_via = 'lightning'
		  WHERE id = $1 AND status IN ('pending', 'expired')`, chargeID)
	if err != nil {
		return false, err
	}
	if err := tx.Commit(ctx); err != nil {
		return false, err
	}
	return ct.RowsAffected() == 1, nil
}

// VencerFacturasLightning da por vencidas las pendientes que vencieron antes de
// `vencidasAntesDe` (el vencimiento menos la gracia de las consultas).
func (r *Repository) VencerFacturasLightning(ctx context.Context, vencidasAntesDe time.Time) (int64, error) {
	ct, err := r.db.Exec(ctx,
		`UPDATE qr_charge_lightning SET status = 'expired'
		  WHERE status = 'pending' AND invoice_expires_at <= $1`, vencidasAntesDe)
	if err != nil {
		return 0, err
	}
	return ct.RowsAffected(), nil
}

// VentasLightning son las facturas pagadas del comercio en [desde, hasta).
func (r *Repository) VentasLightning(ctx context.Context, merchantID string, desde, hasta time.Time) ([]VentaLightning, error) {
	rows, err := r.db.Query(ctx,
		`SELECT l.charge_id, c.note, l.fiat_amount, l.currency, l.sats, l.btc_price, l.payment_hash,
		        l.paid_at, c.status
		   FROM qr_charge_lightning l
		   JOIN qr_charges c ON c.id = l.charge_id
		  WHERE l.merchant_id = $1 AND l.status = 'paid' AND l.paid_at >= $2 AND l.paid_at < $3
		  ORDER BY l.paid_at, l.id`, merchantID, desde, hasta)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	ventas := []VentaLightning{}
	for rows.Next() {
		var v VentaLightning
		if err := rows.Scan(&v.ChargeID, &v.Note, &v.FiatAmount, &v.Currency, &v.Sats, &v.BTCPrice,
			&v.PaymentHash, &v.PaidAt, &v.ChargeStatus); err != nil {
			return nil, err
		}
		ventas = append(ventas, v)
	}
	return ventas, rows.Err()
}
