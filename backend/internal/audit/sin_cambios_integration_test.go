package audit_test

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"

	"github.com/kiramopay/backend/internal/audit"
	"github.com/kiramopay/backend/internal/testutil"
)

// Migracion 091: el registro de auditoria no se edita ni se borra fila por
// fila. Una fila que se puede reescribir no prueba quien hizo que.

func esRechazoDelRegistro(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23001" // restrict_violation
}

func TestElRegistroNoSeEditaNiSeBorra(t *testing.T) {
	pool := testutil.TestDB(t)
	ctx := context.Background()
	repo := audit.NewRepository(pool)
	userID := testutil.SeedTestUser(t, pool, "702650930", "dummy")
	sembrar(t, repo, userID, "login", "low")

	for _, c := range []struct {
		nombre string
		sql    string
	}{
		{"cambiar la accion", `UPDATE audit_logs SET action = 'otra' WHERE user_id = $1::uuid`},
		{"cambiar el riesgo", `UPDATE audit_logs SET risk_level = 'critical' WHERE user_id = $1::uuid`},
		{"cambiar la fecha", `UPDATE audit_logs SET created_at = created_at - INTERVAL '1 day' WHERE user_id = $1::uuid`},
		{"cambiar a quien", `UPDATE audit_logs SET user_id = NULL WHERE user_id = $1::uuid`},
		{"reescribir la IP", `UPDATE audit_logs SET ip_address = '10.9.9.9' WHERE user_id = $1::uuid`},
		{"reescribir los detalles", `UPDATE audit_logs SET details = '{"success": false}' WHERE user_id = $1::uuid`},
		{"borrar la fila", `DELETE FROM audit_logs WHERE user_id = $1::uuid`},
	} {
		t.Run(c.nombre, func(t *testing.T) {
			_, err := pool.Exec(ctx, c.sql, userID)
			if !esRechazoDelRegistro(err) {
				t.Fatalf("se esperaba el rechazo del registro, salio %v", err)
			}
		})
	}

	var accion, riesgo string
	var ip *string
	if err := pool.QueryRow(ctx,
		`SELECT action, risk_level, host(ip_address) FROM audit_logs WHERE user_id = $1::uuid`, userID,
	).Scan(&accion, &riesgo, &ip); err != nil {
		t.Fatalf("la fila no sobrevivio: %v", err)
	}
	if accion != "login" || riesgo != "low" || ip == nil || *ip != "10.0.0.1" {
		t.Fatalf("la fila cambio: accion=%q riesgo=%q ip=%v", accion, riesgo, ip)
	}
}

// La unica edicion aceptada es la de la eliminacion de cuenta (Ley 8968): IP,
// navegador y detalles en blanco, y todo lo demas igual. Es la consulta de
// accountdeletion/pasos.go, "desasociar auditoria".
func TestElRegistroAceptaLaDesasociacion(t *testing.T) {
	pool := testutil.TestDB(t)
	ctx := context.Background()
	repo := audit.NewRepository(pool)
	userID := testutil.SeedTestUser(t, pool, "702650930", "dummy")
	sembrar(t, repo, userID, "login", "low")

	desasociar := `UPDATE audit_logs
		SET ip_address = NULL, user_agent = NULL, details = '{}'::jsonb
		WHERE user_id = $1::uuid`
	if _, err := pool.Exec(ctx, desasociar, userID); err != nil {
		t.Fatalf("la desasociacion fue rechazada: %v", err)
	}
	// Repetirla no cambia nada y tampoco se rechaza: la eliminacion puede
	// reintentarse.
	if _, err := pool.Exec(ctx, desasociar, userID); err != nil {
		t.Fatalf("repetir la desasociacion fue rechazado: %v", err)
	}

	var accion string
	var ip *string
	var detalles string
	if err := pool.QueryRow(ctx,
		`SELECT action, host(ip_address), details::text FROM audit_logs WHERE user_id = $1::uuid`, userID,
	).Scan(&accion, &ip, &detalles); err != nil {
		t.Fatalf("leer la fila: %v", err)
	}
	if accion != "login" || ip != nil || detalles != "{}" {
		t.Fatalf("desasociacion incompleta: accion=%q ip=%v detalles=%s", accion, ip, detalles)
	}

	// Ya desasociada, tampoco se le puede volver a poner una IP.
	if _, err := pool.Exec(ctx, `UPDATE audit_logs SET ip_address = '10.0.0.1' WHERE user_id = $1::uuid`, userID); !esRechazoDelRegistro(err) {
		t.Fatalf("se esperaba el rechazo del registro, salio %v", err)
	}
}
