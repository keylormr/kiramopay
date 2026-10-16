package escrow

import (
	"strings"
	"testing"
	"time"

	"github.com/kiramopay/backend/internal/notification"
)

// La fecha del aviso va en hora de Costa Rica, no en la del servidor, con el
// formato del idioma de quien lo lee.
func TestFechaDelAvisoEnHoraDeCostaRica(t *testing.T) {
	utc := time.Date(2026, 9, 20, 3, 30, 0, 0, time.UTC) // 21:30 del 19 en CR
	a := &Agreement{Description: "Bicicleta", AmountMinor: 1_250_000, Currency: "CRC"}
	datos := datosDelAviso(a, &utc)
	_, es := notification.Texto(notification.AvisoEscrowEntregaPorVencerVendedor, "es", datos)
	if !strings.Contains(es, "19/09/2026 a las 21:30") || !strings.Contains(es, "₡12,500.00") {
		t.Fatalf("en espanol: %q", es)
	}
	_, en := notification.Texto(notification.AvisoEscrowEntregaPorVencerVendedor, "en", datos)
	if !strings.Contains(en, "09/19/2026 at 9:30 PM") {
		t.Fatalf("en ingles: %q", en)
	}
	// Sin plazo lo dice, en vez de quedar vacio o con la fecha cero.
	_, sin := notification.Texto(notification.AvisoEscrowEntregaPorVencerVendedor, "es", datosDelAviso(a, nil))
	if !strings.Contains(sin, "(sin fecha)") || strings.Contains(sin, "0001") {
		t.Fatalf("sin plazo: %q", sin)
	}
}

// Un plazo en cero venceria el acuerdo en el mismo barrido que lo ve fondeado.
func TestPlazosSinValorUsanLosDeDefecto(t *testing.T) {
	p := plazosDe(&Plazos{DiasParaEntregar: 0, DiasParaRevisar: -3})
	d := PlazosPorDefecto()
	if p.DiasParaEntregar != d.DiasParaEntregar || p.DiasParaRevisar != d.DiasParaRevisar || p.AvisoAntes != d.AvisoAntes {
		t.Fatalf("plazos = %+v, se esperaban los de defecto %+v", p, d)
	}
	if got := plazosDe(nil); got != d {
		t.Fatalf("sin plazos = %+v, se esperaban %+v", got, d)
	}
	if got := plazosDe(&Plazos{DiasParaEntregar: 30}); got.DiasParaEntregar != 30 || got.DiasParaRevisar != d.DiasParaRevisar {
		t.Fatalf("un plazo configurado se perdio: %+v", got)
	}
}
