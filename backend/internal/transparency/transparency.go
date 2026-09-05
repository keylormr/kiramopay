// Package transparency exposes public proof-of-reserves and declared fees.
// Endpoints are PUBLIC (no auth) — they expose only aggregates, never PII.
package transparency

import (
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/kiramopay/backend/internal/qrpayment"
	"github.com/kiramopay/backend/pkg/response"
)

type Handler struct {
	db *pgxpool.Pool
}

func NewHandler(db *pgxpool.Pool) *Handler { return &Handler{db: db} }

// ProofOfReserves returns the total of all user liabilities per currency
// alongside the matching reserve account balance. Publishing this builds
// trust and is the cheapest defensible "we hold your money" signal.
//
// Response shape:
//   {
//     "currencies": [{
//       "currency":"CRC",
//       "user_liabilities_minor": 1500000000,
//       "reserve_balance_minor":  1500000000,
//       "ratio_pct": 100.0
//     }, ...],
//     "as_of": "..."
//   }
func (h *Handler) ProofOfReserves(w http.ResponseWriter, r *http.Request) {
	rows, err := h.db.Query(r.Context(), `
		WITH liabilities AS (
			SELECT currency, COALESCE(SUM(balance_minor), 0) AS amt
			FROM ledger_account_balances
			WHERE type = 'user_wallet'
			GROUP BY currency
		),
		reserves AS (
			SELECT currency, COALESCE(SUM(balance_minor), 0) AS amt
			FROM ledger_account_balances
			WHERE type = 'reserve'
			GROUP BY currency
		)
		SELECT
			COALESCE(l.currency, r.currency) AS currency,
			COALESCE(l.amt, 0) AS user_liabilities,
			COALESCE(r.amt, 0) AS reserve_balance
		FROM liabilities l
		FULL OUTER JOIN reserves r ON r.currency = l.currency
		ORDER BY 1`)
	if err != nil {
		response.Error(w, http.StatusServiceUnavailable, "POR_UNAVAILABLE", "proof of reserves unavailable")
		return
	}
	defer rows.Close()

	type item struct {
		Currency             string  `json:"currency"`
		UserLiabilitiesMinor int64   `json:"user_liabilities_minor"`
		ReserveBalanceMinor  int64   `json:"reserve_balance_minor"`
		RatioPct             float64 `json:"ratio_pct"`
	}
	items := []item{}
	for rows.Next() {
		var it item
		if err := rows.Scan(&it.Currency, &it.UserLiabilitiesMinor, &it.ReserveBalanceMinor); err != nil {
			response.Error(w, http.StatusInternalServerError, "POR_SCAN", "scan failed")
			return
		}
		if it.UserLiabilitiesMinor > 0 {
			it.RatioPct = float64(it.ReserveBalanceMinor) / float64(it.UserLiabilitiesMinor) * 100
		} else {
			it.RatioPct = 100
		}
		items = append(items, it)
	}

	response.JSON(w, http.StatusOK, map[string]interface{}{
		"currencies": items,
		"as_of":      "now",
		"note":       "Published continuously. Reserve accounts and user liabilities derive from the immutable journal.",
	})
}

// Fees publica lo que de verdad se cobra hoy. La promesa de esta ruta es
// "nada se cobra que no este aqui", y por eso lo contrario tambien tiene que
// cumplirse: nada que este aqui puede dejar de cobrarse. La version anterior
// publicaba una tarifa de transferencia interbancaria que nunca se cobra
// (ese envio se rechaza: no hay licencia), un diferencial de cambio que el
// codigo no aplica en ninguna parte, y una suscripcion de 500 colones al mes
// que no existe ni se puede cobrar. Y callaba la unica comision que si se
// cobra: la del comercio.
//
// Al cambiar una tarifa en el codigo hay que cambiarla aqui. Las pruebas de
// este paquete atan los numeros a las constantes reales para que no se
// separen en silencio.
func (h *Handler) Fees(w http.ResponseWriter, _ *http.Request) {
	response.JSON(w, http.StatusOK, map[string]interface{}{
		"version":        "2.0.0",
		"effective_from": "2026-09-04",
		"note": "Esta es la lista completa de lo que se cobra. Lo que no aparece aqui, " +
			"no se cobra.",

		// Lo unico que hoy genera un cargo: la comision del comercio en un
		// cobro por QR. La absorbe el comercio, nunca el pagador —quien paga
		// entrega exactamente el monto del QR—.
		"merchant_commission": map[string]any{
			"bps":     qrpayment.DefaultCommissionBps,
			"pct":     float64(qrpayment.DefaultCommissionBps) / 100,
			"display": "0.5% del cobro, lo asume el comercio",
			"applies_to": "Cobros por QR de un comercio verificado. Un QR personal " +
				"no lleva comision.",
			"payer_pays_extra": false,
			"configurable_per_merchant": true,
		},

		// Todo esto se mueve sin cargo.
		"free": []string{
			"Transferencias entre cuentas KiramoPay",
			"Cobros y pagos con QR personal",
			"Metas de ahorro: depositar y retirar",
			"Compra y venta de cripto",
			"Tarjeta virtual: emision y mantenimiento",
		},

		// Lo que no se ofrece todavia no lleva tarifa porque no ocurre.
		"not_offered": map[string]any{
			"cross_bank_transfer": "Enviar a una cuenta de otro banco requiere " +
				"licencia; hoy el envio se rechaza y no se cobra nada.",
			"fx_conversion": "No hay conversion de moneda en la aplicacion, " +
				"asi que no hay diferencial de cambio.",
			"bill_payment_and_topup": "Sin convenio con las empresas ni con los " +
				"operadores: el cobro se rechaza.",
		},

		// Los planes estan anunciados y su precio es publico, pero todavia no
		// hay forma de cobrarlos: registrar interes no cobra ni otorga nada.
		"plans": map[string]any{
			"chargeable_today": false,
			"note": "Los planes se anuncian y se puede registrar interes. Nadie " +
				"tiene un cargo activo.",
			"announced": []map[string]any{
				{"code": "free", "price": 0, "currency": "USD", "commission_pct": 0.5},
				{"code": "negocio", "price": 34.99, "currency": "USD", "period": "month",
					"commission_pct": 0.25, "commission_free_monthly_billing": 12000},
				{"code": "cima", "price": 54.99, "currency": "USD", "period": "month",
					"commission_pct": 0.1, "commission_free_monthly_billing": 50000},
			},
		},
	})
}
