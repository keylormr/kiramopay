package adminusers_test

import (
	"context"
	"errors"
	"net/http"
	"testing"
	"time"

	"github.com/kiramopay/backend/internal/adminusers"
	"github.com/kiramopay/backend/internal/audit"
	"github.com/kiramopay/backend/internal/auth"
	"github.com/kiramopay/backend/internal/testutil"
	"github.com/kiramopay/backend/internal/user"
	"github.com/kiramopay/backend/pkg/hash"
)

// disconnectorFalso registra a quien se le corto el socket. El hub real hace lo
// mismo contra conexiones vivas; aqui solo interesa QUE se llame y con quien.
type disconnectorFalso struct{ cortados []string }

func (d *disconnectorFalso) DisconnectUser(userID string) int {
	d.cortados = append(d.cortados, userID)
	return 1
}

// expiresAt lee la columna cruda: la ficha administrativa la expone, pero
// varias pruebas necesitan verla en cuentas que no pasan por el servicio.
func (f *fixture) expiresAt(t *testing.T, userID string) *time.Time {
	t.Helper()
	var at *time.Time
	if err := f.pool.QueryRow(context.Background(),
		`SELECT expires_at FROM users WHERE id = $1::uuid`, userID).Scan(&at); err != nil {
		t.Fatalf("leer expires_at: %v", err)
	}
	return at
}

func (f *fixture) status(t *testing.T, userID string) string {
	t.Helper()
	var s string
	if err := f.pool.QueryRow(context.Background(),
		`SELECT status FROM users WHERE id = $1::uuid`, userID).Scan(&s); err != nil {
		t.Fatalf("leer status: %v", err)
	}
	return s
}

func TestSetExpiry_ProgramaYQuita(t *testing.T) {
	f := setup(t, nil)
	ctx := context.Background()
	cuando := time.Now().Add(48 * time.Hour).Truncate(time.Second)

	v, err := f.svc.SetExpiry(ctx, f.userID, f.adminID, &cuando, actor)
	if err != nil {
		t.Fatalf("SetExpiry() error: %v", err)
	}
	if v.ExpiresAt == nil || !v.ExpiresAt.Equal(cuando) {
		t.Fatalf("la ficha no refleja el vencimiento: %v, esperaba %v", v.ExpiresAt, cuando)
	}
	// Programar no bloquea: la fecha todavia no llego.
	if v.Status != "active" {
		t.Fatalf("programar un vencimiento futuro no debia bloquear: status=%s", v.Status)
	}

	v, err = f.svc.SetExpiry(ctx, f.userID, f.adminID, nil, actor)
	if err != nil {
		t.Fatalf("SetExpiry(nil) error: %v", err)
	}
	if v.ExpiresAt != nil {
		t.Fatalf("el vencimiento no se quito: %v", v.ExpiresAt)
	}
}

func TestSetExpiry_RechazaAdminYCuentaInexistente(t *testing.T) {
	f := setup(t, nil)
	ctx := context.Background()
	cuando := time.Now().Add(time.Hour)

	if _, err := f.svc.SetExpiry(ctx, f.adminID, f.adminID, &cuando, actor); !errors.Is(err, adminusers.ErrAdminTarget) {
		t.Fatalf("SetExpiry(admin) = %v, esperaba ErrAdminTarget", err)
	}
	if _, err := f.svc.SetExpiry(ctx, sinCuentaID, f.adminID, &cuando, actor); !errors.Is(err, adminusers.ErrNotFound) {
		t.Fatalf("SetExpiry(inexistente) = %v, esperaba ErrNotFound", err)
	}
	if at := f.expiresAt(t, f.adminID); at != nil {
		t.Fatalf("la cuenta de administrador quedo con vencimiento: %v", at)
	}
}

