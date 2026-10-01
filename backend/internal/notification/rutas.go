package notification

import "github.com/go-chi/chi/v5"

// MontarHistorial registra las rutas del historial de notificaciones de quien
// esta autenticado. Va dentro del grupo protegido de /api/v1 (main.go).
func MontarHistorial(r chi.Router, h *Handler) {
	r.Get("/notifications", h.ListNotifications)
	r.Patch("/notifications/{id}/read", h.MarkRead)
	r.Post("/notifications/read-all", h.MarkAllRead)
}
