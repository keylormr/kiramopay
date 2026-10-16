package accountdeletion

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/kiramopay/backend/internal/auth"
	"github.com/kiramopay/backend/internal/ledger"
	"github.com/kiramopay/backend/internal/testutil"
	"github.com/kiramopay/backend/internal/user"
)

// sembrarTodo llena TODO lo que la eliminacion trata: credenciales, contactos,
// texto libre, filas que se anonimizan y rastro financiero que se conserva. Es el
// escenario de las pruebas principales.
func sembrarTodo(t *testing.T, pool *pgxpool.Pool, c cuenta, otra cuenta) {
	t.Helper()
	id := c.ID
	exec(t, pool, `INSERT INTO service_providers (code, name, category) VALUES ('KPTEST', 'Proveedor de prueba', 'telecom') ON CONFLICT (code) DO NOTHING`)
	for _, sql := range []string{
		// acceso
		`INSERT INTO user_devices (user_id, device_id, device_name) VALUES ($1::uuid, 'dev-1', 'Pixel de Maria')`,
		`INSERT INTO user_sessions (id, user_id, device_id, token_hash, ip_address, user_agent, device_fingerprint, expires_at, access_jti, refresh_jti)
		 SELECT gen_random_uuid(), $1::uuid, id, 'th', '203.0.113.7', 'Mozilla/5.0 (Maria)', 'huella-123', NOW() + interval '1 day', gen_random_uuid(), gen_random_uuid()
		   FROM user_devices WHERE user_id = $1::uuid`,
		`INSERT INTO refresh_tokens (jti, user_id, family_id, token_hash, expires_at, ip_address, user_agent)
		 VALUES (gen_random_uuid(), $1::uuid, gen_random_uuid(), 'h', NOW() + interval '1 day', '203.0.113.7', 'UA')`,
		`INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at) VALUES (gen_random_uuid(), $1::uuid, 'hr-' || $1::text, NOW() + interval '1 hour')`,
		`INSERT INTO mfa_challenges (id, user_id, purpose, code_hash, expires_at) VALUES (gen_random_uuid(), $1::uuid, 'high_value_tx', 'hc', NOW() + interval '5 minutes')`,
		`INSERT INTO user_totp (user_id, secret_enc, enabled) VALUES ($1::uuid, '\x01', false)`,
		`INSERT INTO totp_recovery_codes (user_id, code_hash) VALUES ($1::uuid, 'rc')`,
		`INSERT INTO push_dispositivos (user_id, token, plataforma) VALUES ($1::uuid, 'fcm-' || $1::text, 'android')`,
		`INSERT INTO api_keys (user_id, name, prefix, key_hash) VALUES ($1::uuid, 'caja', 'kp_live', 'kh-' || $1::text)`,
		`INSERT INTO webhook_endpoints (user_id, url, secret) VALUES ($1::uuid, 'https://ejemplo.test/hook', 's')`,
		`INSERT INTO webhook_deliveries (endpoint_id, event_type, payload)
		 SELECT id, 'x', '{"nombre":"Maria"}' FROM webhook_endpoints WHERE user_id = $1::uuid`,
		// contactos y contenido
		`INSERT INTO sinpe_contacts (user_id, phone, name) VALUES ($1::uuid, '+50688880000', 'Don Pedro Vargas')`,
		`INSERT INTO linked_bank_accounts (user_id, bank_code, bank_name, account_number_encrypted) VALUES ($1::uuid, 'BCR', 'Banco de Costa Rica', '\x01')`,
		`INSERT INTO saved_services (user_id, provider_id, client_id) SELECT $1::uuid, id, 'medidor-9981' FROM service_providers WHERE code = 'KPTEST'`,
		`INSERT INTO budgets (user_id, label, amount_limit) VALUES ($1::uuid, 'Comida', 100)`,
		`INSERT INTO recurring_payments (user_id, label, type, amount, frequency, next_date, recipient_name, recipient_phone)
		 VALUES ($1::uuid, 'Alquiler', 'sinpe', 100, 'monthly', CURRENT_DATE, 'Dona Rosa', '+50688881111')`,
		`INSERT INTO crypto_price_alerts (user_id, asset, target_price, direction) VALUES ($1::uuid, 'BTC', 1, 'above')`,
		`INSERT INTO assistant_conversations (user_id, title, messages) VALUES ($1::uuid, 'Mis deudas', '[{"role":"user","content":"debo plata"}]')`,
		`INSERT INTO notification_history (user_id, title, body, type) VALUES ($1::uuid, 'Pago', 'Pagaste a Pedro', 'tx')`,
		`INSERT INTO plan_interest (user_id, plan) VALUES ($1::uuid, 'plus')`,
		// filas que se anonimizan
		`INSERT INTO savings_goals (user_id, name, target_minor) VALUES ($1::uuid, 'Viaje a Cartago con Laura', 100)`,
		`INSERT INTO ride_requests (user_id, partner_code, pickup, destination, estimated_price, estimated_time, distance, status, driver_name, driver_plate)
		 VALUES ($1::uuid, 'uber', 'Mi casa', 'Casa de mi mama', 100, '5', '1', 'completed', 'Juan Chofer', 'ABC123')`,
		`INSERT INTO virtual_cards (user_id, card_number, last4, expiry_month, expiry_year, cardholder_name, status)
		 VALUES ($1::uuid, '•••• •••• •••• 4321', '4321', 1, 2030, 'MARIA ROJAS', 'active')`,
		`INSERT INTO qr_payment_codes (creator_id, type, qr_data, note, status) VALUES ($1::uuid, 'p2p_receive', 'qr-' || $1::text, 'cobro a Pedro', 'active')`,
		`INSERT INTO split_groups (creator_id, title, total_amount, split_type, status, description)
		 VALUES ($1::uuid, 'Cena con Laura', 100, 'equal', 'active', 'la cena del viernes')`,
		`INSERT INTO split_shares (group_id, user_id, user_name, user_phone, amount, status)
		 SELECT id, $1::uuid, 'Maria Rojas', '+50688887777', 50, 'pending' FROM split_groups WHERE creator_id = $1::uuid`,
		`INSERT INTO split_shares (group_id, user_id, user_name, user_phone, amount, status)
		 SELECT id, NULL, 'Laura Mora', '+50688886666', 50, 'pending' FROM split_groups WHERE creator_id = $1::uuid`,
		// rastro que se conserva
		`INSERT INTO transactions (id, wallet_id, user_id, type, amount, counterparty_name, counterparty_phone, status, metadata)
		 SELECT gen_random_uuid(), id, $1::uuid, 'sinpe_send', 100, 'Pedro Vargas', '+50688880000', 'completed', '{"nota":"gracias"}' FROM wallets WHERE user_id = $1::uuid`,
		`INSERT INTO sinpe_history (user_id, phone, contact_name, amount, type) VALUES ($1::uuid, '+50688880000', 'Pedro Vargas', 100, 'sent')`,
		`INSERT INTO audit_logs (user_id, action, ip_address, user_agent) VALUES ($1::uuid, 'login', '203.0.113.7', 'Mozilla/5.0')`,
	} {
		exec(t, pool, sql, id)
	}
	// La otra persona tiene un movimiento con esta como contraparte y comparte
	// el reparto: sus filas NO se tocan, salvo la parte pendiente de la que se va.
	exec(t, pool, `INSERT INTO transactions (id, wallet_id, user_id, type, amount, counterparty_id, counterparty_name, status)
		SELECT gen_random_uuid(), id, $1::uuid, 'sinpe_send', 50, $2::uuid, 'Maria Rojas', 'completed' FROM wallets WHERE user_id = $1::uuid`,
		otra.ID, id)
}

