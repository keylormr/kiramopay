package uif

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/kiramopay/backend/internal/transaction"
)

type Repository struct {
	db *pgxpool.Pool
}

func NewRepository(db *pgxpool.Pool) *Repository {
	return &Repository{db: db}
}

// outgoingTypesSQL son los tipos de movimiento que sacan valor de la billetera y
// por lo tanto suman al agregado diario de la UIF.
//
// NO se escribe a mano: sale de transaction.TiposDeSalida, la misma lista que usa
// el tope diario de gasto. Estaban duplicadas y se desincronizaron — al agregarse
// escrow, payouts y marketplace, esta se quedo con la lista vieja y la deteccion
// de estructuracion dejo de ver ese dinero, sin fallar ni avisar.
var outgoingTypesSQL = transaction.ListaSQLDeSalidas()

// SalidasDelDiaPorMoneda suma las salidas completadas de HOY, por moneda,
// incluido el movimiento recien confirmado. El agregado del dia junta todas las
// monedas por su equivalente en dolares; esta consulta trae cada una por su
// lado para convertirla.
func (r *Repository) SalidasDelDiaPorMoneda(ctx context.Context, userID string) (map[string]int64, error) {
	return r.salidasPorMoneda(ctx, userID, `created_at::date = CURRENT_DATE`)
}

// SalidasDe30DiasPorMoneda es lo mismo para los ultimos 30 dias.
func (r *Repository) SalidasDe30DiasPorMoneda(ctx context.Context, userID string) (map[string]int64, error) {
	return r.salidasPorMoneda(ctx, userID, `created_at >= NOW() - INTERVAL '30 days'`)
}

// salidasPorMoneda: la ventana es una de las dos constantes de arriba, nunca un
// dato de afuera.
func (r *Repository) salidasPorMoneda(ctx context.Context, userID, ventana string) (map[string]int64, error) {
	rows, err := r.db.Query(ctx,
		`SELECT currency, COALESCE(SUM(amount), 0) FROM transactions
		  WHERE user_id = $1::uuid AND status = 'completed' AND `+ventana+`
		    AND type IN `+outgoingTypesSQL+`
		  GROUP BY currency`,
		userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]int64{}
	for rows.Next() {
		var moneda string
		var total int64
		if err := rows.Scan(&moneda, &total); err != nil {
			return nil, err
		}
		out[moneda] = total
	}
	return out, rows.Err()
}

// CreateReport inserts a report. A single_threshold/structuring report for the
// same tx is deduplicated by the partial unique index (ON CONFLICT DO NOTHING).
func (r *Repository) CreateReport(ctx context.Context, rep *Report) error {
	if rep.ID == "" {
		rep.ID = uuid.New().String()
	}
	if rep.Status == "" {
		rep.Status = StatusPending
	}
	_, err := r.db.Exec(ctx,
		`INSERT INTO uif_reports
		   (id, user_id, tx_id, report_type, amount_minor, currency, daily_total_minor, reason, status,
		    acumulado_30d_minor)
		 VALUES ($1::uuid, $2::uuid, NULLIF($3,'')::uuid, $4, $5, $6, $7, $8, $9, NULLIF($10, 0))
		 ON CONFLICT (tx_id, report_type) WHERE tx_id IS NOT NULL DO NOTHING`,
		rep.ID, rep.UserID, rep.TxID, rep.ReportType, rep.AmountMinor,
		rep.Currency, rep.DailyTotalMinor, rep.Reason, rep.Status, rep.Acumulado30Minor,
	)
	return err
}

const reportCols = `id::text, user_id::text, COALESCE(tx_id::text,''), report_type,
	amount_minor, currency, daily_total_minor, reason, status,
	COALESCE(reviewer_id::text,''), COALESCE(reviewer_notes,''), created_at, reviewed_at,
	COALESCE(acumulado_30d_minor, 0)`

func scanReport(row pgx.Row) (*Report, error) {
	rep := &Report{}
	if err := row.Scan(
		&rep.ID, &rep.UserID, &rep.TxID, &rep.ReportType, &rep.AmountMinor,
		&rep.Currency, &rep.DailyTotalMinor, &rep.Reason, &rep.Status,
		&rep.ReviewerID, &rep.ReviewerNotes, &rep.CreatedAt, &rep.ReviewedAt,
		&rep.Acumulado30Minor,
	); err != nil {
		return nil, err
	}
	return rep, nil
}

func (r *Repository) GetReport(ctx context.Context, id string) (*Report, error) {
	return scanReport(r.db.QueryRow(ctx,
		`SELECT `+reportCols+` FROM uif_reports WHERE id = $1::uuid`, id))
}

// ListByStatus returns reports filtered by status ("" = all), newest first.
func (r *Repository) ListByStatus(ctx context.Context, status string, limit int) ([]Report, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	q := `SELECT ` + reportCols + ` FROM uif_reports`
	args := []any{}
	if status != "" {
		q += ` WHERE status = $1`
		args = append(args, status)
	}
	q += fmt.Sprintf(` ORDER BY created_at DESC LIMIT %d`, limit)

	rows, err := r.db.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []Report{}
	for rows.Next() {
		rep, err := scanReport(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *rep)
	}
	return out, rows.Err()
}

// Review records a compliance decision (submitted/dismissed/reviewed).
func (r *Repository) Review(ctx context.Context, id, reviewerID, status, notes string) error {
	ct, err := r.db.Exec(ctx,
		`UPDATE uif_reports
		 SET status = $2, reviewer_id = NULLIF($3,'')::uuid, reviewer_notes = NULLIF($4,''),
		     reviewed_at = NOW()
		 WHERE id = $1::uuid AND status = 'pending'`,
		id, status, reviewerID, notes,
	)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return fmt.Errorf("report not found or already reviewed")
	}
	return nil
}
