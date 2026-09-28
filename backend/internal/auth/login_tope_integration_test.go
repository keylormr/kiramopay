package auth_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/kiramopay/backend/internal/auth"
	"github.com/kiramopay/backend/internal/middleware"
)

// rutaDeAcceso arma el login como lo monta main.go: el control del bloqueo va
// delante del handler, con el mismo tope de cinco intentos.
func rutaDeAcceso(svc *auth.Service, store middleware.LockoutStore) http.Handler {
	h := auth.NewHandler(svc, auth.CookieConfig{Secure: true}, false)
	return middleware.AccountLockoutCheck(store, 5)(http.HandlerFunc(h.Login))
}

// intentarEntrar no recibe t a proposito: tambien se llama desde goroutines, y
// t.Fatal solo vale en la goroutine de la prueba.
func intentarEntrar(ruta http.Handler, identificador, contrasena string) *httptest.ResponseRecorder {
	cuerpo, _ := json.Marshal(map[string]string{"identifier": identificador, "password": contrasena})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", bytes.NewReader(cuerpo))
	rec := httptest.NewRecorder()
	ruta.ServeHTTP(rec, req)
	return rec
}

func codigoDeLaRespuesta(t *testing.T, rec *httptest.ResponseRecorder) string {
	t.Helper()
	if rec.Code == http.StatusOK {
		return "OK"
	}
	s := leerSobreError(t, rec)
	if s.Error == nil {
		t.Fatalf("respuesta %d sin error: %s", rec.Code, rec.Body.String())
	}
	return s.Error.Code
}

// rafagaDeAcceso manda n intentos a la vez, soltados juntos, y cuenta las
// respuestas por codigo. Los recorders se leen al final, en la goroutine de la
// prueba.
func rafagaDeAcceso(t *testing.T, ruta http.Handler, identificador, contrasena string, n int) map[string]int {
	t.Helper()
	salida := make(chan struct{})
	recs := make([]*httptest.ResponseRecorder, n)
	var wg sync.WaitGroup
	for i := range recs {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-salida
			recs[i] = intentarEntrar(ruta, identificador, contrasena)
		}()
	}
	close(salida)
	wg.Wait()
	codigos := map[string]int{}
	for _, rec := range recs {
		codigos[codigoDeLaRespuesta(t, rec)]++
	}
	return codigos
}

// El tope de cinco intentos se media DESPUES de probar la contrasena: el
// control de la ruta leia el contador, y el contador solo subia cuando la
// contrasena ya habia fallado. Diez intentos mandados a la vez pasaban todos
// el control con el contador en cero, y se probaban las diez contrasenas.
//
// La misma rafaga va contra una cuenta que existe y contra una que no: las dos
// tienen que recibir lo mismo, o comparar las respuestas diria que nombres de
// usuario tienen cuenta.
func TestLogin_UnaRafagaNoPruebaMasDeCincoContrasenas(t *testing.T) {
	svc, pool, store := servicioConDemo(t, false)
	sembrarConUsuario(t, pool, "702650930", "keilor", false)
	ruta := rutaDeAcceso(svc, store)

	for _, quien := range []string{"keilor", "nadie"} {
		codigos := rafagaDeAcceso(t, ruta, quien, "noEsLaClave1!", 10)
		if codigos["AUTH_FAILED"] != 5 || codigos["ACCOUNT_LOCKED"] != 5 {
			t.Errorf("%s: de 10 intentos a la vez se probaron %d contrasenas; esperaba 5 probadas y 5 frenadas (codigos: %v)",
				quien, codigos["AUTH_FAILED"], codigos)
		}
	}

	// Pasada la rafaga, ni la contrasena correcta entra.
	if c := codigoDeLaRespuesta(t, intentarEntrar(ruta, "keilor", "Kiramopay2024!")); c != "ACCOUNT_LOCKED" {
		t.Fatalf("la contrasena correcta despues de la rafaga recibio %q, esperaba ACCOUNT_LOCKED", c)
	}
}

// Contar el intento antes de probar la contrasena no puede comerse uno: con
// cuatro equivocadas, la quinta sigue siendo un intento y, si es la buena,
// entra.
func TestLogin_LaQuintaContrasenaTodaviaPuedeSerLaBuena(t *testing.T) {
	svc, pool, store := servicioConDemo(t, false)
	sembrarConUsuario(t, pool, "702650930", "keilor", false)
	ruta := rutaDeAcceso(svc, store)

	for i := 0; i < 4; i++ {
		if c := codigoDeLaRespuesta(t, intentarEntrar(ruta, "keilor", "noEsLaClave1!")); c != "AUTH_FAILED" {
			t.Fatalf("intento %d: %q, esperaba AUTH_FAILED", i+1, c)
		}
	}
	if rec := intentarEntrar(ruta, "keilor", "Kiramopay2024!"); rec.Code != http.StatusOK {
		t.Fatalf("la quinta, con la contrasena correcta, recibio %d: %s", rec.Code, rec.Body.String())
	}
}

