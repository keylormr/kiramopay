// Package appversion expone la ultima version publicada del APK para que la
// app instalada detecte actualizaciones y ofrezca bajarlas en un toque, sin
// depender de una tienda.
//
// La fuente es el ultimo release de GitHub, por DOS caminos:
//
//  1. La API (api.github.com), que es autoritativa: da el nombre real de cada
//     archivo adjunto. Sin token su limite son 60 peticiones por hora POR IP, y
//     el backend sale por una IP COMPARTIDA de Render: la cuota se agota con lo
//     que hagan los demas inquilinos, no con lo nuestro. Eso tumbo el aviso de
//     actualizacion justo despues de publicar la 2.3.6 y los telefonos en 2.3.5
//     no se enteraron. Con GITHUB_TOKEN configurado el limite sube a 5000/hora.
//  2. La redireccion de github.com/<repo>/releases/latest, que NO pasa por la
//     API ni tiene ese limite: su cabecera Location trae el tag. Con el tag, la
//     URL del APK es deterministica porque el nombre lo fija nuestro propio CI.
//
// Se intenta la API primero y se cae al segundo camino; lo que funcione se
// cachea, para que mil telefonos no golpeen a GitHub.
//
// Toda version nueva es obligatoria, y el aviso dice que trae. La app instalada
// no conoce el changelog de la version que todavia no tiene: lo lee de aca. El
// CI adjunta a cada release un notas.json armado desde src/config/version.ts, y
// se baja por la URL de descarga, que tampoco pasa por la API, asi que los dos
// caminos lo traen. Sin notas (los releases anteriores a la 2.8.0, o una
// descarga que falla) la version se ofrece igual con la lista vacia: no saber
// que trae no es motivo para no exigirla. Una falla pasajera de las notas se
// cachea solo un minuto, no los diez de siempre.
//
// Como la actualizacion es obligatoria, ofrecer una version cuyo APK no existe
// deja a la gente frente a una barrera con un boton que da 404. Los dos
// workflows del tag publican en el mismo release, y si iOS termina primero o el
// de Android falla, el release queda sin .apk. La API lo rechaza sola; la
// redireccion no ve los adjuntos, asi que confirma el APK antes de ofrecerlo.
//
// Actualizacion interna: cuando la version nueva solo cambia la capa web, la
// app la baja por dentro en vez de pedir otro binario. Los workflows del tag
// adjuntan al release, por plataforma, el paquete (kiramopay-web-<p>.zip) y su
// manifiesto firmado (actualizacion-<p>.json), y la respuesta los pasa en
// "web". El servidor no verifica la firma ni decide si el paquete le sirve al
// telefono: eso lo hace la app, con la llave que trae el binario
// (src/utils/paqueteFirmado.ts y src/hooks/useActualizacion.ts). Aca solo se
// cuida no ofrecer un paquete que no existe o que es de otra version o de otra
// plataforma; ante cualquier duda se omite y la app va por el binario.
//
// Las dos plataformas comparten la VERSION pero no la URL, porque no se
// actualizan igual:
//
//   - Android baja el .apk del release y el sistema lo instala encima (misma
//     firma, versionCode creciente). La URL sale del propio release.
//   - iOS no puede instalar un binario bajado de un link. Actualizar es siempre
//     mandar al usuario a su canal: TestFlight, App Store, o un manifiesto OTA
//     itms-services:// si la distribucion es Ad Hoc. Cual de los tres se
//     configura con IOS_UPDATE_URL. Sin esa variable no hay canal: la app iOS
//     solo se actualiza por dentro, y si tampoco hay paquete no se ofrece nada,
//     que es preferible a un boton que no lleva a ningun lado.
package appversion

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/kiramopay/backend/pkg/response"
)

const (
	apiURL      = "https://api.github.com/repos/keylormr/kiramopay/releases/latest"
	webURL      = "https://github.com/keylormr/kiramopay/releases/latest"
	descargaFmt = "https://github.com/keylormr/kiramopay/releases/download/%s/kiramopay.apk"
	notasFmt    = "https://github.com/keylormr/kiramopay/releases/download/%s/notas.json"
	// Por tag y plataforma; los nombres los fija scripts/paquete-web.mjs.
	manifiestoFmt = "https://github.com/keylormr/kiramopay/releases/download/%s/actualizacion-%s.json"
	paqueteFmt    = "https://github.com/keylormr/kiramopay/releases/download/%s/kiramopay-web-%s.zip"
	cacheTTL      = 10 * time.Minute
	// Cuando las novedades fallaron por algo pasajero (un 5xx, un corte):
	// se vuelven a buscar pronto.
	cacheTTLProvisional = time.Minute
	// Un changelog son unas decenas de lineas; esto sobra y corta un adjunto
	// equivocado antes de leerlo entero.
	maxNotas = 64 << 10
	// Un manifiesto firmado ocupa menos de 2 KiB.
	maxManifiesto = 16 << 10
)