// El caso feliz: la persona elimina su cuenta y queda una tumba. Es la prueba que
// nombra todo lo que la politica promete.
func TestEliminarMiCuenta_DejaLaTumbaYBorraLoPersonal(t *testing.T) {
	pool := testutil.TestDB(t)
	ctx := context.Background()
	a := sembrar(t, pool)
	b := sembrar(t, pool)
	sembrarTodo(t, pool, a, b)

	asientosAntes := cuenta1[int](t, pool, `SELECT COUNT(*) FROM journal_entries`)
	cuentasLibroAntes := cuenta1[int](t, pool, `SELECT COUNT(*) FROM ledger_accounts WHERE user_id = $1::uuid`, a.ID)
	jtiAcceso := cuenta1[string](t, pool, `SELECT access_jti::text FROM user_sessions WHERE user_id = $1::uuid`, a.ID)

	svc := nuevoServicio(pool, nil)
	res, err := svc.EliminarMiCuenta(ctx, a.ID, Confirmacion{Password: claveDePrueba})
	if err != nil {
		t.Fatalf("eliminar: %v", err)
	}
	if res.Ya {
		t.Fatal("la primera eliminacion no puede decir que ya estaba eliminada")
	}

	// ── La tumba ────────────────────────────────────────────────────────────
	var (
		status, nombre, apellido, canal, hashCed, hashTel, pwd string
		username, hashCorreo                                   *string
		anonimizada, eliminada                                 bool
	)
	if err := pool.QueryRow(ctx, `
		SELECT status, first_name, last_name, deletion_channel, cedula_hash, phone_hash, password_hash,
		       username, email_hash, anonymized_at IS NOT NULL, deleted_at IS NOT NULL
		  FROM users WHERE id = $1::uuid`, a.ID,
	).Scan(&status, &nombre, &apellido, &canal, &hashCed, &hashTel, &pwd, &username, &hashCorreo, &anonimizada, &eliminada); err != nil {
		t.Fatalf("leer tumba: %v", err)
	}
	if status != "closed" || !anonimizada || !eliminada || canal != "in_app" {
		t.Errorf("la tumba no esta completa: status=%s anonimizada=%v eliminada=%v canal=%s", status, anonimizada, eliminada, canal)
	}
	if nombre != "Usuario" || apellido != "eliminado" || username != nil || hashCorreo != nil {
		t.Errorf("quedaron datos de identidad: %s %s username=%v correo=%v", nombre, apellido, username, hashCorreo)
	}
	if !strings.HasPrefix(hashCed, "deleted:") || !strings.HasPrefix(hashTel, "deleted:") || pwd != "!deleted" {
		t.Errorf("los reemplazos de cedula/telefono/clave no son los esperados: %q %q %q", hashCed, hashTel, pwd)
	}
	// La PII descifrada ya no es la de la persona.
	for col, original := range map[string]string{"cedula_enc": a.Cedula, "phone_enc": a.Telefono} {
		descifrada := cuenta1[string](t, pool, `SELECT fn_pii_decrypt(`+col+`) FROM users WHERE id = $1::uuid`, a.ID)
		if descifrada == original || descifrada != "deleted" {
			t.Errorf("%s descifra a %q", col, descifrada)
		}
	}
	if cuenta1[bool](t, pool, `SELECT email_enc IS NOT NULL FROM users WHERE id = $1::uuid`, a.ID) {
		t.Error("el correo cifrado sigue ahi")
	}

	// ── Lo que se borra ─────────────────────────────────────────────────────
	for tabla, tratamiento := range Clasificacion {
		if tratamiento != Borrar || tabla == "webhook_endpoints" {
			continue
		}
		if n := contar(t, pool, tabla, "user_id", a.ID); n != 0 {
			t.Errorf("%s: quedaron %d filas de una tabla que se borra", tabla, n)
		}
	}
	if n := cuenta1[int](t, pool, `SELECT COUNT(*) FROM webhook_endpoints`); n != 0 {
		t.Errorf("webhook_endpoints: quedaron %d", n)
	}
	if n := cuenta1[int](t, pool, `SELECT COUNT(*) FROM webhook_deliveries`); n != 0 {
		t.Errorf("webhook_deliveries: quedaron %d", n)
	}

	// ── Lo que se anonimiza ─────────────────────────────────────────────────
	var ip, agente, huella *string
	var revocada bool
	if err := pool.QueryRow(ctx, `SELECT ip_address::text, user_agent, device_fingerprint, revoked_at IS NOT NULL
		FROM user_sessions WHERE user_id = $1::uuid`, a.ID).Scan(&ip, &agente, &huella, &revocada); err != nil {
		t.Fatalf("la sesion debe seguir existiendo, revocada: %v", err)
	}
	if ip != nil || agente != nil || huella != nil || !revocada {
		t.Errorf("la sesion conserva datos o no esta revocada: ip=%v ua=%v huella=%v revocada=%v", ip, agente, huella, revocada)
	}
	if cuenta1[string](t, pool, `SELECT name FROM savings_goals WHERE user_id = $1::uuid`, a.ID) != "Meta eliminada" {
		t.Error("la meta de ahorro conserva su nombre")
	}
	if cuenta1[string](t, pool, `SELECT destination FROM ride_requests WHERE user_id = $1::uuid`, a.ID) != "" {
		t.Error("el viaje conserva el destino")
	}
	var estadoTarjeta, numero, titular string
	if err := pool.QueryRow(ctx, `SELECT status, card_number, cardholder_name FROM virtual_cards WHERE user_id = $1::uuid`, a.ID).
		Scan(&estadoTarjeta, &numero, &titular); err != nil {
		t.Fatal(err)
	}
	if estadoTarjeta != "cancelled" || titular != "Usuario eliminado" || !strings.HasSuffix(numero, "4321") {
		t.Errorf("tarjeta: %s %q %q", estadoTarjeta, numero, titular)
	}
	if cuenta1[string](t, pool, `SELECT status FROM qr_payment_codes WHERE creator_id = $1::uuid`, a.ID) != "revoked" {
		t.Error("el QR de la persona sigue activo")
	}
	if cuenta1[bool](t, pool, `SELECT note IS NOT NULL FROM qr_payment_codes WHERE creator_id = $1::uuid`, a.ID) {
		t.Error("el QR conserva la nota")
	}
	if cuenta1[string](t, pool, `SELECT status FROM split_groups WHERE creator_id = $1::uuid`, a.ID) != "cancelled" {
		t.Error("el reparto abierto no se cancelo")
	}
	if n := cuenta1[int](t, pool, `SELECT COUNT(*) FROM split_shares WHERE user_phone IS NOT NULL`); n != 0 {
		t.Errorf("quedaron %d telefonos en las partes del reparto", n)
	}
	if cuenta1[string](t, pool, `SELECT status FROM split_shares WHERE user_id = $1::uuid`, a.ID) != "declined" {
		t.Error("la parte pendiente de la persona no quedo rechazada")
	}

	// ── El dinero: nada se toco ─────────────────────────────────────────────
	if n := cuenta1[int](t, pool, `SELECT COUNT(*) FROM journal_entries`); n != asientosAntes {
		t.Errorf("el diario cambio: %d asientos antes, %d despues", asientosAntes, n)
	}
	if n := cuenta1[int](t, pool, `SELECT COUNT(*) FROM ledger_accounts WHERE user_id = $1::uuid AND closed_at IS NOT NULL`, a.ID); n != cuentasLibroAntes {
		t.Errorf("de %d cuentas del libro quedaron cerradas %d", cuentasLibroAntes, n)
	}
	saldo := cuenta1[int64](t, pool, `
		SELECT COALESCE(SUM(CASE WHEN je.direction = 'credit' THEN je.amount_minor ELSE -je.amount_minor END), 0)
		  FROM journal_entries je JOIN ledger_accounts la ON la.id = je.account_id
		 WHERE la.user_id = $1::uuid`, a.ID)
	if saldo != 0 {
		t.Errorf("el saldo del libro de la persona es %d, debia seguir en cero", saldo)
	}
	if cuenta1[string](t, pool, `SELECT status FROM wallets WHERE user_id = $1::uuid`, a.ID) != "closed" {
		t.Error("la billetera no quedo cerrada")
	}

	// ── Nivel B: se conserva tal cual hasta que el abogado decida ───────────
	if cuenta1[string](t, pool, `SELECT counterparty_name FROM transactions WHERE user_id = $1::uuid AND counterparty_id IS NULL`, a.ID) != "Pedro Vargas" {
		t.Error("la contraparte de la transaccion se borro; es Nivel B y debe conservarse")
	}
	if cuenta1[string](t, pool, `SELECT contact_name FROM sinpe_history WHERE user_id = $1::uuid`, a.ID) != "Pedro Vargas" {
		t.Error("el historial SINPE se toco; es Nivel B")
	}
	if cuenta1[string](t, pool, `SELECT ip_address::text FROM audit_logs WHERE user_id = $1::uuid AND action = 'login'`, a.ID) != "203.0.113.7/32" {
		t.Error("la IP de la auditoria se toco; es Nivel B")
	}
	// La otra persona conserva su movimiento intacto.
	if cuenta1[string](t, pool, `SELECT counterparty_name FROM transactions WHERE user_id = $1::uuid AND counterparty_id = $2::uuid`, b.ID, a.ID) != "Maria Rojas" {
		t.Error("se toco el historial de la otra persona")
	}

	// ── Auditoria ───────────────────────────────────────────────────────────
	if n := cuenta1[int](t, pool, `SELECT COUNT(*) FROM audit_logs WHERE user_id = $1::uuid AND action = 'account_deleted' AND ip_address IS NULL AND user_agent IS NULL`, a.ID); n != 1 {
		t.Errorf("auditoria account_deleted: %d filas, se esperaba 1 sin IP ni agente", n)
	}

	// ── El token de acceso que ya existia ya no sirve ───────────────────────
	// IsAccessJTIRevoked trata una sesion AUSENTE como no revocada: por eso la
	// fila se conserva. Esta prueba existe para que nadie la "limpie" despues.
	revocado, err := auth.NewRepository(pool, nil).IsAccessJTIRevoked(ctx, jtiAcceso)
	if err != nil || !revocado {
		t.Errorf("el token de acceso anterior sigue valido: revocado=%v err=%v", revocado, err)
	}
}

