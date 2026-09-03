package mfa

import (
	"context"
	"testing"
	"time"

	"github.com/kiramopay/backend/internal/audit"
	"github.com/kiramopay/backend/internal/testutil"
)

// Apagar el segundo factor es quitar un control de acceso, y quitar acceso no es
// borrar el registro: la fila se queda marcada y el evento va a la auditoria.
// Antes, DisableTOTP borraba el enrolamiento y todos los codigos, asi que no
// quedaba forma de saber que la cuenta tuvo segundo factor ni cuando lo perdio
// — justo lo que hay que poder reconstruir despues de una toma de cuenta.
func TestDisableTOTP_DejaRastroYNoBorra(t *testing.T) {
	pool := testutil.TestDB(t)
	userID := testutil.SeedTestUser(t, pool, "702650930", "x")
	logger := audit.NewLogger(audit.NewRepository(pool), 10)
	svc := NewService(pool, &Config{
		TOTPEncryptionKey: []byte("test-totp-key"),
		AuditLogger:       logger,
	})
	ctx := context.Background()

	// Enrolar y confirmar con un codigo real del secreto recien emitido.
	secret, _, err := svc.EnrollTOTP(ctx, userID, "keilor")
	if err != nil {
		t.Fatalf("EnrollTOTP: %v", err)
	}
	codigos, err := svc.ConfirmTOTP(ctx, userID, currentTOTP(t, secret))
	if err != nil {
		t.Fatalf("ConfirmTOTP: %v", err)
	}
	if len(codigos) == 0 {
		t.Fatal("ConfirmTOTP no devolvio codigos de recuperacion")
	}

	// Apagarlo con el codigo del paso SIGUIENTE: el del paso actual ya quedo
	// registrado en last_used_step al confirmar, y la guarda de repeticion lo
	// rechazaria. La tolerancia de +-1 paso lo acepta sin esperar 30 segundos.
	if err := svc.DisableTOTP(ctx, userID, totpAt(t, secret, time.Now().Add(30*time.Second))); err != nil {
		t.Fatalf("DisableTOTP: %v", err)
	}

	// La fila sigue ahi, apagada y fechada.
	var enabled bool
	var disabledAt, confirmedAt *time.Time
	var secretLen int
	if err := pool.QueryRow(ctx,
		`SELECT enabled, disabled_at, confirmed_at, length(secret_enc)
		   FROM user_totp WHERE user_id = $1::uuid`, userID,
	).Scan(&enabled, &disabledAt, &confirmedAt, &secretLen); err != nil {
		t.Fatalf("el enrolamiento se borro en vez de marcarse: %v", err)
	}
	if enabled {
		t.Fatal("la cuenta quedo con el segundo factor encendido")
	}
	if disabledAt == nil {
		t.Fatal("no quedo la fecha en que se apago")
	}
	if confirmedAt == nil {
		t.Fatal("se perdio desde cuando estuvo encendido")
	}
	// El rastro se queda; la credencial no.
	if secretLen != 0 {
		t.Fatalf("el secreto sobrevivio al apagado: %d bytes", secretLen)
	}

	// Los codigos de recuperacion tampoco se borran: se invalidan, y eso se
	// distingue de haberlos usado.
	var vivos, invalidados, usados int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FILTER (WHERE used_at IS NULL AND invalidated_at IS NULL),
		        count(*) FILTER (WHERE invalidated_at IS NOT NULL),
		        count(*) FILTER (WHERE used_at IS NOT NULL)
		   FROM totp_recovery_codes WHERE user_id = $1::uuid`, userID,
	).Scan(&vivos, &invalidados, &usados); err != nil {
		t.Fatalf("leer codigos: %v", err)
	}
	if vivos != 0 {
		t.Fatalf("quedaron %d codigos de recuperacion vivos tras apagar el MFA", vivos)
	}
	if invalidados != len(codigos) {
		t.Fatalf("codigos invalidados = %d, esperaba %d", invalidados, len(codigos))
	}
	if usados != 0 {
		t.Fatalf("%d codigos quedaron marcados como usados, pero nadie los uso", usados)
	}

	// Un codigo de recuperacion invalidado ya no sirve para entrar.
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	if ok, err := svc.consumeRecoveryCode(ctx, tx, userID, codigos[0]); err != nil || ok {
		t.Fatalf("un codigo invalidado todavia se consume: ok=%v err=%v", ok, err)
	}

	logger.Stop() // vacia el buffer a la tabla

	// Y las dos mitades del rastro en la auditoria: cuando se encendio y cuando
	// se apago. Sin la primera no se sabe desde cuando estuvo protegida.
	var encendidos, apagados int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FILTER (WHERE action = 'mfa_totp_enabled'),
		        count(*) FILTER (WHERE action = 'mfa_totp_disabled' AND risk_level = 'high')
		   FROM audit_logs WHERE resource_id = $1`, userID,
	).Scan(&encendidos, &apagados); err != nil {
		t.Fatalf("leer auditoria: %v", err)
	}
	if encendidos != 1 || apagados != 1 {
		t.Fatalf("rastro en auditoria: %d encendidos y %d apagados, esperaba 1 y 1", encendidos, apagados)
	}
}