var plataformas = []string{"android", "ios"}

type infoVersion struct {
	Version string   `json:"version"`
	URL     string   `json:"url"`
	Notas   []string `json:"notes"`
	// La capa web de la plataforma que pregunta, si el release la trae. Se
	// omite si no: los binarios viejos no conocen el campo.
	Web *infoWeb `json:"web,omitempty"`

	// Lo que se guarda en cache y no sale tal cual: el paquete de cada
	// plataforma, y los adjuntos del release cuando se leyo por la API.
	paquetes map[string]*infoWeb
	adjuntos map[string]string
}

// infoWeb es lo que la app necesita para actualizar por dentro: el manifiesto
// firmado (base64) y su firma, tal cual los publico el CI, y la URL del .zip.
type infoWeb struct {
	Manifest  string `json:"manifest"`
	Signature string `json:"signature"`
	URL       string `json:"url"`
}

type Handler struct {
	mu       sync.Mutex
	cache    *infoVersion
	cachedAt time.Time
	// Vigencia de la cache actual; cero es cacheTTL.
	cacheVigencia time.Duration
	// Una sola consulta a GitHub a la vez: con la cache vacia y mil
	// telefonos, los demas esperan y usan lo que trajo la primera.
	refresco sync.Mutex
	client   *http.Client
	// Para el notas.json y para confirmar el APK: la descarga de un adjunto
	// responde con una redireccion al almacenamiento de objetos, y este
	// cliente si la sigue.
	clienteDescargas *http.Client
	// Canal de actualizacion de iOS (IOS_UPDATE_URL). Vacio mientras no exista
	// distribucion iOS; ver el comentario del paquete.
	iosUpdateURL string
	// Inyectables para las pruebas; en produccion son las constantes de arriba.
	apiURL        string
	webURL        string
	descargaFmt   string
	notasFmt      string
	manifiestoFmt string
	paqueteFmt    string
	token         string
}

func NewHandler() *Handler {
	return &Handler{
		// Sin seguir redirecciones: el camino web necesita LEER el Location,
		// no ir a buscar la pagina HTML del release (que serian cientos de KB
		// por peticion para extraer un numero de version).
		client: &http.Client{
			Timeout:       10 * time.Second,
			CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
		},
		clienteDescargas: &http.Client{Timeout: 3 * time.Second},
		apiURL:           apiURL,
		webURL:           webURL,
		descargaFmt:      descargaFmt,
		notasFmt:         notasFmt,
		manifiestoFmt:    manifiestoFmt,
		paqueteFmt:       paqueteFmt,
		// Opcional: sube el limite de la API de 60 a 5000 por hora. Sin el, el
		// camino web hace el trabajo igual.
		token:        os.Getenv("GITHUB_TOKEN"),
		iosUpdateURL: strings.TrimSpace(os.Getenv("IOS_UPDATE_URL")),
	}
}

