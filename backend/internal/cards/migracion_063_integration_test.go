package cards_test

import (
	"context"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/kiramopay/backend/internal/cards"
	"github.com/kiramopay/backend/internal/testutil"
)

// La migracion 063 reemplaza las tarjetas VISA ya emitidas. Se prueba
// ejecutando SU PROPIO archivo: el esquema de pruebas no lee migrations/, y una
// copia del SQL aca podria divergir del que corre en produccion.
func correr063(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	sql, err := os.ReadFile("../../migrations/063_tarjetas_que_no_son_de_nadie.sql")
	if err != nil {
		t.Fatalf("leer migracion: %v", err)
	}
	if _, err := pool.Exec(context.Background(), string(sql)); err != nil {
		t.Fatalf("correr migracion: %v", err)
	}
}

func insertarTarjeta(t *testing.T, pool *pgxpool.Pool, userID, marca, estado, last4 string) string {
	t.Helper()
	// Los ::text no son decoracion: $3 y $4 aparecen dos veces cada uno, y sin
	// el tipo explicito Postgres deduce uno distinto en cada lugar (42P08).
	var id string
	if err := pool.QueryRow(context.Background(), `
		INSERT INTO virtual_cards (user_id, card_number, last4, expiry_month, expiry_year,
		                           cardholder_name, brand, status, daily_limit,
		                           frozen_at)
		VALUES ($1::uuid, '•••• •••• •••• ' || $4::text, $4::text, 1, 2028, 'TEST USER', $2::text, $3::text, 77700,
		        CASE WHEN $3::text = 'frozen' THEN NOW() END)
		RETURNING id::text`, userID, marca, estado, last4).Scan(&id); err != nil {
		t.Fatalf("insertar tarjeta: %v", err)
	}
	return id
}

type fila struct {
	marca, estado string
	topeDiario    int64
	congelada     bool
}

func tarjetasDe(t *testing.T, pool *pgxpool.Pool, userID string) []fila {
	t.Helper()
	rows, err := pool.Query(context.Background(), `
		SELECT brand, status, daily_limit, frozen_at IS NOT NULL
		  FROM virtual_cards WHERE user_id = $1::uuid ORDER BY created_at, status`, userID)
	if err != nil {
		t.Fatalf("leer tarjetas: %v", err)
	}
	defer rows.Close()
	var out []fila
	for rows.Next() {
		var f fila
		if err := rows.Scan(&f.marca, &f.estado, &f.topeDiario, &f.congelada); err != nil {
			t.Fatalf("scan: %v", err)
		}
		out = append(out, f)
	}
	return out
}

func contar(filas []fila, marca, estado string) int {
	n := 0
	for _, f := range filas {
		if f.marca == marca && f.estado == estado {
			n++
		}
	}
	return n
}

func TestLaMigracion063ReemplazaSinBorrar(t *testing.T) {
	pool := testutil.TestDB(t)
	uno := testutil.SeedTestUser(t, pool, "702650930", "dummy")
	dos := testutil.SeedTestUser2(t, pool)

	insertarTarjeta(t, pool, uno, "visa", "active", "1111")
	insertarTarjeta(t, pool, uno, "visa", "cancelled", "2222")
	insertarTarjeta(t, pool, dos, "visa", "frozen", "3333")
	insertarTarjeta(t, pool, dos, cards.MarcaKiramoPay, "active", "4444")

	correr063(t, pool)

	// Persona 1: la VISA activa queda reemplazada (la fila sigue ahi) y tiene
	// una KiramoPay activa nueva con los mismos topes. La cancelada no se toca
	// ni se reemplaza.
	f1 := tarjetasDe(t, pool, uno)
	if len(f1) != 3 {
		t.Fatalf("persona 1: %d tarjetas, se esperaban 3 (VISA reemplazada, VISA cancelada, reemplazo)", len(f1))
	}
	if contar(f1, "visa", "replaced") != 1 || contar(f1, "visa", "cancelled") != 1 ||
		contar(f1, cards.MarcaKiramoPay, "active") != 1 {
		t.Fatalf("persona 1: %+v", f1)
	}
	for _, f := range f1 {
		if f.marca == cards.MarcaKiramoPay && f.topeDiario != 77700 {
			t.Fatalf("el reemplazo perdio el tope diario: %+v", f)
		}
	}

	// Persona 2: la VISA congelada se reemplaza por una KiramoPay CONGELADA —
	// descongelarla por una migracion seria devolverle a alguien una tarjeta
	// que decidio frenar—, y su KiramoPay previa sigue igual.
	f2 := tarjetasDe(t, pool, dos)
	if contar(f2, "visa", "replaced") != 1 || contar(f2, cards.MarcaKiramoPay, "frozen") != 1 ||
		contar(f2, cards.MarcaKiramoPay, "active") != 1 {
		t.Fatalf("persona 2: %+v", f2)
	}
	for _, f := range f2 {
		if f.estado == "frozen" && !f.congelada {
			t.Fatalf("el reemplazo congelado perdio frozen_at: %+v", f)
		}
	}

	// Idempotente: una segunda pasada no emite nada.
	correr063(t, pool)
	if len(tarjetasDe(t, pool, uno)) != 3 || len(tarjetasDe(t, pool, dos)) != 3 {
		t.Fatal("la segunda pasada de la migracion emitio tarjetas de nuevo")
	}

	// Lo que la persona ve: solo las vivas. La reemplazada no ocupa cupo ni
	// aparece, pero su fila sigue en la base.
	repo := cards.NewRepository(pool)
	lista, err := repo.GetUserCards(context.Background(), uno)
	if err != nil {
		t.Fatalf("GetUserCards: %v", err)
	}
	if len(lista) != 1 || lista[0].Brand != cards.MarcaKiramoPay {
		t.Fatalf("la persona ve %+v, se esperaba solo su tarjeta KiramoPay", lista)
	}
	cupo, err := repo.CountUserCards(context.Background(), uno)
	if err != nil {
		t.Fatalf("CountUserCards: %v", err)
	}
	if cupo != 1 {
		t.Fatalf("cupo usado = %d, se esperaba 1: la reemplazada no cuenta", cupo)
	}
}

// Una tarjeta nueva nace KiramoPay y con un numero que no es de nadie.
func TestUnaTarjetaNuevaNaceKiramoPay(t *testing.T) {
	pool := testutil.TestDB(t)
	uno := testutil.SeedTestUser(t, pool, "702650930", "dummy")
	svc := cards.NewService(cards.NewRepository(pool))

	c, err := svc.CreateCard(context.Background(), uno, "TEST USER", &cards.CreateCardRequest{})
	if err != nil {
		t.Fatalf("CreateCard: %v", err)
	}
	if c.Brand != cards.MarcaKiramoPay {
		t.Fatalf("marca = %q, se esperaba %q", c.Brand, cards.MarcaKiramoPay)
	}
	if c.CardNumber[0] != '8' {
		t.Fatalf("numero = %s, se esperaba que empiece en 8", c.CardNumber)
	}
	// Y lo que se guarda sigue siendo solo el enmascarado.
	var guardado string
	if err := pool.QueryRow(context.Background(),
		`SELECT card_number FROM virtual_cards WHERE id = $1::uuid`, c.ID).Scan(&guardado); err != nil {
		t.Fatalf("leer: %v", err)
	}
	if guardado == c.CardNumber {
		t.Fatal("se guardo el numero completo")
	}
}
