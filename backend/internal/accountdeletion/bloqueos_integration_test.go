package accountdeletion

import (
	"context"
	"errors"
	"sort"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/kiramopay/backend/internal/ledger"
	"github.com/kiramopay/backend/internal/testutil"
	"github.com/kiramopay/backend/internal/user"
)

// fondear le pone saldo REAL a una persona: por el motor, para que la cache de la
// billetera y el diario cuadren como en produccion.
func fondear(t *testing.T, pool *pgxpool.Pool, userID string, monto int64) {
	t.Helper()
	if _, err := ledger.NewEngine(pool, nil).Post(context.Background(), &ledger.Posting{
		Description: "fondeo de prueba",
		Entries: []ledger.Entry{
			{Account: ledger.Account{SystemCode: ledger.SystemReserveCRC}, Side: ledger.Debit, AmountMinor: monto, Currency: "CRC"},
			{Account: ledger.Account{UserID: userID}, Side: ledger.Credit, AmountMinor: monto, Currency: "CRC"},
		},
	}); err != nil {
		t.Fatalf("fondear: %v", err)
	}
}

// comercioDe crea un comercio de la persona y devuelve su id.
func comercioDe(t *testing.T, pool *pgxpool.Pool, userID string) string {
	t.Helper()
	return cuenta1[string](t, pool, `
		INSERT INTO qr_merchants (user_id, name, category, qr_code)
		VALUES ($1::uuid, 'Soda La Esquina', 'restaurant', 'MQR-' || substr(md5(random()::text), 1, 10))
		RETURNING id::text`, userID)
}

// codigosDe junta los codigos de un ErrBloqueada, ordenados.
func codigosDe(err error) []string {
	var b *ErrBloqueada
	if !errors.As(err, &b) {
		return nil
	}
	out := make([]string, 0, len(b.Bloqueos))
	for _, x := range b.Bloqueos {
		out = append(out, x.Codigo)
	}
	sort.Strings(out)
	return out
}

