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
}

func JSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(APIResponse{
		Success: true,
		Data:    listaVaciaSiNil(data),
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

// ErrorWithData is Error plus a `data` payload on the SAME envelope — for a
// rejection the client can act on without a second request (e.g. CONTACT_EXISTS
// carrying the contact that already exists). Never used for 5xx: same reason
// Error() blanks the message there, an internal failure must not leak data.
func ErrorWithData(w http.ResponseWriter, status int, code, message string, data interface{}) {
	if status >= http.StatusInternalServerError {
		slog.Error("server error response", "status", status, "code", code, "detail", message)
		message = "internal server error"
		data = nil
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(APIResponse{
		Success: false,
		Data:    data,
		Error: &APIError{
			Code:    code,
			Message: message,
		},
	})
}

func NoContent(w http.ResponseWriter) {
	w.WriteHeader(http.StatusNoContent)
}
