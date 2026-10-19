package auth_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/kiramopay/backend/internal/auth"
)

// ─────────────────────────────────────────────────────────────────────────
//  Cuenta con la eliminacion en curso
//
//  Durante los 30 dias del plazo el login es la puerta de vuelta: con la
//  contrasena correcta responde ACCOUNT_PENDING_DELETION con la fecha del
//  cierre, y con reactivate la reactiva y emite la sesion. El ciclo completo
//  (con accountdeletion de verdad) se prueba en internal/accountdeletion; aqui
//  va el contrato HTTP con un doble.
// ─────────────────────────────────────────────────────────────────────────

type porEliminarFalso struct {
	pool        *pgxpool.Pool
	fecha       time.Time
	reactivable bool
	reactivadas int
}

func (f *porEliminarFalso) SeEliminaEl(context.Context, string) (time.Time, bool, error) {
	return f.fecha, f.reactivable, nil
}

func (f *porEliminarFalso) Reactivar(ctx context.Context, userID string) (bool, error) {
	if !f.reactivable {
		return false, nil
	}
	f.reactivadas++
	_, err := f.pool.Exec(ctx, `UPDATE users
		SET status = 'active', deletion_requested_at = NULL, deletion_due_at = NULL,
		    deletion_terms_accepted_at = NULL, deletion_channel = NULL
		WHERE id = $1::uuid`, userID)
	return err == nil, err
}

// marcarPorEliminar deja la cuenta como la deja el dia 0.
func marcarPorEliminar(t *testing.T, pool *pgxpool.Pool, userID string) {
	t.Helper()
	if _, err := pool.Exec(context.Background(), `UPDATE users
		SET status = 'pending_deletion', deletion_requested_at = NOW(),
		    deletion_due_at = NOW() + interval '30 days', deletion_terms_accepted_at = NOW(),
		    deletion_channel = 'in_app'
		WHERE id = $1::uuid`, userID); err != nil {
		t.Fatalf("marcar por eliminar: %v", err)
	}
}

type sobreConDetalle struct {
	Success bool `json:"success"`
	Error   *struct {
		Code    string `json:"code"`
		Details struct {
			SeEliminaEl time.Time `json:"deletion_due_at"`
		} `json:"details"`
	} `json:"error"`
}

func TestLoginHandler_CuentaPorEliminarResponde403ConLaFecha(t *testing.T) {
	env := armarEntornoBloqueo(t)
	resp := registerTestUser(t, env.svc)
	marcarPorEliminar(t, env.pool, resp.User.ID)
	fecha := time.Now().Add(30 * 24 * time.Hour).UTC().Truncate(time.Second)
	env.svc.SetCuentasPorEliminar(&porEliminarFalso{pool: env.pool, fecha: fecha, reactivable: true})
	h := auth.NewHandler(env.svc, auth.CookieConfig{Secure: true}, false)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login",
		strings.NewReader(`{"identifier":"702650930","password":"Kiramopay2024!"}`))
	rec := httptest.NewRecorder()
	h.Login(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, esperaba 403: %s", rec.Code, rec.Body.String())
	}
	var s sobreConDetalle
	if err := json.Unmarshal(rec.Body.Bytes(), &s); err != nil {
		t.Fatalf("cuerpo no es JSON: %s", rec.Body.String())
	}
	if s.Error == nil || s.Error.Code != "ACCOUNT_PENDING_DELETION" {
		t.Fatalf("sobre inesperado: %s", rec.Body.String())
	}
	if !s.Error.Details.SeEliminaEl.Equal(fecha) {
		t.Errorf("la fecha del detalle es %v, se esperaba %v", s.Error.Details.SeEliminaEl, fecha)
	}
	if findCookie(rec, "__Host-kp_refresh") != nil {
		t.Fatal("sin reactivar no debe haber cookie de sesion")
	}
}

