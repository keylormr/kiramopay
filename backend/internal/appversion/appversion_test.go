package appversion

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// Handler apuntado a servidores de prueba en vez de a GitHub.
func handlerDePrueba(api, web string) *Handler {
	h := NewHandler()
	h.apiURL = api
	h.webURL = web
	h.descargaFmt = web + "/download/%s/kiramopay.apk"
	// Sin servidor de novedades: las pruebas que no las miran no salen a la
	// red. Las que si, apuntan notasFmt a servidorNotas.
	h.notasFmt = ""
	// Lo mismo con los paquetes de la actualizacion interna: las que los miran
	// usan conPaquetes.
	h.manifiestoFmt = ""
	h.paqueteFmt = ""
	h.token = ""
	return h
}

func pedir(t *testing.T, h *Handler) (int, infoVersion) {
	t.Helper()
	rec := httptest.NewRecorder()
	h.GetLatest(rec, httptest.NewRequest(http.MethodGet, "/api/v1/app/version", nil))
	var sobre struct {
		Success bool        `json:"success"`
		Data    infoVersion `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &sobre); err != nil {
		t.Fatalf("respuesta no es JSON (%d): %s", rec.Code, rec.Body.String())
	}
	return rec.Code, sobre.Data
}

// Servidor que imita la API de releases de GitHub.
func servidorAPI(t *testing.T, status int, cuotaAgotada bool) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if cuotaAgotada {
			w.Header().Set("X-RateLimit-Remaining", "0")
		}
		if status != http.StatusOK {
			w.WriteHeader(status)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"tag_name":"v2.3.6","assets":[
			{"name":"KiramoPay-unsigned.ipa","browser_download_url":"https://ejemplo/ipa"},
			{"name":"kiramopay.apk","browser_download_url":"https://ejemplo/apk"}]}`))
	}))
}

// Servidor que imita github.com/<repo>/releases/latest: redirige al tag.
// Tambien sirve la descarga del APK como GitHub: una redireccion al
// almacenamiento de objetos, que responde el archivo.
func servidorWeb(t *testing.T, redirige bool) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !redirige {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		switch {
		case strings.HasPrefix(r.URL.Path, "/download/"):
			http.Redirect(w, r, "/objetos/kiramopay.apk", http.StatusFound)
		case r.URL.Path == "/objetos/kiramopay.apk":
			w.WriteHeader(http.StatusPartialContent)
			_, _ = w.Write([]byte("P"))
		default:
			w.Header().Set("Location", "https://github.com/keylormr/kiramopay/releases/tag/v2.3.6")
			w.WriteHeader(http.StatusFound)
		}
	}))
}

// La release lleva el .ipa de iOS ademas del APK: hay que elegir el .apk, no
// el primero de la lista.
func TestGetLatest_APIEligeElAPKNoElPrimerAdjunto(t *testing.T) {
	api := servidorAPI(t, http.StatusOK, false)
	defer api.Close()
	web := servidorWeb(t, true)
	defer web.Close()

	code, info := pedir(t, handlerDePrueba(api.URL, web.URL))
	if code != http.StatusOK || info.Version != "2.3.6" || info.URL != "https://ejemplo/apk" {
		t.Fatalf("code=%d info=%+v, esperaba 200 con la 2.3.6 y la URL del apk", code, info)
	}
}

// El caso real que tumbo el aviso de actualizacion: la cuota de la API de
// GitHub esta agotada para la IP compartida de Render. El camino web tiene que
// salvarlo sin que el usuario note nada.
func TestGetLatest_CuotaDeLaAPIAgotadaCaeALaRedireccion(t *testing.T) {
	api := servidorAPI(t, http.StatusForbidden, true)
	defer api.Close()
	web := servidorWeb(t, true)
	defer web.Close()

	code, info := pedir(t, handlerDePrueba(api.URL, web.URL))
	if code != http.StatusOK {
		t.Fatalf("code=%d, esperaba 200 por el camino web", code)
	}
	if info.Version != "2.3.6" {
		t.Fatalf("version=%q, esperaba 2.3.6 sacada del tag de la redireccion", info.Version)
	}
	if want := web.URL + "/download/v2.3.6/kiramopay.apk"; info.URL != want {
		t.Fatalf("url=%q, esperaba %q", info.URL, want)
	}
}

func TestGetLatest_LosDosCaminosCaidosSinCacheDa503(t *testing.T) {
	api := servidorAPI(t, http.StatusForbidden, true)
	defer api.Close()
	web := servidorWeb(t, false)
	defer web.Close()

	code, _ := pedir(t, handlerDePrueba(api.URL, web.URL))
	if code != http.StatusServiceUnavailable {
		t.Fatalf("code=%d, esperaba 503 sin cache", code)
	}
}