// Cuando la CUENTA ya gasto sus intentos (sumando todas sus puertas), la
// contrasena correcta tiene que recibir lo mismo que una equivocada. Con una
// cuenta bloqueada por un administrador no pasaba: la correcta recibia
// ACCOUNT_BLOCKED y la equivocada AUTH_FAILED, y la diferencia confirmaba cual
// era la buena por cada puerta que todavia tuviera intentos propios.
func TestLogin_ConLaCuentaEnPausaLaRespuestaNoConfirmaLaContrasena(t *testing.T) {
	svc, pool, store := servicioConDemo(t, false)
	id := sembrarConUsuario(t, pool, "702650930", "keilor", false)
	bloquearComoAdmin(t, pool, id)
	ruta := rutaDeAcceso(svc, store)

	// Cinco equivocadas por la cedula dejan la cuenta en pausa.
	for i := 0; i < 5; i++ {
		if c := codigoDeLaRespuesta(t, intentarEntrar(ruta, "702650930", "noEsLaClave1!")); c != "AUTH_FAILED" {
			t.Fatalf("intento %d: %q, esperaba AUTH_FAILED", i+1, c)
		}
	}
	// El nombre de usuario todavia tiene intentos propios.
	buena := codigoDeLaRespuesta(t, intentarEntrar(ruta, "keilor", "Kiramopay2024!"))
	mala := codigoDeLaRespuesta(t, intentarEntrar(ruta, "keilor", "otraMala1!"))
	if buena != mala {
		t.Fatalf("con la cuenta en pausa, la contrasena correcta recibe %q y una equivocada %q: la respuesta dice cual es la buena",
			buena, mala)
	}
}

// Contar el intento antes de probar la contrasena no puede dejar sumando los
// de quien si la sabe. Una cuenta bloqueada por un administrador nunca llega a
// emitir la sesion: si los contadores se vaciaran recien ahi, su titular veria
// "cuenta bloqueada" cinco veces y despues "demasiados intentos", y al
// desbloquearla seguiria frenada hasta que venciera la ventana de 15 minutos.
func TestLogin_LaContrasenaCorrectaDeUnaCuentaBloqueadaNoGastaIntentos(t *testing.T) {
	svc, pool, store := servicioConDemo(t, false)
	id := sembrarConUsuario(t, pool, "702650930", "keilor", false)
	bloquearComoAdmin(t, pool, id)
	ruta := rutaDeAcceso(svc, store)

	for i := 0; i < 7; i++ {
		if c := codigoDeLaRespuesta(t, intentarEntrar(ruta, "keilor", "Kiramopay2024!")); c != "ACCOUNT_BLOCKED" {
			t.Fatalf("intento %d con la contrasena correcta: %q, esperaba ACCOUNT_BLOCKED", i+1, c)
		}
	}

	desbloquearComoAdmin(t, pool, id)
	if rec := intentarEntrar(ruta, "keilor", "Kiramopay2024!"); rec.Code != http.StatusOK {
		t.Fatalf("recien desbloqueada, la contrasena correcta recibio %d: %s", rec.Code, rec.Body.String())
	}
}

// bloquearComoAdmin y desbloquearComoAdmin escriben las mismas columnas que
// BlockUserAndRevokeSessions y UnblockUser: chk_users_blocked_coherente las
// exige juntas.
func bloquearComoAdmin(t *testing.T, pool *pgxpool.Pool, id string) {
	t.Helper()
	if _, err := pool.Exec(context.Background(),
		`UPDATE users SET status = 'blocked', blocked_at = NOW(), blocked_reason = 'prueba'
		  WHERE id = $1::uuid`, id); err != nil {
		t.Fatalf("bloquear la cuenta: %v", err)
	}
}

func desbloquearComoAdmin(t *testing.T, pool *pgxpool.Pool, id string) {
	t.Helper()
	if _, err := pool.Exec(context.Background(),
		`UPDATE users SET status = 'active', blocked_at = NULL, blocked_reason = NULL, blocked_by = NULL
		  WHERE id = $1::uuid`, id); err != nil {
		t.Fatalf("desbloquear la cuenta: %v", err)
	}
}
