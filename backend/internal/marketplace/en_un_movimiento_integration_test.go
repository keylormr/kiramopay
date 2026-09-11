package marketplace_test

import (
	"context"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/kiramopay/backend/internal/marketplace"
)

// El cobro se confirmaba primero y lo demas iba despues, por fuera. En un pedido
// de comida eso quiere decir que si el pedido no se podia insertar, la persona
// quedaba cobrada sin pedido. Ahora el pedido, el historial y el tope corren
// dentro del asiento del cobro.

func contar(t *testing.T, pool *pgxpool.Pool, sql string, args ...any) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(), sql, args...).Scan(&n); err != nil {
		t.Fatalf("contar: %v", err)
	}
	return n
}

func TestUnPedidoQueNoSePuedeGuardarNoCobra(t *testing.T) {
	svc, pool, user := setupMarketplace(t)
	ctx := context.Background()
	antes := walletCRC(t, pool, user)

	// Un nombre de linea mas largo que la columna (VARCHAR(200)): el insert del
	// pedido falla adentro del asiento.
	_, err := svc.CreateFoodOrder(ctx, user, &marketplace.CreateFoodOrderRequest{
		PartnerCode:    "ubereats",
		RestaurantName: "Soda Tica",
		Items:          []marketplace.FoodOrderItemReq{{Name: strings.Repeat("x", 300), Quantity: 1, Price: 350000}},
	})
	if err == nil {
		t.Fatal("un pedido que no se puede guardar tiene que fallar")
	}

	// Y no queda NADA: ni cobro, ni pedido, ni fila en el historial.
	if got := walletCRC(t, pool, user); got != antes {
		t.Fatalf("billetera = %d, se esperaba %d: se cobro un pedido que no existe", got, antes)
	}
	if n := contar(t, pool, `SELECT COUNT(*) FROM food_orders WHERE user_id = $1::uuid`, user); n != 0 {
		t.Fatalf("pedidos = %d, se esperaba 0", n)
	}
	if n := contar(t, pool,
		`SELECT COUNT(*) FROM transactions WHERE user_id = $1::uuid AND type = 'marketplace'`, user); n != 0 {
		t.Fatalf("filas de historial = %d, se esperaba 0", n)
	}
}

// El pedido que si se guarda queda con su cobro y su fila de historial, las dos
// completadas: el historial ya no se escribe por fuera con el error descartado.
func TestUnPedidoGuardadoTieneSuHistorial(t *testing.T) {
	svc, pool, user := setupMarketplace(t)
	ctx := context.Background()

	order, err := svc.CreateFoodOrder(ctx, user, &marketplace.CreateFoodOrderRequest{
		PartnerCode:    "ubereats",
		RestaurantName: "Soda Tica",
		Items:          []marketplace.FoodOrderItemReq{{Name: "Casado", Quantity: 1, Price: 350000}},
	})
	if err != nil {
		t.Fatalf("CreateFoodOrder: %v", err)
	}
	if n := contar(t, pool, `SELECT COUNT(*) FROM food_orders WHERE id = $1::uuid`, order.ID); n != 1 {
		t.Fatalf("pedido guardado = %d, se esperaba 1", n)
	}
	if n := contar(t, pool,
		`SELECT COUNT(*) FROM transactions WHERE user_id = $1::uuid AND type = 'marketplace' AND status = 'completed'`,
		user); n != 1 {
		t.Fatalf("filas de historial completadas = %d, se esperaba 1", n)
	}
}

// El viaje se confirma dentro del cobro: una vez confirmado, el cobro y el estado
// estan en la misma transaccion, y una segunda confirmacion no cobra.
func TestConfirmarUnViajeCobraYConfirmaJuntos(t *testing.T) {
	svc, pool, user := setupMarketplace(t)
	ctx := context.Background()
	ride, err := svc.CreateRideRequest(ctx, user, &marketplace.CreateRideRequest{
		PartnerCode: "uber", Pickup: "A", Destination: "B",
	})
	if err != nil {
		t.Fatalf("CreateRideRequest: %v", err)
	}
	antes := walletCRC(t, pool, user)

	if _, err := svc.ConfirmRide(ctx, user, ride.ID); err != nil {
		t.Fatalf("ConfirmRide: %v", err)
	}
	if got := walletCRC(t, pool, user); got != antes-ride.EstimatedPrice {
		t.Fatalf("billetera = %d, se esperaba %d", got, antes-ride.EstimatedPrice)
	}
	var estado string
	if err := pool.QueryRow(ctx, `SELECT status FROM ride_requests WHERE id = $1`, ride.ID).Scan(&estado); err != nil {
		t.Fatalf("leer viaje: %v", err)
	}
	if estado != "confirmed" {
		t.Fatalf("estado = %q, se esperaba confirmed", estado)
	}
	if _, err := svc.ConfirmRide(ctx, user, ride.ID); err == nil {
		t.Fatal("una segunda confirmacion tiene que fallar")
	}
	if got := walletCRC(t, pool, user); got != antes-ride.EstimatedPrice {
		t.Fatalf("la segunda confirmacion cobro: billetera = %d", got)
	}
}
