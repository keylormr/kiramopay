// Package salud arma el cuerpo de GET /health.
//
// Existe para que el handler y la prueba de contrato escriban EXACTAMENTE los
// mismos bytes. Antes el handler era un fmt.Fprintf en cmd/api/main.go y la
// prueba validaba una copia escrita a mano de ese formato: cuando se agrego
// `auditoria_descartada` al handler, la copia no se actualizo, la respuesta
// real empezo a violar el esquema (que tiene additionalProperties: false) y la
// prueba siguio en verde. Una prueba que valida su propia copia no valida nada.
package salud

import (
	"encoding/json"

	"github.com/kiramopay/backend/internal/country"
	"github.com/kiramopay/backend/internal/crypto"
)

// Servicios es el estado de las dependencias que el handler consulta.
type Servicios struct {
	Database string `json:"database"`
	Redis    string `json:"redis"`
}

// Cuerpo es la respuesta de GET /health. El orden de los campos es el orden en
// que salen.
type Cuerpo struct {
	Status           string    `json:"status"`
	Version          string    `json:"version"`
	Environment      string    `json:"environment"`
	Services         Servicios `json:"services"`
	WebsocketClients int       `json:"websocket_clients"`
	LastDriftCRC     int64     `json:"last_drift_crc"`
	// DiasDeParticiones: cuantos dias faltan para que un INSERT en
	// transactions empiece a fallar por falta de particion. -1 = todavia no
	// se pudo consultar.
	DiasDeParticiones int `json:"dias_de_particiones"`
	// AuditoriaDescartada distinto de cero quiere decir que el rastro tiene
	// huecos: eventos que no entraron al buffer y se perdieron.
	AuditoriaDescartada int64 `json:"auditoria_descartada"`
	// CryptoPrices: plan de CoinGecko y ultimo estado del proveedor.
	CryptoPrices crypto.Diagnostics `json:"crypto_prices"`
	// TipoDeCambio: la tasa vigente, de que fecha es segun la fuente y el
	// ultimo error. Si se queda vieja, cripto en colones deja de operar.
	TipoDeCambio country.DiagnosticoTipoDeCambio `json:"tipo_de_cambio"`
}

// JSON devuelve el cuerpo serializado. Los tipos son todos serializables, asi
// que el error de json.Marshal no puede ocurrir.
func (c Cuerpo) JSON() []byte {
	b, _ := json.Marshal(c)
	return b
}