// Una cache vencida sigue siendo mejor que nada: la app ofrece la version que
// se conocia en vez de no ofrecer ninguna.
func TestGetLatest_CacheViejaSalvaCuandoTodoFalla(t *testing.T) {
	api := servidorAPI(t, http.StatusForbidden, true)
	defer api.Close()
	web := servidorWeb(t, false)
	defer web.Close()

	h := handlerDePrueba(api.URL, web.URL)
	h.cache = &infoVersion{Version: "2.3.5", URL: "https://ejemplo/viejo.apk"}
	h.cachedAt = time.Now().Add(-time.Hour)

	code, info := pedir(t, h)
	if code != http.StatusOK || info.Version != "2.3.5" {
		t.Fatalf("code=%d info=%+v, esperaba la cache vieja", code, info)
	}
}

// La cache fresca no vuelve a salir a la red.
func TestGetLatest_CacheFrescaNoConsultaAGitHub(t *testing.T) {
	llamadas := 0
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { llamadas++ }))
	defer api.Close()
	web := servidorWeb(t, true)
	defer web.Close()

	h := handlerDePrueba(api.URL, web.URL)
	h.cache = &infoVersion{Version: "2.3.6", URL: "https://ejemplo/apk"}
	h.cachedAt = time.Now()

	if code, _ := pedir(t, h); code != http.StatusOK {
		t.Fatalf("code=%d, esperaba 200 desde la cache", code)
	}
	if llamadas != 0 {
		t.Fatalf("consulto a GitHub %d veces teniendo cache fresca", llamadas)
	}
}

// Con token configurado, la peticion a la API lo lleva: es lo que sube el
// limite de 60 a 5000 por hora.
func TestGetLatest_ConTokenLoMandaEnLaCabecera(t *testing.T) {
	recibida := make(chan string, 1)
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case recibida <- r.Header.Get("Authorization"):
		default:
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"tag_name":"v2.3.6","assets":[{"name":"kiramopay.apk","browser_download_url":"https://ejemplo/apk"}]}`))
	}))
	defer api.Close()
	web := servidorWeb(t, true)
	defer web.Close()

	h := handlerDePrueba(api.URL, web.URL)
	h.token = "ghp_secreto"
	if code, _ := pedir(t, h); code != http.StatusOK {
		t.Fatalf("code=%d", code)
	}
	if got := <-recibida; got != "Bearer ghp_secreto" {
		t.Fatalf("Authorization = %q", got)
	}
}

// ── Reparto por plataforma ───────────────────────────────────────────────────
// Android e iOS comparten la version pero no la URL: iOS no puede instalar un
// binario bajado de un link.

func conCacheYCanal(iosURL string) *Handler {
	h := NewHandler()
	h.iosUpdateURL = iosURL
	h.cache = &infoVersion{Version: "2.3.6", URL: "https://ejemplo/kiramopay.apk"}
	h.cachedAt = time.Now()
	return h
}

func pedirPlataforma(t *testing.T, h *Handler, query string) (int, infoVersion) {
	t.Helper()
	rec := httptest.NewRecorder()
	h.GetLatest(rec, httptest.NewRequest(http.MethodGet, "/api/v1/app/version"+query, nil))
	var sobre struct {
		Data infoVersion `json:"data"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &sobre)
	return rec.Code, sobre.Data
}

// Los APK ya instalados llaman sin ?platform= y tienen que seguir recibiendo la
// URL del .apk. Romper esto deja sin actualizaciones al parque Android entero.
func TestPlataforma_SinParametroSigueSiendoAndroid(t *testing.T) {
	code, info := pedirPlataforma(t, conCacheYCanal(""), "")
	if code != http.StatusOK || info.URL != "https://ejemplo/kiramopay.apk" {
		t.Fatalf("code=%d info=%+v, esperaba la URL del apk", code, info)
	}
}

func TestPlataforma_IOSDevuelveSuCanalYLaMismaVersion(t *testing.T) {
	const canal = "https://testflight.apple.com/join/abc123"
	code, info := pedirPlataforma(t, conCacheYCanal(canal), "?platform=ios")
	if code != http.StatusOK {
		t.Fatalf("code=%d, esperaba 200", code)
	}
	if info.URL != canal {
		t.Errorf("url=%q, esperaba el canal iOS %q", info.URL, canal)
	}
	if info.Version != "2.3.6" {
		t.Errorf("version=%q, esperaba la misma que Android (2.3.6)", info.Version)
	}
}

// Sin canal configurado no hay a donde mandar al usuario: 503 y la app calla,
// que es mejor que abrir una hoja con un boton que no lleva a ningun lado.
func TestPlataforma_IOSSinCanalNoOfrece(t *testing.T) {
	if code, _ := pedirPlataforma(t, conCacheYCanal(""), "?platform=ios"); code != http.StatusServiceUnavailable {
		t.Fatalf("code=%d, esperaba 503", code)
	}
}

func TestPlataforma_InvalidaEs400(t *testing.T) {
	if code, _ := pedirPlataforma(t, conCacheYCanal("https://x.test"), "?platform=windows"); code != http.StatusBadRequest {
		t.Fatalf("code=%d, esperaba 400", code)
	}
}