func TestExpireDue_BloqueaSoloLasVencidas(t *testing.T) {
	f := setup(t, nil)
	ctx := context.Background()
	corte := &disconnectorFalso{}
	f.svc.SetDisconnector(corte)

	pasado := time.Now().Add(-time.Minute)
	futuro := time.Now().Add(24 * time.Hour)

	// Vencida: se bloquea. keilorID no vence: no se toca.
	if _, err := f.svc.SetExpiry(ctx, f.userID, f.adminID, &pasado, actor); err != nil {
		t.Fatalf("SetExpiry(vencida) error: %v", err)
	}
	if _, err := f.svc.SetExpiry(ctx, keilorID, f.adminID, &futuro, actor); err != nil {
		t.Fatalf("SetExpiry(futura) error: %v", err)
	}
	// Un administrador con la fecha cumplida NO se bloquea, ni siquiera si
	// alguien se la puso por fuera del servicio.
	if _, err := f.userRepo.SetExpiresAt(ctx, f.adminID, &pasado); err != nil {
		t.Fatalf("SetExpiresAt(admin) error: %v", err)
	}

	n, err := f.svc.ExpireDue(ctx, time.Now(), 100)
	if err != nil {
		t.Fatalf("ExpireDue() error: %v", err)
	}
	if n != 1 {
		t.Fatalf("ExpireDue bloqueo %d cuentas, esperaba 1", n)
	}

	if got := f.status(t, f.userID); got != "blocked" {
		t.Fatalf("la cuenta vencida quedo en %s", got)
	}
	if got := f.status(t, keilorID); got != "active" {
		t.Fatalf("la cuenta con vencimiento futuro se bloqueo: %s", got)
	}
	if got := f.status(t, f.adminID); got != "active" {
		t.Fatalf("se bloqueo una cuenta de administrador: %s", got)
	}

	v, err := f.svc.Get(ctx, f.userID)
	if err != nil {
		t.Fatalf("Get() error: %v", err)
	}
	if v.BlockedReason != adminusers.ReasonDemoExpired {
		t.Fatalf("motivo = %q, esperaba %q", v.BlockedReason, adminusers.ReasonDemoExpired)
	}
	// Sin autor: el barrido no es una persona, y blocked_by queda NULL.
	if v.BlockedByName != "" {
		t.Fatalf("blocked_by_name = %q, esperaba vacio (bloqueo automatico)", v.BlockedByName)
	}
	if v.BlockedAt == nil {
		t.Fatalf("blocked_at quedo nulo pese al bloqueo")
	}

	// La marca de Redis es lo que hace que el middleware responda
	// ACCOUNT_BLOCKED: sin ella el bloqueo seria invisible hasta el reinicio.
	if isBlocked, err := f.authRepo.IsUserBlocked(ctx, f.userID); err != nil || !isBlocked {
		t.Fatalf("la marca en Redis no quedo puesta: blocked=%v err=%v", isBlocked, err)
	}
	if len(corte.cortados) != 1 || corte.cortados[0] != f.userID {
		t.Fatalf("no se corto el socket de la cuenta vencida: %v", corte.cortados)
	}
}