// Con la contrasena equivocada la respuesta es la de siempre: el codigo propio
// solo sale tras verificar la contrasena, para no delatar que la cuenta existe.
func TestLoginHandler_CuentaPorEliminarConContrasenaMalaNoDelataNada(t *testing.T) {
	env := armarEntornoBloqueo(t)
	resp := registerTestUser(t, env.svc)
	marcarPorEliminar(t, env.pool, resp.User.ID)
	env.svc.SetCuentasPorEliminar(&porEliminarFalso{pool: env.pool, fecha: time.Now(), reactivable: true})
	h := auth.NewHandler(env.svc, auth.CookieConfig{Secure: true}, false)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login",
		strings.NewReader(`{"identifier":"702650930","password":"Otra-Clave-2024!"}`))
	rec := httptest.NewRecorder()
	h.Login(rec, req)
	if strings.Contains(rec.Body.String(), "ACCOUNT_PENDING_DELETION") {
		t.Fatalf("la contrasena equivocada no debe revelar el estado: %s", rec.Body.String())
	}
}

func TestLoginHandler_ReactivarEmiteLaSesion(t *testing.T) {
	env := armarEntornoBloqueo(t)
	resp := registerTestUser(t, env.svc)
	marcarPorEliminar(t, env.pool, resp.User.ID)
	falso := &porEliminarFalso{pool: env.pool, fecha: time.Now().Add(time.Hour), reactivable: true}
	env.svc.SetCuentasPorEliminar(falso)
	h := auth.NewHandler(env.svc, auth.CookieConfig{Secure: true}, false)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login",
		strings.NewReader(`{"identifier":"702650930","password":"Kiramopay2024!","reactivate":true}`))
	rec := httptest.NewRecorder()
	h.Login(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, esperaba 200: %s", rec.Code, rec.Body.String())
	}
	if falso.reactivadas != 1 {
		t.Errorf("se reactivo %d veces", falso.reactivadas)
	}
	if findCookie(rec, "__Host-kp_refresh") == nil {
		t.Error("reactivada, la sesion debia emitirse")
	}
}

// Si ya no se puede reactivar (vencio el plazo), reactivate no abre la puerta.
func TestLoginHandler_ReactivarFueraDePlazoSeRechaza(t *testing.T) {
	env := armarEntornoBloqueo(t)
	resp := registerTestUser(t, env.svc)
	marcarPorEliminar(t, env.pool, resp.User.ID)
	env.svc.SetCuentasPorEliminar(&porEliminarFalso{pool: env.pool, fecha: time.Now().Add(-time.Hour), reactivable: false})
	h := auth.NewHandler(env.svc, auth.CookieConfig{Secure: true}, false)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login",
		strings.NewReader(`{"identifier":"702650930","password":"Kiramopay2024!","reactivate":true}`))
	rec := httptest.NewRecorder()
	h.Login(rec, req)
	if rec.Code != http.StatusForbidden || leerSobreError(t, rec).Error.Code != "ACCOUNT_BLOCKED" {
		t.Fatalf("fuera de plazo: %d %s", rec.Code, rec.Body.String())
	}
}

// El refresh de un telefono que se quedo con la sesion vieja tambien dice por
// que no entra, para que la app muestre el aviso correcto.
func TestRefreshHandler_CuentaPorEliminarResponde403(t *testing.T) {
	env := armarEntornoBloqueo(t)
	resp := registerTestUser(t, env.svc)
	marcarPorEliminar(t, env.pool, resp.User.ID)
	env.svc.SetCuentasPorEliminar(&porEliminarFalso{pool: env.pool, fecha: time.Now().Add(time.Hour), reactivable: true})
	h := auth.NewHandler(env.svc, auth.CookieConfig{Secure: true}, false)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/refresh", nil)
	req.AddCookie(&http.Cookie{Name: "__Host-kp_refresh", Value: resp.Tokens.RefreshToken})
	rec := httptest.NewRecorder()
	h.RefreshToken(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, esperaba 403: %s", rec.Code, rec.Body.String())
	}
	if s := leerSobreError(t, rec); s.Error == nil || s.Error.Code != "ACCOUNT_PENDING_DELETION" {
		t.Fatalf("sobre inesperado: %s", rec.Body.String())
	}
}

