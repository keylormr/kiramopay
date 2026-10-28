package qrpayment_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/kiramopay/backend/internal/audit"
	"github.com/kiramopay/backend/internal/qrpayment"
	"github.com/kiramopay/backend/internal/user"
)

// Aprobar, rechazar y fijar la comision de un comercio son decisiones del
// administrador que mueven plata (un comercio aprobado puede cobrar; la
// comision se descuenta de cada cobro) y no dejaban fila en audit_logs. Solo el
// cambio de plan la dejaba. Un recorrido contra el servidor real lo encontro:
// ninguna fila para el comercio aprobado ni para el rechazado.

// filasDeAuditoria cuenta lo que quedo escrito para un comercio, por accion.
func filasDeAuditoria(t *testing.T, pool *pgxpool.Pool, merchantID, accion string) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM audit_logs WHERE action = $1 AND resource_id = $2`,
		accion, merchantID).Scan(&n); err != nil {
		t.Fatalf("contar la auditoria de %s: %v", accion, err)
	}
	return n
}

// rastroDe lee la unica fila de una accion sobre un comercio. Exigir "una" es
// parte de la prueba: dos filas por una decision tambien es un rastro falso.
func rastroDe(t *testing.T, pool *pgxpool.Pool, merchantID, accion string) (actor, tipoDeRecurso, riesgo, estado, motivo, comisionBps string) {
	t.Helper()
	if n := filasDeAuditoria(t, pool, merchantID, accion); n != 1 {
		t.Fatalf("filas de %s para el comercio %s = %d, se esperaba 1", accion, merchantID, n)
	}
	if err := pool.QueryRow(context.Background(),
		`SELECT user_id::text, resource_type, risk_level,
		        COALESCE(details->>'estado_nuevo', ''), COALESCE(details->>'motivo', ''),
		        COALESCE(details->>'comision_bps_nueva', '')
		   FROM audit_logs WHERE action = $1 AND resource_id = $2`,
		accion, merchantID).Scan(&actor, &tipoDeRecurso, &riesgo, &estado, &motivo, &comisionBps); err != nil {
		t.Fatalf("leer la auditoria de %s: %v", accion, err)
	}
	return actor, tipoDeRecurso, riesgo, estado, motivo, comisionBps
}

func TestDecisionesDelAdministrador_AprobarRechazarYComisionQuedanEnAuditoria(t *testing.T) {
	_, pool, _, owner := setupQR(t)
	ctx := context.Background()
	logger := audit.NewLogger(audit.NewRepository(pool), 10)
	svc := qrpayment.NewService(qrpayment.NewRepository(pool), nil, user.NewRepository(pool),
		&qrpayment.Options{AuditLogger: logger})
	aprobado := registrarComercio(t, svc, owner, "Soda Aprobada")
	rechazado := registrarComercio(t, svc, owner, "Soda Rechazada")

	if _, err := svc.ApproveMerchant(ctx, aprobado.ID, revisorDePrueba); err != nil {
		t.Fatalf("aprobar: %v", err)
	}
	if _, err := svc.RejectMerchant(ctx, rechazado.ID, revisorDePrueba, "documento ilegible"); err != nil {
		t.Fatalf("rechazar: %v", err)
	}
	if _, err := svc.SetCommission(ctx, aprobado.ID, revisorDePrueba, 150); err != nil {
		t.Fatalf("fijar la comision: %v", err)
	}
	// Una decision que se rechaza no cambio nada: no deja fila. El dueno no
	// aprueba su propio comercio.
	if _, err := svc.ApproveMerchant(ctx, rechazado.ID, owner); err == nil {
		t.Fatal("el dueno aprobo su propio comercio")
	}
	logger.Stop()

	actor, recurso, riesgo, estado, _, _ := rastroDe(t, pool, aprobado.ID, "admin_merchant_approved")
	if actor != revisorDePrueba || recurso != "merchant" || riesgo != "high" || estado != "verified" {
		t.Errorf("aprobacion: actor=%s recurso=%s riesgo=%s estado=%s", actor, recurso, riesgo, estado)
	}

	actor, recurso, riesgo, estado, motivo, _ := rastroDe(t, pool, rechazado.ID, "admin_merchant_rejected")
	if actor != revisorDePrueba || recurso != "merchant" || riesgo != "high" || estado != "rejected" || motivo != "documento ilegible" {
		t.Errorf("rechazo: actor=%s recurso=%s riesgo=%s estado=%s motivo=%q", actor, recurso, riesgo, estado, motivo)
	}

	actor, recurso, riesgo, _, _, bps := rastroDe(t, pool, aprobado.ID, "admin_merchant_commission_set")
	if actor != revisorDePrueba || recurso != "merchant" || riesgo != "high" || bps != "150" {
		t.Errorf("comision: actor=%s recurso=%s riesgo=%s bps=%s", actor, recurso, riesgo, bps)
	}

	// Lo rechazado por ser del dueno no dejo nada, y cada comercio tiene solo lo suyo.
	if n := filasDeAuditoria(t, pool, rechazado.ID, "admin_merchant_approved"); n != 0 {
		t.Errorf("una aprobacion rechazada dejo %d filas", n)
	}
	if n := filasDeAuditoria(t, pool, rechazado.ID, "admin_merchant_commission_set"); n != 0 {
		t.Errorf("el comercio rechazado tiene %d filas de comision que nadie fijo", n)
	}
}

// Por la ruta de administracion la fila lleva tambien desde donde se hizo.
func TestDecisionesDelAdministrador_PorLaRutaGuardanLaProcedencia(t *testing.T) {
	_, pool, _, owner := setupQR(t)
	logger := audit.NewLogger(audit.NewRepository(pool), 10)
	svc := qrpayment.NewService(qrpayment.NewRepository(pool), nil, user.NewRepository(pool),
		&qrpayment.Options{AuditLogger: logger})
	h := qrpayment.NewHandler(svc)
	pendiente := registrarComercio(t, svc, owner, "Soda Por Ruta")

	rec := httptest.NewRecorder()
	req := peticion(http.MethodPost, "/api/v1/admin/merchants/"+pendiente.ID+"/approve", `{}`, revisorDePrueba, pendiente.ID)
	req.Header.Set("User-Agent", "recorrido-de-prueba")
	h.ApproveMerchant(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("aprobar por la ruta = %d: %s", rec.Code, rec.Body.String())
	}
	logger.Stop()

	var agente string
	var hayIP bool
	if err := pool.QueryRow(context.Background(),
		`SELECT COALESCE(user_agent, ''), ip_address IS NOT NULL
		   FROM audit_logs WHERE action = 'admin_merchant_approved' AND resource_id = $1`,
		pendiente.ID).Scan(&agente, &hayIP); err != nil {
		t.Fatalf("leer la auditoria (debe haber exactamente una fila): %v", err)
	}
	if agente != "recorrido-de-prueba" || !hayIP {
		t.Errorf("procedencia: agente=%q con IP=%v", agente, hayIP)
	}
}
