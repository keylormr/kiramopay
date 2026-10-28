package auth_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
)

// ─────────────────────────────────────────────────────────────────────────
//  Una sesion cerrada por el servidor no puede seguir listada como abierta
//
//  Cuando Refresh cerraba una sesion por inactividad revocaba solo la familia de
//  refresh (refresh_tokens). La fila de user_sessions quedaba sin marcar, asi que
//  "Dispositivos conectados" seguia mostrandola como abierta —con su fecha de
//  vencimiento— cuando ya no podia renovarse ni servir: audit_logs decia
//  session_timeout y la pantalla decia que el dispositivo seguia dentro.
//
//  Lo mismo pasaba con la deteccion de reuso de un refresh token.
//
//  Revocar marca la fila (revoked_at y el motivo), no la borra.
// ─────────────────────────────────────────────────────────────────────────

const migracion085 = "../../migrations/085_actividad_de_sesion.sql"

// filaDeSesion devuelve si la sesion cuyo refresh vigente es refreshJTI esta
// cerrada y con que motivo; existe=false si no hay fila (seria un borrado).
func filaDeSesion(t *testing.T, env entornoBloqueo, refreshJTI string) (existe, cerrada bool, motivo string) {
	t.Helper()
	var motivoNull *string
	err := env.pool.QueryRow(context.Background(),
		`SELECT revoked_at IS NOT NULL, revoked_reason FROM user_sessions WHERE refresh_jti = $1::uuid`,
		refreshJTI).Scan(&cerrada, &motivoNull)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, false, ""
	}
	if err != nil {
		t.Fatalf("leer la fila de la sesion: %v", err)
	}
	if motivoNull != nil {
		motivo = *motivoNull
	}
	return true, cerrada, motivo
}

func sesionesListadas(t *testing.T, env entornoBloqueo, userID string) int {
	t.Helper()
	sesiones, err := env.authRepo.ListActiveSessions(context.Background(), userID, "")
	if err != nil {
		t.Fatalf("ListActiveSessions: %v", err)
	}
	return len(sesiones)
}

// refreshsCerrados cuenta los refresh tokens de la familia que quedaron
// revocados y con el motivo dado.
func refreshsCerrados(t *testing.T, env entornoBloqueo, familyID, motivo string) (total, conMotivo int) {
	t.Helper()
	if err := env.pool.QueryRow(context.Background(),
		`SELECT COUNT(*) FILTER (WHERE revoked_at IS NOT NULL),
		        COUNT(*) FILTER (WHERE revoked_at IS NOT NULL AND revoked_reason = $2)
		   FROM refresh_tokens WHERE family_id = $1::uuid`,
		familyID, motivo).Scan(&total, &conMotivo); err != nil {
		t.Fatalf("contar refresh cerrados: %v", err)
	}
	return total, conMotivo
}

func TestRefresh_UnaSesionCerradaPorInactividadDejaDeListarse(t *testing.T) {
	env := armarEntornoBloqueo(t)
	ctx := context.Background()
	inactiva := registerTestUser(t, env.svc)
	viva := entrar(t, env)
	fijarAccion(t, env, inactiva.Tokens.RefreshJTI, 40*time.Minute)
	if n := sesionesListadas(t, env, inactiva.User.ID); n != 2 {
		t.Fatalf("antes del cierre hay %d sesiones listadas, se esperaban 2", n)
	}

	if _, err := env.svc.Refresh(ctx, inactiva.Tokens.RefreshToken, emptyCtx); err == nil {
		t.Fatal("la sesion llevaba 40 minutos sin acciones y se renovo")
	}

	if n := sesionesListadas(t, env, inactiva.User.ID); n != 1 {
		t.Fatalf("tras el cierre por inactividad hay %d sesiones listadas, se esperaba 1 (la otra)", n)
	}
	existe, cerrada, motivo := filaDeSesion(t, env, inactiva.Tokens.RefreshJTI)
	if !existe || !cerrada || motivo != "idle_timeout" {
		t.Fatalf("fila de la sesion cerrada: existe=%v cerrada=%v motivo=%q; se esperaba la fila marcada idle_timeout", existe, cerrada, motivo)
	}
	if total, conMotivo := refreshsCerrados(t, env, inactiva.Tokens.FamilyID, "idle_timeout"); total == 0 || conMotivo != total {
		t.Fatalf("refresh de la familia: %d revocados, %d con el motivo; se esperaba que todos lo llevaran", total, conMotivo)
	}
	// La otra sesion no se toca.
	if existe, cerrada, _ := filaDeSesion(t, env, viva.Tokens.RefreshJTI); !existe || cerrada {
		t.Fatalf("la sesion viva quedo existe=%v cerrada=%v", existe, cerrada)
	}
}

