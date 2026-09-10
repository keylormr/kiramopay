package qrpayment

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// pgxQuerier lo satisfacen *pgxpool.Pool y pgx.Tx: el mismo SQL corre suelto o
// dentro de la transaccion del asiento.
type pgxQuerier interface {
	Exec(ctx context.Context, sql string, args ...interface{}) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...interface{}) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...interface{}) pgx.Row
}

// ── La identidad permanente ─────────────────────────────────────────────────

// GetOrCreateStaticCode devuelve el codigo permanente de una persona o de un
// mostrador, creandolo si no existe.
//
// No usa ON CONFLICT: inferir un indice unico PARCIAL y con expresiones obliga a
// repetir el predicado entero en la sentencia, y eso se desincroniza en la
// primera vez que alguien toca el indice. La carrera se resuelve como siempre:
// si el INSERT choca con 23505, gano otro y se relee el suyo.
func (r *Repository) GetOrCreateStaticCode(
	ctx context.Context, creatorID, merchantID, locationID, currency, tipo string,
) (*QRPaymentCode, error) {
	if currency == "" {
		currency = "CRC"
	}
	if code, err := r.buscarCodigoActivo(ctx, creatorID, merchantID, locationID, currency); err == nil {
		return code, nil
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}

	code := &QRPaymentCode{
		ID:         uuid.New().String(),
		CreatorID:  creatorID,
		Type:       tipo,
		Currency:   currency,
		MerchantID: merchantID,
		LocationID: locationID,
		Status:     EstadoCodigoActivo,
	}
	// El <id8> del payload sale del id de la PROPIA fila y no del usuario: un
	// codigo que se imprime y se pega no puede llevar adentro el UUID de quien
	// cobra. Ningun parser lee ese campo, asi que la forma no cambia para nadie.
	code.QRData = fmt.Sprintf("KP:%s:%s:0:%s:i%s", tipo, code.ID[:8], currency, generateQRToken())

	err := r.CreateQRCode(ctx, code)
	if err == nil {
		return code, nil
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		return r.buscarCodigoActivo(ctx, creatorID, merchantID, locationID, currency)
	}
	return nil, err
}

func (r *Repository) buscarCodigoActivo(
	ctx context.Context, creatorID, merchantID, locationID, currency string,
) (*QRPaymentCode, error) {
	if merchantID == "" {
		return scanCode(r.db.QueryRow(ctx,
			`SELECT `+codeCols+` FROM qr_payment_codes
			  WHERE creator_id = $1 AND currency = $2
			    AND merchant_id IS NULL AND status = 'active'`,
			creatorID, currency))
	}
	// El COALESCE espeja el del indice unico: sin el, dos codigos generales del
	// mismo comercio (location_id NULL) no se encontrarian entre si.
	return scanCode(r.db.QueryRow(ctx,
		`SELECT `+codeCols+` FROM qr_payment_codes
		  WHERE merchant_id = $1::uuid
		    AND COALESCE(location_id, '00000000-0000-0000-0000-000000000000'::uuid)
		        = COALESCE(NULLIF($2,'')::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
		    AND currency = $3 AND status = 'active'`,
		merchantID, locationID, currency))
}

// RevocarCodigo retira un codigo permanente. Existe porque un codigo permanente
// es un identificador estable: el afiche se fotografia, el local cierra, el
// empleado se lleva el rotulo.
func (r *Repository) RevocarCodigo(ctx context.Context, id, creatorID string) error {
	ct, err := r.db.Exec(ctx,
		`UPDATE qr_payment_codes SET status = 'revoked', revoked_at = NOW()
		  WHERE id = $1 AND creator_id = $2 AND status = 'active'`, id, creatorID)
	if err != nil {
		return err
	}
	if ct.RowsAffected() != 1 {
		return ErrQRInvalido
	}
	return nil
}

// ── Cobros ──────────────────────────────────────────────────────────────────