func TestExpireDue_NoRepiteSobreLoYaBloqueado(t *testing.T) {
	pool := testutil.TestDB(t)
	logger := audit.NewLogger(audit.NewRepository(pool), 10)
	rdb := testutil.TestRedis(t)
	authRepo := auth.NewRepository(pool, rdb)
	userRepo := user.NewRepository(pool)
	pinHash, _ := hash.HashPin("Kiramopay2024!")
	userID := testutil.SeedTestUser(t, pool, "702650930", pinHash)
	adminID := testutil.SeedTestUser2(t, pool)
	svc := adminusers.NewService(userRepo, authRepo, &adminusers.Options{AuditLogger: logger})
	ctx := context.Background()

	pasado := time.Now().Add(-time.Minute)
	if _, err := svc.SetExpiry(ctx, userID, adminID, &pasado, actor); err != nil {
		t.Fatalf("SetExpiry() error: %v", err)
	}

	primera, err := svc.ExpireDue(ctx, time.Now(), 100)
	if err != nil || primera != 1 {
		t.Fatalf("primera pasada: n=%d err=%v", primera, err)
	}
	var antes time.Time
	if err := pool.QueryRow(ctx, `SELECT blocked_at FROM users WHERE id = $1::uuid`, userID).Scan(&antes); err != nil {
		t.Fatalf("leer blocked_at: %v", err)
	}

	// El filtro excluye a las bloqueadas: un segundo tick no las vuelve a tocar
	// ni repisa su rastro. Sin eso, cada minuto duplicaria un evento critico.
	segunda, err := svc.ExpireDue(ctx, time.Now(), 100)
	if err != nil || segunda != 0 {
		t.Fatalf("segunda pasada: n=%d err=%v, esperaba 0", segunda, err)
	}
	var despues time.Time
	if err := pool.QueryRow(ctx, `SELECT blocked_at FROM users WHERE id = $1::uuid`, userID).Scan(&despues); err != nil {
		t.Fatalf("leer blocked_at: %v", err)
	}
	if !antes.Equal(despues) {
		t.Fatalf("el segundo tick repiso blocked_at: %v -> %v", antes, despues)
	}

	logger.Stop() // vacia el buffer a la tabla

	var n int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM audit_logs
		  WHERE resource_id = $1 AND action = 'user_blocked' AND (details->>'automatic')::boolean IS TRUE`,
		userID,
	).Scan(&n); err != nil {
		t.Fatalf("leer auditoria: %v", err)
	}
	if n != 1 {
		t.Fatalf("eventos user_blocked automaticos = %d, esperaba exactamente 1", n)
	}

	// El bloqueo automatico no tiene actor: user_id queda NULL, no vacio.
	var actorNulo bool
	if err := pool.QueryRow(ctx,
		`SELECT user_id IS NULL FROM audit_logs
		  WHERE resource_id = $1 AND action = 'user_blocked'`, userID,
	).Scan(&actorNulo); err != nil {
		t.Fatalf("leer actor de la auditoria: %v", err)
	}
	if !actorNulo {
		t.Fatalf("el bloqueo automatico quedo con un actor humano en la auditoria")
	}
}

func TestUnblock_LimpiaElVencimientoCumplidoYConservaElFuturo(t *testing.T) {
	f := setup(t, nil)
	ctx := context.Background()

	// Cumplido: desbloquear a mano debe ganarle al barrido. Si el vencimiento
	// sobreviviera, el siguiente tick volveria a cerrar la cuenta.
	pasado := time.Now().Add(-time.Minute)
	if _, err := f.svc.SetExpiry(ctx, f.userID, f.adminID, &pasado, actor); err != nil {
		t.Fatalf("SetExpiry(pasado) error: %v", err)
	}
	if _, err := f.svc.ExpireDue(ctx, time.Now(), 100); err != nil {
		t.Fatalf("ExpireDue() error: %v", err)
	}
	v, err := f.svc.Unblock(ctx, f.userID, f.adminID, actor)
	if err != nil {
		t.Fatalf("Unblock() error: %v", err)
	}
	if v.ExpiresAt != nil {
		t.Fatalf("el desbloqueo dejo vivo un vencimiento ya cumplido: %v", v.ExpiresAt)
	}
	n, err := f.svc.ExpireDue(ctx, time.Now(), 100)
	if err != nil || n != 0 {
		t.Fatalf("el barrido volvio a cerrar una cuenta desbloqueada a mano: n=%d err=%v", n, err)
	}

	// Futuro: el desbloqueo resuelve otra cosa y la demo conserva su fecha.
	futuro := time.Now().Add(72 * time.Hour).Truncate(time.Second)
	if _, err := f.svc.SetExpiry(ctx, keilorID, f.adminID, &futuro, actor); err != nil {
		t.Fatalf("SetExpiry(futuro) error: %v", err)
	}
	if _, err := f.svc.Block(ctx, keilorID, f.adminID, "revision manual", actor); err != nil {
		t.Fatalf("Block() error: %v", err)
	}
	v, err = f.svc.Unblock(ctx, keilorID, f.adminID, actor)
	if err != nil {
		t.Fatalf("Unblock() error: %v", err)
	}
	if v.ExpiresAt == nil || !v.ExpiresAt.Equal(futuro) {
		t.Fatalf("el desbloqueo borro un vencimiento futuro: %v, esperaba %v", v.ExpiresAt, futuro)
	}
}

func TestBlock_CortaLosSocketsAbiertos(t *testing.T) {
	f := setup(t, nil)
	ctx := context.Background()
	corte := &disconnectorFalso{}
	f.svc.SetDisconnector(corte)

	if _, err := f.svc.Block(ctx, f.userID, f.adminID, "acceso revocado", actor); err != nil {
		t.Fatalf("Block() error: %v", err)
	}
	if len(corte.cortados) != 1 || corte.cortados[0] != f.userID {
		t.Fatalf("el bloqueo manual no corto el socket: %v", corte.cortados)
	}

	// Desbloquear no reconecta nada: la persona vuelve a entrar y abre otro.
	if _, err := f.svc.Unblock(ctx, f.userID, f.adminID, actor); err != nil {
		t.Fatalf("Unblock() error: %v", err)
	}
	if len(corte.cortados) != 1 {
		t.Fatalf("el desbloqueo toco los sockets: %v", corte.cortados)
	}
}

// El barrido lee un lote y despues bloquea fila por fila. Si en esa ventana un
// administrador bloquea la cuenta a mano por otro motivo, el barrido NO debe
// llegar tarde y pisar el motivo ni el autor humano: eso borraria de la ficha
// por que esta bloqueada la cuenta.
func TestExpireDue_NoPisaUnBloqueoManual(t *testing.T) {
	f := setup(t, nil)
	ctx := context.Background()
	pasado := time.Now().Add(-time.Minute)

	if _, err := f.svc.SetExpiry(ctx, f.userID, f.adminID, &pasado, actor); err != nil {
		t.Fatalf("SetExpiry() error: %v", err)
	}
	if _, err := f.svc.Block(ctx, f.userID, f.adminID, "sospecha de fraude", actor); err != nil {
		t.Fatalf("Block() error: %v", err)
	}

	n, err := f.svc.ExpireDue(ctx, time.Now(), 100)
	if err != nil {
		t.Fatalf("ExpireDue() error: %v", err)
	}
	if n != 0 {
		t.Fatalf("el barrido bloqueo %d cuentas ya bloqueadas a mano, esperaba 0", n)
	}

	v, err := f.svc.Get(ctx, f.userID)
	if err != nil {
		t.Fatalf("Get() error: %v", err)
	}
	if v.BlockedReason != "sospecha de fraude" {
		t.Fatalf("el barrido piso el motivo humano: %q", v.BlockedReason)
	}
	if v.BlockedByName != "Admin User" {
		t.Fatalf("el barrido borro al autor del bloqueo: %q", v.BlockedByName)
	}
}

// Aunque el id ya venga en el lote, el bloqueo automatico reconfirma en su
// propio UPDATE la razon por la que entro. Estas son las tres formas de que esa
// razon deje de valer entre la lectura y el bloqueo.
func TestBlockExpiredUser_ReconfirmaLaCondicion(t *testing.T) {
	f := setup(t, nil)
	ctx := context.Background()
	ahora := time.Now()
	futuro := ahora.Add(24 * time.Hour)

	// (a) El administrador extendio el vencimiento: la fecha ya no paso.
	if _, err := f.userRepo.SetExpiresAt(ctx, f.userID, &futuro); err != nil {
		t.Fatalf("SetExpiresAt(futuro) error: %v", err)
	}
	found, _, err := f.authRepo.BlockExpiredUserAndRevokeSessions(ctx, f.userID, adminusers.ReasonDemoExpired, ahora)
	if err != nil {
		t.Fatalf("BlockExpiredUser(futuro) error: %v", err)
	}
	if found {
		t.Fatal("bloqueo una cuenta cuyo vencimiento se habia extendido")
	}

	// (b) El administrador quito el vencimiento.
	if _, err := f.userRepo.SetExpiresAt(ctx, f.userID, nil); err != nil {
		t.Fatalf("SetExpiresAt(nil) error: %v", err)
	}
	found, _, err = f.authRepo.BlockExpiredUserAndRevokeSessions(ctx, f.userID, adminusers.ReasonDemoExpired, ahora)
	if err != nil {
		t.Fatalf("BlockExpiredUser(sin fecha) error: %v", err)
	}
	if found {
		t.Fatal("bloqueo una cuenta sin vencimiento")
	}

	// (c) La cuenta es de administrador, aunque tenga la fecha cumplida.
	pasado := ahora.Add(-time.Minute)
	if _, err := f.userRepo.SetExpiresAt(ctx, f.adminID, &pasado); err != nil {
		t.Fatalf("SetExpiresAt(admin) error: %v", err)
	}
	found, _, err = f.authRepo.BlockExpiredUserAndRevokeSessions(ctx, f.adminID, adminusers.ReasonDemoExpired, ahora)
	if err != nil {
		t.Fatalf("BlockExpiredUser(admin) error: %v", err)
	}
	if found {
		t.Fatal("bloqueo una cuenta de administrador")
	}
	if got := f.status(t, f.adminID); got != "active" {
		t.Fatalf("la cuenta de administrador quedo en %s", got)
	}

	// Y con la condicion intacta si bloquea.
	if _, err := f.userRepo.SetExpiresAt(ctx, f.userID, &pasado); err != nil {
		t.Fatalf("SetExpiresAt(pasado) error: %v", err)
	}
	found, _, err = f.authRepo.BlockExpiredUserAndRevokeSessions(ctx, f.userID, adminusers.ReasonDemoExpired, ahora)
	if err != nil || !found {
		t.Fatalf("BlockExpiredUser(vencida): found=%v err=%v", found, err)
	}
	if got := f.status(t, f.userID); got != "blocked" {
		t.Fatalf("la cuenta vencida quedo en %s", got)
	}
}

// Si la marca de Redis se pierde (fallo transitorio al bloquear, FLUSHDB,
// eviccion), la cuenta sigue bloqueada en BD pero el middleware responde
// SESSION_REVOKED en vez de ACCOUNT_BLOCKED. El barrido la repone sin esperar
// un reinicio del proceso.
func TestReconcileBlockedMarks_ReponeLaMarcaPerdida(t *testing.T) {
	f := setup(t, nil)
	ctx := context.Background()

	if _, err := f.svc.Block(ctx, f.userID, f.adminID, "acceso revocado", actor); err != nil {
		t.Fatalf("Block() error: %v", err)
	}
	if err := f.authRepo.ClearUserBlocked(ctx, f.userID); err != nil {
		t.Fatalf("ClearUserBlocked() error: %v", err)
	}
	if isBlocked, err := f.authRepo.IsUserBlocked(ctx, f.userID); err != nil || isBlocked {
		t.Fatalf("la marca debia estar ausente para la prueba: blocked=%v err=%v", isBlocked, err)
	}

	puestas, _, err := f.svc.ReconcileBlockedMarks(ctx)
	if err != nil {
		t.Fatalf("ReconcileBlockedMarks() error: %v", err)
	}
	if puestas < 1 {
		t.Fatalf("el repaso repuso %d marcas, esperaba al menos 1", puestas)
	}
	if isBlocked, err := f.authRepo.IsUserBlocked(ctx, f.userID); err != nil || !isBlocked {
		t.Fatalf("la marca no se repuso: blocked=%v err=%v", isBlocked, err)
	}
}

// La otra direccion, que es la que hace seguro repetir el repaso: desbloquear
// quita la marca ANTES de comprometer el UPDATE, asi que un repaso que caiga en
// esa ventana repone una marca sobre una cuenta que queda activa. Si el repaso
// solo supiera poner marcas, esa quedaria para siempre: la ficha diria "activa"
// y la persona recibiria ACCOUNT_BLOCKED en todo, sin explicacion.
func TestReconcileBlockedMarks_QuitaLaMarcaQueSobra(t *testing.T) {
	f := setup(t, nil)
	ctx := context.Background()

	// Cuenta activa con una marca huerfana, como la dejaria esa carrera.
	if err := f.authRepo.MarkUserBlocked(ctx, f.userID); err != nil {
		t.Fatalf("MarkUserBlocked() error: %v", err)
	}
	if got := f.status(t, f.userID); got != "active" {
		t.Fatalf("la cuenta debia seguir activa para la prueba: %s", got)
	}

	_, quitadas, err := f.svc.ReconcileBlockedMarks(ctx)
	if err != nil {
		t.Fatalf("ReconcileBlockedMarks() error: %v", err)
	}
	if quitadas < 1 {
		t.Fatalf("el repaso quito %d marcas, esperaba al menos 1", quitadas)
	}
	if isBlocked, err := f.authRepo.IsUserBlocked(ctx, f.userID); err != nil || isBlocked {
		t.Fatalf("la marca huerfana sobrevivio: blocked=%v err=%v", isBlocked, err)
	}
}

func TestHandler_Expiry(t *testing.T) {
	f := setup(t, nil)
	router := newRouter(adminusers.NewHandler(f.svc), f.userRepo, f.adminID)
	ruta := "/admin/users/" + keilorID + "/expiry"

	// La clave debe venir siempre: un cuerpo vacio no es "quitar el vencimiento".
	if status, env := do(t, router, http.MethodPost, ruta, `{}`); status != http.StatusBadRequest || errorCode(env) != "EXPIRY_REQUIRED" {
		t.Fatalf("cuerpo vacio: %d %s, esperaba 400 EXPIRY_REQUIRED", status, errorCode(env))
	}
	if status, env := do(t, router, http.MethodPost, ruta, `{"expires_at":"manana"}`); status != http.StatusBadRequest || errorCode(env) != "INVALID_EXPIRY" {
		t.Fatalf("fecha invalida: %d %s, esperaba 400 INVALID_EXPIRY", status, errorCode(env))
	}
	if status, env := do(t, router, http.MethodPost, ruta, `{"expires_at":123}`); status != http.StatusBadRequest || errorCode(env) != "INVALID_EXPIRY" {
		t.Fatalf("tipo invalido: %d %s, esperaba 400 INVALID_EXPIRY", status, errorCode(env))
	}

	cuando := time.Now().Add(24 * time.Hour).UTC().Truncate(time.Second)
	if status, _ := do(t, router, http.MethodPost, ruta, `{"expires_at":"`+cuando.Format(time.RFC3339)+`"}`); status != http.StatusOK {
		t.Fatalf("programar vencimiento: %d, esperaba 200", status)
	}
	at := f.expiresAt(t, keilorID)
	if at == nil || !at.Equal(cuando) {
		t.Fatalf("expires_at = %v, esperaba %v", at, cuando)
	}

	if status, _ := do(t, router, http.MethodPost, ruta, `{"expires_at":null}`); status != http.StatusOK {
		t.Fatalf("quitar vencimiento: %d, esperaba 200", status)
	}
	if at := f.expiresAt(t, keilorID); at != nil {
		t.Fatalf("expires_at = %v, esperaba nulo", at)
	}

	// Un administrador no se programa para vencer, ni por la ruta.
	status, env := do(t, router, http.MethodPost, "/admin/users/"+f.adminID+"/expiry",
		`{"expires_at":"`+cuando.Format(time.RFC3339)+`"}`)
	if status != http.StatusBadRequest || errorCode(env) != "CANNOT_EXPIRE_ADMIN" {
		t.Fatalf("admin: %d %s, esperaba 400 CANNOT_EXPIRE_ADMIN", status, errorCode(env))
	}

	status, env = do(t, router, http.MethodPost, "/admin/users/"+sinCuentaID+"/expiry",
		`{"expires_at":"`+cuando.Format(time.RFC3339)+`"}`)
	if status != http.StatusNotFound || errorCode(env) != "USER_NOT_FOUND" {
		t.Fatalf("cuenta inexistente: %d %s, esperaba 404 USER_NOT_FOUND", status, errorCode(env))
	}
}