func TestPlataforma_ToleraMayusculasYEspacios(t *testing.T) {
	code, info := pedirPlataforma(t, conCacheYCanal("https://testflight.apple.com/join/abc"), "?platform=%20iOS%20")
	if code != http.StatusOK || info.URL == "" {
		t.Fatalf("code=%d info=%+v, esperaba resolver iOS igual", code, info)
	}
}

// EL DEFECTO QUE ESTO CIERRA: con GitHub caido y la cache vencida, la respuesta
// salia TAL CUAL de la cache — y la cache siempre guarda la variante de Android.
// Un cliente iOS recibia la URL del .apk, un archivo que en iOS no se puede
// instalar. Es justo la confusion que la respuesta por plataforma vino a evitar,
// y aparecia solo en el momento en que mas molesta: cuando GitHub no responde.
//
// Sin el arreglo esta prueba falla: la URL devuelta termina en .apk.
func TestGetLatest_ConCacheViejaIOSNoRecibeElAPK(t *testing.T) {
	api := servidorAPI(t, http.StatusForbidden, true)
	defer api.Close()
	web := servidorWeb(t, false)
	defer web.Close()

	h := handlerDePrueba(api.URL, web.URL)
	h.iosUpdateURL = "https://apps.apple.com/app/kiramopay"
	h.cache = &infoVersion{Version: "2.3.5", URL: "https://ejemplo/viejo.apk"}
	h.cachedAt = time.Now().Add(-time.Hour)

	code, info := pedirPlataforma(t, h, "?platform=ios")
	if code != http.StatusOK {
		t.Fatalf("code=%d, esperaba 200 desde la cache vieja", code)
	}
	if info.Version != "2.3.5" {
		t.Fatalf("version=%q, esperaba la de la cache", info.Version)
	}
	if strings.HasSuffix(info.URL, ".apk") {
		t.Fatalf("un cliente iOS recibio la URL del APK: %q", info.URL)
	}
	if info.URL != h.iosUpdateURL {
		t.Fatalf("url=%q, esperaba el canal de iOS", info.URL)
	}
}

// Y android sigue recibiendo el .apk de la cache, que es lo correcto para el.
func TestGetLatest_ConCacheViejaAndroidSiRecibeElAPK(t *testing.T) {
	api := servidorAPI(t, http.StatusForbidden, true)
	defer api.Close()
	web := servidorWeb(t, false)
	defer web.Close()

	h := handlerDePrueba(api.URL, web.URL)
	h.iosUpdateURL = "https://apps.apple.com/app/kiramopay"
	h.cache = &infoVersion{Version: "2.3.5", URL: "https://ejemplo/viejo.apk"}
	h.cachedAt = time.Now().Add(-time.Hour)

	_, info := pedirPlataforma(t, h, "?platform=android")
	if !strings.HasSuffix(info.URL, ".apk") {
		t.Fatalf("android no recibio el APK: %q", info.URL)
	}
}

// ── Novedades ────────────────────────────────────────────────────────────────
// La actualizacion es obligatoria y el aviso dice que trae. La app instalada no
// conoce el changelog de la version nueva: se lo da el servidor, que lo lee del
// notas.json que el CI adjunta a cada release.

// Servidor que imita la descarga de un adjunto del release. GitHub no sirve el
// archivo en esa URL: redirige al almacenamiento de objetos, y hay que seguir
// la redireccion (el cliente principal no las sigue a proposito).
func servidorNotas(t *testing.T, tag, cuerpo string, status int) *httptest.Server {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc("/download/"+tag+"/notas.json", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/objetos/notas.json", http.StatusFound)
	})
	mux.HandleFunc("/objetos/notas.json", func(w http.ResponseWriter, r *http.Request) {
		if status != http.StatusOK {
			w.WriteHeader(status)
			return
		}
		w.Header().Set("Content-Type", "application/octet-stream")
		_, _ = w.Write([]byte(cuerpo))
	})
	return httptest.NewServer(mux)
}

func conNotas(api, web, notas string) *Handler {
	h := handlerDePrueba(api, web)
	h.notasFmt = notas + "/download/%s/notas.json"
	return h
}

func TestGetLatest_TraeLasNovedadesDelRelease(t *testing.T) {
	api := servidorAPI(t, http.StatusOK, false)
	defer api.Close()
	web := servidorWeb(t, true)
	defer web.Close()
	notas := servidorNotas(t, "v2.3.6", `{"version":"2.3.6","cambios":["Primero","Segundo"]}`, http.StatusOK)
	defer notas.Close()

	code, info := pedir(t, conNotas(api.URL, web.URL, notas.URL))
	if code != http.StatusOK {
		t.Fatalf("code=%d, esperaba 200", code)
	}
	if want := []string{"Primero", "Segundo"}; !reflect.DeepEqual(info.Notas, want) {
		t.Fatalf("notes=%q, esperaba %q", info.Notas, want)
	}
}

