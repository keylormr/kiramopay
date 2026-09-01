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
		// Invalidos
		{"", "", "", true},
		{"1234567", "", "", true},          // 7 digitos: ni telefono ni cedula
		{"1234567890123", "", "", true},    // 13 digitos
		{"+1234567890", "", "", true},      // + sin 506
		{"hola", "", "", true},             // letras sin @
		{"no-un-correo@", "", "", true},    // @ pero invalido
		{"12 34 lo que sea", "", "", true},
		{strings.Repeat("9", 300), "", "", true}, // sobre el tope de largo
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

func TestLockoutKeySinPII(t *testing.T) {
	k := LockoutKey("keilor@example.com")
	if strings.Contains(k, "keilor") || strings.Contains(k, "@") {
		t.Fatalf("la clave de lockout expone PII: %q", k)
	}
	if !strings.HasPrefix(k, "lockout:") || len(k) != len("lockout:")+64 {
		t.Fatalf("formato inesperado de clave: %q", k)
	}
	if k != LockoutKey("keilor@example.com") {
		t.Fatal("la clave no es determinista")
	}
	if k == LockoutKey("otro@example.com") {
		t.Fatal("claves iguales para identificadores distintos")
	}
}
