package user

import (
	"strings"
	"testing"
)

func TestNewReferralCode_LargoYAlfabeto(t *testing.T) {
	for i := 0; i < 1000; i++ {
		code := NewReferralCode()
		if len(code) != largoCodigoReferido {
			t.Fatalf("largo %d, se esperaba %d (%q)", len(code), largoCodigoReferido, code)
		}
		for _, c := range code {
			if !strings.ContainsRune(alfabetoReferido, c) {
				t.Fatalf("simbolo %q fuera del alfabeto en %q", c, code)
			}
		}
		if !IsValidReferralCodeFormat(code) {
			t.Fatalf("el codigo generado %q no cumple el formato", code)
		}
	}
}

func TestNewReferralCode_SinRepetidos(t *testing.T) {
	const n = 10000
	vistos := make(map[string]struct{}, n)
	for i := 0; i < n; i++ {
		code := NewReferralCode()
		if _, dup := vistos[code]; dup {
			t.Fatalf("codigo repetido en %d generaciones: %q", n, code)
		}
		vistos[code] = struct{}{}
	}
}

func TestNormalizeReferralCode(t *testing.T) {
	casos := map[string]string{
		" k7pm3xq2 ": "K7PM3XQ2",
		"K7PM3XQ2":   "K7PM3XQ2",
		"\tabc\n":    "ABC",
		"   ":        "",
		"":           "",
	}
	for in, want := range casos {
		if got := NormalizeReferralCode(in); got != want {
			t.Errorf("NormalizeReferralCode(%q) = %q, se esperaba %q", in, got, want)
		}
	}
}

func TestIsValidReferralCodeFormat(t *testing.T) {
	validos := []string{"K7PM3XQ2", "ABCDEFGH", "23456789", "A1B2C3D4"}
	for _, c := range validos {
		if !IsValidReferralCodeFormat(c) {
			t.Errorf("%q deberia ser valido", c)
		}
	}
	invalidos := []string{
		"",
		"K7PM3XQ",   // 7
		"K7PM3XQ22", // 9
		"k7pm3xq2",  // minusculas: se espera YA normalizado
		"K7PM3XQ-",  // simbolo
		"K7PM 3XQ",  // espacio
		"K7PM3XQ2\n",
		"ÑÑÑÑÑÑÑÑ",
	}
	for _, c := range invalidos {
		if IsValidReferralCodeFormat(c) {
			t.Errorf("%q deberia ser invalido", c)
		}
	}
}
