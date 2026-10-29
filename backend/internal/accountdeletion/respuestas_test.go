package accountdeletion

import (
	"regexp"
	"strings"
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

// El aviso de una solicitud bloqueada sale por correo, y el correo tutea: asi le
// habla la app a la persona (el dueno pidio sacar el voseo, #275). Las formas con
// el pronombre pegado ("envialo", "cerralo") van sin tilde en voseo y con tilde
// en tuteo ("envíalo", "ciérralo").
var voseo = regexp.MustCompile(`(?i)(?:^|[^\p{L}])(tenés|podés|esperá|envialo|retiralo|gastalo|pasalo|vendelas|envialas|retirala|cancelalos|cerralo)(?:[^\p{L}]|$)`)

func TestFrasesDeBloqueo_EnTuteo(t *testing.T) {
	for codigo, frase := range frasesDeBloqueo {
		if m := voseo.FindStringSubmatch(frase); m != nil {
			t.Errorf("%s: %q usa voseo (%q); el correo tutea", codigo, frase, m[1])
		}
	}
	if !regexp.MustCompile(`\btienes\b`).MatchString(frasesDeBloqueo[BloqueoSaldo]) {
		t.Errorf("la frase del saldo: %q", frasesDeBloqueo[BloqueoSaldo])
	}
	// Las que mandan a hacer algo lo dicen en tuteo, no solo sin voseo.
	for codigo, esperada := range map[string]string{
		BloqueoSaldo:          "envíalo, retíralo o gástalo",
		BloqueoAhorros:        "pásalo a tu billetera",
		BloqueoCripto:         "véndelas o envíalas",
		BloqueoStaking:        "retírala",
		BloqueoCobrosAbiertos: "cancélalos",
		BloqueoEscrowAbierto:  "ciérralo o espera a que se liquide",
	} {
		if !strings.Contains(frasesDeBloqueo[codigo], esperada) {
			t.Errorf("%s: %q no dice %q", codigo, frasesDeBloqueo[codigo], esperada)
		}
	}
}

// La regla para pasar una respuesta a operaciones: a las 48 horas, o antes si el
// plazo legal ya no le deja tres dias. Una respuesta normal (nacida con su plazo
// de cinco dias habiles) nunca escala antes de las 48 horas, nazca el dia que
// nazca; una que nacio con el plazo encima escala al primer fallo.
func TestPasaAOperaciones_NuncaAntesDeLas48HorasSiNacioConSuPlazo(t *testing.T) {
	cr := time.FixedZone("CR", -6*3600)
	for dia := 19; dia <= 25; dia++ { // del lunes 19 al domingo 25 de octubre de 2026
		for _, hora := range []int{0, 10, 23} {
			creada := time.Date(2026, 10, dia, hora, 30, 0, 0, cr)
			vence := responderAntesDe(creada)
			if pasaAOperaciones(creada.Add(48*time.Hour-time.Minute), creada, vence) {
				t.Errorf("%s: escalo antes de las 48 horas", creada.Format("Mon 02 15:04"))
			}
			if !pasaAOperaciones(creada.Add(48*time.Hour), creada, vence) {
				t.Errorf("%s: a las 48 horas debia escalar", creada.Format("Mon 02 15:04"))
			}
		}
	}
	creada := time.Date(2026, 10, 22, 10, 0, 0, 0, cr)
	tarde := responderAntesDe(creada.AddDate(0, 0, -5))
	if !pasaAOperaciones(creada.Add(time.Minute), creada, tarde) {
		t.Error("la que nacio con el plazo encima debe escalar al primer fallo")
	}
}