// GetLatest responde {version, url, notes, web} de la ultima version publicada:
// url es el binario (o el canal de iOS) y web, si existe, la capa web para
// actualizar por dentro. Publico: la app lo consulta ANTES de saber si hay
// sesion. Si los dos caminos fallan y no hay cache, devuelve 503 y la app
// simplemente no ofrece actualizar esta vez.
func (h *Handler) GetLatest(w http.ResponseWriter, r *http.Request) {
	// Sin parametro se asume android: los APK ya instalados llaman a este
	// endpoint sin plataforma y tienen que seguir recibiendo la URL del .apk.
	plataforma := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("platform")))
	if plataforma == "" {
		plataforma = "android"
	}
	if plataforma != "android" && plataforma != "ios" {
		response.Error(w, http.StatusBadRequest, "VALIDATION_ERROR", "platform must be android or ios")
		return
	}

	if info, ok := h.cacheVigente(); ok {
		h.responder(w, info, plataforma)
		return
	}
	h.refresco.Lock()
	defer h.refresco.Unlock()
	// Mientras se esperaba, otra peticion pudo haberla llenado.
	if info, ok := h.cacheVigente(); ok {
		h.responder(w, info, plataforma)
		return
	}

	info, err := h.desdeAPI(r)
	if err != nil {
		slog.Warn("app version: la API de GitHub no sirvio, se prueba la redireccion web", "err", err)
		info, err = h.desdeRedireccion(r)
	}
	if err != nil {
		slog.Warn("app version: ningun camino a GitHub funciono", "err", err)
		h.responderCacheViejaOFallo(w, plataforma)
		return
	}

	// Las novedades y el paquete de cada plataforma son descargas
	// independientes: se piden a la vez.
	var (
		wg                  sync.WaitGroup
		notasDefinitivas    bool
		paquetesDefinitivos = make([]bool, len(plataformas))
		paquetesPlataforma  = make([]*infoWeb, len(plataformas))
	)
	wg.Add(1 + len(plataformas))
	go func() {
		defer wg.Done()
		info.Notas, notasDefinitivas = h.notasDe(r, info.Version)
	}()
	for i, p := range plataformas {
		go func() {
			defer wg.Done()
			paquetesPlataforma[i], paquetesDefinitivos[i] = h.paqueteDe(r, info, p)
		}()
	}
	wg.Wait()
	definitivo := notasDefinitivas
	info.paquetes = map[string]*infoWeb{}
	for i, p := range plataformas {
		if paquetesPlataforma[i] != nil {
			info.paquetes[p] = paquetesPlataforma[i]
		}
		definitivo = definitivo && paquetesDefinitivos[i]
	}

	h.mu.Lock()
	h.cache = info
	h.cachedAt = time.Now()
	h.cacheVigencia = cacheTTL
	if !definitivo {
		h.cacheVigencia = cacheTTLProvisional
	}
	h.mu.Unlock()
	h.responder(w, *info, plataforma)
}

// responder arma la respuesta de la plataforma. iOS sin canal y sin paquete no
// tiene por donde actualizar: no es un fallo del servicio, y se responde 503,
// que es lo que la app ya sabe tolerar en silencio.
func (h *Handler) responder(w http.ResponseWriter, info infoVersion, plataforma string) {
	resp := h.paraPlataforma(info, plataforma)
	if plataforma == "ios" && resp.URL == "" && resp.Web == nil {
		response.Error(w, http.StatusServiceUnavailable, "VERSION_UNAVAILABLE", "no ios update channel configured")
		return
	}
	response.JSON(w, http.StatusOK, resp)
}

// cacheVigente devuelve la respuesta cacheada si todavia vale.
func (h *Handler) cacheVigente() (infoVersion, bool) {
	h.mu.Lock()
	defer h.mu.Unlock()
	vigencia := h.cacheVigencia
	if vigencia <= 0 {
		vigencia = cacheTTL
	}
	if h.cache == nil || time.Since(h.cachedAt) >= vigencia {
		return infoVersion{}, false
	}
	return *h.cache, true
}

// paraPlataforma adapta la respuesta cacheada (que es la de Android, con la URL
// del .apk) a la plataforma que pregunta. La version es la misma en las dos:
// sale del tag del release.
func (h *Handler) paraPlataforma(info infoVersion, plataforma string) infoVersion {
	if plataforma == "ios" {
		info.URL = h.iosUpdateURL
	}
	// Nunca null: la pantalla recorre la lista. Una cache de antes de las
	// novedades no las trae.
	if info.Notas == nil {
		info.Notas = []string{}
	}
	info.Web = info.paquetes[plataforma]
	return info
}

