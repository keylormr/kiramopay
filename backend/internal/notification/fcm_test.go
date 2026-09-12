package notification

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// Los avisos nativos se entregan por la API HTTP v1 de FCM con un token de
// cuenta de servicio. Estas pruebas levantan un Google de mentira (endpoint de
// tokens y de envio) y fijan: el aserto que se firma, la cache del token, el
// mensaje que viaja, y sobre todo cuando un token se da por muerto, porque
// equivocarse ahi vacia la tabla de telefonos.

type googleFalso struct {
	t          *testing.T
	publica    *rsa.PublicKey
	srv        *httptest.Server
	tokensDado atomic.Int32
	envios     atomic.Int32
	ultimo     atomic.Value // mensajeFCM
	respuesta  func(w http.ResponseWriter)
}

func nuevoGoogleFalso(t *testing.T, publica *rsa.PublicKey) *googleFalso {
	g := &googleFalso{t: t, publica: publica}
	g.respuesta = func(w http.ResponseWriter) { w.WriteHeader(http.StatusOK); _, _ = io.WriteString(w, `{"name":"x"}`) }
	mux := http.NewServeMux()
	mux.HandleFunc("/token", func(w http.ResponseWriter, r *http.Request) {
		if err := r.ParseForm(); err != nil {
			t.Errorf("form: %v", err)
		}
		if got := r.PostForm.Get("grant_type"); got != concesionJWT {
			t.Errorf("grant_type = %q", got)
		}
		claims := jwt.MapClaims{}
		tok, err := jwt.ParseWithClaims(r.PostForm.Get("assertion"), claims, func(tk *jwt.Token) (any, error) {
			if tk.Method != jwt.SigningMethodRS256 {
				t.Errorf("alg = %v, esperaba RS256", tk.Method)
			}
			return g.publica, nil
		})
		if err != nil || tok == nil || !tok.Valid {
			t.Errorf("aserto invalido: %v", err)
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		if claims["iss"] != "avisos@proyecto.iam.gserviceaccount.com" || claims["scope"] != alcanceFCM {
			t.Errorf("claims = %v", claims)
		}
		if claims["aud"] != g.srv.URL+"/token" {
			t.Errorf("aud = %v", claims["aud"])
		}
		if tok.Header["kid"] != "clave-1" {
			t.Errorf("kid = %v", tok.Header["kid"])
		}
		n := g.tokensDado.Add(1)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"access_token": "acceso-" + string(rune('0'+n)), "expires_in": 3599, "token_type": "Bearer",
		})
	})
	mux.HandleFunc("/v1/projects/proyecto-kiramo/messages:send", func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.Header.Get("Authorization"), "Bearer acceso-") {
			t.Errorf("Authorization = %q", r.Header.Get("Authorization"))
		}
		var m mensajeFCM
		if err := json.NewDecoder(r.Body).Decode(&m); err != nil {
			t.Errorf("mensaje: %v", err)
		}
		g.ultimo.Store(m)
		g.envios.Add(1)
		g.respuesta(w)
	})
	g.srv = httptest.NewTLSServer(mux)
	t.Cleanup(g.srv.Close)
	return g
}

func cuentaDePrueba(t *testing.T, uriToken string) (string, *rsa.PublicKey) {
	t.Helper()
	clave, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	der, err := x509.MarshalPKCS8PrivateKey(clave)
	if err != nil {
		t.Fatal(err)
	}
	pemClave := string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der}))
	crudo, _ := json.Marshal(map[string]string{
		"type":           "service_account",
		"project_id":     "proyecto-kiramo",
		"private_key_id": "clave-1",
		"private_key":    pemClave,
		"client_email":   "avisos@proyecto.iam.gserviceaccount.com",
		"token_uri":      uriToken,
	})
	return string(crudo), &clave.PublicKey
}

// enviadorContra arma un enviador que habla con el Google de mentira.
func enviadorContra(t *testing.T) (*EnviadorFCM, *googleFalso) {
	t.Helper()
	// El servidor se levanta primero para conocer su URL; la clave publica se
	// completa despues.
	g := nuevoGoogleFalso(t, nil)
	crudo, publica := cuentaDePrueba(t, g.srv.URL+"/token")
	g.publica = publica
	e, err := NuevoEnviadorFCM(crudo)
	if err != nil {
		t.Fatalf("NuevoEnviadorFCM: %v", err)
	}
	e.baseURL = g.srv.URL
	e.http = g.srv.Client()
	return e, g
}

