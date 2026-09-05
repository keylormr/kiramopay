package adminusers

import (
	"testing"

	"github.com/kiramopay/backend/pkg/identifier"
)

// hashColumnFor tenia una rama default que devolvia "cedula_hash" para
// cualquier tipo desconocido. Al aparecer el nombre de usuario como cuarto
// tipo, la busqueda del panel de administracion empezaba a mandar terminos
// como "martinez" o "keil" —que ahora clasifican— a consultarse contra el HMAC
// de la cedula. No fallaba: devolvia cero filas, en silencio, y la busqueda por
// nombre del panel quedaba muerta sin que nadie se enterara.
//
// Sin el arreglo esta prueba falla: hashColumnFor(KindUsername) devuelve
// "cedula_hash".
func TestHashColumnFor_SoloLosTiposQueVivenEnUnaColumnaPII(t *testing.T) {
	casos := []struct {
		kind     identifier.Kind
		esperado string
	}{
		{identifier.KindCedula, "cedula_hash"},
		{identifier.KindPhone, "phone_hash"},
		{identifier.KindEmail, "email_hash"},
		// El nombre de usuario NO vive en una columna HMAC: quien lo pida tiene
		// que seguir el camino de la busqueda por nombre, no el del hash.
		{identifier.KindUsername, ""},
		// Y un tipo que no existe tampoco puede caer en cedula_hash.
		{identifier.Kind("tipo-que-no-existe"), ""},
	}
	for _, c := range casos {
		if got := hashColumnFor(c.kind); got != c.esperado {
			t.Errorf("hashColumnFor(%q) = %q, esperaba %q", c.kind, got, c.esperado)
		}
	}
}

// Los terminos que un administrador teclea de verdad para buscar a alguien por
// su nombre no pueden terminar consultando una columna de PII.
func TestBusquedaPorNombre_NoSeVaAUnaColumnaDeHash(t *testing.T) {
	for _, termino := range []string{"martinez", "keil", "ana", "lopez", "victor"} {
		k, _, err := identifier.Classify(termino)
		if err != nil {
			continue // no clasifica: ya iba por el camino del nombre
		}
		if col := hashColumnFor(k); col != "" {
			t.Errorf("buscar %q se iria a la columna %q en vez de buscar por nombre", termino, col)
		}
	}
}
