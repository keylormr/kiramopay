package loyalty_test

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/kiramopay/backend/internal/loyalty"
	"github.com/kiramopay/backend/internal/testutil"
)

// setupReferral levanta el servicio con el bono dado y dos usuarios: A (el
// referidor) y B (un invitado). Sin Postgres los tests se saltan (TestDB).
func setupReferral(t *testing.T, bonus int) (*loyalty.Service, *loyalty.Repository, *pgxpool.Pool, string, string) {
	t.Helper()
	pool := testutil.TestDB(t)
	repo := loyalty.NewRepository(pool)
	svc := loyalty.NewService(repo, &loyalty.Options{ReferralBonusPoints: bonus})
	a := testutil.SeedTestUser(t, pool, "702650930", "dummy_hash")
	b := testutil.SeedTestUser2(t, pool)
	return svc, repo, pool, a, b
}

// seedInvitado inserta una cuenta minima atribuida a referredBy.
func seedInvitado(t *testing.T, pool *pgxpool.Pool, id, cedula, phone, referredBy string) {
	t.Helper()
	if _, err := pool.Exec(context.Background(),
		`INSERT INTO users (id, cedula_enc, cedula_hash, phone_enc, phone_hash, first_name, last_name, password_hash, status, kyc_level, referred_by)
		 VALUES ($1, fn_pii_encrypt($2), fn_pii_hmac($2), fn_pii_encrypt($3), fn_pii_hmac($3), 'Invitado', 'Prueba', 'dummy_hash', 'active', 0, $4)`,
		id, cedula, phone, referredBy); err != nil {
		t.Fatalf("seed invitado %s: %v", id, err)
	}
}

