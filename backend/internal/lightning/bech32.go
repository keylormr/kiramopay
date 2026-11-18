package lightning

import (
	"errors"
	"strings"
)

// Bech32 (BIP-173), sin el tope de 90 caracteres: una factura BOLT 11 lo pasa
// casi siempre, y BOLT 11 dice que ese tope no se aplica.

const alfabetoBech32 = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"

var valorBech32 = func() [128]int8 {
	var t [128]int8
	for i := range t {
		t[i] = -1
	}
	for i, c := range alfabetoBech32 {
		t[c] = int8(i)
	}
	return t
}()

// largoMaximoBech32 acota lo que se acepta leer. Una factura real mide unos
// cientos de caracteres; el limite practico de una URL de LNURL es ~2.000.
const largoMaximoBech32 = 4096

// decodificarBech32 devuelve la parte legible (en minusculas) y las palabras de
// 5 bits sin la suma de control.
func decodificarBech32(s string) (string, []byte, error) {
	if len(s) > largoMaximoBech32 {
		return "", nil, errors.New("demasiado larga")
	}
	minusculas := strings.ToLower(s)
	if minusculas != s && strings.ToUpper(s) != s {
		return "", nil, errors.New("mayusculas y minusculas mezcladas")
	}
	s = minusculas
	sep := strings.LastIndexByte(s, '1')
	if sep < 1 || sep+7 > len(s) {
		return "", nil, errors.New("sin separador o sin suma de control")
	}
	hrp := s[:sep]
	for i := 0; i < len(hrp); i++ {
		if hrp[i] < 33 || hrp[i] > 126 {
			return "", nil, errors.New("caracter invalido en el prefijo")
		}
	}
	datos := make([]byte, 0, len(s)-sep-1)
	for i := sep + 1; i < len(s); i++ {
		c := s[i]
		if c >= 128 || valorBech32[c] < 0 {
			return "", nil, errors.New("caracter fuera del alfabeto")
		}
		datos = append(datos, byte(valorBech32[c]))
	}
	if polimodBech32(append(expandirPrefijo(hrp), datos...)) != 1 {
		return "", nil, errors.New("suma de control invalida")
	}
	return hrp, datos[:len(datos)-6], nil
}

func expandirPrefijo(hrp string) []byte {
	salida := make([]byte, 0, len(hrp)*2+1)
	for i := 0; i < len(hrp); i++ {
		salida = append(salida, hrp[i]>>5)
	}
	salida = append(salida, 0)
	for i := 0; i < len(hrp); i++ {
		salida = append(salida, hrp[i]&31)
	}
	return salida
}

func polimodBech32(valores []byte) uint32 {
	generadores := [5]uint32{0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3}
	chk := uint32(1)
	for _, v := range valores {
		b := chk >> 25
		chk = (chk&0x1ffffff)<<5 ^ uint32(v)
		for i := 0; i < 5; i++ {
			if (b>>uint(i))&1 == 1 {
				chk ^= generadores[i]
			}
		}
	}
	return chk
}
