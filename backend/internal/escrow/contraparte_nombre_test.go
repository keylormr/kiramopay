package escrow

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/kiramopay/backend/internal/user"
)

// El detalle de un pago protegido no decia con quien era el acuerdo: el
// servidor mandaba solo los ids de las dos partes y la pantalla no tenia como
// nombrarlas. La respuesta lleva ahora el nombre de la OTRA parte, la que no es
// quien consulta. Es un dato de la respuesta, no del acuerdo: no se guarda ni
// viaja en los avisos a los webhooks.

type cuentasDePrueba struct {
	porId     map[string]*user.UserRecord
	consultas map[string]int
	falla     error
}

func (c *cuentasDePrueba) FindByID(_ context.Context, id string) (*user.UserRecord, error) {
	if c.consultas == nil {
		c.consultas = map[string]int{}
	}
	c.consultas[id]++
	if c.falla != nil {
		return nil, c.falla
	}
	u, ok := c.porId[id]
	if !ok {
		return nil, errors.New("no existe")
	}
	return u, nil
}

func (c *cuentasDePrueba) FindByPhone(context.Context, string) (*user.UserRecord, error) {
	return nil, errors.New("no se usa")
}

func conCuentas(c *cuentasDePrueba) *Service {
	return &Service{cuentas: c}
}

func personas() *cuentasDePrueba {
	return &cuentasDePrueba{porId: map[string]*user.UserRecord{
		"comprador": {ID: "comprador", FirstName: "Ana", LastName: "Mora", Status: "active"},
		"vendedor":  {ID: "vendedor", FirstName: " Luis ", LastName: "Rojas  Vega", Status: "active"},
	}}
}

func TestConContraparte_CadaParteVeALaOtra(t *testing.T) {
	svc := conCuentas(personas())
	ctx := context.Background()
	a := &Agreement{ID: "a1", BuyerID: "comprador", SellerID: "vendedor"}

	if got := svc.ConContraparte(ctx, "comprador", a).CounterpartyName; got != "Luis Rojas Vega" {
		t.Fatalf("el comprador ve %q, se esperaba el nombre del vendedor", got)
	}
	if got := svc.ConContraparte(ctx, "vendedor", a).CounterpartyName; got != "Ana Mora" {
		t.Fatalf("el vendedor ve %q, se esperaba el nombre del comprador", got)
	}
}

func TestConContraparte_NoToca_ElAcuerdoOriginal(t *testing.T) {
	svc := conCuentas(personas())
	a := &Agreement{ID: "a1", BuyerID: "comprador", SellerID: "vendedor"}

	_ = svc.ConContraparte(context.Background(), "comprador", a)

	if a.CounterpartyName != "" {
		t.Fatalf("el acuerdo original quedo con nombre (%q): viajaria en los avisos a los webhooks", a.CounterpartyName)
	}
}

func TestConContraparte_SinNombreNoRompeLaRespuesta(t *testing.T) {
	a := &Agreement{ID: "a1", BuyerID: "comprador", SellerID: "vendedor"}

	t.Run("la cuenta ya no se puede leer", func(t *testing.T) {
		svc := conCuentas(&cuentasDePrueba{falla: errors.New("la base no responde")})
		if got := svc.ConContraparte(context.Background(), "comprador", a); got == nil || got.CounterpartyName != "" || got.ID != "a1" {
			t.Fatalf("respuesta = %+v: debe seguir siendo el acuerdo, sin nombre", got)
		}
	})
	t.Run("sin buscador de cuentas", func(t *testing.T) {
		svc := &Service{}
		if got := svc.ConContraparte(context.Background(), "comprador", a); got == nil || got.CounterpartyName != "" {
			t.Fatalf("respuesta = %+v", got)
		}
	})
	t.Run("quien consulta no es parte del acuerdo", func(t *testing.T) {
		svc := conCuentas(personas())
		if got := svc.ConContraparte(context.Background(), "otro", a).CounterpartyName; got != "" {
			t.Fatalf("un tercero vio el nombre %q", got)
		}
	})
}

func TestConContrapartes_PreguntaUnaVezPorPersona(t *testing.T) {
	cuentas := personas()
	svc := conCuentas(cuentas)
	lista := []Agreement{
		{ID: "a1", BuyerID: "comprador", SellerID: "vendedor"},
		{ID: "a2", BuyerID: "comprador", SellerID: "vendedor"},
		{ID: "a3", BuyerID: "vendedor", SellerID: "comprador"},
	}

	salida := svc.ConContrapartes(context.Background(), "comprador", lista)

	if len(salida) != 3 {
		t.Fatalf("salida = %d acuerdos, se esperaban 3", len(salida))
	}
	// Quien consulta es el comprador de a1 y a2 y el vendedor de a3: en los tres
	// ve a la misma persona, la otra parte.
	for i, a := range salida {
		if a.CounterpartyName != "Luis Rojas Vega" {
			t.Fatalf("acuerdo %d: nombre %q", i, a.CounterpartyName)
		}
	}
	if cuentas.consultas["vendedor"] != 1 {
		t.Fatalf("se pregunto %d veces por la misma persona", cuentas.consultas["vendedor"])
	}
	if lista[0].CounterpartyName != "" {
		t.Fatal("la lista original quedo con nombres")
	}
}

func TestAgreement_ElNombreSaleEnElJSONSoloSiLoHay(t *testing.T) {
	con, _ := json.Marshal(Agreement{ID: "a1", CounterpartyName: "Luis Rojas"})
	if !strings.Contains(string(con), `"counterparty_name":"Luis Rojas"`) {
		t.Fatalf("falta counterparty_name en %s", con)
	}
	sin, _ := json.Marshal(Agreement{ID: "a1"})
	if strings.Contains(string(sin), "counterparty_name") {
		t.Fatalf("counterparty_name no debe salir vacio: %s", sin)
	}
}