// Cada situacion que la persona puede resolver detiene la eliminacion con SU
// codigo, y no se borra ni se anonimiza nada: la cuenta sigue entera.
func TestEliminar_CadaBloqueoDetieneYNoTocaNada(t *testing.T) {
	casos := []struct {
		codigo   string
		preparar func(t *testing.T, pool *pgxpool.Pool, a, otra cuenta)
	}{
		{BloqueoSaldo, func(t *testing.T, pool *pgxpool.Pool, a, _ cuenta) { fondear(t, pool, a.ID, 5000) }},
		{BloqueoAhorros, func(t *testing.T, pool *pgxpool.Pool, a, _ cuenta) {
			exec(t, pool, `INSERT INTO savings_goals (user_id, name, target_minor, saved_minor) VALUES ($1::uuid, 'Casa', 1000, 100)`, a.ID)
		}},
		{BloqueoCripto, func(t *testing.T, pool *pgxpool.Pool, a, _ cuenta) {
			exec(t, pool, `INSERT INTO crypto_assets (user_id, symbol, name, balance) VALUES ($1::uuid, 'BTC', 'Bitcoin', 0.5)`, a.ID)
		}},
		{BloqueoStaking, func(t *testing.T, pool *pgxpool.Pool, a, _ cuenta) {
			exec(t, pool, `INSERT INTO crypto_staking (user_id, asset, amount, status) VALUES ($1::uuid, 'ETH', 1, 'active')`, a.ID)
		}},
		{BloqueoSaldoRegional, func(t *testing.T, pool *pgxpool.Pool, a, _ cuenta) {
			exec(t, pool, `INSERT INTO regional_wallets (user_id, country_code, currency, balance) VALUES ($1::uuid, 'PA', 'USD', 1000)`, a.ID)
		}},
		{BloqueoSaldoComercio, func(t *testing.T, pool *pgxpool.Pool, a, _ cuenta) {
			m := comercioDe(t, pool, a.ID)
			if _, err := ledger.NewEngine(pool, nil).Post(context.Background(), &ledger.Posting{
				Description: "venta del comercio",
				Entries: []ledger.Entry{
					{Account: ledger.Account{SystemCode: ledger.SystemReserveCRC}, Side: ledger.Debit, AmountMinor: 700, Currency: "CRC"},
					{Account: ledger.Account{MerchantID: m}, Side: ledger.Credit, AmountMinor: 700, Currency: "CRC"},
				},
			}); err != nil {
				t.Fatalf("saldo del comercio: %v", err)
			}
		}},
		{BloqueoCobrosAbiertos, func(t *testing.T, pool *pgxpool.Pool, a, _ cuenta) {
			m := comercioDe(t, pool, a.ID)
			exec(t, pool, `INSERT INTO qr_payment_codes (id, creator_id, type, qr_data, merchant_id) VALUES ('c0000000-0000-4000-8000-000000000001', $1::uuid, 'merchant_dynamic', 'qr-cobro', $2::uuid)`, a.ID, m)
			exec(t, pool, `INSERT INTO qr_charges (qr_code_id, merchant_id, created_by, amount, currency, qr_data, expires_at, status)
				VALUES ('c0000000-0000-4000-8000-000000000001', $2::uuid, $1::uuid, 100, 'CRC', 'qr-cobro', NOW() + interval '1 hour', 'pending')`, a.ID, m)
		}},
		{BloqueoMovimientoEnCurso, func(t *testing.T, pool *pgxpool.Pool, a, _ cuenta) {
			exec(t, pool, `INSERT INTO transactions (id, wallet_id, user_id, type, amount, status)
				SELECT gen_random_uuid(), id, $1::uuid, 'sinpe_send', 100, 'pending' FROM wallets WHERE user_id = $1::uuid`, a.ID)
		}},
		{BloqueoEscrowAbierto, func(t *testing.T, pool *pgxpool.Pool, a, otra cuenta) {
			exec(t, pool, `INSERT INTO escrow_agreements (buyer_id, seller_id, amount_minor, description, status)
				VALUES ($1::uuid, $2::uuid, 100, 'compra', 'funded')`, a.ID, otra.ID)
		}},
		{BloqueoPayoutEnCurso, func(t *testing.T, pool *pgxpool.Pool, a, _ cuenta) {
			exec(t, pool, `INSERT INTO payouts (user_id, rail, amount_minor, destination, idempotency_key, status)
				VALUES ($1::uuid, 'MOCK', 100, '{}', 'k1', 'processing')`, a.ID)
		}},
		{BloqueoTransfronterizo, func(t *testing.T, pool *pgxpool.Pool, a, _ cuenta) {
			exec(t, pool, `INSERT INTO cross_border_transfers (sender_id, receiver_phone, from_country, to_country, from_currency, to_currency, from_amount, to_amount, exchange_rate, status)
				VALUES ($1::uuid, '+50761234567', 'CR', 'PA', 'CRC', 'USD', 100, 1, 0.002, 'processing')`, a.ID)
		}},
		{BloqueoMarketplace, func(t *testing.T, pool *pgxpool.Pool, a, _ cuenta) {
			exec(t, pool, `INSERT INTO ride_requests (user_id, partner_code, pickup, destination, estimated_price, estimated_time, distance, status)
				VALUES ($1::uuid, 'uber', 'a', 'b', 100, '5', '1', 'in_progress')`, a.ID)
		}},
	}

	for _, c := range casos {
		t.Run(c.codigo, func(t *testing.T) {
			pool := testutil.TestDB(t)
			a, otra := sembrar(t, pool), sembrar(t, pool)
			exec(t, pool, `INSERT INTO sinpe_contacts (user_id, phone, name) VALUES ($1::uuid, '+50688880000', 'Pedro')`, a.ID)
			c.preparar(t, pool, a, otra)

			_, err := nuevoServicio(pool, nil).ejecutar(context.Background(), a.ID, opciones{canal: CanalApp})
			codigos := codigosDe(err)
			encontrado := false
			for _, x := range codigos {
				if x == c.codigo {
					encontrado = true
				}
			}
			if !encontrado {
				t.Fatalf("se esperaba el bloqueo %s, salio %v (codigos %v)", c.codigo, err, codigos)
			}
			if cuenta1[bool](t, pool, `SELECT anonymized_at IS NOT NULL FROM users WHERE id = $1::uuid`, a.ID) {
				t.Error("la cuenta se anonimizo pese al bloqueo")
			}
			if n := contar(t, pool, "sinpe_contacts", "user_id", a.ID); n != 1 {
				t.Errorf("el bloqueo no deshizo los borrados: quedan %d contactos", n)
			}
			if cuenta1[string](t, pool, `SELECT status FROM wallets WHERE user_id = $1::uuid`, a.ID) != "active" {
				t.Error("la billetera se cerro pese al bloqueo")
			}
		})
	}
}