func TestRefresh_UnaSesionCerradaPorAntiguedadTieneSuMotivo(t *testing.T) {
	env := armarEntornoBloqueo(t)
	ctx := context.Background()
	vieja := registerTestUser(t, env.svc)
	fijarEmision(t, env, vieja.Tokens.RefreshJTI, 8*24*time.Hour)
	fijarAccion(t, env, vieja.Tokens.RefreshJTI, time.Minute)

	if _, err := env.svc.Refresh(ctx, vieja.Tokens.RefreshToken, emptyCtx); err == nil {
		t.Fatal("la sesion llevaba 8 dias abierta y se renovo")
	}

	if n := sesionesListadas(t, env, vieja.User.ID); n != 0 {
		t.Fatalf("tras el cierre por antiguedad hay %d sesiones listadas, se esperaban 0", n)
	}
	if _, cerrada, motivo := filaDeSesion(t, env, vieja.Tokens.RefreshJTI); !cerrada || motivo != "absolute_timeout" {
		t.Fatalf("cerrada=%v motivo=%q; se esperaba absolute_timeout", cerrada, motivo)
	}
}

// Reusar un refresh token ya rotado revoca la familia entera: la sesion de ese
// dispositivo, que ya apunta al token nuevo, tampoco puede quedar listada.
func TestRefresh_ElReusoDeUnTokenCierraLaSesionYDejaDeListarse(t *testing.T) {
	env := armarEntornoBloqueo(t)
	ctx := context.Background()
	primera := registerTestUser(t, env.svc)
	entrar(t, env)
	nuevos, err := env.svc.Refresh(ctx, primera.Tokens.RefreshToken, emptyCtx)
	if err != nil {
		t.Fatalf("refresh: %v", err)
	}

	if _, err := env.svc.Refresh(ctx, primera.Tokens.RefreshToken, emptyCtx); err == nil {
		t.Fatal("reusar el token original tenia que fallar")
	}

	if n := sesionesListadas(t, env, primera.User.ID); n != 1 {
		t.Fatalf("tras el reuso hay %d sesiones listadas, se esperaba 1 (la otra)", n)
	}
	if existe, cerrada, motivo := filaDeSesion(t, env, nuevos.RefreshJTI); !existe || !cerrada || motivo != "refresh_reuse" {
		t.Fatalf("fila de la sesion: existe=%v cerrada=%v motivo=%q; se esperaba marcada refresh_reuse", existe, cerrada, motivo)
	}
}

// Las sesiones que ya quedaron asi en produccion (la familia de refresh
// revocada y la fila abierta) se cierran con la migracion: filtrarlas solo al
// listar dejaria el conteo de "cerrar las demas", la lista del administrador y
// cualquier otra lectura de user_sessions viendolas como abiertas.
func TestMigracion085_CierraLasSesionesQueSuFamiliaYaMurio(t *testing.T) {
	env := armarEntornoBloqueo(t)
	ctx := context.Background()
	zombi := registerTestUser(t, env.svc)
	viva := entrar(t, env)
	// El estado que dejaba el cierre por inactividad: familia revocada, fila sin marcar.
	if err := env.authRepo.RevokeRefreshFamily(ctx, zombi.Tokens.FamilyID); err != nil {
		t.Fatalf("revocar familia: %v", err)
	}
	if n := sesionesListadas(t, env, zombi.User.ID); n != 2 {
		t.Fatalf("antes de la migracion hay %d sesiones listadas, se esperaban 2 (una es el zombi)", n)
	}

	correrArchivo(t, env.pool, migracion085)

	if n := sesionesListadas(t, env, zombi.User.ID); n != 1 {
		t.Fatalf("tras la migracion hay %d sesiones listadas, se esperaba 1 (la viva)", n)
	}
	var mismaHora bool
	var motivo string
	if err := env.pool.QueryRow(ctx,
		`SELECT s.revoked_at = rt.revoked_at, COALESCE(s.revoked_reason, '')
		   FROM user_sessions s JOIN refresh_tokens rt ON rt.jti = s.refresh_jti
		  WHERE s.refresh_jti = $1::uuid`, zombi.Tokens.RefreshJTI).Scan(&mismaHora, &motivo); err != nil {
		t.Fatalf("leer la fila del zombi (se borro?): %v", err)
	}
	if !mismaHora {
		t.Error("la fila no quedo cerrada a la hora en que murio su refresh token")
	}
	if motivo != "refresh_revoked" {
		t.Errorf("motivo = %q, se esperaba refresh_revoked", motivo)
	}
	if existe, cerrada, _ := filaDeSesion(t, env, viva.Tokens.RefreshJTI); !existe || cerrada {
		t.Errorf("la sesion viva quedo existe=%v cerrada=%v: la migracion no debe tocarla", existe, cerrada)
	}
}
