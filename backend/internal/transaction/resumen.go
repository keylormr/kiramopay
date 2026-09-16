package transaction

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/kiramopay/backend/internal/middleware"
	"github.com/kiramopay/backend/pkg/response"
)

// Resumen de un periodo para la pantalla de analisis de gastos.
//
// La pantalla descargaba la ventana fila por fila, de cien en cien y con un
// techo de mil filas. Con "este ano" o un rango libre ese techo se alcanza, y
// entonces los totales, el grafico y los porcentajes describian solo una parte
// del periodo aunque se leyeran como el periodo entero. Aqui la base suma TODO
// el rango y devuelve agregados, que caben en una respuesta chica sin importar
// cuantos movimientos haya.
//
// El servidor no decide que es ingreso y que es gasto: devuelve el TIPO de cada
// grupo, como la lista, y la aplicacion lo clasifica con la misma regla con que
// clasifica la lista. Asi las dos pantallas nunca cuentan el mismo dinero de
// dos maneras.

const (
	// ZonaResumen es la zona en la que se cortan los dias del resumen.
	ZonaResumen = "America/Costa_Rica"

	// desfaseCostaRica es fijo: Costa Rica no aplica horario de verano desde
	// 1992. Se usa un desfase y no la base de zonas porque el dia se calcula
	// en SQL con aritmetica sobre el instante (ver sqlResumenGrupos), y esa
	// cuenta da lo mismo si created_at es TIMESTAMP (produccion, migracion
	// 001) o TIMESTAMPTZ (el esquema de pruebas). AT TIME ZONE no: trata
	// distinto a los dos tipos.
	desfaseCostaRica = -6 * 3600

	// maxDiasResumen acota el rango a dos anos bisiestos. Mas que eso no lo
	// pide ninguna pantalla y si cuesta recorrerlo.
	maxDiasResumen = 732

	// PrincipalesPorTipo es cuantos movimientos grandes se devuelven por cada
	// (tipo, moneda). Se cuentan por tipo y no en total: si los mas grandes
	// fueran todos ingresos, el filtro "Gastos" de la pantalla quedaria vacio
	// aunque haya gastos. Es igual al maximo que la pantalla muestra en
	// cualquier filtro, asi que los N mas grandes de cualquier combinacion de
	// tipos estan siempre en la respuesta.
	PrincipalesPorTipo = 8

	diaSegundos = 86400
)

// ErrRangoResumen es un rango que no se puede resumir: falta un borde, no es
// una fecha, esta al reves o es demasiado largo.
var ErrRangoResumen = errors.New("rango de resumen invalido")

// RangoResumen es un rango de dias civiles de Costa Rica ya validado, con los
// bordes listos para la consulta.
type RangoResumen struct {
	// Desde y Hasta son las fechas tal cual llegaron ('YYYY-MM-DD'). Desde se
	// incluye y Hasta no: agosto de 2026 es 2026-08-01 a 2026-09-01.
	Desde string
	Hasta string

	// Inicio y Fin son los mismos bordes como instantes, en UTC. Tienen que ir
	// en UTC y no en hora local: created_at es TIMESTAMP sin zona en
	// produccion y pgx escribe la hora de pared del valor. El servidor corre
	// en UTC, asi que esa es la hora de pared que guardan las filas.
	Inicio time.Time
	Fin    time.Time

	// DesfaseSegundos se suma al instante para obtener la hora de Costa Rica.
	DesfaseSegundos int64

	// ParticionDesde y ParticionHasta acotan created_date, la llave de
	// particion, para que la base pode las particiones que no tocan el rango.
	// Llevan un dia de margen a cada lado porque created_date se escribe con
	// la fecha del servidor, no con la de Costa Rica.
	ParticionDesde time.Time
	ParticionHasta time.Time
}

