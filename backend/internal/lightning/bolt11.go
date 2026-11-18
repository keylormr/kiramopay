// Package lightning lee facturas Lightning (BOLT 11) y habla LNURL (LUD-06,
// LUD-16 y LUD-21) para que un comercio cobre en su billetera propia.
//
// El servidor NO recibe, no guarda y no mueve bitcoin, y no tiene llaves. Lo
// unico que hace es pedirle una factura a la direccion Lightning del comercio,
// leer de ella el monto y el payment hash, y despues comprobar el preimage que
// devuelve la URL de verificacion: el SHA-256 del preimage es el payment hash,
// y segun BOLT 11 el preimage es la prueba de pago.
package lightning

import (
	"encoding/hex"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
)

// Errores de lectura de una factura. Todos son "esta factura no sirve": no se
// distingue mas porque nadie hace nada distinto con cada uno.
var (
	ErrFacturaInvalida = errors.New("factura lightning invalida")
)

// VencimientoPorDefecto es el plazo de una factura sin campo `x` (BOLT 11:
// "Default is 3600 (1 hour) if not specified").
const VencimientoPorDefecto = 3600 * time.Second

// Factura es lo que el servidor necesita saber de una factura BOLT 11.
//
// La firma NO se verifica: la factura llega por TLS desde el servidor LNURL de
// la direccion del comercio, que es quien la emite. Lo que importa de ella es
// el monto (que coincida con lo cotizado) y el payment hash (contra el que se
// comprueba el preimage).
type Factura struct {
	// Red: "bc" (principal), "tb" (testnet), "tbs" (signet), "bcrt" (regtest).
	Red string
	// MontoMsat en milisatoshis; 0 si la factura no trae monto.
	MontoMsat int64
	Fecha     time.Time
	Vence     time.Time
	// PaymentHash en hexadecimal, 64 caracteres.
	PaymentHash string
	// Descripcion (campo d) o, si viene hasheada, DescripcionHash (campo h).
	Descripcion     string
	DescripcionHash string
}

// Tipos de campo de BOLT 11 que se leen. Los demas se saltan.
const (
	campoPaymentHash     = 1  // p
	campoSecreto         = 16 // s
	campoDescripcion     = 13 // d
	campoDescripcionHash = 23 // h
	campoVencimiento     = 6  // x
	campoNodo            = 19 // n
)

// palabrasDeFirma: la firma son 65 bytes, 520 bits, 104 palabras de 5 bits.
const palabrasDeFirma = 104

// DecodificarFactura lee una factura BOLT 11. Acepta el prefijo "lightning:" y
// la factura toda en mayusculas (como va en un QR), nunca mezclada.
func DecodificarFactura(texto string) (*Factura, error) {
	s := strings.TrimSpace(texto)
	if len(s) >= len("lightning:") && strings.EqualFold(s[:len("lightning:")], "lightning:") {
		s = s[len("lightning:"):]
	}
	hrp, datos, err := decodificarBech32(s)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrFacturaInvalida, err)
	}
	f := &Factura{}
	if err := leerPrefijo(hrp, f); err != nil {
		return nil, err
	}
	// 7 palabras de fecha + la firma, como minimo.
	if len(datos) < 7+palabrasDeFirma {
		return nil, fmt.Errorf("%w: demasiado corta", ErrFacturaInvalida)
	}
	f.Fecha = time.Unix(int64(aEntero(datos[:7])), 0).UTC()
	campos := datos[7 : len(datos)-palabrasDeFirma]

	var vencimiento = VencimientoPorDefecto
	vistos := map[int]bool{}
	for len(campos) > 0 {
		if len(campos) < 3 {
			return nil, fmt.Errorf("%w: campo cortado", ErrFacturaInvalida)
		}
		tipo := int(campos[0])
		largo := int(campos[1])<<5 | int(campos[2])
		if len(campos) < 3+largo {
			return nil, fmt.Errorf("%w: campo mas largo que la factura", ErrFacturaInvalida)
		}
		valor := campos[3 : 3+largo]
		campos = campos[3+largo:]

		switch tipo {
		case campoPaymentHash:
			// BOLT 11: un p de otro largo se salta; dos p validos invalidan la factura.
			if largo != 52 {
				continue
			}
			if vistos[campoPaymentHash] {
				return nil, fmt.Errorf("%w: dos payment hash", ErrFacturaInvalida)
			}
			vistos[campoPaymentHash] = true
			b, err := aBytes(valor)
			if err != nil {
				return nil, err
			}
			f.PaymentHash = hex.EncodeToString(b[:32])
		case campoSecreto:
			if largo != 52 {
				continue
			}
			if vistos[campoSecreto] {
				return nil, fmt.Errorf("%w: dos payment secret", ErrFacturaInvalida)
			}
			vistos[campoSecreto] = true
		case campoNodo:
			// BOLT 11 lo exige de 53 palabras; con otro largo la factura es invalida.
			if largo != 53 {
				return nil, fmt.Errorf("%w: campo n de largo %d", ErrFacturaInvalida, largo)
			}
		case campoDescripcion:
			b, err := aBytes(valor)
			if err != nil {
				return nil, err
			}
			f.Descripcion = string(b)
		case campoDescripcionHash:
			if largo != 52 {
				continue
			}
			b, err := aBytes(valor)
			if err != nil {
				return nil, err
			}
			f.DescripcionHash = hex.EncodeToString(b[:32])
		case campoVencimiento:
			if largo == 0 || largo > 12 {
				return nil, fmt.Errorf("%w: vencimiento ilegible", ErrFacturaInvalida)
			}
			vencimiento = time.Duration(aEntero(valor)) * time.Second
		}
	}
	if f.PaymentHash == "" {
		return nil, fmt.Errorf("%w: sin payment hash", ErrFacturaInvalida)
	}
	if !vistos[campoSecreto] {
		return nil, fmt.Errorf("%w: sin payment secret", ErrFacturaInvalida)
	}
	f.Vence = f.Fecha.Add(vencimiento)
	return f, nil
}

