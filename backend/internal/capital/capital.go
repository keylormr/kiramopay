// Package capital le dice al panel de administracion cuanto dinero propio tiene
// KiramoPay, por moneda, y cuanto le falta cuando esta en negativo.
//
// El capital propio (SYSTEM:CAPITAL:<moneda>, migracion 087) es el efectivo de
// la empresa que NO es de los usuarios: la reserva es exactamente igual a lo que
// se les debe a ellos, y todo lo demas vive aqui. La compra y la venta de cripto
// mueven plata entre la reserva y el capital, las comisiones entran y las
// promociones salen. La cuenta no tiene piso a proposito (decision del dueno:
// "Permitir y avisar"): las operaciones siguen funcionando aunque quede en
// negativo, y lo que se hace es avisar, para saber cuanto habria que depositar
// con dinero real.
//
// Este paquete solo LEE. El saldo sale del libro (el diario inmutable, via
// ledger_account_balances), nunca se calcula en la pantalla ni se guarda aparte.
// El endpoint es solo para administradores: main.go lo monta dentro del grupo con
// RequireAdmin y RequireLiveSession, y una prueba lo exige.
package capital

import (
	"context"
	"log/slog"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/kiramopay/backend/pkg/response"
)

// Saldo es el capital propio de una moneda, tal como lo dice el libro. Va en
// unidades menores (centimos) y con su signo: negativo si falta.
type Saldo struct {
	Moneda     string
	SaldoMinor int64
}

// Lector entrega los saldos del capital. Lo implementa Repository contra el
// libro; las pruebas del handler pasan uno falso.
type Lector interface {
	SaldosDelCapital(ctx context.Context) ([]Saldo, error)
}

// Repository lee el capital propio del libro.
type Repository struct {
	db *pgxpool.Pool
}

func NewRepository(db *pgxpool.Pool) *Repository { return &Repository{db: db} }

// SaldosDelCapital devuelve el saldo de cada cuenta SYSTEM:CAPITAL:<moneda>,
// ordenado por moneda.
//
// Se lee de ledger_account_balances, la vista que deriva el saldo del diario (la
// misma fuente de la prueba de reservas publica): una cuenta de saldo normal
// 'debit' como esta suma los debitos y resta los creditos. El filtro por tipo
// baja hasta la tabla de cuentas, asi que no recorre el diario de los usuarios.
func (r *Repository) SaldosDelCapital(ctx context.Context) ([]Saldo, error) {
	rows, err := r.db.Query(ctx, `
		SELECT currency, balance_minor
		  FROM ledger_account_balances
		 WHERE type = 'capital'
		 ORDER BY currency`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var saldos []Saldo
	for rows.Next() {
		var s Saldo
		if err := rows.Scan(&s.Moneda, &s.SaldoMinor); err != nil {
			return nil, err
		}
		saldos = append(saldos, s)
	}
	return saldos, rows.Err()
}

type Handler struct {
	lector Lector
}

func NewHandler(l Lector) *Handler { return &Handler{lector: l} }

// monedaDelCapital es lo que ve el panel de una moneda.
type monedaDelCapital struct {
	Currency     string `json:"currency"`
	BalanceMinor int64  `json:"balance_minor"`
	// ShortfallMinor es lo que falta para volver a cero, en la misma unidad: lo
	// que habria que depositar con dinero real. Cero si el capital no esta en
	// negativo.
	ShortfallMinor int64 `json:"shortfall_minor"`
	Negative       bool  `json:"negative"`
}

// Saldos responde GET /api/v1/admin/capital.
//
//	{
//	  "currencies": [
//	    {"currency":"CRC","balance_minor":-19670,"shortfall_minor":19670,"negative":true},
//	    {"currency":"USD","balance_minor":0,"shortfall_minor":0,"negative":false}
//	  ],
//	  "as_of": "2026-10-29T15:00:00Z"
//	}
//
// Si el libro no se pudo leer es un 503 SIN monedas: un cero seria una
// afirmacion ("no falta nada"), y lo que hay es "no se sabe".
func (h *Handler) Saldos(w http.ResponseWriter, r *http.Request) {
	saldos, err := h.lector.SaldosDelCapital(r.Context())
	if err != nil {
		// response.Error deja el detalle en el log y manda al cliente solo el
		// texto generico de un 5xx.
		response.Error(w, http.StatusServiceUnavailable, "CAPITAL_UNAVAILABLE", "own capital unavailable: "+err.Error())
		return
	}

	monedas := make([]monedaDelCapital, 0, len(saldos))
	for _, s := range saldos {
		m := monedaDelCapital{Currency: s.Moneda, BalanceMinor: s.SaldoMinor}
		if s.SaldoMinor < 0 {
			m.Negative = true
			m.ShortfallMinor = -s.SaldoMinor
			// El aviso de la decision "Permitir y avisar", del lado del servidor:
			// nada se bloquea, pero queda en el registro cada vez que alguien del
			// panel lo consulta.
			slog.Warn("capital propio en negativo",
				"moneda", s.Moneda, "saldo_minor", s.SaldoMinor, "faltante_minor", m.ShortfallMinor)
		}
		monedas = append(monedas, m)
	}

	response.JSON(w, http.StatusOK, map[string]any{
		"currencies": monedas,
		"as_of":      time.Now().UTC().Format(time.RFC3339),
	})
}
