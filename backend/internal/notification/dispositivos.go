package notification

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"

	"github.com/kiramopay/backend/internal/middleware"
	"github.com/kiramopay/backend/pkg/response"
)

// Telefonos registrados para avisos nativos (FCM). El envio vive en fcm.go; la
// tabla, en la migracion 067.

// PlataformaAndroid es la unica que se acepta hoy. iOS necesita APNs y la
// cuenta de organizacion de Apple; cuando exista se agrega aqui y en el CHECK.
const PlataformaAndroid = "android"

// largoMaximoToken acota lo que se guarda: un token de FCM ronda los 160
// caracteres.
const largoMaximoToken = 4096

var (
	// ErrNativoApagado: el servidor no tiene la cuenta de servicio de FCM.
	ErrNativoApagado = errors.New("notification: native push is not configured")
	// ErrTokenInvalido: token vacio o desmedido.
	ErrTokenInvalido = errors.New("notification: device token is missing or too long")
	// ErrPlataformaInvalida: una plataforma que el servidor no sabe atender.
	ErrPlataformaInvalida = errors.New("notification: unsupported platform")
)

// RegistroDispositivo es lo que manda la app al activar los avisos.
type RegistroDispositivo struct {
	Token      string `json:"token"`
	Plataforma string `json:"plataforma"`
}

// ── Repositorio ─────────────────────────────────────────────────────────────

// GuardarDispositivo registra el token para la cuenta. Si el token ya era de
// otra cuenta (otra persona activo los avisos en el mismo telefono), pasa a
// esta: el telefono es de quien lo esta usando.
func (r *Repository) GuardarDispositivo(ctx context.Context, userID, token, plataforma string) error {
	_, err := r.db.Exec(ctx,
		`INSERT INTO push_dispositivos (user_id, token, plataforma)
		 VALUES ($1::uuid, $2, $3)
		 ON CONFLICT (token) DO UPDATE SET
		   user_id = EXCLUDED.user_id,
		   plataforma = EXCLUDED.plataforma,
		   updated_at = NOW()`,
		userID, token, plataforma,
	)
	return err
}

// BorrarDispositivo da de baja un token de la cuenta. El filtro por cuenta
// impide que alguien de de baja el telefono de otro sabiendo su token.
func (r *Repository) BorrarDispositivo(ctx context.Context, userID, token string) error {
	_, err := r.db.Exec(ctx,
		`DELETE FROM push_dispositivos WHERE user_id = $1::uuid AND token = $2`,
		userID, token,
	)
	return err
}

// BorrarTokenMuerto quita un token que FCM dio por no registrado.
func (r *Repository) BorrarTokenMuerto(ctx context.Context, token string) error {
	_, err := r.db.Exec(ctx, `DELETE FROM push_dispositivos WHERE token = $1`, token)
	return err
}

// TokensDeUsuario devuelve los telefonos de la cuenta.
func (r *Repository) TokensDeUsuario(ctx context.Context, userID string) ([]string, error) {
	rows, err := r.db.Query(ctx,
		`SELECT token FROM push_dispositivos WHERE user_id = $1::uuid`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var tokens []string
	for rows.Next() {
		var t string
		if err := rows.Scan(&t); err != nil {
			return nil, err
		}
		tokens = append(tokens, t)
	}
	return tokens, rows.Err()
}

// ── Servicio ────────────────────────────────────────────────────────────────

// SetEnviadorFCM conecta el envio nativo. nil lo deja apagado.
func (s *Service) SetEnviadorFCM(e *EnviadorFCM) {
	s.fcm = e
}

// NativoHabilitado dice si el servidor puede entregar avisos a la app
// instalada. Sin la cuenta de servicio, la app no ofrece activarlos.
func (s *Service) NativoHabilitado() bool {
	return s.fcm != nil
}

// RegistrarDispositivo guarda el token del telefono para la cuenta en sesion.
func (s *Service) RegistrarDispositivo(ctx context.Context, userID string, req *RegistroDispositivo) error {
	if s.fcm == nil {
		return ErrNativoApagado
	}
	token := strings.TrimSpace(req.Token)
	if token == "" || len(token) > largoMaximoToken {
		return ErrTokenInvalido
	}
	plataforma := strings.TrimSpace(req.Plataforma)
	if plataforma == "" {
		plataforma = PlataformaAndroid
	}
	if plataforma != PlataformaAndroid {
		return ErrPlataformaInvalida
	}
	return s.repo.GuardarDispositivo(ctx, userID, token, plataforma)
}

// OlvidarDispositivo da de baja el telefono de la cuenta.
func (s *Service) OlvidarDispositivo(ctx context.Context, userID, token string) error {
	token = strings.TrimSpace(token)
	if token == "" {
		return ErrTokenInvalido
	}
	return s.repo.BorrarDispositivo(ctx, userID, token)
}

// enviarANativos reparte el aviso a los telefonos de la cuenta. Best-effort,
// como el web push: el historial es la fuente de verdad que la app lee.
func (s *Service) enviarANativos(ctx context.Context, userID string, payload *NotificationPayload) {
	if s.fcm == nil {
		return
	}
	tokens, err := s.repo.TokensDeUsuario(ctx, userID)
	if err != nil {
		slog.Error("no se pudieron leer los telefonos para avisos", "error", err)
		return
	}
	for _, token := range tokens {
		invalido, err := s.fcm.Enviar(ctx, token, payload)
		if invalido {
			// La app se desinstalo o FCM roto el token: credencial muerta.
			if derr := s.repo.BorrarTokenMuerto(ctx, token); derr != nil {
				slog.Error("no se pudo borrar un token de FCM muerto", "error", derr)
			}
			continue
		}
		if err != nil {
			slog.Error("aviso nativo fallido", "error", err)
		}
	}
}

// ── HTTP ────────────────────────────────────────────────────────────────────

// EstadoNativo responde GET /api/v1/push/nativo.
func (h *Handler) EstadoNativo(w http.ResponseWriter, _ *http.Request) {
	response.JSON(w, http.StatusOK, map[string]bool{"habilitado": h.service.NativoHabilitado()})
}

// RegistrarDispositivo responde POST /api/v1/push/dispositivos.
func (h *Handler) RegistrarDispositivo(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	var req RegistroDispositivo
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.Error(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}
	if err := h.service.RegistrarDispositivo(r.Context(), userID, &req); err != nil {
		switch {
		case errors.Is(err, ErrNativoApagado):
			response.Error(w, http.StatusConflict, "NATIVE_PUSH_DISABLED", err.Error())
		case errors.Is(err, ErrTokenInvalido):
			response.Error(w, http.StatusBadRequest, "INVALID_TOKEN", err.Error())
		case errors.Is(err, ErrPlataformaInvalida):
			response.Error(w, http.StatusBadRequest, "INVALID_PLATFORM", err.Error())
		default:
			response.Error(w, http.StatusInternalServerError, "REGISTER_FAILED", "could not save the device")
		}
		return
	}
	response.JSON(w, http.StatusCreated, map[string]string{"status": "registered"})
}

// OlvidarDispositivo responde POST /api/v1/push/dispositivos/baja.
func (h *Handler) OlvidarDispositivo(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	var req struct {
		Token string `json:"token"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.Error(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}
	if err := h.service.OlvidarDispositivo(r.Context(), userID, req.Token); err != nil {
		if errors.Is(err, ErrTokenInvalido) {
			response.Error(w, http.StatusBadRequest, "INVALID_TOKEN", err.Error())
			return
		}
		response.Error(w, http.StatusInternalServerError, "UNREGISTER_FAILED", "could not remove the device")
		return
	}
	response.NoContent(w)
}
