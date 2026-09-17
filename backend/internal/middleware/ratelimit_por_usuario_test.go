package middleware

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/kiramopay/backend/internal/testutil"
	jwtpkg "github.com/kiramopay/backend/pkg/jwt"
)

// El limite global contaba 100 peticiones por minuto POR DIRECCION IP para
// TODAS las rutas, tambien las autenticadas. Una oficina, el CGNAT de un
// operador movil o dos personas en la misma casa comparten una sola direccion:
// entre todas agotaban un cupo pensado para una y la app respondia 429 a todas
// con uso perfectamente normal.
//
// Cuando la peticion trae sesion, el cupo se cuenta por USUARIO. La IP queda
// para lo anonimo, que por cliente es poco.

// pedirComo hace una peticion autenticada con `token` desde `ip`.
func pedirComo(h http.Handler, ip, token string) int {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/wallets/me", nil)
	req.RemoteAddr = ip + ":40000"
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec.Code
}

func TestLimiteGlobal_DosUsuariosTrasLaMismaIPNoSeQuitanCupo(t *testing.T) {
	jm := newTestJWTManager()
	deA, err := jm.GenerateTokenPair("usuario-a")
	if err != nil {
		t.Fatalf("token de A: %v", err)
	}
	deB, err := jm.GenerateTokenPair("usuario-b")
	if err != nil {
		t.Fatalf("token de B: %v", err)
	}

	espia := testutil.NuevoEspiaDeRedis()
	h := RateLimitGlobal(espia.Cliente(), UsuarioDelToken(jm), 3, 3, time.Minute)(siempreOK())

	// Misma oficina, misma direccion de salida.
	const ip = "203.0.113.90"

	// A gasta TODO su cupo.
	for i := 1; i <= 3; i++ {
		if code := pedirComo(h, ip, deA.AccessToken); code != http.StatusOK {
			t.Fatalf("peticion %d de A: %d, se esperaba %d", i, code, http.StatusOK)
		}
	}
	if code := pedirComo(h, ip, deA.AccessToken); code != http.StatusTooManyRequests {
		t.Fatalf("A paso de su cupo y recibio %d, se esperaba %d", code, http.StatusTooManyRequests)
	}

	// B, desde la MISMA direccion, tiene su cupo intacto: este es el 429 que
	// recibia sin haber hecho nada.
	for i := 1; i <= 3; i++ {
		if code := pedirComo(h, ip, deB.AccessToken); code != http.StatusOK {
			t.Fatalf("peticion %d de B: %d, se esperaba %d — B no hizo nada y el trafico de A lo dejo fuera",
				i, code, http.StatusOK)
		}
	}
}

// El mismo usuario desde otra red sigue contando en SU ventana: la sesion es la
// unidad, no el dispositivo ni la red.
func TestLimiteGlobal_ElMismoUsuarioCuentaIgualDesdeOtraRed(t *testing.T) {
	jm := newTestJWTManager()
	par, err := jm.GenerateTokenPair("usuario-c")
	if err != nil {
		t.Fatalf("token: %v", err)
	}

	espia := testutil.NuevoEspiaDeRedis()
	h := RateLimitGlobal(espia.Cliente(), UsuarioDelToken(jm), 2, 50, time.Minute)(siempreOK())

	if code := pedirComo(h, "203.0.113.91", par.AccessToken); code != http.StatusOK {
		t.Fatalf("primera peticion: %d", code)
	}
	if code := pedirComo(h, "198.51.100.7", par.AccessToken); code != http.StatusOK {
		t.Fatalf("segunda peticion: %d", code)
	}
	if code := pedirComo(h, "192.0.2.15", par.AccessToken); code != http.StatusTooManyRequests {
		t.Fatalf("tercera peticion desde una tercera red: %d, se esperaba %d", code, http.StatusTooManyRequests)
	}
}

// Sin sesion se cuenta por IP, como siempre: lo anonimo no se puede atribuir a
// nadie.
func TestLimiteGlobal_LoAnonimoSigueContandoPorIP(t *testing.T) {
	espia := testutil.NuevoEspiaDeRedis()
	h := RateLimitGlobal(espia.Cliente(), UsuarioDelToken(newTestJWTManager()), 50, 2, time.Minute)(siempreOK())

	const ip = "203.0.113.92"
	if code := pedirComo(h, ip, ""); code != http.StatusOK {
		t.Fatalf("primera peticion anonima: %d", code)
	}
	if code := pedirComo(h, ip, ""); code != http.StatusOK {
		t.Fatalf("segunda peticion anonima: %d", code)
	}
	if code := pedirComo(h, ip, ""); code != http.StatusTooManyRequests {
		t.Fatalf("tercera peticion anonima: %d, se esperaba %d", code, http.StatusTooManyRequests)
	}
	// Y otra direccion no heredo ese contador.
	if code := pedirComo(h, "203.0.113.93", ""); code != http.StatusOK {
		t.Fatalf("otra direccion: %d, se esperaba %d", code, http.StatusOK)
	}
}

// Un token que no verifica NO identifica a nadie. Si bastara con leer las
// reclamaciones sin comprobar la firma, cualquiera escribiria un user_id
// distinto en cada peticion y estrenaria una ventana limpia cada vez: el limite
// dejaria de existir.
func TestLimiteGlobal_UnTokenInventadoNoEstrenaVentana(t *testing.T) {
	jm := newTestJWTManager()
	otro := jwtDeOtroEmisor(t)

	espia := testutil.NuevoEspiaDeRedis()
	h := RateLimitGlobal(espia.Cliente(), UsuarioDelToken(jm), 50, 2, time.Minute)(siempreOK())

	const ip = "203.0.113.94"
	// Cada peticion lleva un token firmado por otro (con un user_id distinto);
	// las tres tienen que caer en la MISMA ventana, la de la IP.
	for i := 1; i <= 2; i++ {
		if code := pedirComo(h, ip, otro(i)); code != http.StatusOK {
			t.Fatalf("peticion %d: %d", i, code)
		}
	}
	if code := pedirComo(h, ip, otro(3)); code != http.StatusTooManyRequests {
		t.Fatalf("tercera peticion con token inventado: %d, se esperaba %d — se estan estrenando ventanas",
			code, http.StatusTooManyRequests)
	}
}

// jwtDeOtroEmisor devuelve tokens bien formados, con un user_id distinto cada
// vez, firmados con OTRO secreto: exactamente lo que fabricaria quien quiera
// esquivar el limite.
func jwtDeOtroEmisor(t *testing.T) func(int) string {
	t.Helper()
	falso := jwtpkg.NewManager("secreto-que-el-servidor-no-conoce", 15*time.Minute, 7*24*time.Hour)
	return func(n int) string {
		par, err := falso.GenerateTokenPair(fmt.Sprintf("intruso-%d", n))
		if err != nil {
			t.Fatalf("token falso %d: %v", n, err)
		}
		return par.AccessToken
	}
}