func TestNuevoEnviadorFCM_VacioEsApagado(t *testing.T) {
	e, err := NuevoEnviadorFCM("   ")
	if e != nil || err != nil {
		t.Fatalf("vacio: enviador=%v err=%v, esperaba nil, nil", e, err)
	}
}

func TestNuevoEnviadorFCM_AceptaBase64(t *testing.T) {
	crudo, _ := cuentaDePrueba(t, "https://oauth2.googleapis.com/token")
	e, err := NuevoEnviadorFCM(base64.StdEncoding.EncodeToString([]byte(crudo)))
	if err != nil || e == nil {
		t.Fatalf("base64: enviador=%v err=%v", e, err)
	}
	if e.proyecto != "proyecto-kiramo" || e.uriToken != "https://oauth2.googleapis.com/token" {
		t.Fatalf("proyecto=%q uriToken=%q", e.proyecto, e.uriToken)
	}
}

func TestNuevoEnviadorFCM_RechazaLoIncompleto(t *testing.T) {
	casos := map[string]string{
		"basura":         "esto no es nada",
		"sin clave":      `{"project_id":"p","client_email":"a@b"}`,
		"clave rota":     `{"project_id":"p","client_email":"a@b","private_key":"-----BEGIN PRIVATE KEY-----\nxx\n-----END PRIVATE KEY-----"}`,
		"token sin tls":  "",
		"sin project_id": `{"client_email":"a@b","private_key":"x"}`,
	}
	crudo, _ := cuentaDePrueba(t, "http://oauth2.googleapis.com/token")
	casos["token sin tls"] = crudo
	for nombre, entrada := range casos {
		if _, err := NuevoEnviadorFCM(entrada); !errors.Is(err, ErrCredencialesFCM) {
			t.Errorf("%s: err = %v, esperaba ErrCredencialesFCM", nombre, err)
		}
	}
}

func TestEnviar_ArmaElMensajeYReusaElToken(t *testing.T) {
	e, g := enviadorContra(t)
	ctx := context.Background()
	p := &NotificationPayload{Title: "SINPE recibido", Body: "CRC 1000.00", Tag: "transaction"}

	for i := 0; i < 3; i++ {
		invalido, err := e.Enviar(ctx, "token-telefono", p)
		if invalido || err != nil {
			t.Fatalf("envio %d: invalido=%v err=%v", i, invalido, err)
		}
	}
	if n := g.tokensDado.Load(); n != 1 {
		t.Fatalf("se pidieron %d tokens de acceso para 3 envios, esperaba 1", n)
	}
	m := g.ultimo.Load().(mensajeFCM)
	if m.Message.Token != "token-telefono" || m.Message.Notification.Title != "SINPE recibido" ||
		m.Message.Notification.Body != "CRC 1000.00" {
		t.Fatalf("mensaje = %+v", m.Message)
	}
	if m.Message.Data["url"] != "/" || m.Message.Data["tipo"] != "transaction" {
		t.Fatalf("data = %v", m.Message.Data)
	}
	if m.Message.Android.Priority != "HIGH" || m.Message.Android.Notification.ChannelID != canalDeAvisos {
		t.Fatalf("android = %+v", m.Message.Android)
	}
}

func TestEnviar_PideOtroTokenCuandoVence(t *testing.T) {
	e, g := enviadorContra(t)
	reloj := time.Now()
	e.ahora = func() time.Time { return reloj }
	p := &NotificationPayload{Title: "t", Body: "b"}

	if _, err := e.Enviar(context.Background(), "tk", p); err != nil {
		t.Fatal(err)
	}
	reloj = reloj.Add(56 * time.Minute) // pasado el margen de 5 min antes de la hora
	if _, err := e.Enviar(context.Background(), "tk", p); err != nil {
		t.Fatal(err)
	}
	if n := g.tokensDado.Load(); n != 2 {
		t.Fatalf("tokens pedidos = %d, esperaba 2 (el primero vencio)", n)
	}
}

func TestEnviar_UnregisteredEsTokenMuerto(t *testing.T) {
	e, g := enviadorContra(t)
	g.respuesta = func(w http.ResponseWriter) {
		w.WriteHeader(http.StatusNotFound)
		_, _ = io.WriteString(w, `{"error":{"code":404,"message":"Requested entity was not found.","status":"NOT_FOUND",
			"details":[{"@type":"type.googleapis.com/google.firebase.fcm.v1.FcmError","errorCode":"UNREGISTERED"}]}}`)
	}
	invalido, err := e.Enviar(context.Background(), "tk", &NotificationPayload{Title: "t"})
	if !invalido || err == nil {
		t.Fatalf("UNREGISTERED: invalido=%v err=%v, esperaba token muerto", invalido, err)
	}
}