// Lo ya resuelto no estorba: un escrow liquidado, un movimiento completado y un
// reparto cerrado no son pendientes.
func TestEliminar_LoResueltoNoBloquea(t *testing.T) {
	pool := testutil.TestDB(t)
	a, otra := sembrar(t, pool), sembrar(t, pool)
	exec(t, pool, `INSERT INTO escrow_agreements (buyer_id, seller_id, amount_minor, description, status, settled_at)
		VALUES ($1::uuid, $2::uuid, 100, 'compra', 'released', NOW())`, a.ID, otra.ID)
	exec(t, pool, `INSERT INTO transactions (id, wallet_id, user_id, type, amount, status)
		SELECT gen_random_uuid(), id, $1::uuid, 'sinpe_send', 100, 'completed' FROM wallets WHERE user_id = $1::uuid`, a.ID)
	exec(t, pool, `INSERT INTO payouts (user_id, rail, amount_minor, destination, idempotency_key, status)
		VALUES ($1::uuid, 'MOCK', 100, '{}', 'k2', 'completed')`, a.ID)
	exec(t, pool, `INSERT INTO ride_requests (user_id, partner_code, pickup, destination, estimated_price, estimated_time, distance, status)
		VALUES ($1::uuid, 'uber', 'a', 'b', 100, '5', '1', 'completed')`, a.ID)

	if _, err := nuevoServicio(pool, nil).ejecutar(context.Background(), a.ID, opciones{canal: CanalApp}); err != nil {
		t.Fatalf("lo resuelto no debia bloquear: %v", err)
	}
}

// Todo lo que hay que resolver sale de una vez, no de uno en uno.
func TestEliminar_ReportaTodosLosBloqueosJuntos(t *testing.T) {
	pool := testutil.TestDB(t)
	a := sembrar(t, pool)
	fondear(t, pool, a.ID, 5000)
	exec(t, pool, `INSERT INTO payouts (user_id, rail, amount_minor, destination, idempotency_key, status)
		VALUES ($1::uuid, 'MOCK', 100, '{}', 'k3', 'pending')`, a.ID)

	_, err := nuevoServicio(pool, nil).ejecutar(context.Background(), a.ID, opciones{canal: CanalApp})
	got := codigosDe(err)
	want := []string{BloqueoPayoutEnCurso, BloqueoSaldo}
	sort.Strings(want)
	if len(got) != 2 || got[0] != want[0] || got[1] != want[1] {
		t.Fatalf("bloqueos %v, se esperaba %v", got, want)
	}
}

