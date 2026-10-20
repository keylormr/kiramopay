package accountdeletion

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/kiramopay/backend/internal/middleware"
	"github.com/kiramopay/backend/internal/user"
	"github.com/kiramopay/backend/pkg/response"
)

// Handler expone la eliminacion por HTTP. Las cuatro familias de rutas (de la
// persona autenticada, publicas, de administracion) comparten el servicio; cada
// una se monta en su grupo de main.go con los middlewares que le corresponden.
type Handler struct {
	service *Service
	// endSession limpia la cookie de sesion del navegador; lo da auth.Handler.
	endSession func(http.ResponseWriter)
}

func NewHandler(service *Service, endSession func(http.ResponseWriter)) *Handler {
	return &Handler{service: service, endSession: endSession}
}

// Preflight — GET /users/me/delete-account/preflight
func (h *Handler) Preflight(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		response.Error(w, http.StatusUnauthorized, "UNAUTHORIZED", "user not authenticated")
		return
	}
	pf, err := h.service.Preflight(r.Context(), userID)
	if err != nil {
		if errors.Is(err, ErrCuentaNoEncontrada) {
			response.Error(w, http.StatusNotFound, "NOT_FOUND", "user not found")
			return
		}
		response.Error(w, http.StatusInternalServerError, "PREFLIGHT_FAILED", err.Error())
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	response.JSON(w, http.StatusOK, pf)
}

// Eliminar — POST /users/me/delete-account {"password":"...","totp_code":"...","accept_terms":true}
//
// Inicia el plazo de 30 dias (el dia 0) y responde las fechas.
func (h *Handler) Eliminar(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		response.Error(w, http.StatusUnauthorized, "UNAUTHORIZED", "user not authenticated")
		return
	}
	var req Confirmacion
	if err := json.NewDecoder(io.LimitReader(r.Body, 4<<10)).Decode(&req); err != nil {
		response.Error(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}
	res, err := h.service.EliminarMiCuenta(r.Context(), userID, req)
	if err != nil {
		var bloqueada *ErrBloqueada
		switch {
		case errors.Is(err, ErrPlazoNoAceptado):
			response.Error(w, http.StatusBadRequest, "TERMS_NOT_ACCEPTED", err.Error())
		case errors.Is(err, ErrCorreoParaRespuesta):
			response.Error(w, http.StatusBadRequest, "RESPONSE_EMAIL_REQUIRED", err.Error())
		case errors.Is(err, ErrCorreoParaRespuestaInvalido):
			response.Error(w, http.StatusBadRequest, "RESPONSE_EMAIL_INVALID", err.Error())
		case errors.As(err, &bloqueada):
			response.ErrorConDetalle(w, http.StatusConflict, "DELETION_BLOCKED",
				"la cuenta tiene algo pendiente que resolver antes de eliminarla",
				map[string]any{"blockers": bloqueada.Bloqueos})
		case errors.Is(err, user.ErrCuentaDeDemostracion):
			response.Error(w, http.StatusForbidden, "DEMO_ACCOUNT", "una cuenta de demostracion no se puede eliminar")
		case errors.Is(err, ErrRolNoPermitido):
			response.Error(w, http.StatusForbidden, "ADMIN_ACCOUNT", err.Error())
		case errors.Is(err, ErrCuentaNoElegible):
			response.Error(w, http.StatusForbidden, "ACCOUNT_NOT_ELIGIBLE", err.Error())
		case errors.Is(err, ErrContrasenaIncorrecta):
			response.Error(w, http.StatusBadRequest, "CURRENT_PASSWORD_INVALID", err.Error())
		case errors.Is(err, ErrTOTPRequerido):
			response.Error(w, http.StatusBadRequest, "TOTP_REQUIRED", err.Error())
		case errors.Is(err, ErrTOTPInvalido):
			response.Error(w, http.StatusBadRequest, "TOTP_INVALID", err.Error())
		case errors.Is(err, ErrEnPausa):
			response.Error(w, http.StatusLocked, "DELETION_LOCKED", err.Error())
		case errors.Is(err, ErrCuentaNoEncontrada):
			response.Error(w, http.StatusNotFound, "NOT_FOUND", "user not found")
		default:
			// Lo demas no lo corrige la persona: sale 500 sin detalle.
			response.Error(w, http.StatusInternalServerError, "DELETION_FAILED", err.Error())
		}
		return
	}
	// La sesion ya esta revocada en la base; esto le dice al navegador que suelte
	// la cookie y lo que tenga guardado.
	if h.endSession != nil {
		h.endSession(w)
	}
	response.JSON(w, http.StatusOK, res)
}

