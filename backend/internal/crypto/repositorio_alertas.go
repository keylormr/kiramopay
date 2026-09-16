package crypto

import (
	"context"
	"sort"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/kiramopay/backend/internal/plans"
	"github.com/shopspring/decimal"
)

// Alertas de precio. Los estados y por que nada se borra estan en
// migrations/071_alertas_de_precio_cumplidas.sql.

// cumplidasVisibles es cuantas alertas cumplidas devuelve la lista, las mas
// recientes. Las activas salen todas (el tope ya las acota).
const cumplidasVisibles = 20

const columnasDeAlerta = `id, user_id, asset, target_price, direction,
	COALESCE(active, false), created_at, cumplida_at, precio_cumplida`

func escanearAlerta(row pgx.Row) (PriceAlertRecord, error) {
	var (
		a        PriceAlertRecord
		cumplida *time.Time
		precio   decimal.NullDecimal
	)
	if err := row.Scan(&a.ID, &a.UserID, &a.Asset, &a.TargetPrice, &a.Direction,
		&a.Active, &a.CreatedAt, &cumplida, &precio); err != nil {
		return a, err
	}
	a.Status = AlertaActiva
	if !a.Active {
		a.Status = AlertaCumplida
	}
	a.TriggeredAt = cumplida
	if precio.Valid {
		p := precio.Decimal
		a.TriggeredPrice = &p
	}
	return a, nil
}

func escanearAlertas(rows pgx.Rows) ([]PriceAlertRecord, error) {
	defer rows.Close()
	alertas := []PriceAlertRecord{}
	for rows.Next() {
		a, err := escanearAlerta(rows)
		if err != nil {
			return nil, err
		}
		alertas = append(alertas, a)
	}
	return alertas, rows.Err()
}

// GetPriceAlerts devuelve las alertas activas de la persona y sus cumplidas
// mas recientes que no quito. Primero las activas (la mas nueva arriba) y
// despues las cumplidas (la ultima en cumplirse arriba).
func (r *Repository) GetPriceAlerts(ctx context.Context, userID string) ([]PriceAlertRecord, error) {
	rows, err := r.db.Query(ctx, `
		(SELECT `+columnasDeAlerta+`
		   FROM crypto_price_alerts
		  WHERE user_id = $1 AND active = true)
		UNION ALL
		(SELECT `+columnasDeAlerta+`
		   FROM crypto_price_alerts
		  WHERE user_id = $1 AND cumplida_at IS NOT NULL AND borrada_at IS NULL
		  ORDER BY cumplida_at DESC
		  LIMIT $2)`,
		userID, cumplidasVisibles,
	)
	if err != nil {
		return nil, err
	}
	alertas, err := escanearAlertas(rows)
	if err != nil {
		return nil, err
	}
	// UNION ALL no promete conservar el orden de cada rama: se ordena aqui.
	sort.SliceStable(alertas, func(i, j int) bool {
		a, b := alertas[i], alertas[j]
		if a.Active != b.Active {
			return a.Active
		}
		if a.Active || a.TriggeredAt == nil || b.TriggeredAt == nil {
			return a.CreatedAt.After(b.CreatedAt)
		}
		return a.TriggeredAt.After(*b.TriggeredAt)
	})
	return alertas, nil
}

// AddPriceAlert guarda la alerta si la persona no llego al tope de activas.
// Contar e insertar corren bajo el bloqueo por persona de plans.CrearConTope:
// sin el, dos creaciones simultaneas pasaban el tope juntas. Pasado el tope
// devuelve *plans.TopeAlcanzadoError.
func (r *Repository) AddPriceAlert(ctx context.Context, a *PriceAlertRecord) error {
	a.ID = uuid.New().String()
	return plans.CrearConTope(ctx, r.db, recursoAlertas, a.UserID, topesDeAlertas,
		func(ctx context.Context, tx pgx.Tx) (int, error) {
			var activas int
			err := tx.QueryRow(ctx,
				`SELECT COUNT(*) FROM crypto_price_alerts WHERE user_id = $1 AND active = true`,
				a.UserID,
			).Scan(&activas)
			return activas, err
		},
		func(ctx context.Context, tx pgx.Tx) error {
			return tx.QueryRow(ctx,
				`INSERT INTO crypto_price_alerts (id, user_id, asset, target_price, direction, active, created_at)
				 VALUES ($1, $2, $3, $4, $5, true, NOW())
				 RETURNING created_at`,
				a.ID, a.UserID, a.Asset, a.TargetPrice, a.Direction,
			).Scan(&a.CreatedAt)
		},
	)
}

// DeactivatePriceAlert quita la alerta de la lista de la persona, este activa
// o cumplida. La fila queda: se apaga y se anota cuando se quito.
func (r *Repository) DeactivatePriceAlert(ctx context.Context, id, userID string) error {
	_, err := r.db.Exec(ctx,
		`UPDATE crypto_price_alerts
		    SET active = false, borrada_at = NOW()
		  WHERE id = $1 AND user_id = $2 AND borrada_at IS NULL`,
		id, userID)
	return err
}

// CumplirAlertas marca como cumplidas las alertas activas de un activo que el
// precio satisface, y las devuelve. Hasta `limite` por llamada.
//
// Marcar y elegir son UNA sentencia: una alerta pasa de activa a cumplida una
// sola vez aunque dos barridos corran a la vez (el `active = true` de afuera se
// vuelve a evaluar sobre la fila bloqueada, y SKIP LOCKED salta la que otro
// esta tocando, incluida la que la persona esta quitando en ese momento). Por
// eso el aviso que sigue sale a lo sumo una vez por alerta.
//
// La condicion es la misma de alertaCumplida. Las alertas de cuentas que no
// estan activas (bloqueadas, suspendidas, cerradas o dadas de baja) no se
// evaluan: quedan esperando por si la cuenta vuelve.
func (r *Repository) CumplirAlertas(ctx context.Context, activo string, precio decimal.Decimal, limite int) ([]PriceAlertRecord, error) {
	rows, err := r.db.Query(ctx, `
		UPDATE crypto_price_alerts
		   SET active = false, cumplida_at = NOW(), precio_cumplida = $2
		 WHERE id IN (
		         SELECT a.id
		           FROM crypto_price_alerts a
		           JOIN users u ON u.id = a.user_id
		          WHERE a.active = true
		            AND a.asset = $1
		            AND ((a.direction = 'above' AND a.target_price <= $2)
		              OR (a.direction = 'below' AND a.target_price >= $2))
		            AND COALESCE(u.status, 'active') = 'active'
		            AND u.deleted_at IS NULL
		          ORDER BY a.created_at
		          LIMIT $3
		            FOR UPDATE OF a SKIP LOCKED)
		   AND active = true
		RETURNING `+columnasDeAlerta,
		activo, precio, limite,
	)
	if err != nil {
		return nil, err
	}
	return escanearAlertas(rows)
}
