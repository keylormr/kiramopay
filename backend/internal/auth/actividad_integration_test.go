package auth_test

import (
	"context"
	"testing"
	"time"
)

// ─────────────────────────────────────────────────────────────────────────
//  Cierre por inactividad: 30 minutos desde la ultima ACCION de la persona
//
//  Hasta hoy la inactividad se media desde la ultima EMISION del token
//  (refresh_tokens.issued_at). Con un token de acceso de quince minutos la
//  inactividad efectiva iba de 15 a 30, y una peticion que sale sola en segundo
//  plano (precios, sondeo de un pedido) que cayera con el token vencido
//  renovaba la sesion sin que nadie hubiera tocado la app.
//
//  Ahora el cliente avisa cada accion real (POST /auth/activity) y el servidor
//  la guarda en user_sessions.last_activity_at. Renovar el token NO la toca.
//  Una sesion que nunca aviso (last_activity_at NULL: un cliente anterior a
//  este cambio) se sigue midiendo como antes.
// ─────────────────────────────────────────────────────────────────────────

// fijarEmision pone la emision del refresh token hace `hace`.
func fijarEmision(t *testing.T, env entornoBloqueo, refreshJTI string, hace time.Duration) {
	t.Helper()
	if _, err := env.pool.Exec(context.Background(),
		`UPDATE refresh_tokens SET issued_at = NOW() - make_interval(secs => $2::float8)
		  WHERE jti = $1::uuid`, refreshJTI, hace.Seconds()); err != nil {
		t.Fatalf("fijar la emision: %v", err)
	}
}

// fijarAccion pone la ultima accion de la sesion hace `hace`; 0 la deja en NULL,
// como una sesion de un cliente que nunca avisa.
func fijarAccion(t *testing.T, env entornoBloqueo, refreshJTI string, hace time.Duration) {
	t.Helper()
	var err error
	if hace == 0 {
		_, err = env.pool.Exec(context.Background(),
			`UPDATE user_sessions SET last_activity_at = NULL WHERE refresh_jti = $1::uuid`, refreshJTI)
	} else {
		_, err = env.pool.Exec(context.Background(),
			`UPDATE user_sessions SET last_activity_at = NOW() - make_interval(secs => $2::float8)
			  WHERE refresh_jti = $1::uuid`, refreshJTI, hace.Seconds())
	}
	if err != nil {
		t.Fatalf("fijar la ultima accion: %v", err)
	}
}

// haceDeLaAccion devuelve hace cuanto fue la ultima accion guardada, o -1 si es NULL.
func haceDeLaAccion(t *testing.T, env entornoBloqueo, jti, columna string) time.Duration {
	t.Helper()
	var segundos *float64
	if err := env.pool.QueryRow(context.Background(),
		`SELECT EXTRACT(EPOCH FROM (NOW() - last_activity_at))::float8
		   FROM user_sessions WHERE `+columna+` = $1::uuid`, jti).Scan(&segundos); err != nil {
		t.Fatalf("leer la ultima accion: %v", err)
	}
	if segundos == nil {
		return -1
	}
	return time.Duration(*segundos * float64(time.Second))
}

func TestRefresh_LaInactividadSeMideDesdeLaUltimaAccionNoDesdeLaEmision(t *testing.T) {
	casos := []struct {
		nombre   string
		emitido  time.Duration // hace cuanto se emitio el refresh
		accion   time.Duration // hace cuanto fue la ultima accion; 0 = nunca aviso
		renueva  bool
		porQueNo string
	}{
		{"accion reciente aunque el token sea viejo", 40 * time.Minute, 5 * time.Minute, true, ""},
		{"token recien emitido pero sin acciones hace 40 min", time.Minute, 40 * time.Minute, false, "una renovacion no es una accion"},
		{"a 29 minutos de la accion todavia entra", time.Minute, 29 * time.Minute, true, ""},
		{"a 31 minutos de la accion ya no", time.Minute, 31 * time.Minute, false, "pasaron mas de 30 minutos sin actuar"},
		{"cliente que no avisa: token reciente entra", 5 * time.Minute, 0, true, ""},
		{"cliente que no avisa: token de 40 min ya no", 40 * time.Minute, 0, false, "se mide como antes, desde la emision"},
	}
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			env := armarEntornoBloqueo(t)
			resp := registerTestUser(t, env.svc)
			fijarEmision(t, env, resp.Tokens.RefreshJTI, c.emitido)
			fijarAccion(t, env, resp.Tokens.RefreshJTI, c.accion)

			_, err := env.svc.Refresh(context.Background(), resp.Tokens.RefreshToken, emptyCtx)
			if c.renueva && err != nil {
				t.Fatalf("la sesion debia renovarse: %v", err)
			}
			if !c.renueva && err == nil {
				t.Fatalf("la sesion debia cerrarse (%s) y se renovo", c.porQueNo)
			}
		})
	}
}

// Renovar el token no es una accion: la hora de la ultima accion tiene que
// sobrevivir a la rotacion intacta. Si la rotacion la pusiera en NOW(), una
// peticion de fondo que cayera con el token vencido mantendria viva la sesion
// para siempre.
func TestRefresh_UnaRenovacionNoCuentaComoAccion(t *testing.T) {
	env := armarEntornoBloqueo(t)
	resp := registerTestUser(t, env.svc)
	fijarAccion(t, env, resp.Tokens.RefreshJTI, 10*time.Minute)

	nuevos, err := env.svc.Refresh(context.Background(), resp.Tokens.RefreshToken, emptyCtx)
	if err != nil {
		t.Fatalf("refresh: %v", err)
	}

	hace := haceDeLaAccion(t, env, nuevos.RefreshJTI, "refresh_jti")
	if hace < 9*time.Minute+30*time.Second || hace > 11*time.Minute {
		t.Fatalf("la ultima accion quedo hace %s tras renovar; tenia que seguir en ~10 min", hace)
	}
}

// El token de acceso vive 15 minutos, pero eso no puede alargar la inactividad:
// una sesion sin acciones hace mas de 30 minutos deja de servir en la siguiente
// peticion aunque su token de acceso siga vigente.
func TestIsAccessJTIRevoked_UnaSesionSinAccionesHaceMasDeLaVentanaYaNoSirve(t *testing.T) {
	casos := []struct {
		nombre  string
		accion  time.Duration
		revoked bool
	}{
		{"accion reciente", 5 * time.Minute, false},
		{"a 29 minutos", 29 * time.Minute, false},
		{"a 31 minutos", 31 * time.Minute, true},
		{"cliente que no avisa nunca se corta por esto", 0, false},
	}
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			env := armarEntornoBloqueo(t)
			resp := registerTestUser(t, env.svc)
			fijarAccion(t, env, resp.Tokens.RefreshJTI, c.accion)

			revoked, err := env.authRepo.IsAccessJTIRevoked(context.Background(), resp.Tokens.AccessJTI)
			if err != nil {
				t.Fatalf("IsAccessJTIRevoked: %v", err)
			}
			if revoked != c.revoked {
				t.Fatalf("revoked = %v, se esperaba %v", revoked, c.revoked)
			}
		})
	}
}
