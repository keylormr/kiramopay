package response

import (
	"encoding/json"
	"log/slog"
	"net/http"
)

type APIResponse struct {
	Success bool        `json:"success"`
	Data    interface{} `json:"data,omitempty"`
	Error   *APIError   `json:"error,omitempty"`
}

type APIError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	// Details lleva datos que la pantalla necesita para explicar el rechazo
	// (por ejemplo el tope y cuantas tiene la persona). Solo en errores 4xx:
	// ErrorConDetalle nunca lo pone en un 5xx.
	Details any `json:"details,omitempty"`
}

func JSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(APIResponse{
		Success: true,
		Data:    data,
	})
}

func Error(w http.ResponseWriter, status int, code, message string) {
	// Never leak internal failure detail (raw DB/driver text, invariants) to
	// clients on server errors. The real message is logged for diagnosis; the
	// client gets a generic message. 4xx messages are author-controlled and
	// user-safe, so they pass through unchanged.
	if status >= http.StatusInternalServerError {
		slog.Error("server error response", "status", status, "code", code, "detail", message)
		message = "internal server error"
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(APIResponse{
		Success: false,
		Error: &APIError{
			Code:    code,
			Message: message,
		},
	})
}

// ErrorConDetalle es Error con `details`: los datos que la pantalla necesita
// para explicar el rechazo sin adivinar (el tope del plan y cuantas tiene la
// persona, el plan que haria falta). Solo para 4xx: en un 5xx el detalle se
// descarta y se responde exactamente lo mismo que Error, porque un detalle de
// un fallo interno es justo lo que Error se niega a filtrar.
func ErrorConDetalle(w http.ResponseWriter, status int, code, message string, details any) {
	if status >= http.StatusInternalServerError {
		Error(w, status, code, message)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(APIResponse{
		Success: false,
		Error: &APIError{
			Code:    code,
			Message: message,
			Details: details,
		},
	})
}

func NoContent(w http.ResponseWriter) {
	w.WriteHeader(http.StatusNoContent)
}
