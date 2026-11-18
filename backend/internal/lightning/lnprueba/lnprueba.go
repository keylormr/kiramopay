// Package lnprueba arma dobles de Lightning para las pruebas: facturas BOLT 11
// bien formadas (con firma de ceros) y un servidor LNURL que se porta como el
// de una direccion Lightning, con verificacion LUD-21.
//
// Solo lo importan pruebas. Una factura de aqui no se puede pagar: no tiene
// firma valida.
package lnprueba

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/kiramopay/backend/internal/lightning"
)

// ── Facturas ────────────────────────────────────────────────────────────────

const alfabeto = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"

// Factura arma una factura BOLT 11 de la red dada por msat milisatoshis, con
// ese payment hash, fecha y plazo en segundos. La firma son ceros.
func Factura(red string, msat int64, paymentHash [32]byte, fecha time.Time, plazo int) string {
	hrp := "ln" + red + monto(msat)
	var datos []byte
	datos = append(datos, entero(uint64(fecha.Unix()), 7)...)
	datos = append(datos, campo(1, aPalabras(paymentHash[:]))...)
	secreto := sha256.Sum256(paymentHash[:])
	datos = append(datos, campo(16, aPalabras(secreto[:]))...)
	datos = append(datos, campo(13, aPalabras([]byte("KiramoPay")))...)
	if plazo > 0 {
		datos = append(datos, campo(6, enteroMinimo(uint64(plazo)))...)
	}
	datos = append(datos, make([]byte, 104)...) // firma
	return codificar(hrp, datos)
}

// Preimage devuelve un preimage al azar y su payment hash.
func Preimage() (preimage, hash [32]byte) {
	if _, err := rand.Read(preimage[:]); err != nil {
		panic(err)
	}
	return preimage, sha256.Sum256(preimage[:])
}

func monto(msat int64) string {
	if msat <= 0 {
		return ""
	}
	if msat%100 == 0 {
		return strconv.FormatInt(msat/100, 10) + "n"
	}
	return strconv.FormatInt(msat*10, 10) + "p"
}

func campo(tipo byte, valor []byte) []byte {
	return append([]byte{tipo, byte(len(valor) >> 5), byte(len(valor) & 31)}, valor...)
}

func entero(n uint64, palabras int) []byte {
	salida := make([]byte, palabras)
	for i := palabras - 1; i >= 0; i-- {
		salida[i] = byte(n & 31)
		n >>= 5
	}
	return salida
}

func enteroMinimo(n uint64) []byte {
	palabras := 1
	for v := n >> 5; v > 0; v >>= 5 {
		palabras++
	}
	return entero(n, palabras)
}

func aPalabras(b []byte) []byte {
	var acumulado uint32
	var bits uint
	var salida []byte
	for _, c := range b {
		acumulado = acumulado<<8 | uint32(c)
		bits += 8
		for bits >= 5 {
			bits -= 5
			salida = append(salida, byte(acumulado>>bits)&31)
		}
	}
	if bits > 0 {
		salida = append(salida, byte(acumulado<<(5-bits))&31)
	}
	return salida
}

func codificar(hrp string, datos []byte) string {
	valores := append(expandir(hrp), datos...)
	valores = append(valores, 0, 0, 0, 0, 0, 0)
	mod := polimod(valores) ^ 1
	var sb strings.Builder
	sb.WriteString(hrp)
	sb.WriteByte('1')
	for _, d := range datos {
		sb.WriteByte(alfabeto[d])
	}
	for i := 0; i < 6; i++ {
		sb.WriteByte(alfabeto[(mod>>uint(5*(5-i)))&31])
	}
	return sb.String()
}

func expandir(hrp string) []byte {
	var salida []byte
	for i := 0; i < len(hrp); i++ {
		salida = append(salida, hrp[i]>>5)
	}
	salida = append(salida, 0)
	for i := 0; i < len(hrp); i++ {
		salida = append(salida, hrp[i]&31)
	}
	return salida
}

func polimod(valores []byte) uint32 {
	gen := [5]uint32{0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3}
	chk := uint32(1)
	for _, v := range valores {
		b := chk >> 25
		chk = (chk&0x1ffffff)<<5 ^ uint32(v)
		for i := 0; i < 5; i++ {
			if (b>>uint(i))&1 == 1 {
				chk ^= gen[i]
			}
		}
	}
	return chk
}

// ── Servidor LNURL ──────────────────────────────────────────────────────────

type facturaEmitida struct {
	texto    string
	preimage [32]byte
	pagada   bool
}