// Regenerar el lote de codigos tampoco borra el anterior: lo retira. Pasa al
// confirmar un enrolamiento nuevo sobre una cuenta que ya tuvo codigos.
func TestReplaceRecoveryCodes_RetiraElLoteViejo(t *testing.T) {
	pool := testutil.TestDB(t)
	userID := testutil.SeedTestUser(t, pool, "702650930", "x")
	svc := NewService(pool, &Config{TOTPEncryptionKey: []byte("test-totp-key")})
	ctx := context.Background()

	primero, _, err := svc.EnrollTOTP(ctx, userID, "keilor")
	if err != nil {
		t.Fatalf("EnrollTOTP: %v", err)
	}
	viejos, err := svc.ConfirmTOTP(ctx, userID, currentTOTP(t, primero))
	if err != nil {
		t.Fatalf("ConfirmTOTP: %v", err)
	}

	if err := svc.DisableTOTP(ctx, userID, totpAt(t, primero, time.Now().Add(30*time.Second))); err != nil {
		t.Fatalf("DisableTOTP: %v", err)
	}
	segundo, _, err := svc.EnrollTOTP(ctx, userID, "keilor")
	if err != nil {
		t.Fatalf("segundo EnrollTOTP: %v", err)
	}
	nuevos, err := svc.ConfirmTOTP(ctx, userID, currentTOTP(t, segundo))
	if err != nil {
		t.Fatalf("segundo ConfirmTOTP: %v", err)
	}

	var total, vivos int
	if err := pool.QueryRow(ctx,
		`SELECT count(*), count(*) FILTER (WHERE used_at IS NULL AND invalidated_at IS NULL)
		   FROM totp_recovery_codes WHERE user_id = $1::uuid`, userID,
	).Scan(&total, &vivos); err != nil {
		t.Fatalf("leer codigos: %v", err)
	}
	if total != len(viejos)+len(nuevos) {
		t.Fatalf("codigos guardados = %d, esperaba %d: el lote viejo se borro", total, len(viejos)+len(nuevos))
	}
	if vivos != len(nuevos) {
		t.Fatalf("codigos vivos = %d, esperaba solo los %d nuevos", vivos, len(nuevos))
	}
}

// currentTOTP devuelve el codigo del paso actual del secreto dado.
func currentTOTP(t *testing.T, secret string) string {
	t.Helper()
	return totpAt(t, secret, time.Now())
}

func totpAt(t *testing.T, secretB32 string, at time.Time) string {
	t.Helper()
	secret, err := decodeTOTPSecret(secretB32)
	if err != nil {
		t.Fatalf("decodificar secreto: %v", err)
	}
	return hotp(secret, uint64(at.Unix()/totpPeriod))
}