// leerPrefijo separa la red y el monto: "lnbc2500u" -> red "bc", 250000000 msat.
func leerPrefijo(hrp string, f *Factura) error {
	if !strings.HasPrefix(hrp, "ln") {
		return fmt.Errorf("%w: no empieza con ln", ErrFacturaInvalida)
	}
	resto := hrp[2:]
	// Las redes conocidas, de la mas larga a la mas corta: "bcrt" antes que "bc".
	for _, red := range []string{"bcrt", "tbs", "bc", "tb"} {
		if strings.HasPrefix(resto, red) {
			f.Red = red
			resto = resto[len(red):]
			break
		}
	}
	if f.Red == "" {
		return fmt.Errorf("%w: red desconocida", ErrFacturaInvalida)
	}
	if resto == "" {
		return nil
	}
	msat, err := montoEnMsat(resto)
	if err != nil {
		return err
	}
	f.MontoMsat = msat
	return nil
}

// montoEnMsat interpreta el monto del prefijo. Un bitcoin son 10^11 msat.
// Multiplicadores (BOLT 11): m = 10^-3, u = 10^-6, n = 10^-9, p = 10^-12. Con p
// el ultimo digito tiene que ser 0: no hay fracciones de milisatoshi.
func montoEnMsat(texto string) (int64, error) {
	multiplicador := texto[len(texto)-1]
	cifras := texto
	var porBitcoin int64 // msat por unidad del monto
	divisor := int64(1)
	switch multiplicador {
	case 'm':
		porBitcoin = 100_000_000
	case 'u':
		porBitcoin = 100_000
	case 'n':
		porBitcoin = 100
	case 'p':
		porBitcoin = 1
		divisor = 10
	default:
		if multiplicador < '0' || multiplicador > '9' {
			return 0, fmt.Errorf("%w: multiplicador %q", ErrFacturaInvalida, multiplicador)
		}
		porBitcoin = 100_000_000_000
	}
	if multiplicador < '0' || multiplicador > '9' {
		cifras = texto[:len(texto)-1]
	}
	if cifras == "" || (len(cifras) > 1 && cifras[0] == '0') {
		return 0, fmt.Errorf("%w: monto mal escrito", ErrFacturaInvalida)
	}
	n, err := strconv.ParseInt(cifras, 10, 64)
	if err != nil || n <= 0 {
		return 0, fmt.Errorf("%w: monto mal escrito", ErrFacturaInvalida)
	}
	if divisor > 1 && n%divisor != 0 {
		return 0, fmt.Errorf("%w: fraccion de milisatoshi", ErrFacturaInvalida)
	}
	n /= divisor
	if n > (1<<62)/porBitcoin {
		return 0, fmt.Errorf("%w: monto fuera de rango", ErrFacturaInvalida)
	}
	return n * porBitcoin, nil
}

// aEntero lee palabras de 5 bits como un entero sin signo (big-endian).
func aEntero(palabras []byte) uint64 {
	var n uint64
	for _, p := range palabras {
		n = n<<5 | uint64(p)
	}
	return n
}

// aBytes reagrupa palabras de 5 bits en bytes. Los bits que sobran al final son
// relleno y se descartan, como dice BOLT 11.
func aBytes(palabras []byte) ([]byte, error) {
	var acumulado uint32
	var bits uint
	salida := make([]byte, 0, len(palabras)*5/8)
	for _, p := range palabras {
		if p > 31 {
			return nil, fmt.Errorf("%w: palabra fuera de rango", ErrFacturaInvalida)
		}
		acumulado = acumulado<<5 | uint32(p)
		bits += 5
		for bits >= 8 {
			bits -= 8
			salida = append(salida, byte(acumulado>>bits))
		}
		acumulado &= (1 << bits) - 1
	}
	return salida, nil
}