const chargeCols = `id, qr_code_id, COALESCE(merchant_id::text, ''), COALESCE(location_id::text, ''),
	created_by, amount, currency, note, channel, status, qr_data, expires_at,
	COALESCE(paid_by::text, ''), COALESCE(paid_tx_id, ''), paid_at,
	COALESCE(superseded_by::text, ''), created_at`

func scanCharge(row pgx.Row) (*QRCharge, error) {
	var c QRCharge
	if err := row.Scan(&c.ID, &c.QRCodeID, &c.MerchantID, &c.LocationID, &c.CreatedBy,
		&c.Amount, &c.Currency, &c.Note, &c.Channel, &c.Status, &c.QRData, &c.ExpiresAt,
		&c.PaidBy, &c.PaidTxID, &c.PaidAt, &c.SupersededBy, &c.CreatedAt); err != nil {
		return nil, err
	}
	return &c, nil
}

func (r *Repository) GetCharge(ctx context.Context, id string) (*QRCharge, error) {
	return scanCharge(r.db.QueryRow(ctx,
		`SELECT `+chargeCols+` FROM qr_charges WHERE id = $1`, id))
}

func (r *Repository) GetChargeByData(ctx context.Context, qrData string) (*QRCharge, error) {
	return scanCharge(r.db.QueryRow(ctx,
		`SELECT `+chargeCols+` FROM qr_charges WHERE qr_data = $1`, qrData))
}

func (r *Repository) CrearCobro(ctx context.Context, q pgxQuerier, c *QRCharge) error {
	_, err := q.Exec(ctx,
		`INSERT INTO qr_charges (id, qr_code_id, merchant_id, location_id, created_by,
		                         amount, currency, note, channel, status, qr_data, expires_at)
		 VALUES ($1, $2, NULLIF($3,'')::uuid, NULLIF($4,'')::uuid, $5, $6, $7, $8, $9, $10, $11, $12)`,
		c.ID, c.QRCodeID, c.MerchantID, c.LocationID, c.CreatedBy,
		c.Amount, c.Currency, c.Note, c.Channel, c.Status, c.QRData, c.ExpiresAt)
	return err
}

// CerrarCobro mueve un cobro PENDIENTE a cancelado o reemplazado, con guarda.
//
// Cero filas afectadas NO es un error tecnico y no se puede tratar como uno: es
// la rama exacta donde un UPDATE sin guarda produce un doble cobro real. Si el
// cobro ya se pago y aqui dijeramos "cancelado", el cajero pediria el pago otra
// vez sobre una venta que ya entro. Por eso se devuelve el estado real y quien
// llama decide.
func (r *Repository) CerrarCobro(ctx context.Context, q pgxQuerier, id, nuevoEstado, supersededBy string) error {
	ct, err := q.Exec(ctx,
		`UPDATE qr_charges SET status = $2, superseded_by = NULLIF($3,'')::uuid
		  WHERE id = $1 AND status = 'pending'`, id, nuevoEstado, supersededBy)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 1 {
		return nil
	}
	return r.errorDelEstadoReal(ctx, id)
}

// errorDelEstadoReal traduce "el UPDATE guardado no afecto filas" al motivo
// concreto, leyendo el estado que de verdad tiene el cobro.
func (r *Repository) errorDelEstadoReal(ctx context.Context, id string) error {
	c, err := r.GetCharge(ctx, id)
	if err != nil {
		return ErrQRInvalido
	}
	switch c.Status {
	case EstadoCobroPagado:
		return ErrCobroYaPagado
	case EstadoCobroCancelado:
		return ErrCobroCancelado
	case EstadoCobroVencido:
		return ErrCobroVencido
	case EstadoCobroReemplazado:
		return ErrCobroReemplazado
	}
	return ErrQRInvalido
}

