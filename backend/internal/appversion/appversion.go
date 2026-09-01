// Package appversion expone la ultima version publicada del APK para que la
// app instalada detecte actualizaciones y ofrezca bajarlas en un toque, sin
// depender de una tienda. La fuente es el ultimo release de GitHub (el mismo
// que alimenta el boton de descarga del login), consultado con cache en
// memoria para que mil telefonos no golpeen la API de GitHub: sin token, el
// limite es 60 peticiones/hora por IP y el backend es UNA IP.
package appversion

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/kiramopay/backend/pkg/response"
)

const (
	releaseURL = "https://api.github.com/repos/keylormr/kiramopay/releases/latest"
	cacheTTL   = 10 * time.Minute
)

type infoVersion struct {
	Version string `json:"version"`
	URL     string `json:"url"`
}

type Handler struct {
	mu       sync.Mutex
	cache    *infoVersion
	cachedAt time.Time
	client   *http.Client
}

func NewHandler() *Handler {
	return &Handler{client: &http.Client{Timeout: 10 * time.Second}}
}

// GetLatest responde {version, url} del ultimo APK publicado. Publico: la app
// lo consulta ANTES de saber si hay sesion. Si GitHub no responde y no hay
// cache, devuelve 503 y la app simplemente no ofrece actualizar esta vez.
func (h *Handler) GetLatest(w http.ResponseWriter, r *http.Request) {
	h.mu.Lock()
	if h.cache != nil && time.Since(h.cachedAt) < cacheTTL {
		info := *h.cache
		h.mu.Unlock()
		response.JSON(w, http.StatusOK, info)
		return
	}
	h.mu.Unlock()

	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, releaseURL, nil)
	if err != nil {
		response.Error(w, http.StatusServiceUnavailable, "VERSION_UNAVAILABLE", "version check failed")
		return
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	resp, err := h.client.Do(req)
	if err != nil {
		h.responderCacheViejaOFallo(w)
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		slog.Warn("app version: GitHub respondio non-200", "status", resp.StatusCode)
		h.responderCacheViejaOFallo(w)
		return
	}

	var release struct {
		TagName string `json:"tag_name"`
		Assets  []struct {
			Name               string `json:"name"`
			BrowserDownloadURL string `json:"browser_download_url"`
		} `json:"assets"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&release); err != nil {
		h.responderCacheViejaOFallo(w)
		return
	}

	info := infoVersion{Version: strings.TrimPrefix(release.TagName, "v")}
	for _, a := range release.Assets {
		if strings.HasSuffix(a.Name, ".apk") {
			info.URL = a.BrowserDownloadURL
			break
		}
	}
	if info.Version == "" || info.URL == "" {
		h.responderCacheViejaOFallo(w)
		return
	}

	h.mu.Lock()
	h.cache = &info
	h.cachedAt = time.Now()
	h.mu.Unlock()
	response.JSON(w, http.StatusOK, info)
}

// Con GitHub caido, una cache vencida sigue siendo mejor que nada; sin cache,
// 503 honesto.
func (h *Handler) responderCacheViejaOFallo(w http.ResponseWriter) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.cache != nil {
		response.JSON(w, http.StatusOK, *h.cache)
		return
	}
	response.Error(w, http.StatusServiceUnavailable, "VERSION_UNAVAILABLE", "version check failed")
}