// paqueteDe lee el manifiesto firmado de la plataforma en el release y confirma
// que el .zip existe. Devuelve nil si no hay paquete util, y si el resultado es
// definitivo (no lo hay, o no sirve) o una falla pasajera que conviene
// reintentar pronto (red, corte, 5xx).
func (h *Handler) paqueteDe(r *http.Request, info *infoVersion, plataforma string) (*infoWeb, bool) {
	if h.manifiestoFmt == "" || h.paqueteFmt == "" {
		return nil, true
	}
	tag := "v" + info.Version
	nombreManifiesto := "actualizacion-" + plataforma + ".json"
	nombrePaquete := "kiramopay-web-" + plataforma + ".zip"
	urlManifiesto := fmt.Sprintf(h.manifiestoFmt, tag, plataforma)
	urlPaquete := fmt.Sprintf(h.paqueteFmt, tag, plataforma)
	// Por la API se sabe que adjuntos tiene el release: sin los dos, no hay
	// paquete y no hace falta pedir nada.
	if info.adjuntos != nil {
		m, okM := info.adjuntos[nombreManifiesto]
		z, okZ := info.adjuntos[nombrePaquete]
		if !okM || !okZ {
			return nil, true
		}
		urlManifiesto, urlPaquete = m, z
	}

	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, urlManifiesto, nil)
	if err != nil {
		return nil, true
	}
	resp, err := h.clienteDescargas.Do(req)
	if err != nil {
		slog.Warn("app version: no se pudo bajar el manifiesto del paquete", "version", info.Version, "plataforma", plataforma, "err", err)
		return nil, false
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		// 404: un release sin actualizacion interna (los anteriores a la 2.9.0).
		return nil, resp.StatusCode < 500
	}
	var publicado struct {
		Manifiesto string `json:"manifiesto"`
		Firma      string `json:"firma"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, maxManifiesto)).Decode(&publicado); err != nil ||
		publicado.Manifiesto == "" || publicado.Firma == "" {
		slog.Warn("app version: el manifiesto del paquete no es valido", "version", info.Version, "plataforma", plataforma, "err", err)
		return nil, true
	}
	crudo, err := base64.StdEncoding.DecodeString(publicado.Manifiesto)
	var campos struct {
		Version    string `json:"version"`
		Plataforma string `json:"plataforma"`
		Paquete    string `json:"paquete"`
	}
	if err != nil || json.Unmarshal(crudo, &campos) != nil {
		slog.Warn("app version: el manifiesto del paquete no se puede leer", "version", info.Version, "plataforma", plataforma)
		return nil, true
	}
	// Un adjunto subido al release o a la plataforma equivocados no se ofrece:
	// la app lo rechazaria igual, pero iria por el binario sin necesidad.
	if campos.Version != info.Version || campos.Plataforma != plataforma || campos.Paquete != nombrePaquete {
		slog.Warn("app version: el manifiesto del paquete no corresponde", "release", info.Version, "plataforma", plataforma,
			"manifiesto_version", campos.Version, "manifiesto_plataforma", campos.Plataforma)
		return nil, true
	}
	if info.adjuntos == nil {
		if err := h.existeDescarga(r, urlPaquete); err != nil {
			slog.Warn("app version: el release no tiene el paquete web", "version", info.Version, "plataforma", plataforma, "err", err)
			return nil, false
		}
	}
	return &infoWeb{Manifest: publicado.Manifiesto, Signature: publicado.Firma, URL: urlPaquete}, true
}

// notasDe baja el notas.json del release de esa version. Cualquier problema
// (no existe, no es JSON, es de otra version) da una lista vacia y queda en el
// log: la version se exige igual.
// notasDe baja el notas.json del release de esa version. Cualquier problema da
// una lista vacia y queda en el log: la version se exige igual. El segundo
// valor dice si el resultado es definitivo (hay notas, o el release no las
// tiene, o son invalidas) o si fue una falla pasajera que conviene reintentar
// pronto (red, corte, 5xx).
func (h *Handler) notasDe(r *http.Request, version string) ([]string, bool) {
	if h.notasFmt == "" {
		return []string{}, true
	}
	url := fmt.Sprintf(h.notasFmt, "v"+version)
	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, url, nil)
	if err != nil {
		return []string{}, true
	}
	resp, err := h.clienteDescargas.Do(req)
	if err != nil {
		slog.Warn("app version: no se pudieron bajar las novedades", "version", version, "err", err)
		return []string{}, false
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		slog.Warn("app version: el release no trae novedades", "version", version, "status", resp.StatusCode)
		return []string{}, resp.StatusCode < 500
	}
	var notas struct {
		Version string   `json:"version"`
		Cambios []string `json:"cambios"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, maxNotas)).Decode(&notas); err != nil {
		slog.Warn("app version: las novedades no son JSON valido", "version", version, "err", err)
		return []string{}, true
	}
	// Un adjunto subido al release equivocado no puede presentarse como lo que
	// trae esta version.
	if notas.Version != version {
		slog.Warn("app version: las novedades son de otra version", "release", version, "notas", notas.Version)
		return []string{}, true
	}
	limpias := make([]string, 0, len(notas.Cambios))
	for _, c := range notas.Cambios {
		if c = strings.TrimSpace(c); c != "" {
			limpias = append(limpias, c)
		}
	}
	return limpias, true
}

