// Package identifier clasifica el identificador de login (cedula, correo o
// telefono) y lo lleva a su forma canonica. Es la UNICA fuente de esas reglas:
// el handler, el servicio de auth y el middleware de lockout la comparten para
// que los tres construyan exactamente la misma clave por intento.
package identifier

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strings"

	"github.com/kiramopay/backend/pkg/validator"
)

type Kind string

const (
	KindCedula Kind = "cedula"
	KindEmail  Kind = "email"
	KindPhone  Kind = "phone"
)

// ErrUnrecognized: la entrada no calza con ninguna forma valida. El mensaje al
// cliente debe ser generico (no revelar que forma fallo).
var ErrUnrecognized = errors.New("unrecognized identifier")

const maxLen = 254 // tope RFC de un correo; nada legitimo lo excede

// Classify decide el tipo por forma DISJUNTA y devuelve la forma canonica:
// correo -> lower(trim); telefono -> +506XXXXXXXX; cedula -> solo digitos.
// Reglas: contiene '@' = correo; tras quitar espacios, guiones y puntos:
// +506XXXXXXXX, 506XXXXXXXX (11 digitos) u 8 digitos = telefono; 9-12 digitos
// = cedula. La ambiguedad de 11 digitos que empiezan en 506 se resuelve a
// favor de telefono, igual que hace el frontend (normalizarTelefonoCR).
func Classify(raw string) (Kind, string, error) {
	s := strings.TrimSpace(raw)
	if s == "" || len(s) > maxLen {
		return "", "", ErrUnrecognized
	}

	if strings.Contains(s, "@") {
		canon := strings.ToLower(s)
		if verr := validator.ValidateEmail(canon); verr != nil {
			return "", "", ErrUnrecognized
		}
		return KindEmail, canon, nil
	}

	// Separadores tolerados en cedulas ("1-2345-6789") y telefonos tecleados.
	clean := strings.Map(func(r rune) rune {
		switch r {
		case ' ', '-', '.':
			return -1
		}
		return r
	}, s)

	plus := strings.HasPrefix(clean, "+")
	digits := strings.TrimPrefix(clean, "+")
	for _, r := range digits {
		if r < '0' || r > '9' {
			return "", "", ErrUnrecognized
		}
	}

	switch {
	case plus:
		if len(digits) == 11 && strings.HasPrefix(digits, "506") {
			return KindPhone, "+" + digits, nil
		}
		return "", "", ErrUnrecognized
	case len(digits) == 8:
		return KindPhone, "+506" + digits, nil
	// Antes del rango de cedula a proposito: 506XXXXXXXX pelado es telefono.
	case len(digits) == 11 && strings.HasPrefix(digits, "506"):
		return KindPhone, "+" + digits, nil
	case len(digits) >= 9 && len(digits) <= 12:
		return KindCedula, digits, nil
	}
	return "", "", ErrUnrecognized
}

// LockoutKey construye la clave Redis del contador de intentos fallidos para
// un identificador canonico. Va hasheada para no dejar PII en claro en Redis.
func LockoutKey(canonical string) string {
	sum := sha256.Sum256([]byte(canonical))
	return "lockout:" + hex.EncodeToString(sum[:])
}
