package audit

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/kiramopay/backend/pkg/response"
)

// Un rastro que nadie puede leer no es un rastro.
//
// El registro de auditoria se escribia desde el arranque del proyecto y NO
// existia una sola ruta para consultarlo: ni admin, ni interna, ni nada. Lo
// unico que se podia hacer con el era mirarlo por fuera, entrando a la base.
// Para SUGEF 13-19 eso es como no tenerlo.

// Registro es una fila del rastro, tal como sale a quien la consulta.
type Registro struct {
	ID           string                 `json:"id"`
	UserID       string                 `json:"user_id,omitempty"`
	Action       string                 `json:"action"`
	ResourceType string                 `json:"resource_type,omitempty"`
	ResourceID   string                 `json:"resource_id,omitempty"`
	IPAddress    string                 `json:"ip_address,omitempty"`
	UserAgent    string                 `json:"user_agent,omitempty"`
	Details      map[string]interface{} `json:"details,omitempty"`
	RiskLevel    string                 `json:"risk_level"`
	CreatedAt    time.Time              `json:"created_at"`
}

// Filtro acota la consulta. Todos los campos son opcionales.
type Filtro struct {
	UserID    string
	Action    string
	RiskLevel string
	Desde     *time.Time
	Hasta     *time.Time
	Limite    int
	Offset    int
}

// Listar devuelve el rastro, del mas reciente al mas viejo.
//
// El limite tiene tope duro: una consulta sin acotar sobre una tabla que crece
// con cada movimiento es una forma comoda de tumbar la base.
func (r *Repository) Listar(ctx context.Context, f Filtro) ([]Registro, error) {
	if f.Limite <= 0 || f.Limite > 200 {
		f.Limite = 50
	}
	if f.Offset < 0 {
		f.Offset = 0
	}
	rows, err := r.db.Query(ctx, `
		SELECT id::text, COALESCE(user_id::text, ''), action,
		       COALESCE(resource_type, ''), COALESCE(resource_id, ''),
		       COALESCE(host(ip_address), ''), COALESCE(user_agent, ''),
		       COALESCE(details::text, '{}'), risk_level, created_at
		  FROM audit_logs
		 WHERE ($1 = '' OR user_id = NULLIF($1,'')::uuid)
		   AND ($2 = '' OR action = $2)
		   AND ($3 = '' OR risk_level = $3)
		   AND ($4::timestamptz IS NULL OR created_at >= $4)
		   AND ($5::timestamptz IS NULL OR created_at < $5)
		 ORDER BY created_at DESC
		 LIMIT $6 OFFSET $7`,
		f.UserID, f.Action, f.RiskLevel, f.Desde, f.Hasta, f.Limite, f.Offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	registros := []Registro{}
	for rows.Next() {
		var reg Registro
		var detalles string
		if err := rows.Scan(&reg.ID, &reg.UserID, &reg.Action, &reg.ResourceType,
			&reg.ResourceID, &reg.IPAddress, &reg.UserAgent, &detalles,
			&reg.RiskLevel, &reg.CreatedAt); err != nil {
			return nil, err
		}
		if detalles != "" && detalles != "{}" {
			_ = json.Unmarshal([]byte(detalles), &reg.Details)
		}
		registros = append(registros, reg)
	}
	return registros, rows.Err()
}

// Handler sirve la consulta del rastro. La ruta va SIEMPRE detras de
// RequireAdmin: el rastro tiene direcciones IP, agentes de usuario y los
// detalles de cada operacion.
type Handler struct {
	repo   *Repository
	logger *Logger
}

func NewHandler(repo *Repository, logger *Logger) *Handler {
	return &Handler{repo: repo, logger: logger}
}

// Listar responde GET /api/v1/admin/audit.
func (h *Handler) Listar(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	f := Filtro{
		UserID:    q.Get("user_id"),
		Action:    q.Get("action"),
		RiskLevel: q.Get("risk_level"),
	}
	f.Limite, _ = strconv.Atoi(q.Get("limit"))
	f.Offset, _ = strconv.Atoi(q.Get("offset"))

	// Una fecha mal formada se RECHAZA en vez de ignorarse: descartarla en
	// silencio devolveria el rastro entero como si fuera el rango pedido.
	desde, err := parseFecha(q.Get("from"))
	if err != nil {
		response.Error(w, http.StatusBadRequest, "VALIDATION_ERROR", "invalid 'from': use RFC3339 or YYYY-MM-DD")
		return
	}
	hasta, err := parseFecha(q.Get("to"))
	if err != nil {
		response.Error(w, http.StatusBadRequest, "VALIDATION_ERROR", "invalid 'to': use RFC3339 or YYYY-MM-DD")
		return
	}
	f.Desde, f.Hasta = desde, hasta

	registros, err := h.repo.Listar(r.Context(), f)
	if err != nil {
		response.Error(w, http.StatusInternalServerError, "FETCH_FAILED", "no se pudo leer el rastro")
		return
	}
	response.JSON(w, http.StatusOK, map[string]interface{}{
		"events": registros,
		// Cuantos eventos se perdieron por buffer lleno desde que arranco el
		// proceso. Distinto de cero quiere decir que este rastro tiene huecos, y
		// quien lo esta leyendo tiene que saberlo.
		"dropped_since_boot": h.logger.Descartados(),
	})
}

func parseFecha(v string) (*time.Time, error) {
	if v == "" {
		return nil, nil
	}
	if t, err := time.Parse(time.RFC3339, v); err == nil {
		return &t, nil
	}
	t, err := time.Parse("2006-01-02", v)
	if err != nil {
		return nil, err
	}
	return &t, nil
}