func TestEliminar_Elegibilidad(t *testing.T) {
	ctx := context.Background()

	t.Run("administrador", func(t *testing.T) {
		pool := testutil.TestDB(t)
		a := sembrar(t, pool)
		exec(t, pool, `UPDATE users SET role = 'admin' WHERE id = $1::uuid`, a.ID)
		_, err := nuevoServicio(pool, nil).EliminarMiCuenta(ctx, a.ID, Confirmacion{Password: claveDePrueba})
		if !errors.Is(err, ErrRolNoPermitido) {
			t.Fatalf("se esperaba ErrRolNoPermitido, salio %v", err)
		}
		exec(t, pool, `UPDATE users SET role = 'support' WHERE id = $1::uuid`, a.ID)
		_, err = nuevoServicio(pool, nil).EliminarMiCuenta(ctx, a.ID, Confirmacion{Password: claveDePrueba})
		if !errors.Is(err, ErrRolNoPermitido) {
			t.Fatalf("soporte tampoco se autoelimina: %v", err)
		}
	})

	t.Run("demo", func(t *testing.T) {
		pool := testutil.TestDB(t)
		a := sembrar(t, pool)
		exec(t, pool, `UPDATE users SET demo_login = true WHERE id = $1::uuid`, a.ID)
		_, err := nuevoServicio(pool, nil).EliminarMiCuenta(ctx, a.ID, Confirmacion{Password: claveDePrueba})
		if !errors.Is(err, user.ErrCuentaDeDemostracion) {
			t.Fatalf("se esperaba ErrCuentaDeDemostracion, salio %v", err)
		}
	})

	t.Run("bloqueada va por la via web", func(t *testing.T) {
		pool := testutil.TestDB(t)
		a := sembrar(t, pool)
		exec(t, pool, `UPDATE users SET status = 'blocked', blocked_at = NOW(), blocked_reason = 'fraude confirmado' WHERE id = $1::uuid`, a.ID)
		svc := nuevoServicio(pool, nil)

		if _, err := svc.EliminarMiCuenta(ctx, a.ID, Confirmacion{Password: claveDePrueba}); !errors.Is(err, ErrCuentaNoElegible) {
			t.Fatalf("la via de la app debia rechazarla: %v", err)
		}
		// La via con una persona de operaciones si la acepta, y el rastro del
		// bloqueo SOBREVIVE (decision del abogado, ver la 074).
		if _, err := svc.ejecutar(ctx, a.ID, opciones{canal: CanalWeb, permitirCuentaBloqueada: true}); err != nil {
			t.Fatalf("la via web debia aceptarla: %v", err)
		}
		if cuenta1[string](t, pool, `SELECT blocked_reason FROM users WHERE id = $1::uuid`, a.ID) != "fraude confirmado" {
			t.Error("el rastro del bloqueo se perdio al cerrar la cuenta")
		}
		if cuenta1[string](t, pool, `SELECT deletion_channel FROM users WHERE id = $1::uuid`, a.ID) != "web" {
			t.Error("el canal no quedo como web")
		}
	})

	t.Run("preflight", func(t *testing.T) {
		pool := testutil.TestDB(t)
		a := sembrar(t, pool)
		svc := nuevoServicio(pool, nil)

		pf, err := svc.Preflight(ctx, a.ID)
		if err != nil || !pf.Elegible || len(pf.Bloqueos) != 0 || pf.Bloqueos == nil {
			t.Fatalf("limpia debia ser elegible con lista vacia (no nula): %+v %v", pf, err)
		}
		fondear(t, pool, a.ID, 100)
		pf, _ = svc.Preflight(ctx, a.ID)
		if pf.Elegible || len(pf.Bloqueos) != 1 || pf.Bloqueos[0].Codigo != BloqueoSaldo {
			t.Fatalf("con saldo: %+v", pf)
		}
		exec(t, pool, `UPDATE users SET role = 'admin' WHERE id = $1::uuid`, a.ID)
		pf, _ = svc.Preflight(ctx, a.ID)
		if pf.Elegible || pf.Motivo != "ADMIN_ACCOUNT" {
			t.Fatalf("administrador: %+v", pf)
		}
	})
}

// ── Reautenticacion ────────────────────────────────────────────────────────

type almacenEnMemoria struct {
	mu sync.Mutex
	n  map[string]int64
}

func nuevoAlmacen() *almacenEnMemoria { return &almacenEnMemoria{n: map[string]int64{}} }
func (a *almacenEnMemoria) IncrLockout(k string) int64 {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.n[k]++
	return a.n[k]
}
func (a *almacenEnMemoria) ResetLockout(k string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	delete(a.n, k)
}
func (a *almacenEnMemoria) GetLockout(k string) int64 {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.n[k]
}

type totpFalso struct {
	activo bool
	valido string
}

func (f totpFalso) TOTPEnabled(context.Context, string) (bool, error) { return f.activo, nil }
func (f totpFalso) VerifyTOTP(_ context.Context, _, _, code string) (bool, error) {
	return code == f.valido, nil
}