// En Render la cuota de la API suele estar agotada y la version sale por la
// redireccion: ese camino, que es el de todos los dias, tambien trae las
// novedades.
func TestGetLatest_PorLaRedireccionTambienTraeLasNovedades(t *testing.T) {
	api := servidorAPI(t, http.StatusForbidden, true)
	defer api.Close()
	web := servidorWeb(t, true)
	defer web.Close()
	notas := servidorNotas(t, "v2.3.6", `{"version":"2.3.6","cambios":["Uno"]}`, http.StatusOK)
	defer notas.Close()

	code, info := pedir(t, conNotas(api.URL, web.URL, notas.URL))
	if code != http.StatusOK || !reflect.DeepEqual(info.Notas, []string{"Uno"}) {
		t.Fatalf("code=%d notes=%q, esperaba 200 con [Uno]", code, info.Notas)
	}
}

// Un release sin notas.json (todos los anteriores a este cambio) o una descarga
// que falla no pueden dejar a la gente sin el aviso: la version sale igual y
// la lista de novedades va vacia, nunca null (la pantalla la recorre).
func TestGetLatest_SinNovedadesLaVersionSaleIgualConListaVacia(t *testing.T) {
	for _, caso := range []struct {
		nombre string
		cuerpo string
		status int
	}{
		{"sin adjunto", "", http.StatusNotFound},
		{"adjunto roto", "no es json", http.StatusOK},
		{"notas de otra version", `{"version":"2.3.5","cambios":["Viejo"]}`, http.StatusOK},
	} {
		t.Run(caso.nombre, func(t *testing.T) {
			api := servidorAPI(t, http.StatusOK, false)
			defer api.Close()
			web := servidorWeb(t, true)
			defer web.Close()
			notas := servidorNotas(t, "v2.3.6", caso.cuerpo, caso.status)
			defer notas.Close()

			rec := httptest.NewRecorder()
			conNotas(api.URL, web.URL, notas.URL).GetLatest(rec, httptest.NewRequest(http.MethodGet, "/api/v1/app/version", nil))
			if rec.Code != http.StatusOK {
				t.Fatalf("code=%d, esperaba 200: sin novedades la version se ofrece igual", rec.Code)
			}
			if !strings.Contains(rec.Body.String(), `"version":"2.3.6"`) || !strings.Contains(rec.Body.String(), `"notes":[]`) {
				t.Fatalf("body=%s, esperaba la 2.3.6 con notes:[]", rec.Body.String())
			}
		})
	}
}

// iOS comparte la version y tambien lo que trae.
func TestPlataforma_IOSRecibeLasMismasNovedades(t *testing.T) {
	h := conCacheYCanal("https://testflight.apple.com/join/abc123")
	h.cache.Notas = []string{"Algo nuevo"}
	_, info := pedirPlataforma(t, h, "?platform=ios")
	if !reflect.DeepEqual(info.Notas, []string{"Algo nuevo"}) {
		t.Fatalf("notes=%q, esperaba las mismas novedades que Android", info.Notas)
	}
}

// En produccion las novedades se buscan en el adjunto del release que publica
// el CI (android-apk.yml).
func TestNewHandler_BuscaLasNovedadesEnElRelease(t *testing.T) {
	got := fmt.Sprintf(NewHandler().notasFmt, "v2.8.0")
	if want := "https://github.com/keylormr/kiramopay/releases/download/v2.8.0/notas.json"; got != want {
		t.Fatalf("notasFmt da %q, esperaba %q", got, want)
	}
}

// ── Lo que encontro la revision de #287 ──────────────────────────────────────

// Los dos workflows del tag publican en el mismo release. Si iOS termina
// primero, o el job de Android falla, el release queda sin .apk: la API lo
// rechaza, pero la redireccion armaba la URL del .apk sin mirar si existia.
// Con la actualizacion obligatoria eso es una barrera con un boton que da 404.
// Sin APK confirmado no se ofrece nada.
func TestGetLatest_PorLaRedireccionSinAPKNoSeOfrece(t *testing.T) {
	api := servidorAPI(t, http.StatusForbidden, true)
	defer api.Close()
	web := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/download/") {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		w.Header().Set("Location", "https://github.com/keylormr/kiramopay/releases/tag/v2.3.7")
		w.WriteHeader(http.StatusFound)
	}))
	defer web.Close()

	code, info := pedir(t, handlerDePrueba(api.URL, web.URL))
	if code != http.StatusServiceUnavailable {
		t.Fatalf("code=%d info=%+v, esperaba 503: el release no tiene el APK", code, info)
	}

	// Con una version anterior en cache, se sigue ofreciendo esa.
	h := handlerDePrueba(api.URL, web.URL)
	h.cache = &infoVersion{Version: "2.3.6", URL: "https://ejemplo/apk"}
	h.cachedAt = time.Now().Add(-time.Hour)
	if code, info := pedir(t, h); code != http.StatusOK || info.Version != "2.3.6" {
		t.Fatalf("code=%d info=%+v, esperaba la 2.3.6 de la cache", code, info)
	}
}

