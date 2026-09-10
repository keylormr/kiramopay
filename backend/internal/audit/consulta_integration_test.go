package audit_test

import (
	"context"
	"testing"
	"time"

	"github.com/kiramopay/backend/internal/audit"
	"github.com/kiramopay/backend/internal/testutil"
)

// El rastro de auditoria se escribia desde el arranque del proyecto y NO existia
// una sola ruta para consultarlo. Un rastro que nadie puede leer no es un
// rastro: para SUGEF 13-19 es como no tenerlo.

func sembrar(t *testing.T, repo *audit.Repository, userID, accion, riesgo string) {
	t.Helper()
	if err := repo.Insert(context.Background(), &audit.Event{
		UserID:       userID,
		Action:       accion,
		ResourceType: "session",
		IPAddress:    "10.0.0.1",
		RiskLevel:    riesgo,
		Details:      map[string]interface{}{"success": true},
	}); err != nil {
		t.Fatalf("sembrar evento: %v", err)
	}
}

func TestElRastroSePuedeLeerYFiltrar(t *testing.T) {
	pool := testutil.TestDB(t)
	ctx := context.Background()
	repo := audit.NewRepository(pool)
	userID := testutil.SeedTestUser(t, pool, "702650930", "dummy")
	otro := testutil.SeedTestUser2(t, pool)

	sembrar(t, repo, userID, "login_success", "low")
	sembrar(t, repo, userID, "login_failed", "medium")
	sembrar(t, repo, otro, "login_success", "low")

	todos, err := repo.Listar(ctx, audit.Filtro{})
	if err != nil {
		t.Fatalf("Listar: %v", err)
	}
	if len(todos) != 3 {
		t.Fatalf("eventos = %d, se esperaba 3", len(todos))
	}
	// Del mas reciente al mas viejo.
	for i := 1; i < len(todos); i++ {
		if todos[i-1].CreatedAt.Before(todos[i].CreatedAt) {
			t.Fatal("el rastro no viene del mas reciente al mas viejo")
		}
	}

	porUsuario, err := repo.Listar(ctx, audit.Filtro{UserID: userID})
	if err != nil {
		t.Fatalf("Listar por usuario: %v", err)
	}
	if len(porUsuario) != 2 {
		t.Fatalf("eventos del usuario = %d, se esperaba 2", len(porUsuario))
	}

	porAccion, err := repo.Listar(ctx, audit.Filtro{Action: "login_failed"})
	if err != nil {
		t.Fatalf("Listar por accion: %v", err)
	}
	if len(porAccion) != 1 || porAccion[0].Action != "login_failed" {
		t.Fatalf("filtro por accion devolvio %+v", porAccion)
	}

	porRiesgo, err := repo.Listar(ctx, audit.Filtro{RiskLevel: "medium"})
	if err != nil {
		t.Fatalf("Listar por riesgo: %v", err)
	}
	if len(porRiesgo) != 1 {
		t.Fatalf("eventos de riesgo medio = %d, se esperaba 1", len(porRiesgo))
	}

	// Los detalles vuelven decodificados, no como texto crudo.
	if porAccion[0].Details["success"] != true {
		t.Fatalf("los detalles no se decodificaron: %+v", porAccion[0].Details)
	}
}

// Una consulta sin acotar sobre una tabla que crece con cada movimiento es una
// forma comoda de tumbar la base: el limite tiene tope duro.
func TestElLimiteTieneTopeDuro(t *testing.T) {
	pool := testutil.TestDB(t)
	ctx := context.Background()
	repo := audit.NewRepository(pool)
	userID := testutil.SeedTestUser(t, pool, "702650930", "dummy")

	for i := 0; i < 5; i++ {
		sembrar(t, repo, userID, "login_success", "low")
	}

	// Un limite absurdo cae al valor por defecto, no al pedido.
	res, err := repo.Listar(ctx, audit.Filtro{Limite: 100000})
	if err != nil {
		t.Fatalf("Listar: %v", err)
	}
	if len(res) != 5 {
		t.Fatalf("eventos = %d, se esperaba 5", len(res))
	}

	dePagina, err := repo.Listar(ctx, audit.Filtro{Limite: 2})
	if err != nil {
		t.Fatalf("Listar con limite: %v", err)
	}
	if len(dePagina) != 2 {
		t.Fatalf("eventos = %d, se esperaba 2", len(dePagina))
	}
}

// Un rango de fechas acota de verdad.
func TestElRangoDeFechasAcota(t *testing.T) {
	pool := testutil.TestDB(t)
	ctx := context.Background()
	repo := audit.NewRepository(pool)
	userID := testutil.SeedTestUser(t, pool, "702650930", "dummy")

	sembrar(t, repo, userID, "login_success", "low")

	manana := time.Now().Add(24 * time.Hour)
	vacio, err := repo.Listar(ctx, audit.Filtro{Desde: &manana})
	if err != nil {
		t.Fatalf("Listar: %v", err)
	}
	if len(vacio) != 0 {
		t.Fatalf("eventos desde manana = %d, se esperaba 0", len(vacio))
	}

	ayer := time.Now().Add(-24 * time.Hour)
	hay, err := repo.Listar(ctx, audit.Filtro{Desde: &ayer})
	if err != nil {
		t.Fatalf("Listar: %v", err)
	}
	if len(hay) != 1 {
		t.Fatalf("eventos desde ayer = %d, se esperaba 1", len(hay))
	}
}

// Los eventos que no entran al buffer se CUENTAN. Antes desaparecian con un
// Warn: el rastro perdia filas y nadie podia enterarse.
func TestLosEventosDescartadosSeCuentan(t *testing.T) {
	pool := testutil.TestDB(t)
	repo := audit.NewRepository(pool)
	// Buffer de cero: todo evento se descarta.
	logger := audit.NewLogger(repo, 0)
	defer logger.Stop()

	if logger.Descartados() != 0 {
		t.Fatalf("descartados iniciales = %d, se esperaba 0", logger.Descartados())
	}
	for i := 0; i < 3; i++ {
		logger.Log(audit.Event{Action: "prueba", RiskLevel: "low"})
	}
	if n := logger.Descartados(); n == 0 {
		t.Fatal("se descartaron eventos y el contador quedo en cero")
	}
}