// Doble clic o reintento: la segunda orden no falla ni toca nada.
func TestEliminar_EsIdempotente(t *testing.T) {
	pool := testutil.TestDB(t)
	a := sembrar(t, pool)
	svc := nuevoServicio(pool, nil)

	r1, err := svc.ejecutar(context.Background(), a.ID, opciones{canal: CanalApp})
	if err != nil || r1.YaEliminada {
		t.Fatalf("primera: res=%+v err=%v", r1, err)
	}
	r2, err := svc.ejecutar(context.Background(), a.ID, opciones{canal: CanalApp})
	if err != nil || !r2.YaEliminada {
		t.Fatalf("segunda: res=%+v err=%v; debia decir que ya estaba eliminada", r2, err)
	}
	if n := cuenta1[int](t, pool, `SELECT COUNT(*) FROM audit_logs WHERE user_id = $1::uuid AND action = 'account_deleted'`, a.ID); n != 1 {
		t.Errorf("la segunda orden audito otra vez: %d", n)
	}
}

// Dos ordenes a la vez sobre la misma cuenta: una elimina y la otra ve que ya esta.
func TestEliminar_DosOrdenesSimultaneas(t *testing.T) {
	pool := testutil.TestDB(t)
	a := sembrar(t, pool)
	svc := nuevoServicio(pool, nil)

	var wg sync.WaitGroup
	resultados := make([]resultado, 4)
	errores := make([]error, 4)
	for i := range resultados {
		wg.Add(1)
		go func() {
			defer wg.Done()
			resultados[i], errores[i] = svc.ejecutar(context.Background(), a.ID, opciones{canal: CanalApp})
		}()
	}
	wg.Wait()

	nuevas := 0
	for i := range resultados {
		if errores[i] != nil {
			t.Fatalf("orden %d: %v", i, errores[i])
		}
		if !resultados[i].YaEliminada {
			nuevas++
		}
	}
	if nuevas != 1 {
		t.Errorf("%d ordenes eliminaron la cuenta, debia ser exactamente 1", nuevas)
	}
}

