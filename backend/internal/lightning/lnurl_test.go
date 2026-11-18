package lightning_test

import (
	"context"
	"encoding/hex"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/shopspring/decimal"

	"github.com/kiramopay/backend/internal/lightning"
	"github.com/kiramopay/backend/internal/lightning/lnprueba"
)

func TestFacturaDePrueba_SeLeeComoLaArmaron(t *testing.T) {
	_, hash := lnprueba.Preimage()
	fecha := time.Unix(1_800_000_000, 0).UTC()
	for _, msat := range []int64{1000, 6_234_000, 123_456_789, 2_500_000_001} {
		texto := lnprueba.Factura("bc", msat, hash, fecha, 600)
		f, err := lightning.DecodificarFactura(texto)
		if err != nil {
			t.Fatalf("msat %d: %v", msat, err)
		}
		if f.MontoMsat != msat || f.PaymentHash != hex.EncodeToString(hash[:]) || !f.Fecha.Equal(fecha) ||
			f.Vence.Sub(f.Fecha) != 10*time.Minute || f.Red != "bc" || f.Descripcion != "KiramoPay" {
			t.Errorf("msat %d: leida %+v", msat, f)
		}
	}
}

func TestPreimageCorresponde(t *testing.T) {
	pre, hash := lnprueba.Preimage()
	if !lightning.PreimageCorresponde(hex.EncodeToString(pre[:]), hex.EncodeToString(hash[:])) {
		t.Fatal("el preimage verdadero no corresponde")
	}
	otro := pre
	otro[31] ^= 1
	if lightning.PreimageCorresponde(hex.EncodeToString(otro[:]), hex.EncodeToString(hash[:])) {
		t.Fatal("un preimage cambiado corresponde")
	}
	// El hash mismo no es su propio preimage, y lo ilegible no corresponde.
	for _, malo := range []string{hex.EncodeToString(hash[:]), "", "zz", hex.EncodeToString(pre[:16])} {
		if lightning.PreimageCorresponde(malo, hex.EncodeToString(hash[:])) {
			t.Errorf("%q corresponde", malo)
		}
	}
}

func TestSepararDireccion(t *testing.T) {
	c := lightning.NuevoCliente([]string{"breez.tips", "Pay.KiramoPay.com"}, "bc", nil)
	buenas := map[string]string{
		"soda@breez.tips":              "soda@breez.tips",
		"  Soda.Tica_1-a@BREEZ.TIPS  ": "soda.tica_1-a@breez.tips",
		"cafe@pay.kiramopay.com":       "cafe@pay.kiramopay.com",
	}
	for entrada, quiero := range buenas {
		got, err := c.NormalizarDireccion(entrada)
		if err != nil || got != quiero {
			t.Errorf("%q -> %q, %v; quiero %q", entrada, got, err, quiero)
		}
	}
	malas := map[string]error{
		"":                         lightning.ErrDireccionInvalida,
		"soda":                     lightning.ErrDireccionInvalida,
		"@breez.tips":              lightning.ErrDireccionInvalida,
		"soda@":                    lightning.ErrDireccionInvalida,
		"so da@breez.tips":         lightning.ErrDireccionInvalida,
		"soda@breez.tips/../x":     lightning.ErrDireccionInvalida,
		"soda@evil.com":            lightning.ErrDominioNoPermitido,
		"soda@breez.tips.evil.com": lightning.ErrDominioNoPermitido,
		"soda@169.254.169.254":     lightning.ErrDominioNoPermitido,
	}
	for entrada, quiero := range malas {
		if _, err := c.NormalizarDireccion(entrada); !errors.Is(err, quiero) {
			t.Errorf("%q: error %v, quiero %v", entrada, err, quiero)
		}
	}
}

func TestCliente_ResuelvePideYVerifica(t *testing.T) {
	srv := lnprueba.Nuevo(t)
	c := srv.Cliente()
	ctx := context.Background()

	p, err := c.ResolverDireccion(ctx, srv.Direccion("soda"))
	if err != nil {
		t.Fatalf("resolver: %v", err)
	}
	if p.MinMsat != 1000 || p.MaxMsat != 100_000_000_000 || p.ComentarioMax != 120 {
		t.Fatalf("pedido de pago: %+v", p)
	}
	f, err := c.PedirFactura(ctx, p, 6_234_000, "KiramoPay 1a2b3c4d")
	if err != nil {
		t.Fatalf("pedir factura: %v", err)
	}
	if f.Factura.MontoMsat != 6_234_000 || f.Verificar == "" || srv.UltimoComentario != "KiramoPay 1a2b3c4d" {
		t.Fatalf("factura: %+v, comentario %q", f, srv.UltimoComentario)
	}

	v, err := c.Verificar(ctx, f.Verificar)
	if err != nil || v.Pagada || v.Preimage != "" {
		t.Fatalf("sin pagar: %+v %v", v, err)
	}
	srv.Pagar(f.Factura.PaymentHash)
	v, err = c.Verificar(ctx, f.Verificar)
	if err != nil || !v.Pagada || v.Factura != f.Texto {
		t.Fatalf("pagada: %+v %v", v, err)
	}
	if !lightning.PreimageCorresponde(v.Preimage, f.Factura.PaymentHash) {
		t.Fatal("el preimage de la verificacion no corresponde al hash de la factura")
	}
}

