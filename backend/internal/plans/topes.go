package plans

import (
	"context"
	"errors"
	"fmt"
	"hash/fnv"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Planes personales. Espejan chk_users_plan (migracion 048).
const (
	PlanFree = "free"
	PlanPlus = "plus"
	PlanPro  = "pro"
)

// PlanPersonalValido dice si el valor es uno de los tres planes personales,
// escrito exactamente asi (minusculas, sin espacios).
func PlanPersonalValido(plan string) bool {
	return plan == PlanFree || plan == PlanPlus || plan == PlanPro
}

// Topes es cuantas cosas ACTIVAS puede tener una persona segun su plan. Un
// valor 0 significa sin tope.
//
// El tope solo frena la CREACION: quien ya tiene mas de lo que su plan permite
// conserva todo lo que tiene. Bajar de plan no borra ni congela nada.
type Topes struct {
	Free int
	Plus int
	Pro  int
}

// Los topes que decidio el dueno el 13-09-2026. La configuracion puede
// cambiarlos (ver config.PlanesConfig); estos son los valores por defecto.
var (
	TopesMetasDeAhorro = Topes{Free: 3, Plus: 10, Pro: 0}
	TopesTarjetas      = Topes{Free: 1, Plus: 3, Pro: 5}
)

// Precios anunciados en dolares al mes (decision del dueno del 13-09-2026).
// NO se cobran: no hay pasarela ni suscripcion. Se publican en
// /transparency/fees con status "coming_soon".
const (
	PrecioPlusUSD      = 11.99
	PrecioProUSD       = 34.99
	PrecioAnaliticaUSD = 9.99
)

// Para devuelve el tope del plan. Un plan que no se reconoce recibe el tope
// del plan gratuito: ante la duda, el mas estricto, nunca el ilimitado.
func (t Topes) Para(plan string) int {
	switch plan {
	case PlanPlus:
		return t.Plus
	case PlanPro:
		return t.Pro
	default:
		return t.Free
	}
}

// TopeAlcanzadoError es el rechazo de una creacion que pasaria el tope del
// plan. Lleva los tres numeros que la pantalla necesita para explicarlo.
type TopeAlcanzadoError struct {
	Plan     string
	Limite   int
	Actuales int
}

func (e *TopeAlcanzadoError) Error() string {
	return fmt.Sprintf("el plan %s permite %d y ya hay %d", e.Plan, e.Limite, e.Actuales)
}

// Detalle es el cuerpo de `details` en la respuesta 409.
func (e *TopeAlcanzadoError) Detalle() map[string]any {
	return map[string]any{"plan": e.Plan, "limite": e.Limite, "actuales": e.Actuales}
}

// ErrUsuarioNoEncontrado: la cuenta no existe o esta dada de baja.
var ErrUsuarioNoEncontrado = errors.New("user not found")

// Recursos con tope. Van en la llave del bloqueo, asi que dos recursos
// distintos de la misma persona no se esperan entre si.
const (
	RecursoMetasDeAhorro = "savings_goals"
	RecursoTarjetas      = "virtual_cards"
)

// CrearConTope crea algo que el plan limita sin que dos creaciones simultaneas
// pasen el tope juntas.
//
// Sin el bloqueo, "contar y luego insertar" es un check-then-act: dos
// peticiones de la misma persona cuentan 2 a la vez, las dos ven que el tope 3
// no se alcanzo y quedan 4. Por eso todo corre en UNA transaccion que primero
// toma un bloqueo consultivo por persona y recurso (pg_advisory_xact_lock, que
// se suelta solo al confirmar o revertir): la segunda peticion espera, cuenta
// despues de que la primera inserto y ve el numero real.
//
// El plan se lee dentro de la misma transaccion. Un cambio de plan simultaneo
// no es una carrera que importe: la creacion queda antes o despues de el.
//
// contar y crear reciben la transaccion y deben escribir y leer POR ELLA; si
// usaran el pool, el conteo no veria lo que otra peticion ya inserto y el
// bloqueo no protegeria nada.
func CrearConTope(
	ctx context.Context,
	db *pgxpool.Pool,
	recurso, userID string,
	topes Topes,
	contar func(ctx context.Context, tx pgx.Tx) (int, error),
	crear func(ctx context.Context, tx pgx.Tx) error,
) error {
	tx, err := db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin %s: %w", recurso, err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck // no-op despues de Commit

	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock($1)`, llaveDeTope(recurso, userID)); err != nil {
		return fmt.Errorf("bloqueo de tope %s: %w", recurso, err)
	}

	var plan string
	if err := tx.QueryRow(ctx,
		`SELECT COALESCE(plan, 'free') FROM users WHERE id = $1::uuid AND deleted_at IS NULL`, userID,
	).Scan(&plan); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrUsuarioNoEncontrado
		}
		return fmt.Errorf("leer plan: %w", err)
	}

	if limite := topes.Para(plan); limite > 0 {
		actuales, err := contar(ctx, tx)
		if err != nil {
			return fmt.Errorf("contar %s: %w", recurso, err)
		}
		if actuales >= limite {
			return &TopeAlcanzadoError{Plan: plan, Limite: limite, Actuales: actuales}
		}
	}

	if err := crear(ctx, tx); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit %s: %w", recurso, err)
	}
	return nil
}

// llaveDeTope es la llave del bloqueo consultivo. El espacio de nombres evita
// chocar con los otros bloqueos consultivos del repositorio (ahorros, migraciones).
func llaveDeTope(recurso, userID string) int64 {
	h := fnv.New64a()
	_, _ = h.Write([]byte("plan-tope:" + recurso + ":" + userID))
	return int64(h.Sum64()) // #nosec G115 -- llave de pg_advisory_xact_lock; cualquier int64 es valido
}