// Una falla pasajera al bajar las novedades (un 502, una descarga cortada) no
// puede dejar la barrera sin lista los diez minutos de la cache, justo cuando
// mas gente la ve. Un release sin notas (404) si es definitivo.
func TestGetLatest_NovedadesConFallaPasajeraSeReintentanPronto(t *testing.T) {
	for _, caso := range []struct {
		nombre    string
		primera   int
		reintenta bool
	}{
		{"falla pasajera", http.StatusBadGateway, true},
		{"release sin notas", http.StatusNotFound, false},
	} {
		t.Run(caso.nombre, func(t *testing.T) {
			api := servidorAPI(t, http.StatusOK, false)
			defer api.Close()
			web := servidorWeb(t, true)
			defer web.Close()
			var pedidas atomic.Int32
			notas := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if pedidas.Add(1) == 1 {
					w.WriteHeader(caso.primera)
					return
				}
				_, _ = w.Write([]byte(`{"version":"2.3.6","cambios":["Uno"]}`))
			}))
			defer notas.Close()
			h := handlerDePrueba(api.URL, web.URL)
			h.notasFmt = notas.URL + "/download/%s/notas.json"

			if _, info := pedir(t, h); len(info.Notas) != 0 {
				t.Fatalf("primera: notes=%q, esperaba vacia", info.Notas)
			}
			// Dos minutos despues: dentro de los diez de la cache normal.
			h.mu.Lock()
			h.cachedAt = time.Now().Add(-2 * time.Minute)
			h.mu.Unlock()
			_, info := pedir(t, h)
			if caso.reintenta && !reflect.DeepEqual(info.Notas, []string{"Uno"}) {
				t.Fatalf("segunda: notes=%q, esperaba [Uno]: la falla pasajera no debia quedar en cache", info.Notas)
			}
			if !caso.reintenta && pedidas.Load() != 1 {
				t.Fatalf("pidio las notas %d veces: un release sin notas es definitivo y va a la cache", pedidas.Load())
			}
		})
	}
}

