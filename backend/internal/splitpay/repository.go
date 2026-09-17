package splitpay

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Repository struct {
	db *pgxpool.Pool
}

func NewRepository(db *pgxpool.Pool) *Repository {
	return &Repository{db: db}
}

// ── Split Groups ─────────────────────────────────────────────────────────────

// CrearGrupoConCuotas escribe el grupo y TODAS sus cuotas en una sola
// transaccion. Iban por separado: si la insercion de una cuota fallaba a mitad,
// quedaba un grupo cuyas cuotas no sumaban su total y que por lo tanto nadie
// podia liquidar nunca.
func (r *Repository) CrearGrupoConCuotas(ctx context.Context, group *SplitGroup, shares []SplitShare) error {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	if _, err := tx.Exec(ctx,
		`INSERT INTO split_groups (id, creator_id, title, description, total_amount, currency, split_type, status)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
		group.ID, group.CreatorID, group.Title, group.Description,
		group.TotalAmount, group.Currency, group.SplitType, group.Status); err != nil {
		return err
	}

	for i := range shares {
		sh := &shares[i]
		// El estado y "ya esta pagada" viajan en parametros distintos. Con $7
		// usado a la vez como valor de la columna VARCHAR y en `$7 = 'paid'`,
		// Postgres deducia dos tipos para el mismo parametro y rechazaba la
		// sentencia entera (42P08). Como la cuota del creador se inserta
		// siempre, NINGUNA division se pudo crear nunca.
		if _, err := tx.Exec(ctx,
			`INSERT INTO split_shares (id, group_id, user_id, user_phone, user_name, amount, status, paid_at)
			 VALUES ($1, $2, $3, NULLIF($4, ''), $5, $6, $7, CASE WHEN $8::boolean THEN NOW() END)`,
			sh.ID, sh.GroupID, sh.UserID, sh.UserPhone,
			sh.UserName, sh.Amount, sh.Status, sh.Status == "paid"); err != nil {
			return err
		}
	}

	return tx.Commit(ctx)
}

func (r *Repository) GetGroup(ctx context.Context, groupID string) (*SplitGroup, error) {
	var g SplitGroup
	err := r.db.QueryRow(ctx,
		`SELECT id, creator_id, title, COALESCE(description, ''), total_amount, currency,
		 split_type, status, created_at, settled_at
		 FROM split_groups WHERE id = $1`, groupID).Scan(
		&g.ID, &g.CreatorID, &g.Title, &g.Description, &g.TotalAmount, &g.Currency,
		&g.SplitType, &g.Status, &g.CreatedAt, &g.SettledAt)
	if err != nil {
		return nil, err
	}
	return &g, nil
}

func (r *Repository) UpdateGroupStatus(ctx context.Context, groupID, status string) error {
	query := `UPDATE split_groups SET status = $2 WHERE id = $1`
	if status == "settled" {
		query = `UPDATE split_groups SET status = $2, settled_at = NOW() WHERE id = $1`
	}
	result, err := r.db.Exec(ctx, query, groupID, status)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return fmt.Errorf("split group not found")
	}
	return nil
}

func (r *Repository) ListUserGroups(ctx context.Context, userID string) ([]SplitGroup, error) {
	rows, err := r.db.Query(ctx,
		`SELECT DISTINCT g.id, g.creator_id, g.title, COALESCE(g.description, ''),
		 g.total_amount, g.currency, g.split_type, g.status, g.created_at, g.settled_at
		 FROM split_groups g
		 LEFT JOIN split_shares s ON s.group_id = g.id
		 WHERE g.creator_id = $1 OR s.user_id = $1
		 ORDER BY g.created_at DESC LIMIT 50`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var groups []SplitGroup
	for rows.Next() {
		var g SplitGroup
		if err := rows.Scan(&g.ID, &g.CreatorID, &g.Title, &g.Description,
			&g.TotalAmount, &g.Currency, &g.SplitType, &g.Status,
			&g.CreatedAt, &g.SettledAt); err != nil {
			return nil, err
		}
		groups = append(groups, g)
	}
	return groups, nil
}

// ── Split Shares ─────────────────────────────────────────────────────────────

func (r *Repository) GetGroupShares(ctx context.Context, groupID string) ([]SplitShare, error) {
	rows, err := r.db.Query(ctx,
		`SELECT id, group_id, COALESCE(user_id::text, ''), COALESCE(user_phone, ''),
		 user_name, amount, status, paid_at
		 FROM split_shares WHERE group_id = $1 ORDER BY user_name`, groupID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var shares []SplitShare
	for rows.Next() {
		var s SplitShare
		if err := rows.Scan(&s.ID, &s.GroupID, &s.UserID, &s.UserPhone,
			&s.UserName, &s.Amount, &s.Status, &s.PaidAt); err != nil {
			return nil, err
		}
		shares = append(shares, s)
	}
	return shares, nil
}

// ejecutor lo satisfacen *pgxpool.Pool y pgx.Tx, para que el MISMO reclamo
// corra suelto o dentro de la transaccion del asiento.
type ejecutor interface {
	Exec(ctx context.Context, sql string, args ...interface{}) (pgconn.CommandTag, error)
}

// El `status = 'pending'` de los dos UPDATE es la unica compuerta real entre
// pagar y rechazar una cuota: quien llega segundo no cambia ninguna fila y se
// entera por RowsAffected. La lectura que hace el servicio antes no frena nada,
// porque lee fuera de la transaccion.
//
// El estado va escrito en el SQL y no como parametro a proposito: un mismo
// parametro usado como valor de la columna VARCHAR y dentro de una comparacion
// hace que Postgres le deduzca dos tipos y rechace la sentencia entera (42P08).
// Ese error ya dejo sin funcionar la creacion de divisiones una vez.
const (
	sqlReclamarPago = `UPDATE split_shares SET status = 'paid', paid_at = NOW()
		 WHERE group_id = $1 AND user_id = $2 AND status = 'pending'`

	sqlRechazarCuota = `UPDATE split_shares SET status = 'declined'
		 WHERE group_id = $1 AND user_id = $2 AND status = 'pending'`
)

func reclamarCuota(ctx context.Context, q ejecutor, sql, groupID, userID string) error {
	result, err := q.Exec(ctx, sql, groupID, userID)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return ErrCuotaNoReclamable
	}
	return nil
}

// ReclamarCuotaEnTx toma la cuota EN EXCLUSIVA por la transaccion que recibe.
//
// Es lo que el servicio le pasa a CreateTransfer en EnLaMismaTx: el reclamo y
// el movimiento del dinero confirman juntos o no confirma ninguno. Antes el
// dinero salia primero y la guarda de estado se aplicaba despues, asi que un
// rechazo simultaneo dejaba la fila en 'declined' con la plata ya movida.
func ReclamarCuotaEnTx(ctx context.Context, tx pgx.Tx, groupID, userID string) error {
	return reclamarCuota(ctx, tx, sqlReclamarPago, groupID, userID)
}

func (r *Repository) PayShare(ctx context.Context, groupID, userID string) error {
	return reclamarCuota(ctx, r.db, sqlReclamarPago, groupID, userID)
}

func (r *Repository) DeclineShare(ctx context.Context, groupID, userID string) error {
	return reclamarCuota(ctx, r.db, sqlRechazarCuota, groupID, userID)
}

// MarcarLiquidadaSiSigueActiva liquida el grupo SOLO si estaba activo.
//
// Sin el `status = 'active'`, una division que el creador acababa de cancelar
// volvia a "liquidada" en cuanto la ultima cuota pendiente se pagaba o se
// rechazaba: el UPDATE pisaba cualquier estado. Que no quede nada pendiente no
// resucita un grupo cancelado.
func (r *Repository) MarcarLiquidadaSiSigueActiva(ctx context.Context, groupID string) error {
	_, err := r.db.Exec(ctx,
		`UPDATE split_groups SET status = 'settled', settled_at = NOW()
		 WHERE id = $1 AND status = 'active'`, groupID)
	return err
}

func (r *Repository) CountPendingShares(ctx context.Context, groupID string) (int, error) {
	var count int
	err := r.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM split_shares WHERE group_id = $1 AND status = 'pending'`,
		groupID).Scan(&count)
	return count, err
}
