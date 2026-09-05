package identifier

import (
	"strings"
	"testing"
)

func TestClassify(t *testing.T) {
	cases := []struct {
		in        string
		kind      Kind
		canonical string
		wantErr   bool
	}{
		// Cedulas
		{"702650930", KindCedula, "702650930", false},
		{"1-2345-6789", KindCedula, "123456789", false},
		{" 702650930 ", KindCedula, "702650930", false},
		{"123456789012", KindCedula, "123456789012", false},
		// Telefonos
		{"88880001", KindPhone, "+50688880001", false},
		{"8888-0001", KindPhone, "+50688880001", false},
		{"+50688880001", KindPhone, "+50688880001", false},
		{"50688880001", KindPhone, "+50688880001", false},
		{"506 8888 0001", KindPhone, "+50688880001", false},
		// Correos
		{"Keilor@Example.COM", KindEmail, "keilor@example.com", false},
		{"  a@b.co  ", KindEmail, "a@b.co", false},
		// Nombres de usuario: empiezan por letra, de 3 a 20 caracteres.
		{"keilor", KindUsername, "keilor", false},
		{"Victor", KindUsername, "victor", false},
		{" Demo ", KindUsername, "demo", false},
		{"a.b_c-1", KindUsername, "a.b_c-1", false},
		{"kei", KindUsername, "kei", false},                    // el minimo
		{"a" + strings.Repeat("b", 19), KindUsername, "a" + strings.Repeat("b", 19), false}, // el maximo
		// Invalidos
		{"", "", "", true},
		{"1234567", "", "", true},       // 7 digitos: ni telefono ni cedula
		{"1234567890123", "", "", true}, // 13 digitos
		{"+1234567890", "", "", true},   // + sin 506
		{"no-un-correo@", "", "", true}, // @ pero invalido
		{"12 34 lo que sea", "", "", true},
		{"ab", "", "", true},                                 // dos letras: bajo el minimo
		{"a" + strings.Repeat("b", 20), "", "", true},        // 21 caracteres: sobre el maximo
		{"1usuario", "", "", true},                           // no empieza por letra
		{"con espacio", "", "", true},                        // el espacio no es admisible
		{"acentó", "", "", true},                        // fuera del alfabeto
		{strings.Repeat("9", 300), "", "", true},             // sobre el tope de largo
	}
	for _, c := range cases {
		kind, canon, err := Classify(c.in)
		if c.wantErr {
			if err == nil {
				t.Errorf("Classify(%q): esperaba error, dio %s %q", c.in, kind, canon)
			}
			continue
		}
		if err != nil {
			t.Errorf("Classify(%q): error inesperado %v", c.in, err)
			continue
		}
		if kind != c.kind || canon != c.canonical {
			t.Errorf("Classify(%q) = %s %q, esperaba %s %q", c.in, kind, canon, c.kind, c.canonical)
		}
	}
}

// Los cuatro espacios tienen que ser DISJUNTOS. Si el nombre de usuario fuera
// un comodin, dos cosas se romperian a la vez: toda cadena basura llegaria al
// Argon2id del login en vez de morir con un 400, y alguien podria registrar el
// usuario "702650930" para chocar contra la cedula de otro.
func TestClassify_EspaciosDisjuntos(t *testing.T) {
	// Nada que sea cedula, telefono o correo puede clasificar como usuario.
	noUsuario := []string{"702650930", "1-2345-6789", "88880001", "+50688880001",
		"50688880001", "keilor@example.com"}
	for _, in := range noUsuario {
		kind, _, err := Classify(in)
		if err != nil {
			t.Errorf("Classify(%q) fallo: %v", in, err)
			continue
		}
		if kind == KindUsername {
			t.Errorf("Classify(%q) = usuario; invade el espacio de otro tipo", in)
		}
	}
	// Y ningun nombre de usuario valido puede clasificar como otra cosa.
	for _, in := range []string{"keilor", "demo", "victor", "a.b-c_1", "usuario506"} {
		kind, _, err := Classify(in)
		if err != nil || kind != KindUsername {
			t.Errorf("Classify(%q) = %s (err %v); esperaba usuario", in, kind, err)
		}
	}
}

// El contador de intentos vive en espacios separados por tipo. Sin eso, quien
// registrara el usuario "702650930" podria agotar los intentos de la cuenta
// cuya cedula es esa y dejarla fuera 15 minutos.
func TestLockoutKey_SeparaPorTipo(t *testing.T) {
	mismoTexto := "702650930"
	if LockoutKey(KindCedula, mismoTexto) == LockoutKey(KindUsername, mismoTexto) {
		t.Fatal("la cedula y el nombre de usuario comparten contador: uno puede bloquear al otro")
	}
	if LockoutKey(KindCedula, mismoTexto) != LockoutKey(KindCedula, mismoTexto) {
		t.Fatal("la clave no es determinista")
	}
}

func TestValidUsername(t *testing.T) {
	validos := []string{"kei", "keilor", "a.b_c-1", "usuario506", "a" + strings.Repeat("b", 19)}
	for _, v := range validos {
		if !ValidUsername(v) {
			t.Errorf("ValidUsername(%q) = false, esperaba true", v)
		}
	}
	invalidos := []string{"", "ab", "1abc", "Keilor", "con espacio", "a@b", "702650930",
		"a" + strings.Repeat("b", 20),
		// Reservados: nadie puede hacerse pasar por el equipo.
		"admin", "soporte", "support", "seguridad", "root", "sistema", "info",
		"kiramopay", "kiramo", "kiramo.oficial", "kiramopay2"}
	for _, v := range invalidos {
		if ValidUsername(v) {
			t.Errorf("ValidUsername(%q) = true, esperaba false", v)
		}
	}
}

func TestLockoutKeySinPII(t *testing.T) {
	k := LockoutKey(KindEmail, "keilor@example.com")
	if strings.Contains(k, "keilor") || strings.Contains(k, "@") {
		t.Fatalf("la clave de lockout expone PII: %q", k)
	}
	if !strings.HasPrefix(k, "lockout:email:") || len(k) != len("lockout:email:")+64 {
		t.Fatalf("formato inesperado de clave: %q", k)
	}
	if k != LockoutKey(KindEmail, "keilor@example.com") {
		t.Fatal("la clave no es determinista")
	}
	if k == LockoutKey(KindEmail, "otro@example.com") {
		t.Fatal("claves iguales para identificadores distintos")
	}
}