func contarMovimientosReferido(t *testing.T, pool *pgxpool.Pool, userID string) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM loyalty_transactions WHERE user_id = $1 AND ref_type = 'referral'`, userID).Scan(&n); err != nil {
		t.Fatalf("contar movimientos: %v", err)
	}
	return n
}

func TestRewardReferral_Idempotente(t *testing.T) {
	svc, repo, pool, a, b := setupReferral(t, 500)
	ctx := context.Background()

	granted, err := svc.RewardReferral(ctx, a, b)
	if err != nil {
		t.Fatalf("primera acreditacion: %v", err)
	}
	if !granted {
		t.Fatal("la primera acreditacion debia otorgarse")
	}

	// Reintento del mismo par: no acredita doble ni deja movimiento huerfano.
	granted, err = svc.RewardReferral(ctx, a, b)
	if err != nil {
		t.Fatalf("segunda acreditacion: %v", err)
	}
	if granted {
		t.Fatal("la segunda acreditacion debia devolver false")
	}

	if n := contarMovimientosReferido(t, pool, a); n != 1 {
		t.Fatalf("movimientos de referido = %d, se esperaba 1", n)
	}
	acct, err := repo.GetOrCreateAccount(ctx, a)
	if err != nil {
		t.Fatalf("cuenta: %v", err)
	}
	if acct.AvailablePoints != 500 || acct.TotalPoints != 500 || acct.LifetimePoints != 500 {
		t.Fatalf("saldo = disponible %d / total %d / historico %d, se esperaba 500 en los tres",
			acct.AvailablePoints, acct.TotalPoints, acct.LifetimePoints)
	}
	if acct.Tier != loyalty.TierBronze {
		t.Fatalf("tier = %s, se esperaba bronze", acct.Tier)
	}

	txs, err := repo.GetTransactions(ctx, a, 10)
	if err != nil {
		t.Fatalf("movimientos: %v", err)
	}
	if len(txs) != 1 {
		t.Fatalf("len(movimientos) = %d, se esperaba 1", len(txs))
	}
	tx := txs[0]
	if tx.Type != "bonus" || tx.RefType != "referral" || tx.RefID != b || tx.Points != 500 {
		t.Fatalf("movimiento inesperado: %+v", tx)
	}
	if tx.Description != "Invitado registrado" {
		t.Fatalf("description = %q", tx.Description)
	}
}

func TestRewardReferral_AutoReferidoIgnorado(t *testing.T) {
	svc, _, pool, a, _ := setupReferral(t, 500)

	granted, err := svc.RewardReferral(context.Background(), a, a)
	if err != nil {
		t.Fatalf("auto-referido: %v", err)
	}
	if granted {
		t.Fatal("un auto-referido no debe acreditar")
	}
	if n := contarMovimientosReferido(t, pool, a); n != 0 {
		t.Fatalf("movimientos = %d, se esperaba 0", n)
	}
}

func TestRewardReferral_ProgramaApagado(t *testing.T) {
	svc, _, pool, a, b := setupReferral(t, 0)

	granted, err := svc.RewardReferral(context.Background(), a, b)
	if err != nil {
		t.Fatalf("programa apagado: %v", err)
	}
	if granted {
		t.Fatal("con REFERRAL_BONUS_POINTS=0 no debe acreditar")
	}
	if n := contarMovimientosReferido(t, pool, a); n != 0 {
		t.Fatalf("movimientos = %d, se esperaba 0", n)
	}
}

func TestRewardReferral_IdsVacios(t *testing.T) {
	svc, _, _, a, _ := setupReferral(t, 500)
	ctx := context.Background()

	for _, par := range [][2]string{{"", a}, {a, ""}, {"", ""}} {
		granted, err := svc.RewardReferral(ctx, par[0], par[1])
		if err != nil || granted {
			t.Fatalf("par %q: granted=%v err=%v, se esperaba (false, nil)", par, granted, err)
		}
	}
}

func TestRewardReferral_SubeDeTier(t *testing.T) {
	svc, repo, _, a, b := setupReferral(t, loyalty.SilverThreshold)
	ctx := context.Background()

	if granted, err := svc.RewardReferral(ctx, a, b); err != nil || !granted {
		t.Fatalf("acreditacion: granted=%v err=%v", granted, err)
	}
	acct, err := repo.GetOrCreateAccount(ctx, a)
	if err != nil {
		t.Fatalf("cuenta: %v", err)
	}
	if acct.Tier != loyalty.TierSilver {
		t.Fatalf("tier = %s, se esperaba silver con %d puntos historicos", acct.Tier, acct.LifetimePoints)
	}
}

func TestReferralSummary(t *testing.T) {
	svc, _, pool, a, b := setupReferral(t, 500)
	ctx := context.Background()

	// B y C fueron traidos por A.
	if _, err := pool.Exec(ctx, `UPDATE users SET referred_by = $1 WHERE id = $2`, a, b); err != nil {
		t.Fatalf("atribuir B: %v", err)
	}
	c := "00000000-0000-0000-0000-000000000003"
	seedInvitado(t, pool, c, "703330333", "+50688883333", a)

	for _, invitado := range []string{b, c} {
		if granted, err := svc.RewardReferral(ctx, a, invitado); err != nil || !granted {
			t.Fatalf("acreditar %s: granted=%v err=%v", invitado, granted, err)
		}
	}

	var codigo string
	if err := pool.QueryRow(ctx, `SELECT referral_code FROM users WHERE id = $1`, a).Scan(&codigo); err != nil {
		t.Fatalf("leer codigo: %v", err)
	}

	s, err := svc.GetReferralSummary(ctx, a)
	if err != nil {
		t.Fatalf("resumen: %v", err)
	}
	if s.ReferralCode != codigo || len(s.ReferralCode) != 8 {
		t.Fatalf("referral_code = %q, se esperaba %q", s.ReferralCode, codigo)
	}
	if s.InvitedCount != 2 {
		t.Fatalf("invited_count = %d, se esperaba 2", s.InvitedCount)
	}
	if s.PointsEarned != 1000 {
		t.Fatalf("points_earned = %d, se esperaba 1000", s.PointsEarned)
	}
	if s.BonusPoints != 500 {
		t.Fatalf("bonus_points = %d, se esperaba 500", s.BonusPoints)
	}

	// Un invitado borrado (soft delete) deja de contar; los puntos ya pagados quedan.
	if _, err := pool.Exec(ctx, `UPDATE users SET deleted_at = NOW() WHERE id = $1`, c); err != nil {
		t.Fatalf("borrar C: %v", err)
	}
	s, err = svc.GetReferralSummary(ctx, a)
	if err != nil {
		t.Fatalf("resumen tras borrado: %v", err)
	}
	if s.InvitedCount != 1 || s.PointsEarned != 1000 {
		t.Fatalf("tras borrado: invited=%d points=%d, se esperaba 1 / 1000", s.InvitedCount, s.PointsEarned)
	}

	// El invitado B sin bono propio: su resumen es 0 / 0 con su propio codigo.
	sb, err := svc.GetReferralSummary(ctx, b)
	if err != nil {
		t.Fatalf("resumen B: %v", err)
	}
	if sb.InvitedCount != 0 || sb.PointsEarned != 0 || sb.ReferralCode == codigo {
		t.Fatalf("resumen B inesperado: %+v", sb)
	}
}

// El programa apagado sigue reportando el codigo pero promete 0 puntos, para
// que la UI calle la promesa.
func TestReferralSummary_ProgramaApagado(t *testing.T) {
	svc, _, _, a, _ := setupReferral(t, 0)

	s, err := svc.GetReferralSummary(context.Background(), a)
	if err != nil {
		t.Fatalf("resumen: %v", err)
	}
	if s.BonusPoints != 0 || len(s.ReferralCode) != 8 {
		t.Fatalf("resumen inesperado: %+v", s)
	}
}

// NewService tolera opts nil: el programa queda apagado.
func TestNewService_OptsNil(t *testing.T) {
	pool := testutil.TestDB(t)
	repo := loyalty.NewRepository(pool)
	svc := loyalty.NewService(repo, nil)
	a := testutil.SeedTestUser(t, pool, "702650930", "dummy_hash")
	b := testutil.SeedTestUser2(t, pool)

	granted, err := svc.RewardReferral(context.Background(), a, b)
	if err != nil || granted {
		t.Fatalf("con opts nil: granted=%v err=%v, se esperaba (false, nil)", granted, err)
	}
}