// El motor del libro se niega a asentar en la cuenta de quien ya no existe. Es la
// defensa contra un cliente que conserve un id viejo.
func TestLibro_NoAcreditaUnaCuentaCerrada(t *testing.T) {
	pool := testutil.TestDB(t)
	a := sembrar(t, pool)
	b := sembrar(t, pool)
	if _, err := nuevoServicio(pool, nil).ejecutar(context.Background(), a.ID, opciones{canal: CanalApp}); err != nil {
		t.Fatal(err)
	}
	antes := cuenta1[int](t, pool, `SELECT COUNT(*) FROM journal_entries`)

	eng := ledger.NewEngine(pool, nil)
	_, err := eng.Post(context.Background(), &ledger.Posting{
		Description: "pago a cuenta cerrada",
		Entries: []ledger.Entry{
			{Account: ledger.Account{UserID: b.ID}, Side: ledger.Debit, AmountMinor: 100, Currency: "CRC"},
			{Account: ledger.Account{UserID: a.ID}, Side: ledger.Credit, AmountMinor: 100, Currency: "CRC"},
		},
	})
	if !errors.Is(err, ledger.ErrCuentaCerrada) {
		t.Fatalf("se esperaba ErrCuentaCerrada, salio %v", err)
	}
	if n := cuenta1[int](t, pool, `SELECT COUNT(*) FROM journal_entries`); n != antes {
		t.Errorf("el rechazo dejo %d asientos", n-antes)
	}
}