func TestCliente_ElComentarioSoloSiCabe(t *testing.T) {
	srv := lnprueba.Nuevo(t)
	srv.ComentarioMax = 5
	c := srv.Cliente()
	p, err := c.ResolverDireccion(context.Background(), srv.Direccion("soda"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := c.PedirFactura(context.Background(), p, 10_000, "KiramoPay 1a2b3c4d"); err != nil {
		t.Fatal(err)
	}
	if srv.UltimoComentario != "" {
		t.Fatalf("mando un comentario mas largo que el permitido: %q", srv.UltimoComentario)
	}
}

func TestCliente_Rechazos(t *testing.T) {
	ctx := context.Background()
	casos := []struct {
		nombre string
		torcer func(*lnprueba.Servidor)
		msat   int64
		quiero error
	}{
		{"monto bajo el minimo", func(s *lnprueba.Servidor) { s.MinMsat = 50_000 }, 10_000, lightning.ErrFueraDeRango},
		{"monto sobre el maximo", func(s *lnprueba.Servidor) { s.MaxMsat = 5_000 }, 10_000, lightning.ErrFueraDeRango},
		{"factura por otro monto", func(s *lnprueba.Servidor) { s.MontoCambiado = true }, 10_000, lightning.ErrFacturaNoCorresponde},
		{"factura de otra red", func(s *lnprueba.Servidor) { s.Red = "tb" }, 10_000, lightning.ErrFacturaNoCorresponde},
		{"sin URL de verificacion", func(s *lnprueba.Servidor) { s.SinVerificacion = true }, 10_000, lightning.ErrSinVerificacion},
	}
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			srv := lnprueba.Nuevo(t)
			c.torcer(srv)
			cli := srv.Cliente()
			p, err := cli.ResolverDireccion(ctx, srv.Direccion("soda"))
			if err != nil {
				t.Fatal(err)
			}
			if _, err := cli.PedirFactura(ctx, p, c.msat, ""); !errors.Is(err, c.quiero) {
				t.Fatalf("error %v, quiero %v", err, c.quiero)
			}
		})
	}

	t.Run("el servidor responde ERROR", func(t *testing.T) {
		srv := lnprueba.Nuevo(t)
		srv.Error = "usuario no existe"
		if _, err := srv.Cliente().ResolverDireccion(ctx, srv.Direccion("soda")); !errors.Is(err, lightning.ErrProveedor) {
			t.Fatalf("error %v", err)
		}
	})
}

// Un callback o una URL de verificacion fuera de la lista no se consultan
// aunque los entregue el servidor de la direccion.
func TestCliente_NoSaleDeLaLista(t *testing.T) {
	malicioso := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"tag":"payRequest","callback":"https://169.254.169.254/x","minSendable":1000,"maxSendable":100000000,"metadata":"[]"}`))
	}))
	defer malicioso.Close()
	host := strings.TrimPrefix(malicioso.URL, "https://")
	c := lightning.NuevoCliente([]string{host}, "bc", malicioso.Client())
	if _, err := c.ResolverDireccion(context.Background(), "soda@"+host); !errors.Is(err, lightning.ErrDominioNoPermitido) {
		t.Fatalf("acepto un callback fuera de la lista: %v", err)
	}
	if _, err := c.Verificar(context.Background(), "https://otro.example/verify"); !errors.Is(err, lightning.ErrDominioNoPermitido) {
		t.Fatalf("consulto una verificacion fuera de la lista: %v", err)
	}
	if _, err := c.Verificar(context.Background(), "http://"+host+"/verify"); !errors.Is(err, lightning.ErrDominioNoPermitido) {
		t.Fatalf("consulto por http: %v", err)
	}
}

// Una redireccion no se sigue: podria llevar a cualquier lado.
func TestCliente_NoSigueRedirecciones(t *testing.T) {
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "https://169.254.169.254/", http.StatusFound)
	}))
	defer srv.Close()
	host := strings.TrimPrefix(srv.URL, "https://")
	c := lightning.NuevoCliente([]string{host}, "bc", srv.Client())
	if _, err := c.ResolverDireccion(context.Background(), "soda@"+host); !errors.Is(err, lightning.ErrProveedor) {
		t.Fatalf("error %v", err)
	}
}

func TestSatsPara(t *testing.T) {
	precio := decimal.NewFromInt(40_000_000) // 1 BTC = 40 millones de colones
	casos := []struct {
		centimos int64
		precio   decimal.Decimal
		sats     int64
	}{
		{500_000, precio, 12_500}, // 5.000 colones, exacto
		{500_001, precio, 12_501}, // un centimo mas: un sat mas, hacia arriba
		{1, precio, 1},            // nunca cero
		{10_000, decimal.RequireFromString("98765.43"), 101_251}, // 100 dolares a 98.765,43
	}
	for _, c := range casos {
		got, err := lightning.SatsPara(c.centimos, c.precio)
		if err != nil || got != c.sats {
			t.Errorf("SatsPara(%d, %s) = %d, %v; quiero %d", c.centimos, c.precio, got, err, c.sats)
		}
	}
	for _, malo := range []struct {
		centimos int64
		precio   decimal.Decimal
	}{{0, precio}, {-5, precio}, {100, decimal.Zero}, {100, decimal.NewFromInt(-1)}, {1 << 60, decimal.NewFromInt(1)}} {
		if _, err := lightning.SatsPara(malo.centimos, malo.precio); !errors.Is(err, lightning.ErrCotizacionInvalida) {
			t.Errorf("SatsPara(%d, %s) no se rechazo: %v", malo.centimos, malo.precio, err)
		}
	}
}
