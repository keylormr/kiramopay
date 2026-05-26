// Package transparency exposes public proof-of-reserves and declared fees.
// Endpoints are PUBLIC (no auth) — they expose only aggregates, never PII.
package transparency

import (
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"
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

// Fees returns the public schedule of fees and FX spread. This is the
// transparent-fees promise: nothing should be charged that isn't here.
func (h *Handler) Fees(w http.ResponseWriter, _ *http.Request) {
	response.JSON(w, http.StatusOK, map[string]interface{}{
		"version": "1.0.0",
		"effective_from": "2026-01-01",
		"sinpe": map[string]any{
			"internal_p2p": "free",
			"cross_bank": map[string]any{
				"fee_minor": 15000,
				"currency": "CRC",
				"display": "₡150 per transfer",
			},
			"daily_limit_minor": 50000000,
			"daily_limit_display": "₡500,000 per day",
		},
		"fx": map[string]any{
			"spread_bps_default": 50,
			"spread_pct_default": 0.50,
			"note": "Final rate is shown to the user before they confirm any cross-border transfer.",
		},
		"cards": map[string]any{
			"issuance_fee_minor": 0,
			"monthly_fee_minor": 0,
			"interchange_share_pct": null(),
		},
		"premium_subscription": map[string]any{
			"price_minor": 50000,
			"currency": "CRC",
			"benefits": []string{
				"Zero cross-bank fee",
				"Tighter FX spread (15 bps)",
				"Higher daily limits (when KYC level 2)",
			},
		},
	})
}

// null() is used to signal "not disclosed yet" in JSON; we prefer being
// explicit over omitting fields silently.
func null() any { return nil }
