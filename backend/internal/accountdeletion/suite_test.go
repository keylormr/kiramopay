package accountdeletion

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/kiramopay/backend/internal/user"
	"github.com/kiramopay/backend/pkg/hash"
)

// claveDePrueba es la contrasena de todas las cuentas sembradas. Cumple la
// politica de contrasenas; no es una credencial real.
const claveDePrueba = "Prueba-Segura-123"

var (
	hashUna sync.Once
	hashVal string
)

// hashDeLaClave calcula el Argon2id una sola vez: es lo caro de sembrar.
func hashDeLaClave(t *testing.T) string {
	t.Helper()
	hashUna.Do(func() {
		h, err := hash.HashPin(claveDePrueba)
		if err != nil {
			t.Fatalf("hash de la clave: %v", err)
		}
		hashVal = h
	})
	return hashVal
}

// cuenta es una persona sembrada en la base de pruebas.
type cuenta struct {
	ID, Cedula, Telefono, Correo string
}

// contador arranca en un valor aleatorio para que dos corridas contra una base
// que no se vacia (la de la cadena de migraciones) no choquen en cedula ni en
// telefono, que son unicos.
var contador = int(time.Now().UnixNano()%9000000) + 100

// sembrar crea una persona con billetera en cero, sus cuentas del libro y un
// historial que entro y salio (el diario tiene asientos pero neto cero). Cada
// llamada genera cedula y telefono distintos.
func sembrar(t *testing.T, pool *pgxpool.Pool) cuenta {
	t.Helper()
	contador++
	c := cuenta{
		ID:       uuid.NewString(),
		Cedula:   "70" + pad(contador, 7),
		Telefono: "+5068" + pad(contador, 7),
		Correo:   "persona" + pad(contador, 7) + "@ejemplo.test",
	}
	ctx := context.Background()
	repo := user.NewRepository(pool)
	if err := repo.Create(ctx, &user.UserRecord{
		ID: c.ID, Cedula: c.Cedula, Phone: c.Telefono, Email: c.Correo,
		FirstName: "Maria", LastName: "Rojas", PasswordHash: hashDeLaClave(t),
		Status: "active", PhoneVerified: true, EmailVerified: true,
	}); err != nil {
		t.Fatalf("sembrar usuario: %v", err)
	}
	exec(t, pool, `INSERT INTO wallets (id, user_id, balance_crc, balance_usd) VALUES (gen_random_uuid(), $1::uuid, 0, 0)`, c.ID)
	exec(t, pool, `
		INSERT INTO ledger_accounts (code, type, user_id, currency, normal_balance)
		VALUES ('USER:'||$1||':CRC','user_wallet',$1::uuid,'CRC','credit'),
		       ('USER:'||$1||':USD','user_wallet',$1::uuid,'USD','credit')
		ON CONFLICT (code) DO NOTHING`, c.ID)
	// Entro 100.000 y salio 100.000: historial real, saldo cero.
	asentar(t, pool, c.ID, "credit", "debit", 10000000)
	asentar(t, pool, c.ID, "debit", "credit", 10000000)
	return c
}

// asentar escribe un asiento balanceado entre la cuenta CRC de la persona y la
// reserva. Va en UNA sentencia: el disparador que valida el balance corre al
// confirmar, y dos INSERT sueltos confirmarian cada uno por su lado.
func asentar(t *testing.T, pool *pgxpool.Pool, userID, ladoPersona, ladoReserva string, monto int64) {
	t.Helper()
	exec(t, pool, `
		WITH p AS (INSERT INTO journal_postings (id, description) VALUES ($1::uuid, 'TEST_HISTORIAL') RETURNING id)
		INSERT INTO journal_entries (posting_id, account_id, direction, amount_minor, currency)
		SELECT p.id, la.id,
		       CASE WHEN la.type = 'user_wallet' THEN $3 ELSE $4 END,
		       $5, 'CRC'
		  FROM p, ledger_accounts la
		 WHERE (la.user_id = $2::uuid AND la.currency = 'CRC' AND la.type = 'user_wallet')
		    OR la.code = 'SYSTEM:RESERVE:CRC'`,
		uuid.NewString(), userID, ladoPersona, ladoReserva, monto)
}

func pad(n, ancho int) string {
	s := ""
	for i := 0; i < ancho; i++ {
		s += "0"
	}
	d := []byte(s)
	for i := ancho - 1; i >= 0 && n > 0; i-- {
		d[i] = byte('0' + n%10)
		n /= 10
	}
	return string(d)
}

func exec(t *testing.T, pool *pgxpool.Pool, sql string, args ...any) {
	t.Helper()
	if _, err := pool.Exec(context.Background(), sql, args...); err != nil {
		t.Fatalf("exec fallo: %v\n%s", err, sql)
	}
}

func cuenta1[T any](t *testing.T, pool *pgxpool.Pool, sql string, args ...any) T {
	t.Helper()
	var v T
	if err := pool.QueryRow(context.Background(), sql, args...).Scan(&v); err != nil {
		t.Fatalf("consulta fallo: %v\n%s", err, sql)
	}
	return v
}

func contar(t *testing.T, pool *pgxpool.Pool, tabla, columna, id string) int {
	t.Helper()
	return cuenta1[int](t, pool,
		"SELECT COUNT(*) FROM "+tabla+" WHERE "+columna+" = $1::uuid", id) //nolint:gosec // nombres fijos de la prueba
}

// nuevoServicio arma el servicio contra la base de pruebas, sin Redis ni envios.
func nuevoServicio(pool *pgxpool.Pool, opts *Options) *Service {
	return NewService(pool, user.NewRepository(pool), opts)
}
