package escrow_test

import (
	"context"
	"errors"
	"testing"

	"github.com/kiramopay/backend/internal/escrow"
)

// La plata se congelaba y quien podia descongelarla no encontraba el caso: las
// dos rutas de lectura estaban acotadas a las PARTES del acuerdo, y el arbitro
// no es comprador ni vendedor.

// disputar deja un acuerdo fondeado en 'disputed'.
func disputar(t *testing.T, svc *escrow.Service, comprador, vendedor, motivo string) *escrow.Agreement {
	t.Helper()
	ctx := context.Background()
	a, err := svc.Create(ctx, comprador, &escrow.CreateRequest{
		SellerID: vendedor, AmountMinor: 120_000, Currency: "CRC", Description: motivo,
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if _, err := svc.Fund(ctx, comprador, a.ID); err != nil {
		t.Fatalf("Fund: %v", err)
	}
	d, err := svc.Dispute(ctx, comprador, a.ID, motivo)
	if err != nil {
		t.Fatalf("Dispute: %v", err)
	}
	return d
}

func TestElArbitroPuedeListarLaColaDeDisputas(t *testing.T) {
	_, svc, comprador, vendedor := setup(t)
	ctx := context.Background()

	disputada := disputar(t, svc, comprador, vendedor, "no llego")
	// Y un acuerdo que NO esta en disputa, para que se vea que la cola filtra.
	otro, err := svc.Create(ctx, comprador, &escrow.CreateRequest{
		SellerID: vendedor, AmountMinor: 50_000, Currency: "CRC", Description: "pendiente",
	})
	if err != nil {
		t.Fatalf("Create otro: %v", err)
	}

	// Un tercero que no es parte NO puede verlos por la ruta normal: ese es el
	// agujero que esto tapa.
	if _, err := svc.Get(ctx, "00000000-0000-0000-0000-000000000001", disputada.ID); !errors.Is(err, escrow.ErrNotParty) {
		t.Fatalf("Get de un tercero = %v, se esperaba ErrNotParty", err)
	}

	// Sin filtro: SOLO la cola de disputas, y la respuesta dice cual aplico.
	cola, err := svc.ListarParaAdmin(ctx, escrow.FiltroAdmin{})
	if err != nil {
		t.Fatalf("ListarParaAdmin: %v", err)
	}
	if cola.Status != escrow.StatusDisputed {
		t.Fatalf("status aplicado = %q, se esperaba disputed", cola.Status)
	}
	if cola.Total != 1 || len(cola.Agreements) != 1 {
		t.Fatalf("cola: total=%d len=%d, se esperaba 1/1", cola.Total, len(cola.Agreements))
	}
	if cola.Agreements[0].ID != disputada.ID {
		t.Fatalf("la cola trajo %s, se esperaba %s", cola.Agreements[0].ID, disputada.ID)
	}
	// El motivo viaja: es el caso, no un identificador.
	if cola.Agreements[0].DisputeReason != "no llego" {
		t.Fatalf("motivo = %q, se esperaba el de la disputa", cola.Agreements[0].DisputeReason)
	}
	// Y el monto, que es lo que hay congelado.
	if cola.Agreements[0].AmountMinor != 120_000 {
		t.Fatalf("monto = %d, se esperaba 120000", cola.Agreements[0].AmountMinor)
	}

	// `all` trae el historial completo, incluido el que no esta en disputa.
	todos, err := svc.ListarParaAdmin(ctx, escrow.FiltroAdmin{Estado: escrow.EstadoTodos})
	if err != nil {
		t.Fatalf("ListarParaAdmin all: %v", err)
	}
	if todos.Total != 2 || len(todos.Agreements) != 2 {
		t.Fatalf("todos: total=%d len=%d, se esperaba 2/2", todos.Total, len(todos.Agreements))
	}

	// Un estado concreto acota a ese estado.
	pendientes, err := svc.ListarParaAdmin(ctx, escrow.FiltroAdmin{Estado: escrow.StatusPending})
	if err != nil {
		t.Fatalf("ListarParaAdmin pending: %v", err)
	}
	if pendientes.Total != 1 || pendientes.Agreements[0].ID != otro.ID {
		t.Fatalf("pendientes: total=%d, se esperaba solo %s", pendientes.Total, otro.ID)
	}

	// Y se puede leer el acuerdo entero sin ser parte, que es lo que hace falta
	// para poder resolverlo.
	leido, err := svc.ObtenerParaAdmin(ctx, disputada.ID)
	if err != nil {
		t.Fatalf("ObtenerParaAdmin: %v", err)
	}
	if leido.ID != disputada.ID || leido.Status != escrow.StatusDisputed {
		t.Fatalf("ObtenerParaAdmin devolvio %+v", leido)
	}
}

// El total es lo que le dice al arbitro cuantos casos le faltan: tiene que
// contar la cola entera, no la pagina.
func TestElTotalDeLaColaNoEsElDeLaPagina(t *testing.T) {
	_, svc, comprador, vendedor := setup(t)
	ctx := context.Background()

	for i := 0; i < 3; i++ {
		disputar(t, svc, comprador, vendedor, "caso")
	}

	pagina, err := svc.ListarParaAdmin(ctx, escrow.FiltroAdmin{Limite: 2})
	if err != nil {
		t.Fatalf("ListarParaAdmin: %v", err)
	}
	if len(pagina.Agreements) != 2 {
		t.Fatalf("pagina = %d, se esperaba 2", len(pagina.Agreements))
	}
	if pagina.Total != 3 {
		t.Fatalf("total = %d, se esperaba 3: el total tiene que contar la cola entera", pagina.Total)
	}

	// La segunda pagina trae el que falta, sin repetir.
	segunda, err := svc.ListarParaAdmin(ctx, escrow.FiltroAdmin{Limite: 2, Offset: 2})
	if err != nil {
		t.Fatalf("ListarParaAdmin offset: %v", err)
	}
	if len(segunda.Agreements) != 1 {
		t.Fatalf("segunda pagina = %d, se esperaba 1", len(segunda.Agreements))
	}
	vistos := map[string]bool{}
	for _, a := range append(pagina.Agreements, segunda.Agreements...) {
		if vistos[a.ID] {
			t.Fatalf("el acuerdo %s salio en las dos paginas", a.ID)
		}
		vistos[a.ID] = true
	}
}

// Un `?status=` que no existe se rechaza. Devolver una lista vacia haria que
// una cola mal consultada se vea igual que una cola sin casos, y lo que hay
// adentro es plata retenida.
func TestUnEstadoDesconocidoNoSeConfundeConColaVacia(t *testing.T) {
	for _, s := range []escrow.Status{"disputed", "all", "pending", "cancelled"} {
		if !escrow.EsEstadoConsultable(s) {
			t.Fatalf("%q deberia ser consultable", s)
		}
	}
	for _, s := range []escrow.Status{"disputada", "DISPUTED", "", "todos", "resuelto"} {
		if escrow.EsEstadoConsultable(s) {
			t.Fatalf("%q NO deberia ser consultable", s)
		}
	}
}
