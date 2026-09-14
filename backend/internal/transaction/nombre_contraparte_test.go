package transaction

import (
	"strings"
	"testing"
	"unicode/utf8"
)

func TestTruncateCounterpartyName_LoQueCabeNoCambia(t *testing.T) {
	for _, nombre := range []string{
		"",
		"Ana Solis",
		strings.Repeat("a", counterpartyNameMax),
		// 100 caracteres de dos bytes: 200 bytes, pero la columna cuenta
		// caracteres, asi que cabe entero.
		strings.Repeat("ñ", counterpartyNameMax),
	} {
		if got := truncateCounterpartyName(nombre); got != nombre {
			t.Errorf("truncateCounterpartyName(%q) = %q, no debia cambiar", nombre, got)
		}
	}
}

// El caso que se vio en el historial: la descripcion de un escrow cortada en
// el caracter 100, "...para ver que hac", a mitad de palabra y sin aviso.
func TestTruncateCounterpartyName_CortaEnUnaPalabraYLoMarca(t *testing.T) {
	nombre := "QA-3 disputa, cede el vendedor reembolsando. Descripcion deliberadamente " +
		"larguisima para ver que hace el sistema con los textos que no caben"
	got := truncateCounterpartyName(nombre)

	if n := utf8.RuneCountInString(got); n > counterpartyNameMax {
		t.Fatalf("quedaron %d caracteres, el tope es %d", n, counterpartyNameMax)
	}
	if !strings.HasSuffix(got, puntosSuspensivos) {
		t.Fatalf("%q no marca que se corto", got)
	}
	conservado := strings.TrimSuffix(got, puntosSuspensivos)
	if !strings.HasPrefix(nombre, conservado) {
		t.Fatalf("%q no es el principio del nombre original", conservado)
	}
	if siguiente, _ := utf8.DecodeRuneInString(nombre[len(conservado):]); siguiente != ' ' {
		t.Fatalf("se partio una palabra: lo conservado es %q y en el original sigue %q", conservado, siguiente)
	}
	if want := "QA-3 disputa, cede el vendedor reembolsando. Descripcion deliberadamente larguisima para ver que..."; got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

// Runas de varios bytes: ni UTF-8 invalido ni una palabra partida, y el tope se
// cuenta en caracteres (la salida pesa mas de 100 bytes y aun asi cabe).
func TestTruncateCounterpartyName_RunasMultibyte(t *testing.T) {
	nombre := strings.Repeat("Ñandú Pérez ", 15)
	got := truncateCounterpartyName(nombre)

	if !utf8.ValidString(got) {
		t.Fatalf("%q no es UTF-8 valido", got)
	}
	if n := utf8.RuneCountInString(got); n > counterpartyNameMax {
		t.Fatalf("quedaron %d caracteres, el tope es %d", n, counterpartyNameMax)
	}
	if len(got) <= counterpartyNameMax {
		t.Fatalf("salieron %d bytes: se corto por bytes y no por caracteres", len(got))
	}
	conservado := strings.TrimSuffix(got, puntosSuspensivos)
	if ultima := conservado[strings.LastIndex(conservado, " ")+1:]; ultima != "Ñandú" && ultima != "Pérez" {
		t.Fatalf("la ultima palabra quedo partida: %q", ultima)
	}
}

// Una sola palabra sin espacios no tiene donde cortar limpio: se corta en el
// ultimo caracter que cabe, sin romper la runa.
func TestTruncateCounterpartyName_UnaSolaPalabraEnorme(t *testing.T) {
	got := truncateCounterpartyName(strings.Repeat("é", 150))
	want := strings.Repeat("é", counterpartyNameMax-len(puntosSuspensivos)) + puntosSuspensivos
	if got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

// Un separador colgando antes de los puntos ("Cena, ...") sobra.
func TestTruncateCounterpartyName_SinSeparadorColgando(t *testing.T) {
	nombre := strings.Repeat("x", 90) + ", palabra larga que ya no cabe en el tope"
	if got, want := truncateCounterpartyName(nombre), strings.Repeat("x", 90)+puntosSuspensivos; got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}
