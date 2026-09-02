package user_test

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/kiramopay/backend/internal/testutil"
	"github.com/kiramopay/backend/internal/user"
)

func nuevoUsuario(cedula, phone string) *user.UserRecord {
	return &user.UserRecord{
		ID:           uuid.New().String(),
		Cedula:       cedula,
		Phone:        phone,
		FirstName:    "Prueba",
		LastName:     "Referidos",
		PasswordHash: "dummy_hash",
		Status:       "active",
	}
}

func TestCreate_GeneraCodigoDeReferido(t *testing.T) {
	pool := testutil.TestDB(t)
	repo := user.NewRepository(pool)
	ctx := context.Background()

	u := nuevoUsuario("702650930", "+50688881234")
	if err := repo.Create(ctx, u); err != nil {
		t.Fatalf("Create: %v", err)
	}
	if len(u.ReferralCode) != 8 || !user.IsValidReferralCodeFormat(u.ReferralCode) {
		t.Fatalf("codigo generado invalido: %q", u.ReferralCode)
	}

	leido, err := repo.FindByID(ctx, u.ID)
	if err != nil {
		t.Fatalf("FindByID: %v", err)
	}
	if leido.ReferralCode != u.ReferralCode {
		t.Fatalf("FindByID devolvio codigo %q, se esperaba %q", leido.ReferralCode, u.ReferralCode)
	}
	if leido.ReferredBy != nil {
		t.Fatalf("ReferredBy debe quedar nil (no se lee del select): %v", *leido.ReferredBy)
	}
}

func TestCreate_RespetaCodigoDado(t *testing.T) {
	pool := testutil.TestDB(t)
	repo := user.NewRepository(pool)
	ctx := context.Background()

	u := nuevoUsuario("702650930", "+50688881234")
	u.ReferralCode = "K7PM3XQ2"
	if err := repo.Create(ctx, u); err != nil {
		t.Fatalf("Create: %v", err)
	}
	if u.ReferralCode != "K7PM3XQ2" {
		t.Fatalf("Create reemplazo el codigo dado: %q", u.ReferralCode)
	}

	// Un codigo dado que colisiona NO se regenera en silencio: es un error.
	otro := nuevoUsuario("700000000", "+50688885678")
	otro.ReferralCode = "K7PM3XQ2"
	if err := repo.Create(ctx, otro); err == nil {
		t.Fatal("se esperaba error por codigo duplicado dado por el llamador")
	}
}

func TestCreate_DuplicadoDeCedulaNoSeReintenta(t *testing.T) {
	pool := testutil.TestDB(t)
	repo := user.NewRepository(pool)
	ctx := context.Background()

	if err := repo.Create(ctx, nuevoUsuario("702650930", "+50688881234")); err != nil {
		t.Fatalf("primer Create: %v", err)
	}
	if err := repo.Create(ctx, nuevoUsuario("702650930", "+50688885678")); err == nil {
		t.Fatal("se esperaba error por cedula duplicada")
	}
}

func TestFindByReferralCode_YCountReferrals(t *testing.T) {
	pool := testutil.TestDB(t)
	repo := user.NewRepository(pool)
	ctx := context.Background()

	a := nuevoUsuario("702650930", "+50688881234")
	if err := repo.Create(ctx, a); err != nil {
		t.Fatalf("Create A: %v", err)
	}

	referidor, err := repo.FindByReferralCode(ctx, a.ReferralCode)
	if err != nil {
		t.Fatalf("FindByReferralCode: %v", err)
	}
	if referidor.ID != a.ID {
		t.Fatalf("FindByReferralCode devolvio %s, se esperaba %s", referidor.ID, a.ID)
	}
	if _, err := repo.FindByReferralCode(ctx, "ZZZZZZZZ"); err == nil {
		t.Fatal("un codigo inexistente debe dar error")
	}

	// B se registra con el codigo de A.
	b := nuevoUsuario("700000000", "+50688885678")
	b.ReferredBy = &a.ID
	if err := repo.Create(ctx, b); err != nil {
		t.Fatalf("Create B: %v", err)
	}
	n, err := repo.CountReferrals(ctx, a.ID)
	if err != nil {
		t.Fatalf("CountReferrals: %v", err)
	}
	if n != 1 {
		t.Fatalf("CountReferrals(A) = %d, se esperaba 1", n)
	}
	if n, _ := repo.CountReferrals(ctx, b.ID); n != 0 {
		t.Fatalf("CountReferrals(B) = %d, se esperaba 0", n)
	}

	// Cuenta suspendida: su codigo se trata como inexistente.
	if _, err := pool.Exec(ctx, `UPDATE users SET status = 'suspended' WHERE id = $1`, a.ID); err != nil {
		t.Fatalf("suspender A: %v", err)
	}
	if _, err := repo.FindByReferralCode(ctx, a.ReferralCode); err == nil {
		t.Fatal("el codigo de una cuenta suspendida no debe resolverse")
	}

	// Cuenta borrada (soft delete): tampoco resuelve y deja de contar como invitado.
	if _, err := pool.Exec(ctx, `UPDATE users SET status = 'active', deleted_at = NOW() WHERE id = $1`, a.ID); err != nil {
		t.Fatalf("borrar A: %v", err)
	}
	if _, err := repo.FindByReferralCode(ctx, a.ReferralCode); err == nil {
		t.Fatal("el codigo de una cuenta borrada no debe resolverse")
	}
	if _, err := pool.Exec(ctx, `UPDATE users SET deleted_at = NOW() WHERE id = $1`, b.ID); err != nil {
		t.Fatalf("borrar B: %v", err)
	}
	if n, _ := repo.CountReferrals(ctx, a.ID); n != 0 {
		t.Fatalf("CountReferrals(A) tras borrar B = %d, se esperaba 0", n)
	}
}

// Tercera capa contra el auto-referido: el CHECK de la tabla.
func TestCreate_AutoReferidoRechazadoPorLaBD(t *testing.T) {
	pool := testutil.TestDB(t)
	repo := user.NewRepository(pool)

	u := nuevoUsuario("702650930", "+50688881234")
	u.ReferredBy = &u.ID
	if err := repo.Create(context.Background(), u); err == nil {
		t.Fatal("chk_users_not_self_referred debia rechazar el insert")
	}
}