// Con la cache vacia (un despliegue, o recien vencida) y muchos telefonos a la
// vez, cada peticion salia a GitHub por su cuenta. Una sola consulta basta.
func TestGetLatest_PeticionesSimultaneasConsultanUnaSolaVez(t *testing.T) {
	var aLaAPI, aLasNotas atomic.Int32
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		aLaAPI.Add(1)
		time.Sleep(50 * time.Millisecond)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"tag_name":"v2.3.6","assets":[{"name":"kiramopay.apk","browser_download_url":"https://ejemplo/apk"}]}`))
	}))
	defer api.Close()
	web := servidorWeb(t, true)
	defer web.Close()
	notas := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		aLasNotas.Add(1)
		_, _ = w.Write([]byte(`{"version":"2.3.6","cambios":["Uno"]}`))
	}))
	defer notas.Close()
	h := handlerDePrueba(api.URL, web.URL)
	h.notasFmt = notas.URL + "/download/%s/notas.json"

	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			rec := httptest.NewRecorder()
			h.GetLatest(rec, httptest.NewRequest(http.MethodGet, "/api/v1/app/version", nil))
			if rec.Code != http.StatusOK {
				t.Errorf("code=%d", rec.Code)
			}
		}()
	}
	wg.Wait()
	if aLaAPI.Load() != 1 || aLasNotas.Load() != 1 {
		t.Fatalf("API %d veces y notas %d veces, esperaba una de cada una", aLaAPI.Load(), aLasNotas.Load())
	}
}

// ── Actualizacion interna ────────────────────────────────────────────────────
// Cuando la version nueva solo cambia la capa web, la app la baja por dentro en
// vez de pedir otro APK. El CI adjunta al release, por plataforma, el paquete
// web (kiramopay-web-<plataforma>.zip) y su manifiesto firmado
// (actualizacion-<plataforma>.json). El servidor no verifica la firma: la
// verifica el telefono con la llave que trae el binario. Aca solo se pasa lo
// publicado, sin ofrecer un paquete que no existe o que es de otra version.

type adjunto struct {
	status int
	cuerpo string
}

// Release con adjuntos, servido como GitHub: la descarga redirige al
// almacenamiento de objetos, que responde el archivo. Cuenta cuantas veces se
// pidio cada uno.
func servidorAdjuntos(t *testing.T, tag string, adjuntos map[string]adjunto) (*httptest.Server, *sync.Map) {
	t.Helper()
	pedidos := &sync.Map{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if nombre, ok := strings.CutPrefix(r.URL.Path, "/download/"+tag+"/"); ok {
			http.Redirect(w, r, "/objetos/"+nombre, http.StatusFound)
			return
		}
		nombre, ok := strings.CutPrefix(r.URL.Path, "/objetos/")
		a, existe := adjuntos[nombre]
		if !ok || !existe {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		n, _ := pedidos.LoadOrStore(nombre, new(atomic.Int32))
		n.(*atomic.Int32).Add(1)
		if a.status != http.StatusOK {
			w.WriteHeader(a.status)
			return
		}
		if r.Header.Get("Range") != "" {
			w.WriteHeader(http.StatusPartialContent)
			_, _ = w.Write([]byte(a.cuerpo[:1]))
			return
		}
		_, _ = w.Write([]byte(a.cuerpo))
	}))
	return srv, pedidos
}

func vecesPedido(pedidos *sync.Map, nombre string) int32 {
	if n, ok := pedidos.Load(nombre); ok {
		return n.(*atomic.Int32).Load()
	}
	return 0
}

// El manifiesto como lo publica scripts/paquete-web.mjs: el JSON firmado va en
// base64, junto con su firma.
func manifiestoPublicado(version, plataforma string) (cuerpo, manifiesto string) {
	m := fmt.Sprintf(`{"formato":1,"plataforma":%q,"version":%q,"versionCode":19,"nativaMinima":19,`+
		`"huellaNativa":"h","paquete":"kiramopay-web-%s.zip","firmaPaquete":"Zg==","bytes":10}`, plataforma, version, plataforma)
	manifiesto = base64.StdEncoding.EncodeToString([]byte(m))
	return fmt.Sprintf(`{"manifiesto":%q,"firma":"ZmlybWE="}`, manifiesto), manifiesto
}

func conPaquetes(api, web, adjuntos string) *Handler {
	h := handlerDePrueba(api, web)
	h.manifiestoFmt = adjuntos + "/download/%s/actualizacion-%s.json"
	h.paqueteFmt = adjuntos + "/download/%s/kiramopay-web-%s.zip"
	return h
}

func releaseCompleto(plataformas ...string) (map[string]adjunto, map[string]string) {
	adjuntos := map[string]adjunto{}
	manifiestos := map[string]string{}
	for _, p := range plataformas {
		cuerpo, m := manifiestoPublicado("2.3.6", p)
		adjuntos["actualizacion-"+p+".json"] = adjunto{http.StatusOK, cuerpo}
		adjuntos["kiramopay-web-"+p+".zip"] = adjunto{http.StatusOK, "PK"}
		manifiestos[p] = m
	}
	return adjuntos, manifiestos
}

// En Render la API suele estar sin cuota y la version sale por la redireccion:
// ese camino tambien tiene que traer el paquete.
func TestPaqueteWeb_PorLaRedireccionAndroidRecibeElManifiestoFirmado(t *testing.T) {
	api := servidorAPI(t, http.StatusForbidden, true)
	defer api.Close()
	web := servidorWeb(t, true)
	defer web.Close()
	contenido, manifiestos := releaseCompleto("android")
	adj, _ := servidorAdjuntos(t, "v2.3.6", contenido)
	defer adj.Close()

	code, info := pedir(t, conPaquetes(api.URL, web.URL, adj.URL))
	if code != http.StatusOK || info.Web == nil {
		t.Fatalf("code=%d info=%+v, esperaba 200 con el paquete web", code, info)
	}
	if info.Web.Manifest != manifiestos["android"] || info.Web.Signature != "ZmlybWE=" {
		t.Fatalf("web=%+v, esperaba el manifiesto y la firma tal cual se publicaron", info.Web)
	}
	if want := adj.URL + "/download/v2.3.6/kiramopay-web-android.zip"; info.Web.URL != want {
		t.Fatalf("url del paquete=%q, esperaba %q", info.Web.URL, want)
	}
	// El APK sigue ahi: es el camino cuando cambia lo nativo.
	if info.URL == "" {
		t.Fatalf("sin URL del APK")
	}
}

// Por la API los adjuntos vienen en la lista del release: no hace falta
// confirmar el .zip pidiendolo.
func TestPaqueteWeb_PorLaAPIUsaLosAdjuntosDelRelease(t *testing.T) {
	contenido, manifiestos := releaseCompleto("android")
	adj, pedidos := servidorAdjuntos(t, "v2.3.6", contenido)
	defer adj.Close()
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprintf(w, `{"tag_name":"v2.3.6","assets":[
			{"name":"kiramopay.apk","browser_download_url":"https://ejemplo/apk"},
			{"name":"actualizacion-android.json","browser_download_url":"%[1]s/download/v2.3.6/actualizacion-android.json"},
			{"name":"kiramopay-web-android.zip","browser_download_url":"%[1]s/download/v2.3.6/kiramopay-web-android.zip"}]}`, adj.URL)
	}))
	defer api.Close()
	web := servidorWeb(t, true)
	defer web.Close()

	code, info := pedir(t, conPaquetes(api.URL, web.URL, adj.URL))
	if code != http.StatusOK || info.Web == nil || info.Web.Manifest != manifiestos["android"] {
		t.Fatalf("code=%d info=%+v, esperaba el paquete de la lista del release", code, info)
	}
	if want := adj.URL + "/download/v2.3.6/kiramopay-web-android.zip"; info.Web.URL != want {
		t.Fatalf("url=%q, esperaba la del adjunto %q", info.Web.URL, want)
	}
	if n := vecesPedido(pedidos, "kiramopay-web-android.zip"); n != 0 {
		t.Fatalf("pidio el .zip %d veces: la lista del release ya dice que existe", n)
	}
}

// Un release sin paquete (todos los anteriores a este cambio), o con uno que no
// sirve, no deja a nadie sin actualizar: se ofrece el APK, como siempre.
func TestPaqueteWeb_SinPaqueteUtilSeOfreceSoloElAPK(t *testing.T) {
	deOtraVersion, _ := manifiestoPublicado("2.3.5", "android")
	deOtraPlataforma, _ := manifiestoPublicado("2.3.6", "ios")
	completo, _ := releaseCompleto("android")
	sinZip := map[string]adjunto{"actualizacion-android.json": completo["actualizacion-android.json"]}
	for _, caso := range []struct {
		nombre   string
		adjuntos map[string]adjunto
	}{
		{"sin manifiesto", map[string]adjunto{"kiramopay-web-android.zip": {http.StatusOK, "PK"}}},
		{"manifiesto roto", map[string]adjunto{
			"actualizacion-android.json": {http.StatusOK, "no es json"},
			"kiramopay-web-android.zip":  {http.StatusOK, "PK"},
		}},
		{"manifiesto sin firma", map[string]adjunto{
			"actualizacion-android.json": {http.StatusOK, `{"manifiesto":"e30=","firma":""}`},
			"kiramopay-web-android.zip":  {http.StatusOK, "PK"},
		}},
		{"manifiesto de otra version", map[string]adjunto{
			"actualizacion-android.json": {http.StatusOK, deOtraVersion},
			"kiramopay-web-android.zip":  {http.StatusOK, "PK"},
		}},
		{"manifiesto de la otra plataforma", map[string]adjunto{
			"actualizacion-android.json": {http.StatusOK, deOtraPlataforma},
			"kiramopay-web-android.zip":  {http.StatusOK, "PK"},
		}},
		{"sin el zip", sinZip},
	} {
		t.Run(caso.nombre, func(t *testing.T) {
			api := servidorAPI(t, http.StatusForbidden, true)
			defer api.Close()
			web := servidorWeb(t, true)
			defer web.Close()
			adj, _ := servidorAdjuntos(t, "v2.3.6", caso.adjuntos)
			defer adj.Close()

			rec := httptest.NewRecorder()
			conPaquetes(api.URL, web.URL, adj.URL).GetLatest(rec, httptest.NewRequest(http.MethodGet, "/api/v1/app/version", nil))
			if rec.Code != http.StatusOK {
				t.Fatalf("code=%d, esperaba 200 con el APK", rec.Code)
			}
			// Sin "web" en la respuesta: los APK viejos no lo conocen y los
			// nuevos van por el APK.
			if strings.Contains(rec.Body.String(), `"web"`) || !strings.Contains(rec.Body.String(), `kiramopay.apk`) {
				t.Fatalf("body=%s, esperaba solo el APK", rec.Body.String())
			}
		})
	}
}

func TestPaqueteWeb_CadaPlataformaRecibeElSuyo(t *testing.T) {
	api := servidorAPI(t, http.StatusForbidden, true)
	defer api.Close()
	web := servidorWeb(t, true)
	defer web.Close()
	contenido, manifiestos := releaseCompleto("android", "ios")
	adj, _ := servidorAdjuntos(t, "v2.3.6", contenido)
	defer adj.Close()
	h := conPaquetes(api.URL, web.URL, adj.URL)
	h.iosUpdateURL = "https://testflight.apple.com/join/abc123"

	_, android := pedirPlataforma(t, h, "?platform=android")
	_, ios := pedirPlataforma(t, h, "?platform=ios")
	if android.Web == nil || android.Web.Manifest != manifiestos["android"] || !strings.HasSuffix(android.Web.URL, "/kiramopay-web-android.zip") {
		t.Fatalf("android web=%+v, esperaba el paquete de android", android.Web)
	}
	if ios.Web == nil || ios.Web.Manifest != manifiestos["ios"] || !strings.HasSuffix(ios.Web.URL, "/kiramopay-web-ios.zip") {
		t.Fatalf("ios web=%+v, esperaba el paquete de ios", ios.Web)
	}
	if ios.URL != h.iosUpdateURL {
		t.Fatalf("ios url=%q, esperaba el canal", ios.URL)
	}
}

// Sin canal de iOS (no hay TestFlight ni App Store todavia) la capa web igual
// se puede actualizar por dentro. Antes esto respondia 503 sin mirar nada.
func TestPaqueteWeb_IOSSinCanalPeroConPaqueteSeOfrece(t *testing.T) {
	api := servidorAPI(t, http.StatusForbidden, true)
	defer api.Close()
	web := servidorWeb(t, true)
	defer web.Close()
	contenido, manifiestos := releaseCompleto("android", "ios")
	adj, _ := servidorAdjuntos(t, "v2.3.6", contenido)
	defer adj.Close()

	code, info := pedirPlataforma(t, conPaquetes(api.URL, web.URL, adj.URL), "?platform=ios")
	if code != http.StatusOK || info.Web == nil || info.Web.Manifest != manifiestos["ios"] {
		t.Fatalf("code=%d info=%+v, esperaba 200 con el paquete de ios", code, info)
	}
	if info.URL != "" || info.Version != "2.3.6" {
		t.Fatalf("info=%+v, esperaba la 2.3.6 sin canal (url vacia)", info)
	}
}

func TestPaqueteWeb_IOSSinCanalNiPaqueteSigueSinOfrecer(t *testing.T) {
	api := servidorAPI(t, http.StatusForbidden, true)
	defer api.Close()
	web := servidorWeb(t, true)
	defer web.Close()
	contenido, _ := releaseCompleto("android")
	adj, _ := servidorAdjuntos(t, "v2.3.6", contenido)
	defer adj.Close()

	if code, info := pedirPlataforma(t, conPaquetes(api.URL, web.URL, adj.URL), "?platform=ios"); code != http.StatusServiceUnavailable {
		t.Fatalf("code=%d info=%+v, esperaba 503: ni canal ni paquete", code, info)
	}
}

// Una falla pasajera al bajar el manifiesto no deja a todos por el APK los
// diez minutos de la cache.
func TestPaqueteWeb_FallaPasajeraSeReintentaPronto(t *testing.T) {
	api := servidorAPI(t, http.StatusForbidden, true)
	defer api.Close()
	web := servidorWeb(t, true)
	defer web.Close()
	cuerpo, manifiesto := manifiestoPublicado("2.3.6", "android")
	var pedidas atomic.Int32
	adj := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasSuffix(r.URL.Path, "/actualizacion-android.json"):
			if pedidas.Add(1) == 1 {
				w.WriteHeader(http.StatusBadGateway)
				return
			}
			_, _ = w.Write([]byte(cuerpo))
		case strings.HasSuffix(r.URL.Path, "/kiramopay-web-android.zip"):
			w.WriteHeader(http.StatusPartialContent)
			_, _ = w.Write([]byte("P"))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer adj.Close()
	h := conPaquetes(api.URL, web.URL, adj.URL)

	if _, info := pedir(t, h); info.Web != nil {
		t.Fatalf("primera: web=%+v, esperaba sin paquete por la falla", info.Web)
	}
	h.mu.Lock()
	h.cachedAt = time.Now().Add(-2 * time.Minute)
	h.mu.Unlock()
	if _, info := pedir(t, h); info.Web == nil || info.Web.Manifest != manifiesto {
		t.Fatalf("segunda: web=%+v, la falla pasajera no debia quedar diez minutos en cache", info.Web)
	}
}

// El refresco de la cache sirve a todos: si el telefono que lo disparo corta la
// conexion a mitad, los demas no pueden quedarse un minuto sin el paquete (en
// Android eso es la barrera del APK).
func TestPaqueteWeb_UnTelefonoQueCortaNoDejaATodosSinPaquete(t *testing.T) {
	api := servidorAPI(t, http.StatusForbidden, true)
	defer api.Close()
	web := servidorWeb(t, true)
	defer web.Close()
	cuerpo, manifiesto := manifiestoPublicado("2.3.6", "android")
	llego := make(chan struct{}, 1)
	cortado := make(chan struct{})
	adj := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasSuffix(r.URL.Path, "/actualizacion-android.json"):
			select {
			case llego <- struct{}{}:
			default:
			}
			// GitHub contesta recien despues de que el telefono corto.
			<-cortado
			_, _ = w.Write([]byte(cuerpo))
		case strings.HasSuffix(r.URL.Path, "/kiramopay-web-android.zip"):
			w.WriteHeader(http.StatusPartialContent)
			_, _ = w.Write([]byte("P"))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer adj.Close()
	h := conPaquetes(api.URL, web.URL, adj.URL)

	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		<-llego
		cancel()
		close(cortado)
	}()
	rec := httptest.NewRecorder()
	h.GetLatest(rec, httptest.NewRequest(http.MethodGet, "/api/v1/app/version?platform=android", nil).WithContext(ctx))

	if _, info := pedir(t, h); info.Web == nil || info.Web.Manifest != manifiesto {
		t.Fatalf("otro telefono: web=%+v, el corte de uno no puede dejar a todos sin el paquete", info.Web)
	}
}

// En produccion los paquetes se buscan en los adjuntos del release que publican
// los workflows del tag.
func TestNewHandler_BuscaLosPaquetesEnElRelease(t *testing.T) {
	h := NewHandler()
	if got, want := fmt.Sprintf(h.manifiestoFmt, "v2.9.0", "android"),
		"https://github.com/keylormr/kiramopay/releases/download/v2.9.0/actualizacion-android.json"; got != want {
		t.Fatalf("manifiestoFmt da %q, esperaba %q", got, want)
	}
	if got, want := fmt.Sprintf(h.paqueteFmt, "v2.9.0", "ios"),
		"https://github.com/keylormr/kiramopay/releases/download/v2.9.0/kiramopay-web-ios.zip"; got != want {
		t.Fatalf("paqueteFmt da %q, esperaba %q", got, want)
	}
}
