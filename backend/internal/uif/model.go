package uif

import "time"

// Report types.
const (
	TypeSingleThreshold = "single_threshold" // one tx >= ceiling
	TypeStructuring     = "structuring"      // same-day aggregate crosses ceiling
	TypeManual          = "manual"           // flagged by a compliance officer
	// TypeAcumulado30 es el tipo con que la migracion 065 abria los casos de
	// 30 dias moviles cuando eran el disparo regulatorio. Ya no se abre: queda
	// para leer los casos viejos.
	TypeAcumulado30 = "acumulado_30d"
	// TypeMultiplesMes: las transacciones multiples del cliente en el mes
	// calendario de Costa Rica igualan o superan el umbral (SUGEF 13-19 art.
	// 20, Lin. 22.2). Se abre en el movimiento que cruza, con la venta de
	// referencia del dia de cada movimiento. Ver migrations/080.
	TypeMultiplesMes = "multiples_mes"
	// TypeCierreMes: al cerrar el mes, el total convertido con la venta del
	// ultimo dia del mes iguala o supera el umbral. Es la lista de lo que hay
	// que registrar ante SUGEF por ese mes; no apunta a un movimiento.
	TypeCierreMes = "cierre_mes"
	// TypeEstructuracion30: las salidas de los ultimos 30 dias moviles cruzan
	// el umbral. Es una alerta INTERNA de estructuracion, no el disparo
	// regulatorio: el periodo de la norma es el mes calendario.
	TypeEstructuracion30 = "estructuracion_30d"
)

// Report statuses.
const (
	StatusPending   = "pending"
	StatusReviewed  = "reviewed"
	StatusSubmitted = "submitted"
	StatusDismissed = "dismissed"
)

// Report is one entry in the UIF review queue.
type Report struct {
	ID              string `json:"id"`
	UserID          string `json:"user_id"`
	TxID            string `json:"tx_id,omitempty"`
	ReportType      string `json:"report_type"`
	AmountMinor     int64  `json:"amount_minor"`
	Currency        string `json:"currency"`
	DailyTotalMinor int64  `json:"daily_total_minor"`
	// Acumulado30Minor es el total de salidas de 30 dias que disparo un caso
	// estructuracion_30d (o acumulado_30d, los viejos). Cero en los demas tipos.
	Acumulado30Minor int64 `json:"rolling_30d_total_minor,omitempty"`
	// Mes es el mes calendario de Costa Rica del caso ('2026-10-01'), y los
	// dos totales del mes en centavos de dolar, cada movimiento con la venta de
	// su dia (con la del ultimo dia del mes en un cierre_mes). Sin mes en los
	// casos anteriores a la migracion 080. Los totales van siempre, aunque sean
	// cero: un cliente que solo recibio tiene salidas en cero, y eso es un dato.
	Mes            string     `json:"mes,omitempty"`
	SalidasMesUSD  int64      `json:"salidas_mes_usd_minor"`
	EntradasMesUSD int64      `json:"entradas_mes_usd_minor"`
	Reason         string     `json:"reason"`
	Status         string     `json:"status"`
	ReviewerID     string     `json:"reviewer_id,omitempty"`
	ReviewerNotes  string     `json:"reviewer_notes,omitempty"`
	CreatedAt      time.Time  `json:"created_at"`
	ReviewedAt     *time.Time `json:"reviewed_at,omitempty"`
}

// ReviewRequest is a compliance officer's decision on a pending report.
type ReviewRequest struct {
	Status string `json:"status"` // submitted | dismissed | reviewed
	Notes  string `json:"notes,omitempty"`
}