// Quien se elimina puede volver a registrarse con la misma cedula y telefono, y
// las busquedas encuentran a la persona NUEVA, nunca a la tumba.
func TestEliminar_LiberaCedulaYTelefono(t *testing.T) {
	pool := testutil.TestDB(t)
	ctx := context.Background()
	a := sembrar(t, pool)
	repo := user.NewRepository(pool)

	if _, err := nuevoServicio(pool, nil).ejecutar(ctx, a.ID, opciones{canal: CanalApp}); err != nil {
		t.Fatal(err)
	}
	for nombre, buscar := range map[string]func() error{
		"cedula":   func() error { _, err := repo.FindByCedula(ctx, a.Cedula); return err },
		"telefono": func() error { _, err := repo.FindByPhone(ctx, a.Telefono); return err },
		"correo":   func() error { _, err := repo.FindByEmail(ctx, a.Correo); return err },
		"id":       func() error { _, err := repo.FindByID(ctx, a.ID); return err },
	} {
		if buscar() == nil {
			t.Errorf("la busqueda por %s todavia encuentra la tumba", nombre)
		}
	}

	nuevo := &user.UserRecord{
		ID: "11111111-1111-4111-8111-111111111111", Cedula: a.Cedula, Phone: a.Telefono, Email: a.Correo,
		FirstName: "Maria", LastName: "Rojas", PasswordHash: hashDeLaClave(t), Status: "active",
	}
	if err := repo.Create(ctx, nuevo); err != nil {
		t.Fatalf("volver a registrarse con los mismos datos: %v", err)
	}
	u, err := repo.FindByPhone(ctx, a.Telefono)
	if err != nil || u.ID != nuevo.ID {
		t.Fatalf("el telefono debe encontrar a la persona nueva: %v %v", u, err)
	}
}

