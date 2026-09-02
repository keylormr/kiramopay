package user

import (
	"crypto/rand"
	"regexp"
	"strings"
)

// alfabetoReferido omite los simbolos ambiguos (0/O, 1/I/L) para que el codigo
// se pueda dictar por telefono o teclear desde una foto sin equivocarse. Debe
// coincidir con el alfabeto del backfill de la migracion 051.
const alfabetoReferido = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
const largoCodigoReferido = 8

var patronCodigoReferido = regexp.MustCompile(`^[A-Z0-9]{8}$`)

// NewReferralCode genera un codigo de invitacion aleatorio (crypto/rand),
// 8 simbolos del alfabeto sin ambiguos. Mismo alfabeto que el backfill de 051.
func NewReferralCode() string {
	b := make([]byte, largoCodigoReferido)
	_, _ = rand.Read(b) // crypto/rand.Read does not fail in practice
	// 31 simbolos no dividen a 256: el sesgo por modulo es < 0.4 % por posicion,
	// irrelevante para un codigo de invitacion (no es un secreto criptografico).
	for i := range b {
		b[i] = alfabetoReferido[int(b[i])%len(alfabetoReferido)]
	}
	return string(b)
}

// NormalizeReferralCode: trim + upper; "" si queda vacio.
func NormalizeReferralCode(s string) string {
	return strings.ToUpper(strings.TrimSpace(s))
}

// IsValidReferralCodeFormat: ^[A-Z0-9]{8}$ sobre el codigo YA normalizado.
func IsValidReferralCodeFormat(s string) bool {
	return patronCodigoReferido.MatchString(s)
}