func TestEliminarMiCuenta_ContrasenaIncorrectaNoTocaNada(t *testing.T) {
	pool := testutil.TestDB(t)
	a := sembrar(t, pool)
	_, err := nuevoServicio(pool, nil).EliminarMiCuenta(context.Background(), a.ID, Confirmacion{Password: "otra-clave-9"})
	if !errors.Is(err, ErrContrasenaIncorrecta) {
		t.Fatalf("se esperaba ErrContrasenaIncorrecta, salio %v", err)
	}
	if cuenta1[bool](t, pool, `SELECT anonymized_at IS NOT NULL FROM users WHERE id = $1::uuid`, a.ID) {
		t.Fatal("se elimino con una contrasena equivocada")
	}
}

// El tope de intentos se cuenta antes de mirar la contrasena: pasado el tope ni
// la correcta entra, y acertar la reinicia.
func TestEliminarMiCuenta_TopeDeIntentos(t *testing.T) {
	pool := testutil.TestDB(t)
	ctx := context.Background()
	a := sembrar(t, pool)
	svc := nuevoServicio(pool, &Options{Lockout: nuevoAlmacen(), MaxIntentos: 3})

	for i := 0; i < 3; i++ {
		if _, err := svc.EliminarMiCuenta(ctx, a.ID, Confirmacion{Password: "mala"}); !errors.Is(err, ErrContrasenaIncorrecta) {
			t.Fatalf("intento %d: %v", i, err)
		}
	}
	if _, err := svc.EliminarMiCuenta(ctx, a.ID, Confirmacion{Password: claveDePrueba}); !errors.Is(err, ErrEnPausa) {
		t.Fatalf("pasado el tope ni la correcta debia entrar: %v", err)
	}
	if cuenta1[bool](t, pool, `SELECT anonymized_at IS NOT NULL FROM users WHERE id = $1::uuid`, a.ID) {
		t.Fatal("se elimino estando en pausa")
	}
}

func TestEliminarMiCuenta_ElSegundoFactorSeExigeSiEstaEncendido(t *testing.T) {
	ctx := context.Background()

	t.Run("falta el codigo", func(t *testing.T) {
		pool := testutil.TestDB(t)
		a := sembrar(t, pool)
		svc := nuevoServicio(pool, &Options{TOTP: totpFalso{activo: true, valido: "123456"}})
		if _, err := svc.EliminarMiCuenta(ctx, a.ID, Confirmacion{Password: claveDePrueba}); !errors.Is(err, ErrTOTPRequerido) {
			t.Fatalf("salio %v", err)
		}
	})
	t.Run("codigo equivocado", func(t *testing.T) {
		pool := testutil.TestDB(t)
		a := sembrar(t, pool)
		svc := nuevoServicio(pool, &Options{TOTP: totpFalso{activo: true, valido: "123456"}})
		if _, err := svc.EliminarMiCuenta(ctx, a.ID, Confirmacion{Password: claveDePrueba, TOTPCode: "000000"}); !errors.Is(err, ErrTOTPInvalido) {
			t.Fatalf("salio %v", err)
		}
		if cuenta1[bool](t, pool, `SELECT anonymized_at IS NOT NULL FROM users WHERE id = $1::uuid`, a.ID) {
			t.Fatal("se elimino con un codigo equivocado")
		}
	})
	t.Run("codigo correcto", func(t *testing.T) {
		pool := testutil.TestDB(t)
		a := sembrar(t, pool)
		svc := nuevoServicio(pool, &Options{TOTP: totpFalso{activo: true, valido: "123456"}})
		if _, err := svc.EliminarMiCuenta(ctx, a.ID, Confirmacion{Password: claveDePrueba, TOTPCode: "123456"}); err != nil {
			t.Fatalf("salio %v", err)
		}
	})
	t.Run("apagado no lo pide", func(t *testing.T) {
		pool := testutil.TestDB(t)
		a := sembrar(t, pool)
		svc := nuevoServicio(pool, &Options{TOTP: totpFalso{activo: false}})
		if _, err := svc.EliminarMiCuenta(ctx, a.ID, Confirmacion{Password: claveDePrueba}); err != nil {
			t.Fatalf("salio %v", err)
		}
	})
}
