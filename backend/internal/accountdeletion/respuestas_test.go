package accountdeletion

import (
	"regexp"
	"testing"
	"time"
)

// El plazo para responder son cinco dias habiles (Ley 8968 art. 7, Reglamento
// art. 18), contados en Costa Rica. Los feriados no se descuentan: el plazo que
// se calcula queda igual o antes que el legal, nunca despues.
func TestResponderAntesDe_CincoDiasHabiles(t *testing.T) {
	cr := time.FixedZone("CR", -6*3600)
	casos := []struct {
		nombre      string
		desde, hast time.Time
	}{
		{"lunes", time.Date(2026, 10, 19, 10, 0, 0, 0, cr), time.Date(2026, 10, 26, 10, 0, 0, 0, cr)},
		{"viernes", time.Date(2026, 10, 23, 10, 0, 0, 0, cr), time.Date(2026, 10, 30, 10, 0, 0, 0, cr)},
		{"sabado", time.Date(2026, 10, 24, 10, 0, 0, 0, cr), time.Date(2026, 10, 30, 10, 0, 0, 0, cr)},
		{"domingo", time.Date(2026, 10, 25, 10, 0, 0, 0, cr), time.Date(2026, 10, 30, 10, 0, 0, 0, cr)},
		// Viernes 23:30 en Costa Rica es sabado en UTC: cuenta el dia de aqui.
		{"viernes de noche", time.Date(2026, 10, 24, 5, 30, 0, 0, time.UTC), time.Date(2026, 10, 30, 23, 30, 0, 0, cr)},
	}
	for _, c := range casos {
		if got := responderAntesDe(c.desde); !got.Equal(c.hast) {
			t.Errorf("%s: %v, se esperaba %v", c.nombre, got.In(cr), c.hast)
		}
	}
}

// El aviso de una solicitud bloqueada sale por correo, y el correo va en voseo.
var tuteo = regexp.MustCompile(`(?i)\b(tienes|tiene que|envíalo|retíralo|gástalo|pásalo|véndelas|envíalas|retírala|cancélalos|ciérralo|espera a)\b`)

func TestFrasesDeBloqueo_EnVoseo(t *testing.T) {
	for codigo, frase := range frasesDeBloqueo {
		if m := tuteo.FindString(frase); m != "" {
			t.Errorf("%s: %q usa tuteo (%q); el correo va en voseo", codigo, frase, m)
		}
	}
	if frasesDeBloqueo[BloqueoSaldo] == "" || !regexp.MustCompile(`\btenés\b`).MatchString(frasesDeBloqueo[BloqueoSaldo]) {
		t.Errorf("la frase del saldo: %q", frasesDeBloqueo[BloqueoSaldo])
	}
}