// ReclamarCobroEnTx es el corazon del arreglo: el cobro se reclama DENTRO de la
// transaccion del asiento, justo antes del COMMIT.
//
// La condicion viaja adentro del UPDATE, que toma el bloqueo de la fila y la
// evalua sosteniendolo: dos pagadores concurrentes se serializan solos y el
// segundo no matchea. No hace falta un SELECT ... FOR UPDATE aparte.
//
// Si no matchea, el gancho devuelve error, el asiento se aborta y al perdedor de
// la carrera no se le debita un centimo. Antes el reclamo corria DESPUES de
// mover el dinero, en modo best-effort.
func ReclamarCobroEnTx(ctx context.Context, q pgxQuerier, chargeID, payerID, txID string) error {
	ct, err := q.Exec(ctx,
		`UPDATE qr_charges
		    SET status = 'paid', paid_by = $2::uuid, paid_tx_id = $3, paid_at = NOW()
		  WHERE id = $1 AND status = 'pending' AND expires_at > NOW()`,
		chargeID, payerID, txID)
	if err != nil {
		return err
	}
	if ct.RowsAffected() != 1 {
		return ErrCobroNoReclamable
	}
	return nil
}

// ListarCobros devuelve los cobros que creo una persona. Es lo que hace posible
// la lista de "solicitudes activas": hasta ahora un pedido de plata era un texto
// que se iba por WhatsApp y no se podia consultar.
func (r *Repository) ListarCobros(ctx context.Context, creatorID, estado string, limite int) ([]QRCharge, error) {
	if limite <= 0 || limite > 100 {
		limite = 50
	}
	rows, err := r.db.Query(ctx,
		`SELECT `+chargeCols+` FROM qr_charges
		  WHERE created_by = $1 AND ($2 = '' OR status = $2)
		  ORDER BY created_at DESC LIMIT $3`, creatorID, estado, limite)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var cobros []QRCharge
	for rows.Next() {
		c, err := scanCharge(rows)
		if err != nil {
			return nil, err
		}
		cobros = append(cobros, *c)
	}
	return cobros, rows.Err()
}

// ExpirarCobrosVencidos marca vencidos los cobros pendientes cuyo plazo paso.
//
// Es COSMETICO para la correctitud: el reclamo ya filtra por `expires_at > NOW()`
// dentro de la transaccion, asi que un cobro vencido no cobra aunque el barrido
// se atrase. Sirve para que la pantalla del cajero y la lista de pedidos digan
// la verdad.
func (r *Repository) ExpirarCobrosVencidos(ctx context.Context, lote int) (int64, error) {
	if lote <= 0 {
		lote = 500
	}
	ct, err := r.db.Exec(ctx,
		`UPDATE qr_charges SET status = 'expired'
		  WHERE id IN (SELECT id FROM qr_charges
		                WHERE status = 'pending' AND expires_at <= NOW()
		                ORDER BY expires_at LIMIT $1)`, lote)
	if err != nil {
		return 0, err
	}
	return ct.RowsAffected(), nil
}

// NombreDeSucursal para el rotulo de la hoja de pago.
func (r *Repository) NombreDeSucursal(ctx context.Context, locationID string) string {
	if locationID == "" {
		return ""
	}
	var nombre string
	if err := r.db.QueryRow(ctx,
		`SELECT name FROM merchant_locations WHERE id = $1`, locationID).Scan(&nombre); err != nil {
		return ""
	}
	return nombre
}

// DuracionCobroMostrador y DuracionCobroEnlace son los dos plazos.
//
// El del mostrador es corto a proposito: como un cobro ya no bloquea nada (no
// hay indice de "un solo cobro vivo por codigo"), un vencimiento corto solo
// cuesta un toque de mas, y en cambio hace que una foto del QR muera pronto.
// Treinta minutos alcanzan para una fila lenta o para quien va al cajero.
//
// El del enlace conserva las 24 horas que ya tenia p2p_request.
const (
	DuracionCobroMostrador = 30 * time.Minute
	DuracionCobroEnlace    = 24 * time.Hour
)