// Un 404 sin UNREGISTERED es el proyecto mal escrito: si se tomara como token
// muerto, el primer envio borraria todos los telefonos.
func TestEnviar_404SinDetalleNoBorra(t *testing.T) {
	e, g := enviadorContra(t)
	g.respuesta = func(w http.ResponseWriter) {
		w.WriteHeader(http.StatusNotFound)
		_, _ = io.WriteString(w, `{"error":{"code":404,"message":"Requested entity was not found.","status":"NOT_FOUND"}}`)
	}
	invalido, err := e.Enviar(context.Background(), "tk", &NotificationPayload{Title: "t"})
	if invalido || err == nil {
		t.Fatalf("404 sin detalle: invalido=%v err=%v, esperaba error sin borrar", invalido, err)
	}
}

// INVALID_ARGUMENT tambien sale por un mensaje mal armado (documentacion de
// FCM): no se toma como token muerto.
func TestEnviar_InvalidArgumentNoBorra(t *testing.T) {
	e, g := enviadorContra(t)
	g.respuesta = func(w http.ResponseWriter) {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = io.WriteString(w, `{"error":{"code":400,"status":"INVALID_ARGUMENT",
			"details":[{"@type":"type.googleapis.com/google.firebase.fcm.v1.FcmError","errorCode":"INVALID_ARGUMENT"}]}}`)
	}
	invalido, err := e.Enviar(context.Background(), "tk", &NotificationPayload{Title: "t"})
	if invalido || err == nil {
		t.Fatalf("INVALID_ARGUMENT: invalido=%v err=%v", invalido, err)
	}
}

func TestEnviar_401TiraElTokenEnCache(t *testing.T) {
	e, g := enviadorContra(t)
	primera := true
	g.respuesta = func(w http.ResponseWriter) {
		if primera {
			primera = false
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.WriteHeader(http.StatusOK)
	}
	p := &NotificationPayload{Title: "t"}
	if _, err := e.Enviar(context.Background(), "tk", p); err == nil {
		t.Fatal("el 401 tenia que devolver error")
	}
	if _, err := e.Enviar(context.Background(), "tk", p); err != nil {
		t.Fatalf("segundo envio: %v", err)
	}
	if n := g.tokensDado.Load(); n != 2 {
		t.Fatalf("tokens pedidos = %d, esperaba 2 (el 401 obliga a pedir otro)", n)
	}
}

func TestRegistrarDispositivo_Validaciones(t *testing.T) {
	apagado := &Service{}
	if err := apagado.RegistrarDispositivo(context.Background(), "u", &RegistroDispositivo{Token: "t"}); !errors.Is(err, ErrNativoApagado) {
		t.Fatalf("sin FCM: err = %v, esperaba ErrNativoApagado", err)
	}
	encendido := &Service{fcm: &EnviadorFCM{}}
	casos := []struct {
		req  RegistroDispositivo
		want error
	}{
		{RegistroDispositivo{Token: "  "}, ErrTokenInvalido},
		{RegistroDispositivo{Token: strings.Repeat("x", largoMaximoToken+1)}, ErrTokenInvalido},
		{RegistroDispositivo{Token: "t", Plataforma: "ios"}, ErrPlataformaInvalida},
	}
	for _, c := range casos {
		if err := encendido.RegistrarDispositivo(context.Background(), "u", &c.req); !errors.Is(err, c.want) {
			t.Errorf("%+v: err = %v, esperaba %v", c.req.Plataforma, err, c.want)
		}
	}
	if err := encendido.OlvidarDispositivo(context.Background(), "u", " "); !errors.Is(err, ErrTokenInvalido) {
		t.Fatalf("baja sin token: err = %v", err)
	}
}

// El aserto lleva la uri de tokens de la cuenta de servicio como audiencia; se
// comprueba aparte que la cuenta real de Google no se reemplace por otra.
func TestNuevoEnviadorFCM_UriPorDefecto(t *testing.T) {
	crudo, _ := cuentaDePrueba(t, "")
	var m map[string]string
	_ = json.Unmarshal([]byte(crudo), &m)
	delete(m, "token_uri")
	sinURI, _ := json.Marshal(m)
	e, err := NuevoEnviadorFCM(string(sinURI))
	if err != nil {
		t.Fatal(err)
	}
	if u, _ := url.Parse(e.uriToken); u.Host != "oauth2.googleapis.com" {
		t.Fatalf("uriToken = %q", e.uriToken)
	}
}
