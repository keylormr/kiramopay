package escrow

import (
	"context"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/kiramopay/backend/pkg/response"
)

// La disputa congelaba plata y la unica persona que podia descongelarla no
// podia encontrarla.
//
// `disputed` solo sale por Resolve, que es admin-only. Pero las dos rutas de
// lectura que existian —GET /escrow y GET /escrow/{id}— estan acotadas a las
// PARTES del acuerdo: quien tiene que arbitrar no es comprador ni vendedor, asi
// que recibia 403 en las dos. En la practica habia un boton para resolver una
// disputa que nadie podia ubicar, y la plata quedaba en SYSTEM:ESCROW hasta que
// alguien entrara a la base de datos a buscarla a mano.
//
// Esto NO decide quien atiende las disputas ni con que plazo: eso sigue siendo
// una decision del dueno. Lo que hace es que el caso se pueda encontrar, que es
// requisito de cualquier respuesta que se elija.

// FiltroAdmin acota la consulta del administrador.
type FiltroAdmin struct {
	// Estado vacio significa SOLO los disputados —la cola que hay que
	// trabajar—; EstadoTodos trae el historial completo. La respuesta dice
	// cual se aplico, para que nadie confunda "tres disputas" con "tres
	// acuerdos en todo el sistema".
	Estado Status
	Limite int
	Offset int
}

// EstadoTodos es el valor de `?status=` que apaga el filtro.
const EstadoTodos Status = "all"

// EsEstadoConsultable dice si un `?status=` es uno de los que existen. Un valor
// desconocido se RECHAZA en vez de devolver una lista vacia: una cola vacia y
// una cola mal consultada se ven igual, y la diferencia importa cuando lo que
// hay adentro es plata retenida.
func EsEstadoConsultable(s Status) bool {
	switch s {
	case EstadoTodos, StatusPending, StatusFunded, StatusReleased,
		StatusRefunded, StatusDisputed, StatusCancelled:
		return true
	}
	return false
}

// PaginaAdmin es una pagina de la cola, con el tamano total de la cola.
type PaginaAdmin struct {
	Agreements []Agreement `json:"agreements"`
	Total      int         `json:"total"`
	Status     Status      `json:"status"`
	Limit      int         `json:"limit"`
	Offset     int         `json:"offset"`
}

// ListarParaAdmin devuelve los acuerdos SIN la comprobacion de parte.
//
// El tope duro es deliberado: es una tabla que crece con cada acuerdo y esta
// consulta no la acota ningun usuario.
func (r *Repository) ListarParaAdmin(ctx context.Context, f FiltroAdmin) (*PaginaAdmin, error) {
	estado := f.Estado
	if estado == "" {
		estado = StatusDisputed
	}
	limite := f.Limite
	if limite <= 0 || limite > 200 {
		limite = 50
	}
	offset := f.Offset
	if offset < 0 {
		offset = 0
	}

	// Un solo WHERE para el conteo y para la pagina, para que no puedan
	// separarse: el total es lo que le dice al arbitro cuantos casos le faltan.
	filtro := ""
	args := []interface{}{}
	if estado != EstadoTodos {
		filtro = " WHERE status = $1"
		args = append(args, string(estado))
	}

	pagina := &PaginaAdmin{Status: estado, Limit: limite, Offset: offset}
	if err := r.db.QueryRow(ctx,
		"SELECT COUNT(*) FROM escrow_agreements"+filtro, args...).Scan(&pagina.Total); err != nil {
		return nil, err
	}

	// El disputado mas VIEJO primero: la cola se trabaja por antiguedad, que es
	// la que mide cuanto lleva congelada la plata de alguien.
	consulta := "SELECT " + agreementCols + " FROM escrow_agreements" + filtro +
		" ORDER BY COALESCE(disputed_at, created_at) ASC, id ASC" +
		" LIMIT $" + strconv.Itoa(len(args)+1) + " OFFSET $" + strconv.Itoa(len(args)+2)
	rows, err := r.db.Query(ctx, consulta, append(args, limite, offset)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	pagina.Agreements = make([]Agreement, 0, limite)
	for rows.Next() {
		a, err := scanAgreement(rows)
		if err != nil {
			return nil, err
		}
		pagina.Agreements = append(pagina.Agreements, *a)
	}
	return pagina, rows.Err()
}

// ListarParaAdmin expone la cola. La reja es la ruta, que va detras de
// RequireAdmin; el servicio no vuelve a comprobar quien pregunta.
func (s *Service) ListarParaAdmin(ctx context.Context, f FiltroAdmin) (*PaginaAdmin, error) {
	return s.repo.ListarParaAdmin(ctx, f)
}

// ObtenerParaAdmin lee un acuerdo sin exigir que quien pregunta sea parte.
func (s *Service) ObtenerParaAdmin(ctx context.Context, id string) (*Agreement, error) {
	return s.repo.Get(ctx, id)
}

// ListarAdmin responde GET /api/v1/admin/escrow.
//
// Sin `?status=` devuelve SOLO los disputados, que es la cola que existe para
// trabajarse; `?status=all` trae el historial completo y cualquier estado
// concreto acota a ese. El estado aplicado viaja en la respuesta.
//
// Los acuerdos identifican a las partes por su id; para ponerles nombre esta
// `GET /api/v1/admin/users/{id}`, que ya existe.
func (h *Handler) ListarAdmin(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	estado := Status(q.Get("status"))
	if estado != "" && !EsEstadoConsultable(estado) {
		response.Error(w, http.StatusBadRequest, "VALIDATION_ERROR",
			"invalid 'status': use one of pending, funded, released, refunded, disputed, cancelled, all")
		return
	}
	limite, _ := strconv.Atoi(q.Get("limit"))
	offset, _ := strconv.Atoi(q.Get("offset"))

	pagina, err := h.service.ListarParaAdmin(r.Context(), FiltroAdmin{
		Estado: estado, Limite: limite, Offset: offset,
	})
	if err != nil {
		response.Error(w, http.StatusInternalServerError, "ESCROW_LIST_FAILED",
			"no se pudo leer la cola de acuerdos")
		return
	}
	response.JSON(w, http.StatusOK, pagina)
}

// ObtenerAdmin responde GET /api/v1/admin/escrow/{id}.
func (h *Handler) ObtenerAdmin(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	// Un id mal formado no llega a la base: `WHERE id = $1::uuid` con basura
	// revienta con 22P02 y saldria como un 500, que le diria al arbitro que
	// fallo el servidor cuando lo que fallo fue el enlace que abrio.
	if _, err := uuid.Parse(id); err != nil {
		response.Error(w, http.StatusBadRequest, "VALIDATION_ERROR", "invalid agreement id")
		return
	}
	a, err := h.service.ObtenerParaAdmin(r.Context(), id)
	if err != nil {
		h.writeError(w, err)
		return
	}
	response.JSON(w, http.StatusOK, a)
}
