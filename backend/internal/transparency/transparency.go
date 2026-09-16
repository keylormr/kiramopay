// Package transparency exposes public proof-of-reserves and declared fees.
// Endpoints are PUBLIC (no auth) — they expose only aggregates, never PII.
package transparency

import (
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/kiramopay/backend/internal/plans"
	"github.com/kiramopay/backend/internal/qrpayment"
	"github.com/kiramopay/backend/pkg/response"
)

// PlanesPublicados son los numeros de cada plan que se publican en /fees. Los
// pasa main con los MISMOS valores que aplican los servicios, para que lo
// publicado no pueda separarse de lo que se cumple.
type PlanesPublicados struct {
	Metas    plans.Topes
	Tarjetas plans.Topes
	// Asistente es nil cuando el asistente no esta configurado: sin el, la
	// cuota diaria no es un beneficio que se entregue y no se publica.
	Asistente *plans.Topes
}

type Handler struct {
	db     *pgxpool.Pool
	planes PlanesPublicados
}

// NewHandler arranca con los topes de fabrica y sin asistente. main los
// reemplaza con SetPlanes.
func NewHandler(db *pgxpool.Pool) *Handler {
	return &Handler{db: db, planes: PlanesPublicados{
		Metas:    plans.TopesMetasDeAhorro,
		Tarjetas: plans.TopesTarjetas,
	}}
}

// SetPlanes fija los numeros de los planes que publica /fees.
func (h *Handler) SetPlanes(p PlanesPublicados) { h.planes = p }

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
			-- El pasivo es TODA la plata que es de los usuarios, no solo la que
			-- esta en su billetera:
			--
			--   * merchant_wallet (migracion 045) es el saldo del comercio, que
			--     el dueno puede retirar cuando quiera;
			--   * SYSTEM:SAVINGS (migracion 040) es plata apartada en una meta,
			--     que sigue siendo del usuario y puede sacar cuando quiera;
			--   * SYSTEM:ESCROW (migracion 029) es plata retenida de una parte o
			--     de la otra, pero de un usuario en cualquier caso.
			--
			-- Contando solo 'user_wallet', el ratio publicado SOBRESTIMA la
			-- cobertura: divide la reserva entre un pasivo mas chico que el real.
			-- Hoy las tres cuentan cero, asi que el numero publicado no cambia;
			-- el dia que alguien guarde en una meta o abra un escrow, empezaria
			-- a mentir.
			SELECT currency, COALESCE(SUM(balance_minor), 0) AS amt
			FROM ledger_account_balances
			WHERE type IN ('user_wallet', 'merchant_wallet')
			   OR code LIKE 'SYSTEM:SAVINGS:%'
			   OR code LIKE 'SYSTEM:ESCROW:%'
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
// Hasta el 13-09-2026 anunciaba ademas los planes de comercio Negocio y Cima,
// con umbrales sin comision y tasas rebajadas que el cobro nunca aplico. Se
// retiraron: los planes que se anuncian ahora son los personales, con los
// topes que los servicios de verdad hacen cumplir.
//
// Al cambiar una tarifa en el codigo hay que cambiarla aqui. Las pruebas de
// este paquete atan los numeros a las constantes reales para que no se
// separen en silencio.
func (h *Handler) Fees(w http.ResponseWriter, _ *http.Request) {
	response.JSON(w, http.StatusOK, map[string]interface{}{
		"version":        "2.1.0",
		"effective_from": "2026-09-13",
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
			"payer_pays_extra":          false,
			"configurable_per_merchant": true,
		},

		// La promocion de entrada: las mismas constantes que usa el cobro.
		"entry_promotion": map[string]any{
			"bps":    qrpayment.PromoEntradaBps,
			"pct":    float64(qrpayment.PromoEntradaBps) / 100,
			"months": qrpayment.PromoEntradaMeses,
			"display": "0.25% del cobro durante los primeros 3 meses, " +
				"contados desde que se aprueba la verificacion del comercio",
			"applies_to": "Comercios cuya verificacion se aprueba por primera vez " +
				"despues de que la promocion entro en vigor. Los comercios que ya " +
				"estaban aprobados no la reciben.",
			"rule": "Durante la promocion se cobra la menor entre 0.25% y la " +
				"comision fijada al comercio. Al terminar, vuelve su comision.",
			"existing_merchants": false,
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
			"status":           "coming_soon",
			"note": "Los planes se anuncian y se puede registrar interes. Nadie " +
				"tiene un cargo activo y registrar interes no otorga el plan.",
			"announced": []map[string]any{
				h.planAnunciado(plans.PlanFree, 0),
				h.planAnunciado(plans.PlanPlus, plans.PrecioPlusUSD),
				h.planAnunciado(plans.PlanPro, plans.PrecioProUSD),
			},
			// Lo que ningun plan incluye se declara con el mismo peso que lo que
			// si incluye.
			"not_included": []string{
				"Tarjeta fisica",
				"Retiros en cajeros",
				"Seguros",
				"Fondo de garantia de depositos",
				"Rendimiento o intereses sobre el dinero guardado",
				"Mejor tipo de cambio",
				"Transferencias a otros bancos",
				"Limites de tarjeta mas altos",
			},
		},

		// La analitica del comercio: se construyo y se habilita comercio por
		// comercio, pero todavia no se puede cobrar.
		"merchant_analytics": map[string]any{
			"code":             qrpayment.PlanComercioAnalitica,
			"price":            plans.PrecioAnaliticaUSD,
			"currency":         "USD",
			"period":           "month",
			"chargeable_today": false,
			"status":           "coming_soon",
			"includes": []string{
				"Comparacion del reporte contra el periodo anterior de igual longitud",
				"Exportacion del reporte en CSV",
			},
		},
	})
}

// planAnunciado arma una fila de plan personal con los topes que se aplican.
// Un tope 0 es "sin tope" y se publica como null.
func (h *Handler) planAnunciado(codigo string, precio float64) map[string]any {
	limites := map[string]any{
		"savings_goals_active": topePublicado(h.planes.Metas.Para(codigo)),
		"virtual_cards_active": topePublicado(h.planes.Tarjetas.Para(codigo)),
	}
	if h.planes.Asistente != nil {
		limites["assistant_daily_questions"] = topePublicado(h.planes.Asistente.Para(codigo))
	}
	return map[string]any{
		"code":     codigo,
		"price":    precio,
		"currency": "USD",
		"period":   "month",
		"limits":   limites,
	}
}

func topePublicado(n int) any {
	if n <= 0 {
		return nil
	}
	return n
}