// Servidor es una direccion Lightning de mentira: responde LUD-16, emite
// facturas por el monto pedido con su URL de verificacion y dice que estan
// pagadas cuando la prueba llama a Pagar.
type Servidor struct {
	*httptest.Server
	Host string

	mu       sync.Mutex
	facturas map[string]*facturaEmitida // por payment hash en hex

	// Lo que la prueba puede torcer.
	MinMsat, MaxMsat int64
	ComentarioMax    int
	SinVerificacion  bool
	MontoCambiado    bool   // la factura sale por 1 msat mas de lo pedido
	Red              string // "bc" si se deja vacio
	Error            string // responde {"status":"ERROR"} con este motivo
	PreimageFalso    bool   // la verificacion dice pagada con otro preimage
	Plazo            int    // segundos de vida de la factura; 0 = sin campo x

	// Lo que la prueba puede leer.
	Pedidos          int
	Verificaciones   int
	UltimoComentario string
}

// Nuevo levanta el servidor; se apaga al terminar la prueba.
func Nuevo(t testing.TB) *Servidor {
	t.Helper()
	s := &Servidor{facturas: map[string]*facturaEmitida{}, MinMsat: 1000, MaxMsat: 100_000_000_000, ComentarioMax: 120, Plazo: 3600}
	s.Server = httptest.NewTLSServer(http.HandlerFunc(s.atender))
	u, _ := url.Parse(s.Server.URL)
	s.Host = u.Host
	t.Cleanup(s.Server.Close)
	return s
}

// Cliente devuelve un cliente LNURL que confia en este servidor y solo en el.
func (s *Servidor) Cliente() *lightning.Cliente {
	return lightning.NuevoCliente([]string{s.Host}, "bc", s.Server.Client())
}

// Direccion es la direccion Lightning de un usuario de este servidor.
func (s *Servidor) Direccion(usuario string) string { return usuario + "@" + s.Host }

// Pagar marca pagada la factura con ese payment hash.
func (s *Servidor) Pagar(paymentHash string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if f, ok := s.facturas[paymentHash]; ok {
		f.pagada = true
	}
}

// PagarTodas marca pagadas todas las facturas emitidas.
func (s *Servidor) PagarTodas() {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, f := range s.facturas {
		f.pagada = true
	}
}

// Emitidas cuenta las facturas emitidas.
func (s *Servidor) Emitidas() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.facturas)
}

func (s *Servidor) responder(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	_ = json.NewEncoder(w).Encode(v)
}

func (s *Servidor) atender(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.Error != "" {
		s.responder(w, map[string]string{"status": "ERROR", "reason": s.Error})
		return
	}
	partes := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	switch {
	case len(partes) == 3 && partes[0] == ".well-known" && partes[1] == "lnurlp":
		s.responder(w, map[string]any{
			"tag":            "payRequest",
			"callback":       "https://" + s.Host + "/lnurlp/" + partes[2] + "/callback",
			"minSendable":    s.MinMsat,
			"maxSendable":    s.MaxMsat,
			"metadata":       `[["text/plain","Pago a ` + partes[2] + `"],["text/identifier","` + partes[2] + "@" + s.Host + `"]]`,
			"commentAllowed": s.ComentarioMax,
		})
	case len(partes) == 3 && partes[0] == "lnurlp" && partes[2] == "callback":
		s.Pedidos++
		msat, err := strconv.ParseInt(r.URL.Query().Get("amount"), 10, 64)
		if err != nil {
			s.responder(w, map[string]string{"status": "ERROR", "reason": "amount"})
			return
		}
		s.UltimoComentario = r.URL.Query().Get("comment")
		if s.MontoCambiado {
			msat++
		}
		red := s.Red
		if red == "" {
			red = "bc"
		}
		pre, hash := Preimage()
		texto := Factura(red, msat, hash, time.Now(), s.Plazo)
		h := hex.EncodeToString(hash[:])
		s.facturas[h] = &facturaEmitida{texto: texto, preimage: pre}
		respuesta := map[string]any{"pr": texto, "routes": []any{}}
		if !s.SinVerificacion {
			respuesta["verify"] = "https://" + s.Host + "/lnurlp/" + partes[1] + "/verify/" + h
		}
		s.responder(w, respuesta)
	case len(partes) == 4 && partes[0] == "lnurlp" && partes[2] == "verify":
		s.Verificaciones++
		f, ok := s.facturas[partes[3]]
		if !ok {
			s.responder(w, map[string]string{"status": "ERROR", "reason": "Not found"})
			return
		}
		respuesta := map[string]any{"status": "OK", "settled": f.pagada, "preimage": nil, "pr": f.texto}
		if f.pagada {
			pre := f.preimage
			if s.PreimageFalso {
				pre[0] ^= 0xff
			}
			respuesta["preimage"] = hex.EncodeToString(pre[:])
		}
		s.responder(w, respuesta)
	default:
		http.NotFound(w, r)
	}
}

// Describe, para mensajes de pruebas.
func (s *Servidor) String() string { return fmt.Sprintf("lnurl de prueba en %s", s.Host) }
