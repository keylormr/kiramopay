// Package identifier clasifica el identificador de login (nombre de usuario,
// cedula, correo o telefono) y lo lleva a su forma canonica. Es la UNICA fuente de esas reglas:
// el handler, el servicio de auth y el middleware de lockout la comparten para
// que los tres construyan exactamente la misma clave por intento.
package identifier

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"regexp"
	"strings"

	"github.com/kiramopay/backend/pkg/validator"
)

type Kind string

const (
	KindCedula   Kind = "cedula"
	KindEmail    Kind = "email"
	KindPhone    Kind = "phone"
	KindUsername Kind = "username"
)

// reUsername es la forma del nombre de usuario. Exige empezar por LETRA y no
// admite '@', y de ahi sale lo unico que esta regla garantiza: que los cuatro
// espacios sean DISJUNTOS. Cedula y telefono son solo digitos, asi que quedan
// fuera por construccion, y un correo lleva arroba. Sin esa disyuncion,
// alguien podria registrar el nombre de usuario "702650930" y hacer chocar el
// contador de intentos de la cuenta cuya CEDULA es esa.
//
// Lo que esta regla NO hace, y conviene no creer que hace: frenar la basura
// antes del Argon2id. "password" calza este regex, asi que llega igual al
// servicio. Esa defensa es otra y vive en el login: la consulta por nombre de
// usuario va contra una columna indexada y sin cifrar, asi que se resuelve
// ANTES de gastar el hash, y una cadena que no existe se responde sin quemar
// los 128 MiB. Ver el comentario de Login en internal/auth/service.go.
var reUsername = regexp.MustCompile(`^[a-z][a-z0-9._-]{2,19}$`)

// reservados son los nombres que nadie puede reclamar. Sin esta lista, el
// primero que se registre se queda con "admin" o con "soporte" y puede hacerse
// pasar por el equipo en cualquier pantalla donde el nombre se muestre.
//
// ESPEJA chk_users_username_reservado de la migracion 058: la misma lista vive
// tambien en la base, porque un INSERT que no pase por este servicio no puede
// colarse por una puerta que el codigo cierra.
var reservados = map[string]bool{
	"admin": true, "administrador": true, "soporte": true, "support": true,
	"ayuda": true, "help": true, "seguridad": true, "security": true,
	"root": true, "sistema": true, "system": true, "oficial": true,
	"official": true, "info": true, "contacto": true, "kiramo": true,
	"kiramopay": true, "nadie": true, "null": true, "undefined": true,
}

// ValidUsername dice si un valor ya canonicalizado (minusculas, sin espacios a
// los lados) es un nombre de usuario admisible: calza el formato y no esta
// reservado. La usan el registro y la migracion para no repetir la regla.
func ValidUsername(canonical string) bool {
	if !reUsername.MatchString(canonical) {
		return false
	}
	if reservados[canonical] || strings.HasPrefix(canonical, "kiramo") {
		return false
	}
	return true
}

// CanonicalizarUsername lleva lo tecleado a su forma canonica sin juzgarlo.
func CanonicalizarUsername(raw string) string {
	return strings.ToLower(strings.TrimSpace(raw))
}

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

	// Nombre de usuario: regla POSITIVA y primera. Empieza por letra, asi que
	// no puede confundirse con cedula ni telefono (solo digitos) y el regex no
	// admite '@', asi que tampoco con un correo.
	if lower := strings.ToLower(s); reUsername.MatchString(lower) {
		return KindUsername, lower, nil
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
//
// Lleva el TIPO en la clave a proposito. Sin el, el espacio de nombres es uno
// solo y el nombre de usuario —el unico de los cuatro que una persona elige—
// se podria usar como arma: registrar el usuario "702650930", fallar cinco
// veces contra el, y dejar bloqueado el login de la cuenta cuya CEDULA es esa.
// Con el tipo delante, cada espacio cuenta sus propios intentos.
func LockoutKey(kind Kind, canonical string) string {
	sum := sha256.Sum256([]byte(canonical))
	return "lockout:" + string(kind) + ":" + hex.EncodeToString(sum[:])
}