// Una parte del dinero que se mueve por lo concurrente: una eliminacion contra
// una transferencia entrante. O la transferencia asienta antes y la eliminacion
// ve el saldo y se niega, o la eliminacion cierra primero y la transferencia
// recibe ErrCuentaCerrada. Lo que NO puede pasar es que el dinero llegue a una
// cuenta que quedo cerrada.
func TestEliminar_CarreraContraUnaTransferenciaEntrante(t *testing.T) {
	pool := testutil.TestDB(t)
	ctx := context.Background()
	for ronda := 0; ronda < 6; ronda++ {
		a := sembrar(t, pool)
		b := sembrar(t, pool)
		svc := nuevoServicio(pool, nil)
		eng := ledger.NewEngine(pool, nil)
		// b tiene con que pagar. Por el motor, no con asientos sueltos: asi la
		// cache de la billetera (que el motor mantiene y exige >= 0) cuadra.
		if _, err := eng.Post(ctx, &ledger.Posting{
			Description: "fondeo de prueba",
			Entries: []ledger.Entry{
				{Account: ledger.Account{SystemCode: ledger.SystemReserveCRC}, Side: ledger.Debit, AmountMinor: 5000, Currency: "CRC"},
				{Account: ledger.Account{UserID: b.ID}, Side: ledger.Credit, AmountMinor: 5000, Currency: "CRC"},
			},
		}); err != nil {
			t.Fatalf("fondear b: %v", err)
		}

		var wg sync.WaitGroup
		var errElim, errPago error
		wg.Add(2)
		go func() {
			defer wg.Done()
			_, errElim = svc.ejecutar(ctx, a.ID, opciones{canal: CanalApp})
		}()
		go func() {
			defer wg.Done()
			_, errPago = eng.Post(ctx, &ledger.Posting{
				Description: "pago entrante",
				Entries: []ledger.Entry{
					{Account: ledger.Account{UserID: b.ID}, Side: ledger.Debit, AmountMinor: 1000, Currency: "CRC"},
					{Account: ledger.Account{UserID: a.ID}, Side: ledger.Credit, AmountMinor: 1000, Currency: "CRC"},
				},
			})
		}()
		wg.Wait()

		cerrada := cuenta1[bool](t, pool, `SELECT anonymized_at IS NOT NULL FROM users WHERE id = $1::uuid`, a.ID)
		saldoA := cuenta1[int64](t, pool, `
			SELECT COALESCE(SUM(CASE WHEN je.direction = 'credit' THEN je.amount_minor ELSE -je.amount_minor END), 0)
			  FROM journal_entries je JOIN ledger_accounts la ON la.id = je.account_id
			 WHERE la.user_id = $1::uuid AND la.currency = 'CRC'`, a.ID)
		if cerrada && saldoA != 0 {
			t.Fatalf("ronda %d: la cuenta quedo cerrada con saldo %d (eliminacion=%v pago=%v)", ronda, saldoA, errElim, errPago)
		}
		if !cerrada && errElim == nil {
			t.Fatalf("ronda %d: la eliminacion dijo que salio y la cuenta no esta cerrada", ronda)
		}
		var bloqueada *ErrBloqueada
		if !cerrada && !errors.As(errElim, &bloqueada) {
			t.Fatalf("ronda %d: sin cerrar, el motivo debia ser un bloqueo por saldo: %v", ronda, errElim)
		}
	}
}