// Desbloquear una cuenta que tenia la eliminacion en curso no la activa: vuelve a
// 'pending_deletion', porque la decision de la persona sigue en pie.
func TestUnblock_ConLaEliminacionEnCursoVuelveAPendiente(t *testing.T) {
	env := armarEntornoBloqueo(t)
	resp := registerTestUser(t, env.svc)
	marcarPorEliminar(t, env.pool, resp.User.ID)
	bloquear(t, env, resp.User.ID, "")
	desbloquear(t, env, resp.User.ID)

	var status string
	if err := env.pool.QueryRow(context.Background(), `SELECT status FROM users WHERE id = $1::uuid`, resp.User.ID).Scan(&status); err != nil {
		t.Fatal(err)
	}
	if status != "pending_deletion" {
		t.Fatalf("tras desbloquear quedo en %s", status)
	}
}

// Una cuenta con la eliminacion en curso se rechaza en cada peticion autenticada,
// igual que una bloqueada: un token de acceso que quedo vivo no sigue sirviendo
// hasta que vence. Sin Redis lo dice la BD, y el repaso de las marcas le pone la
// suya.
func TestPorEliminar_SeRechazaEnCadaPeticion(t *testing.T) {
	env := armarEntornoBloqueo(t)
	ctx := context.Background()
	resp := registerTestUser(t, env.svc)
	marcarPorEliminar(t, env.pool, resp.User.ID)

	if blocked, err := auth.NewRepository(env.pool, nil).IsUserBlocked(ctx, resp.User.ID); err != nil || !blocked {
		t.Fatalf("IsUserBlocked sin Redis = (%v, %v), esperaba true", blocked, err)
	}
	if _, _, err := env.authRepo.ReconcileBlockedMarks(ctx); err != nil {
		t.Fatalf("ReconcileBlockedMarks: %v", err)
	}
	if blocked, err := env.authRepo.IsUserBlocked(ctx, resp.User.ID); err != nil || !blocked {
		t.Fatalf("IsUserBlocked con Redis tras el repaso = (%v, %v), esperaba true", blocked, err)
	}
}

// porEliminarQueOtraYaReactivo responde como cuando otra peticion (el doble
// clic en "Reactivar") gano por un instante: al consultar la cuenta todavia se
// podia reactivar, y al reactivar ya no habia nada que hacer porque la otra la
// dejo activa.
type porEliminarQueOtraYaReactivo struct{ pool *pgxpool.Pool }

func (*porEliminarQueOtraYaReactivo) SeEliminaEl(context.Context, string) (time.Time, bool, error) {
	return time.Now().Add(time.Hour), true, nil
}

func (f *porEliminarQueOtraYaReactivo) Reactivar(ctx context.Context, userID string) (bool, error) {
	_, err := f.pool.Exec(ctx, `UPDATE users
		SET status = 'active', deletion_requested_at = NULL, deletion_due_at = NULL,
		    deletion_terms_accepted_at = NULL, deletion_channel = NULL
		WHERE id = $1::uuid`, userID)
	return false, err
}

// El doble clic en "Reactivar" entra las dos veces: la segunda encuentra la
// cuenta ya activa, con la contrasena verificada, y no tiene por que decir
// "cuenta bloqueada".
func TestLoginHandler_ReactivarDosVecesEntraLaSegunda(t *testing.T) {
	env := armarEntornoBloqueo(t)
	resp := registerTestUser(t, env.svc)
	marcarPorEliminar(t, env.pool, resp.User.ID)
	env.svc.SetCuentasPorEliminar(&porEliminarQueOtraYaReactivo{pool: env.pool})
	h := auth.NewHandler(env.svc, auth.CookieConfig{Secure: true}, false)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login",
		strings.NewReader(`{"identifier":"702650930","password":"Kiramopay2024!","reactivate":true}`))
	rec := httptest.NewRecorder()
	h.Login(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, esperaba 200: %s", rec.Code, rec.Body.String())
	}
	if findCookie(rec, "__Host-kp_refresh") == nil {
		t.Error("la segunda reactivacion debia emitir la sesion")
	}
}
