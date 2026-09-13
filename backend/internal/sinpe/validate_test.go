package sinpe

import (
	"errors"
	"fmt"
	"testing"
)

func TestValidCRMobile(t *testing.T) {
	cases := []struct {
		in   string
		want bool
	}{
		{"88885678", true},      // 8-digit mobile starting with 8
		{"+50688885678", true},  // +506 prefix
		{"50688885678", true},   // 506 prefix, no +
		{"6123 4567", true},     // spaces ignored, starts with 6
		{"71234567", true},      // starts with 7
		{"21234567", false},     // landline prefix (2) not allowed
		{"1234567", false},      // 7 digits
		{"881234567", false},    // 9 digits
		{"", false},             // empty
		{"abcd1234", false},     // too few digits after stripping
		{"+50621234567", false}, // valid length but landline prefix
	}
	for _, c := range cases {
		if got := validCRMobile(c.in); got != c.want {
			t.Errorf("validCRMobile(%q) = %v, want %v", c.in, got, c.want)
		}
	}
}

// ContactExistsError debe calzar con errors.Is(err, ErrContactExists) y
// errors.As(err, &target): el handler depende de ambos para distinguir el
// rechazo por duplicado de cualquier otro error de AddContact.
func TestContactExistsError_ErrorsIsAndAs(t *testing.T) {
	original := &ContactRecord{ID: "c1", Name: "Maria Lopez", Bank: "BAC"}
	err := error(&ContactExistsError{Existing: original})

	if !errors.Is(err, ErrContactExists) {
		t.Fatal("errors.Is(err, ErrContactExists) deberia ser true")
	}

	var target *ContactExistsError
	if !errors.As(err, &target) {
		t.Fatal("errors.As deberia extraer *ContactExistsError")
	}
	if target.Existing != original {
		t.Fatalf("Existing = %+v, se esperaba el contacto original", target.Existing)
	}

	// Un envoltorio (fmt.Errorf con %w) tiene que seguir calzando: el handler
	// usa errors.As sobre lo que devuelve el servicio, que puede pasar por
	// capas intermedias.
	wrapped := fmt.Errorf("add contact: %w", err)
	if !errors.Is(wrapped, ErrContactExists) {
		t.Fatal("errors.Is deberia atravesar un %w")
	}
}