// existeDescarga confirma que el adjunto esta publicado. Pide un solo byte:
// el almacenamiento de objetos de GitHub firma la URL para GET, y un HEAD
// podria rechazarse aunque el archivo exista.
func (h *Handler) existeDescarga(r *http.Request, url string) error {
	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Range", "bytes=0-0")
	resp, err := h.clienteDescargas.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusPartialContent {
		return fmt.Errorf("la descarga %s respondio %d", url, resp.StatusCode)
	}
	return nil
}

// desdeAPI lee el release por la API: es la fuente autoritativa del nombre del
// archivo adjunto (la release lleva tambien el .ipa de iOS, asi que hay que
// elegir el .apk, no el primero).
func (h *Handler) desdeAPI(r *http.Request) (*infoVersion, error) {
	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, h.apiURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	if h.token != "" {
		req.Header.Set("Authorization", "Bearer "+h.token)
	}
	resp, err := h.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		// 403 con la cuota agotada es el caso real en Render; se distingue en
		// el log porque la accion es distinta (configurar GITHUB_TOKEN).
		if resto := resp.Header.Get("X-RateLimit-Remaining"); resto == "0" {
			return nil, fmt.Errorf("cuota de la API de GitHub agotada para esta IP (status %d): configurar GITHUB_TOKEN", resp.StatusCode)
		}
		return nil, fmt.Errorf("la API de GitHub respondio %d", resp.StatusCode)
	}

	var release struct {
		TagName string `json:"tag_name"`
		Assets  []struct {
			Name               string `json:"name"`
			BrowserDownloadURL string `json:"browser_download_url"`
		} `json:"assets"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&release); err != nil {
		return nil, err
	}

	info := infoVersion{Version: strings.TrimPrefix(release.TagName, "v"), adjuntos: map[string]string{}}
	for _, a := range release.Assets {
		info.adjuntos[a.Name] = a.BrowserDownloadURL
		if info.URL == "" && strings.HasSuffix(a.Name, ".apk") {
			info.URL = a.BrowserDownloadURL
		}
	}
	if info.Version == "" || info.URL == "" {
		return nil, fmt.Errorf("el release %q no trae un .apk", release.TagName)
	}
	return &info, nil
}

// desdeRedireccion saca el tag de la cabecera Location de la pagina de releases
// y arma la URL del APK. No pasa por la API, asi que no tiene su limite por IP.
func (h *Handler) desdeRedireccion(r *http.Request) (*infoVersion, error) {
	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, h.webURL, nil)
	if err != nil {
		return nil, err
	}
	resp, err := h.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 300 || resp.StatusCode > 399 {
		return nil, fmt.Errorf("releases/latest respondio %d, se esperaba una redireccion", resp.StatusCode)
	}
	destino := resp.Header.Get("Location")
	i := strings.LastIndex(destino, "/tag/")
	if i < 0 {
		return nil, fmt.Errorf("la redireccion no apunta a un tag: %q", destino)
	}
	tag := destino[i+len("/tag/"):]
	if tag == "" {
		return nil, fmt.Errorf("la redireccion no trae tag: %q", destino)
	}
	descarga := fmt.Sprintf(h.descargaFmt, tag)
	if err := h.existeDescarga(r, descarga); err != nil {
		return nil, fmt.Errorf("el release %s no tiene el APK todavia: %w", tag, err)
	}
	return &infoVersion{
		Version: strings.TrimPrefix(tag, "v"),
		URL:     descarga,
	}, nil
}

// Con GitHub caido, una cache vencida sigue siendo mejor que nada; sin cache,
// 503 honesto.
//
// Recibe la plataforma y adapta igual que los dos caminos de exito. Sin eso
// devolvia la cache TAL CUAL, y la cache siempre guarda la variante de Android:
// un cliente iOS con la cache vencida y GitHub caido recibia la URL del .apk,
// un archivo que en iOS no se puede instalar. Es justo la confusion que la
// respuesta por plataforma vino a evitar.
func (h *Handler) responderCacheViejaOFallo(w http.ResponseWriter, plataforma string) {
	h.mu.Lock()
	cache := h.cache
	h.mu.Unlock()
	if cache != nil {
		h.responder(w, *cache, plataforma)
		return
	}
	response.Error(w, http.StatusServiceUnavailable, "VERSION_UNAVAILABLE", "version check failed")
}