// Solicitar — POST /public/account-deletion-requests {"contact":"...","accept_terms":true}
//
// La respuesta es identica exista o no la cuenta. Lo unico que distingue es la
// forma del dato (400 si no es correo ni telefono), que no revela nada.
func (h *Handler) Solicitar(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Contacto    string `json:"contact"`
		AceptaPlazo bool   `json:"accept_terms"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 2<<10)).Decode(&req); err != nil {
		response.Error(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}
	if err := h.service.Solicitar(r.Context(), req.Contacto, req.AceptaPlazo); err != nil {
		switch {
		case errors.Is(err, ErrPlazoNoAceptado):
			response.Error(w, http.StatusBadRequest, "TERMS_NOT_ACCEPTED", err.Error())
		case errors.Is(err, ErrContactoInvalido):
			response.Error(w, http.StatusBadRequest, "INVALID_CONTACT", err.Error())
		default:
			response.Error(w, http.StatusInternalServerError, "REQUEST_FAILED", "internal server error")
		}
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	response.JSON(w, http.StatusAccepted, map[string]string{"status": "received"})
}

// Verificar — POST /public/account-deletion-requests/verify {"contact":"...","code":"123456"}
//
// Con el codigo correcto responde lo mismo que la respuesta escrita: quien lo
// presenta ya probo que el contacto es suyo.
func (h *Handler) Verificar(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Contacto string `json:"contact"`
		Codigo   string `json:"code"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 2<<10)).Decode(&req); err != nil {
		response.Error(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}
	web, err := h.service.Confirmar(r.Context(), req.Contacto, req.Codigo)
	if err != nil {
		switch {
		case errors.Is(err, ErrContactoInvalido):
			response.Error(w, http.StatusBadRequest, "INVALID_CONTACT", err.Error())
		case errors.Is(err, ErrCodigoInvalido):
			response.Error(w, http.StatusBadRequest, "INVALID_CODE", err.Error())
		default:
			response.Error(w, http.StatusInternalServerError, "VERIFY_FAILED", "internal server error")
		}
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	response.JSON(w, http.StatusOK, struct {
		Estado string `json:"status"`
		*RespuestaWeb
	}{"verified", web})
}

// ListarSolicitudes — GET /admin/account-deletion-requests?limit=50 (admin)
func (h *Handler) ListarSolicitudes(w http.ResponseWriter, r *http.Request) {
	limite, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	out, err := h.service.ListarVerificadas(r.Context(), limite)
	if err != nil {
		response.Error(w, http.StatusInternalServerError, "LIST_FAILED", err.Error())
		return
	}
	response.JSON(w, http.StatusOK, out)
}

// Procesar — POST /admin/account-deletion-requests/{id}/process (admin)
func (h *Handler) Procesar(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if _, err := uuid.Parse(id); err != nil {
		response.Error(w, http.StatusNotFound, "NOT_FOUND", "request not found")
		return
	}
	adminID := middleware.GetUserID(r.Context())
	res, err := h.service.Procesar(r.Context(), id, adminID)
	if err != nil {
		switch {
		case errors.Is(err, ErrSolicitudNoEncontrada):
			response.Error(w, http.StatusNotFound, "NOT_FOUND", err.Error())
		case errors.Is(err, ErrSolicitudNoPendiente):
			response.Error(w, http.StatusConflict, "NOT_PENDING", err.Error())
		default:
			response.Error(w, http.StatusInternalServerError, "PROCESS_FAILED", err.Error())
		}
		return
	}
	response.JSON(w, http.StatusOK, res)
}

// Rechazar — POST /admin/account-deletion-requests/{id}/reject (admin)
func (h *Handler) Rechazar(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if _, err := uuid.Parse(id); err != nil {
		response.Error(w, http.StatusNotFound, "NOT_FOUND", "request not found")
		return
	}
	if err := h.service.Rechazar(r.Context(), id, middleware.GetUserID(r.Context())); err != nil {
		if errors.Is(err, ErrSolicitudNoPendiente) {
			response.Error(w, http.StatusConflict, "NOT_PENDING", err.Error())
			return
		}
		response.Error(w, http.StatusInternalServerError, "REJECT_FAILED", err.Error())
		return
	}
	response.NoContent(w)
}

// ListarRespuestas — GET /admin/account-deletion-responses?limit=50 (admin)
//
// Las respuestas escritas que pasaron a operaciones: sin a donde mandarlas, o
// sin salir despues de 48 horas.
func (h *Handler) ListarRespuestas(w http.ResponseWriter, r *http.Request) {
	limite, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	out, err := h.service.RespuestasSinEntregar(r.Context(), limite)
	if err != nil {
		response.Error(w, http.StatusInternalServerError, "LIST_FAILED", err.Error())
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	response.JSON(w, http.StatusOK, out)
}

// MarcarRespuestaEntregada — POST /admin/account-deletion-responses/{id}/delivered {"note":"..."} (admin)
//
// Deja constancia de que operaciones entrego la respuesta por otra via; la nota
// dice cual.
func (h *Handler) MarcarRespuestaEntregada(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if _, err := uuid.Parse(id); err != nil {
		response.Error(w, http.StatusNotFound, "NOT_FOUND", "response not found")
		return
	}
	var req struct {
		Nota string `json:"note"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 4<<10)).Decode(&req); err != nil {
		response.Error(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}
	if err := h.service.MarcarRespuestaEntregada(r.Context(), id, middleware.GetUserID(r.Context()), req.Nota); err != nil {
		switch {
		case errors.Is(err, ErrNotaRequerida):
			response.Error(w, http.StatusBadRequest, "NOTE_REQUIRED", err.Error())
		case errors.Is(err, ErrNotaLarga):
			response.Error(w, http.StatusBadRequest, "NOTE_TOO_LONG", err.Error())
		case errors.Is(err, ErrRespuestaNoEncontrada):
			response.Error(w, http.StatusNotFound, "NOT_FOUND", err.Error())
		case errors.Is(err, ErrRespuestaCerrada):
			response.Error(w, http.StatusConflict, "NOT_PENDING", err.Error())
		default:
			response.Error(w, http.StatusInternalServerError, "DELIVERY_FAILED", err.Error())
		}
		return
	}
	response.NoContent(w)
}

// VerContactoDeRespuesta — POST /admin/account-deletion-responses/{id}/contact (admin)
func (h *Handler) VerContactoDeRespuesta(w http.ResponseWriter, _ *http.Request) {
	response.Error(w, http.StatusNotImplemented, "NOT_IMPLEMENTED", "sin hacer")
}