// ParseRangoResumen valida las dos fechas y arma los bordes de la consulta.
func ParseRangoResumen(desde, hasta string) (RangoResumen, error) {
	if desde == "" || hasta == "" {
		return RangoResumen{}, fmt.Errorf("%w: 'from' y 'to' son obligatorios (YYYY-MM-DD)", ErrRangoResumen)
	}
	d, err := time.Parse(time.DateOnly, desde)
	if err != nil {
		return RangoResumen{}, fmt.Errorf("%w: 'from' debe ser una fecha YYYY-MM-DD", ErrRangoResumen)
	}
	h, err := time.Parse(time.DateOnly, hasta)
	if err != nil {
		return RangoResumen{}, fmt.Errorf("%w: 'to' debe ser una fecha YYYY-MM-DD", ErrRangoResumen)
	}
	if !h.After(d) {
		return RangoResumen{}, fmt.Errorf("%w: 'to' es exclusivo y debe ser posterior a 'from'", ErrRangoResumen)
	}
	if dias := int(h.Sub(d).Hours() / 24); dias > maxDiasResumen {
		return RangoResumen{}, fmt.Errorf("%w: el rango puede tener hasta %d dias", ErrRangoResumen, maxDiasResumen)
	}

	// time.Parse devuelve la medianoche en UTC. La medianoche de Costa Rica
	// es ese mismo reloj seis horas despues en UTC.
	desfase := time.Duration(desfaseCostaRica) * time.Second
	return RangoResumen{
		Desde:           desde,
		Hasta:           hasta,
		Inicio:          d.Add(-desfase).UTC(),
		Fin:             h.Add(-desfase).UTC(),
		DesfaseSegundos: desfaseCostaRica,
		ParticionDesde:  d.AddDate(0, 0, -1),
		ParticionHasta:  h.AddDate(0, 0, 1),
	}, nil
}

// GrupoResumen suma los movimientos completados de un dia, de un tipo y en una
// moneda.
type GrupoResumen struct {
	// Fecha es el dia civil de Costa Rica, 'YYYY-MM-DD'.
	Fecha    string `json:"date"`
	Type     string `json:"type"`
	Currency string `json:"currency"`
	Count    int    `json:"count"`
	// Amount es la suma de las magnitudes, en centimos.
	Amount int64 `json:"amount"`
}

// Resumen es la respuesta de GET /transactions/summary.
type Resumen struct {
	From     string `json:"from"`
	To       string `json:"to"`
	Timezone string `json:"timezone"`
	// Status dice cual es el unico estado que se cuenta: un movimiento
	// pendiente o fallido no movio dinero.
	Status string         `json:"status"`
	Groups []GrupoResumen `json:"groups"`
	// Top son los movimientos mas grandes de cada (tipo, moneda), del mayor
	// al menor.
	Top        []TransactionRecord `json:"top"`
	TopPerType int                 `json:"top_per_type"`
	// PrimeraFecha es el dia (hora de Costa Rica) del primer movimiento
	// completado de la persona, en cualquier fecha; null si no tiene ninguno.
	// Un periodo anterior que empieza antes de ese dia esta incompleto: sin
	// este dato, "este ano" contra el ano pasado de alguien que llego en junio
	// podia decir "gastaste 400% mas" sin que fuera cierto.
	PrimeraFecha *string `json:"first_date"`
}

// fechaDeDiaEpoch pasa un numero de dia (dias enteros desde 1970-01-01) a su
// fecha. La base calcula ese numero ya corrido a la hora de Costa Rica.
func fechaDeDiaEpoch(dia int64) string {
	return time.Unix(dia*diaSegundos, 0).UTC().Format(time.DateOnly)
}

// Resumen suma los movimientos completados del usuario en el rango.
func (s *Service) Resumen(ctx context.Context, userID string, rango RangoResumen) (*Resumen, error) {
	grupos, err := s.repo.GruposResumen(ctx, userID, rango)
	if err != nil {
		return nil, err
	}
	top, err := s.repo.PrincipalesResumen(ctx, userID, rango, PrincipalesPorTipo)
	if err != nil {
		return nil, err
	}
	primera, err := s.repo.PrimerDiaConMovimientos(ctx, userID, rango.DesfaseSegundos)
	if err != nil {
		return nil, err
	}
	return &Resumen{
		From:         rango.Desde,
		To:           rango.Hasta,
		Timezone:     ZonaResumen,
		Status:       StatusCompleted,
		Groups:       grupos,
		Top:          top,
		TopPerType:   PrincipalesPorTipo,
		PrimeraFecha: primera,
	}, nil
}

// Summary atiende GET /api/v1/transactions/summary?from=YYYY-MM-DD&to=YYYY-MM-DD.
//
// El rango se valida ANTES de tocar la base: un rango malo es un 400 y nunca
// llega a la consulta.
func (h *Handler) Summary(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		response.Error(w, http.StatusUnauthorized, "UNAUTHORIZED", "user not authenticated")
		return
	}

	q := r.URL.Query()
	rango, err := ParseRangoResumen(q.Get("from"), q.Get("to"))
	if err != nil {
		response.Error(w, http.StatusBadRequest, "VALIDATION_ERROR", err.Error())
		return
	}

	res, err := h.service.Resumen(r.Context(), userID, rango)
	if err != nil {
		// response.Error cambia el texto de todo 5xx por uno generico y deja
		// el detalle en el registro.
		response.Error(w, http.StatusInternalServerError, "SUMMARY_FAILED", err.Error())
		return
	}
	response.JSON(w, http.StatusOK, res)
}
