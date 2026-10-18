package accountdeletion

import (
	"context"
	"errors"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/kiramopay/backend/internal/auth"
	"github.com/kiramopay/backend/internal/ledger"
	"github.com/kiramopay/backend/internal/testutil"
	"github.com/kiramopay/backend/internal/user"
)

// sembrarTodo llena TODO lo que la eliminacion trata: credenciales, contactos,
// texto libre, filas que se depuran y el rastro que la ley obliga a conservar.
// Es el escenario de las pruebas principales. Devuelve el id del comercio de la
// persona.
func sembrarTodo(t *testing.T, pool *pgxpool.Pool, c cuenta, otra cuenta) string {
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
		`INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, requested_ip) VALUES (gen_random_uuid(), $1::uuid, 'hr-' || $1::text, NOW() + interval '1 hour', '203.0.113.7')`,
		`INSERT INTO mfa_challenges (id, user_id, purpose, code_hash, expires_at) VALUES (gen_random_uuid(), $1::uuid, 'high_value_tx', 'hc', NOW() + interval '5 minutes')`,
		`INSERT INTO user_totp (user_id, secret_enc, enabled) VALUES ($1::uuid, '\x01', true)`,
		`INSERT INTO totp_recovery_codes (user_id, code_hash) VALUES ($1::uuid, 'rc-' || $1::text)`,
		`INSERT INTO push_subscriptions (user_id, endpoint, auth_key, p256dh_key) VALUES ($1::uuid, 'https://push.ejemplo.test/' || $1::text, 'a', 'p')`,
		`INSERT INTO push_dispositivos (user_id, token, plataforma) VALUES ($1::uuid, 'fcm-' || $1::text, 'android')`,
		`INSERT INTO api_keys (user_id, name, prefix, key_hash) VALUES ($1::uuid, 'caja', 'kp_live', 'kh-' || $1::text)`,
		`INSERT INTO webhook_endpoints (user_id, url, secret) VALUES ($1::uuid, 'https://maria.ejemplo.test/hook', 's')`,
		`INSERT INTO webhook_deliveries (endpoint_id, event_type, payload)
		 SELECT id, 'x', '{"nombre":"Maria"}' FROM webhook_endpoints WHERE user_id = $1::uuid`,
		// contactos, preferencias y contenido de la persona
		`UPDATE users SET language = 'en', biometric_enabled = true WHERE id = $1::uuid`,
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
		// filas que se quedan pero pierden lo que la persona escribio
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
		// rastro que la ley obliga a conservar
		`INSERT INTO transactions (id, wallet_id, user_id, type, amount, counterparty_name, counterparty_phone, status, metadata)
		 SELECT gen_random_uuid(), id, $1::uuid, 'sinpe_send', 100, 'Pedro Vargas', '+50688880000', 'completed', '{"nota":"gracias"}' FROM wallets WHERE user_id = $1::uuid`,
		`INSERT INTO sinpe_history (user_id, phone, contact_name, amount, type, description) VALUES ($1::uuid, '+50688880000', 'Pedro Vargas', 100, 'sent', 'el alquiler')`,
		`INSERT INTO audit_logs (user_id, action, ip_address, user_agent, details) VALUES ($1::uuid, 'login', '203.0.113.7', 'Mozilla/5.0', '{"identifier_type":"email"}')`,
		`INSERT INTO kyc_verifications (user_id, level_requested, full_legal_name, birth_date, nationality, document_type, document_number, reviewer_notes)
		 VALUES ($1::uuid, 1, 'Maria Rojas Mora', '1990-05-01', 'CR', 'cedula', '701230456', 'foto clara')`,
		`INSERT INTO kyc_documents (verification_id, doc_type, file_ref) SELECT id, 'id_front', 'kyc/maria-frente.jpg' FROM kyc_verifications WHERE user_id = $1::uuid`,
		`INSERT INTO identity_verifications (user_id, cedula_hash, verified_name, id_type, source, matched) VALUES ($1::uuid, 'hmac-de-la-cedula', 'MARIA ROJAS MORA', 'nacional', 'tse', true)`,
		`INSERT INTO sanction_screenings (user_id, query_name, normalized_query, result) VALUES ($1::uuid, 'Maria Rojas Mora', 'maria rojas mora', 'clean')`,
		`INSERT INTO uif_reports (user_id, report_type, amount_minor, currency, reason, reviewer_notes) VALUES ($1::uuid, 'manual', 100, 'USD', 'revision de Maria Rojas', 'nota del revisor')`,
		`INSERT INTO fraud_assessments (user_id, tx_type, tx_id, amount, risk_score, risk_level, factors, action) VALUES ($1::uuid, 'sinpe', 'tx-1', 100, 10, 'low', '["ip 203.0.113.7"]', 'allow')`,
		`INSERT INTO fraud_alerts (user_id, assessment_id, type, severity, message) SELECT $1::uuid, id, 'suspicious_tx', 'low', 'Maria hizo algo raro' FROM fraud_assessments WHERE user_id = $1::uuid`,
		`INSERT INTO payouts (user_id, rail, amount_minor, destination, idempotency_key, status)
		 VALUES ($1::uuid, 'MOCK', 100, '{"iban":"CR0501520200100000000001","nombre":"Maria Rojas"}', 'k-' || $1::text, 'completed')`,
		`INSERT INTO payment_history (user_id, type, provider_code, provider_name, client_id, amount) VALUES ($1::uuid, 'recharge', 'KOLBI', 'Kolbi', '88887777', 100)`,
		`INSERT INTO crypto_transactions (user_id, type, asset, amount, price, total, currency, counterparty_name) VALUES ($1::uuid, 'send', 'BTC', 1, 1, 1, 'USD', 'Pedro Vargas')`,
	} {
		exec(t, pool, sql, id)
	}

	// El comercio de la persona, con su identidad legal, una sede, un cajero (la
	// otra persona) y un cobro ya cerrado.
	comercio := comercioDe(t, pool, id)
	exec(t, pool, `UPDATE qr_merchants SET cedula = '701230456', legal_name = 'Maria Rojas Mora', description = 'Sodita de Maria' WHERE id = $1::uuid`, comercio)
	exec(t, pool, `INSERT INTO merchant_locations (merchant_id, name, address) VALUES ($1::uuid, 'Sede Centro', 'Avenida 2, San Jose')`, comercio)
	exec(t, pool, `INSERT INTO merchant_staff (merchant_id, user_id, added_by) VALUES ($1::uuid, $2::uuid, $3::uuid)`, comercio, otra.ID, id)
	exec(t, pool, `INSERT INTO qr_charges (qr_code_id, merchant_id, created_by, amount, currency, note, status, qr_data, expires_at)
		SELECT q.id, $1::uuid, $2::uuid, 100, 'CRC', 'mesa 4', 'cancelled', 'cobro-' || $1::text, NOW()
		  FROM qr_payment_codes q WHERE q.creator_id = $2::uuid`, comercio, id)
	// Un pago con nota que escribio la persona.
	exec(t, pool, `INSERT INTO qr_payments (qr_code_id, payer_id, receiver_id, amount, status, note)
		SELECT q.id, $1::uuid, $2::uuid, 100, 'completed', 'para el cafe de Laura'
		  FROM qr_payment_codes q WHERE q.creator_id = $1::uuid`, id, otra.ID)

	// La otra persona tiene un movimiento con esta como contraparte y comparte
	// el reparto: sus filas NO se tocan, salvo la parte pendiente de la que se va.
	exec(t, pool, `INSERT INTO transactions (id, wallet_id, user_id, type, amount, counterparty_id, counterparty_name, status)
		SELECT gen_random_uuid(), id, $1::uuid, 'sinpe_send', 50, $2::uuid, 'Maria Rojas', 'completed' FROM wallets WHERE user_id = $1::uuid`,
		otra.ID, id)
	return comercio
}

// sembrarTransfronteriza agrega un envio internacional ya completado. Va aparte
// de sembrarTodo porque en el esquema real los paises son una clave foranea.
func sembrarTransfronteriza(t *testing.T, pool *pgxpool.Pool, c cuenta) {
	t.Helper()
	exec(t, pool, `INSERT INTO cross_border_transfers (sender_id, receiver_phone, from_country, to_country, from_currency, to_currency,
	                                                   from_amount, to_amount, exchange_rate, fee, status)
		VALUES ($1::uuid, '+50760001111', 'CR', 'PA', 'CRC', 'USD', 100, 1, 1, 0, 'completed')`, c.ID)
}

// predicado dice como encontrar las filas de una persona en cada tabla de la
// clasificacion. La mayoria tiene user_id; estas no.
var predicado = map[string]string{
	"users":                  "id = $1::uuid",
	"qr_payment_codes":       "creator_id = $1::uuid",
	"split_groups":           "creator_id = $1::uuid",
	"escrow_agreements":      "buyer_id = $1::uuid OR seller_id = $1::uuid",
	"cross_border_transfers": "sender_id = $1::uuid OR receiver_id = $1::uuid",
	"qr_payments":            "payer_id = $1::uuid OR receiver_id = $1::uuid",
	"qr_charges":             "created_by = $1::uuid",
	"journal_postings":       "created_by = $1::uuid",
}

// filasDe cuenta, tabla por tabla de la clasificacion, cuantas filas son de la
// persona. Es la foto que permite decir "no se borro nada" o "se borro esto".
func filasDe(t *testing.T, pool *pgxpool.Pool, userID string) map[string]int {
	t.Helper()
	out := make(map[string]int, len(Clasificacion))
	for tabla := range Clasificacion {
		donde, ok := predicado[tabla]
		if !ok {
			donde = "user_id = $1::uuid"
		}
		out[tabla] = cuenta1[int](t, pool, "SELECT COUNT(*) FROM "+tabla+" WHERE "+donde, userID) //nolint:gosec // nombres fijos de la prueba
	}
	return out
}

func descifrar(t *testing.T, pool *pgxpool.Pool, tabla, columna, userID string) string {
	t.Helper()
	return cuenta1[string](t, pool, "SELECT COALESCE(fn_pii_decrypt("+columna+"), '') FROM "+tabla+" WHERE "+ //nolint:gosec // nombres fijos de la prueba
		map[bool]string{true: "id", false: "user_id"}[tabla == "users"]+" = $1::uuid", userID)
}

// ── Dia 0: la solicitud ───────────────────────────────────────────────────

// El dia 0 la cuenta queda bloqueada y sin forma de mover dinero, pero no se
// borra NADA: la persona puede volver durante 30 dias y encontrar todo igual.
func TestDiaCero_BloqueaLaCuentaYNoBorraNada(t *testing.T) {
	pool := testutil.TestDB(t)
	ctx := context.Background()
	a, b := sembrar(t, pool), sembrar(t, pool)
	sembrarTodo(t, pool, a, b)

	antes := filasDe(t, pool, a.ID)
	asientosAntes := cuenta1[int](t, pool, `SELECT COUNT(*) FROM journal_entries`)
	jtiAcceso := cuenta1[string](t, pool, `SELECT access_jti::text FROM user_sessions WHERE user_id = $1::uuid`, a.ID)

	svc := nuevoServicio(pool, nil)
	res, err := svc.EliminarMiCuenta(ctx, a.ID, Confirmacion{Password: claveDePrueba, AceptaPlazo: true})
	if err != nil {
		t.Fatalf("pedir la eliminacion: %v", err)
	}
	if res.Ya {
		t.Fatal("la primera solicitud no puede decir que ya existia")
	}

	// ── El estado y las fechas ──────────────────────────────────────────────
	var (
		status, canal       string
		pedido, cierre      time.Time
		aceptado, eliminada bool
		plazoExacto         bool
		nombre, apellido    string
	)
	if err := pool.QueryRow(ctx, `
		SELECT status, deletion_channel, deletion_requested_at, deletion_due_at,
		       deletion_terms_accepted_at IS NOT NULL, deleted_at IS NOT NULL,
		       deletion_due_at = deletion_requested_at + interval '30 days',
		       first_name, last_name
		  FROM users WHERE id = $1::uuid`, a.ID,
	).Scan(&status, &canal, &pedido, &cierre, &aceptado, &eliminada, &plazoExacto, &nombre, &apellido); err != nil {
		t.Fatalf("leer la cuenta: %v", err)
	}
	if status != "pending_deletion" || canal != "in_app" || !aceptado || eliminada {
		t.Errorf("estado del dia 0: status=%s canal=%s aceptado=%v cerrada=%v", status, canal, aceptado, eliminada)
	}
	if !plazoExacto {
		t.Errorf("el cierre debe ser 30 dias despues del pedido: %v -> %v", pedido, cierre)
	}
	if !res.SeEliminaEl.Equal(cierre) || !res.SolicitadaEn.Equal(pedido) {
		t.Errorf("la respuesta trae otras fechas: %v / %v, en la base %v / %v", res.SolicitadaEn, res.SeEliminaEl, pedido, cierre)
	}

	// ── La identidad sigue entera ───────────────────────────────────────────
	if nombre != "Maria" || apellido != "Rojas" {
		t.Errorf("el dia 0 no se toca la identidad: %s %s", nombre, apellido)
	}
	if got := descifrar(t, pool, "users", "cedula_enc", a.ID); got != a.Cedula {
		t.Errorf("la cedula cambio el dia 0: %q", got)
	}

	// ── Nada se borro, salvo las credenciales de entrega de avisos ──────────
	// (La auditoria gana una fila: la del pedido.)
	despues := filasDe(t, pool, a.ID)
	for tabla, n := range antes {
		switch {
		case tabla == "push_subscriptions" || tabla == "push_dispositivos":
			if despues[tabla] != 0 {
				t.Errorf("%s: el dia 0 no debe quedar ninguna, quedaron %d", tabla, despues[tabla])
			}
		case despues[tabla] < n:
			t.Errorf("%s: %d filas antes y %d despues del dia 0; no debia borrarse nada", tabla, n, despues[tabla])
		}
	}

	// ── Sin acceso ──────────────────────────────────────────────────────────
	if n := cuenta1[int](t, pool, `SELECT COUNT(*) FROM user_sessions WHERE user_id = $1::uuid AND revoked_at IS NULL`, a.ID); n != 0 {
		t.Errorf("%d sesiones siguen abiertas", n)
	}
	if n := cuenta1[int](t, pool, `SELECT COUNT(*) FROM refresh_tokens WHERE user_id = $1::uuid AND revoked_at IS NULL`, a.ID); n != 0 {
		t.Errorf("%d familias de refresh siguen vivas", n)
	}
	if n := cuenta1[int](t, pool, `SELECT COUNT(*) FROM api_keys WHERE user_id = $1::uuid AND status = 'active'`, a.ID); n != 0 {
		t.Errorf("%d llaves de API siguen activas", n)
	}
	revocado, err := auth.NewRepository(pool, nil).IsAccessJTIRevoked(ctx, jtiAcceso)
	if err != nil || !revocado {
		t.Errorf("el token de acceso anterior sigue valido: revocado=%v err=%v", revocado, err)
	}

	// ── Sin mover dinero, sin tocar el diario ───────────────────────────────
	if n := cuenta1[int](t, pool, `SELECT COUNT(*) FROM ledger_accounts
		WHERE (user_id = $1::uuid OR merchant_id IN (SELECT id FROM qr_merchants WHERE user_id = $1::uuid))
		  AND closed_at IS NULL`, a.ID); n != 0 {
		t.Errorf("%d cuentas del libro siguen abiertas el dia 0", n)
	}
	if n := cuenta1[int](t, pool, `SELECT COUNT(*) FROM journal_entries`); n != asientosAntes {
		t.Errorf("el diario cambio: %d -> %d", asientosAntes, n)
	}

	// ── Auditoria en la misma transaccion ───────────────────────────────────
	if n := cuenta1[int](t, pool, `SELECT COUNT(*) FROM audit_logs
		WHERE user_id = $1::uuid AND action = 'account_deletion_requested'
		  AND details->>'channel' = 'in_app' AND ip_address IS NULL`, a.ID); n != 1 {
		t.Errorf("auditoria del pedido: %d filas", n)
	}

	// La otra persona sigue como estaba.
	if cuenta1[string](t, pool, `SELECT status FROM users WHERE id = $1::uuid`, b.ID) != "active" {
		t.Error("la otra persona resulto afectada")
	}
}

// Sin la aceptacion expresa del plazo no empieza nada.
func TestDiaCero_ExigeAceptarElPlazo(t *testing.T) {
	pool := testutil.TestDB(t)
	a := sembrar(t, pool)
	_, err := nuevoServicio(pool, nil).EliminarMiCuenta(context.Background(), a.ID, Confirmacion{Password: claveDePrueba})
	if !errors.Is(err, ErrPlazoNoAceptado) {
		t.Fatalf("se esperaba ErrPlazoNoAceptado, salio %v", err)
	}
	if st := cuenta1[string](t, pool, `SELECT status FROM users WHERE id = $1::uuid`, a.ID); st != "active" {
		t.Fatalf("sin aceptar el plazo la cuenta quedo en %s", st)
	}
}

// Doble clic o reintento: la segunda orden no falla, no corre el plazo y no
// audita otra vez.
func TestDiaCero_EsIdempotente(t *testing.T) {
	pool := testutil.TestDB(t)
	a := sembrar(t, pool)
	svc := nuevoServicio(pool, nil)

	r1 := pedir(t, svc, a.ID)
	if r1.Ya {
		t.Fatal("la primera no puede decir que ya existia")
	}
	r2 := pedir(t, svc, a.ID)
	if !r2.Ya || !r2.SeEliminaEl.Equal(r1.SeEliminaEl) {
		t.Fatalf("la segunda debia devolver la misma solicitud: %+v / %+v", r1, r2)
	}
	if n := cuenta1[int](t, pool, `SELECT COUNT(*) FROM audit_logs WHERE user_id = $1::uuid AND action = 'account_deletion_requested'`, a.ID); n != 1 {
		t.Errorf("la segunda orden audito otra vez: %d", n)
	}
}

// Cuatro ordenes a la vez: una pide y las demas ven la solicitud ya hecha.
func TestDiaCero_DosOrdenesSimultaneas(t *testing.T) {
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
			resultados[i], errores[i] = svc.iniciar(context.Background(), a.ID, opciones{canal: CanalApp})
		}()
	}
	wg.Wait()

	nuevas := 0
	for i := range resultados {
		if errores[i] != nil {
			t.Fatalf("orden %d: %v", i, errores[i])
		}
		if !resultados[i].Ya {
			nuevas++
		}
	}
	if nuevas != 1 {
		t.Errorf("%d ordenes iniciaron el plazo, debia ser exactamente 1", nuevas)
	}
}

// La respuesta escrita del dia 0: dice que se suprime el dia 30, que se conserva
// por la Ley 7786 y hasta cuando, que puede reactivar, y que puede acudir a la
// PRODHAB. Nunca menciona un reporte de operacion sospechosa.
func TestDiaCero_LaPersonaRecibeLaRespuestaEscrita(t *testing.T) {
	pool := testutil.TestDB(t)
	a := sembrar(t, pool)
	correo := nuevoCorreo()
	svc := nuevoServicio(pool, &Options{Email: correo})

	res, err := svc.EliminarMiCuenta(context.Background(), a.ID, Confirmacion{Password: claveDePrueba, AceptaPlazo: true})
	if err != nil {
		t.Fatal(err)
	}
	m := esperar(t, correo.ch)
	if m.Para != a.Correo {
		t.Errorf("la respuesta fue a %q, se esperaba %q", m.Para, a.Correo)
	}
	dia30 := res.SeEliminaEl.In(zonaDePrueba).Format("02/01/2006")
	conservaHasta := res.SeEliminaEl.In(zonaDePrueba).AddDate(5, 0, 0).Format("02/01/2006")
	for _, debe := range []string{dia30, conservaHasta, "7786", "PRODHAB", "reactivar"} {
		if !strings.Contains(m.Texto, debe) {
			t.Errorf("la respuesta no dice %q:\n%s", debe, m.Texto)
		}
	}
	if prohibida := mencionProhibida.FindString(m.Texto); prohibida != "" {
		t.Errorf("la respuesta menciona %q y no debe:\n%s", prohibida, m.Texto)
	}
}

// mencionProhibida: lo que la respuesta a la persona nunca puede nombrar. Con
// limites de palabra: "otros" no es "ROS".
var mencionProhibida = regexp.MustCompile(`(?i)sospechos|\buif\b|\bros\b`)

// zonaDePrueba es la de Costa Rica, la que usa el correo para las fechas. Sin
// horario de verano: UTC-6 todo el ano.
var zonaDePrueba = time.FixedZone("CR", -6*3600)

// ── Dias 0 a 30: reactivar ────────────────────────────────────────────────

func TestReactivar_CancelaElProcesoYDejaLaCuentaComoEstaba(t *testing.T) {
	pool := testutil.TestDB(t)
	ctx := context.Background()
	a, b := sembrar(t, pool), sembrar(t, pool)
	svc := nuevoServicio(pool, nil)
	pedir(t, svc, a.ID)

	ok, err := svc.Reactivar(ctx, a.ID)
	if err != nil || !ok {
		t.Fatalf("reactivar: ok=%v err=%v", ok, err)
	}
	var status string
	var conSolicitud bool
	if err := pool.QueryRow(ctx, `SELECT status, (deletion_requested_at IS NOT NULL OR deletion_due_at IS NOT NULL
		OR deletion_terms_accepted_at IS NOT NULL OR deletion_channel IS NOT NULL) FROM users WHERE id = $1::uuid`, a.ID,
	).Scan(&status, &conSolicitud); err != nil {
		t.Fatal(err)
	}
	if status != "active" || conSolicitud {
		t.Fatalf("tras reactivar: status=%s y la solicitud sigue=%v", status, conSolicitud)
	}
	if n := cuenta1[int](t, pool, `SELECT COUNT(*) FROM ledger_accounts WHERE user_id = $1::uuid AND closed_at IS NOT NULL`, a.ID); n != 0 {
		t.Errorf("%d cuentas del libro siguen cerradas", n)
	}
	// Vuelve a recibir dinero.
	fondear(t, pool, b.ID, 1000)
	if _, err := ledger.NewEngine(pool, nil).Post(ctx, &ledger.Posting{
		Description: "pago tras reactivar",
		Entries: []ledger.Entry{
			{Account: ledger.Account{UserID: b.ID}, Side: ledger.Debit, AmountMinor: 100, Currency: "CRC"},
			{Account: ledger.Account{UserID: a.ID}, Side: ledger.Credit, AmountMinor: 100, Currency: "CRC"},
		},
	}); err != nil {
		t.Fatalf("la cuenta reactivada no recibe dinero: %v", err)
	}
	if n := cuenta1[int](t, pool, `SELECT COUNT(*) FROM audit_logs WHERE user_id = $1::uuid AND action = 'account_deletion_cancelled'`, a.ID); n != 1 {
		t.Errorf("auditoria de la reactivacion: %d", n)
	}
	// El barrido ya no tiene nada que hacer con ella.
	if n, err := svc.CerrarVencidas(ctx, time.Now().Add(40*24*time.Hour), 100); err != nil || n != 0 {
		t.Errorf("el barrido cerro una cuenta reactivada: n=%d err=%v", n, err)
	}
	// Reactivar otra vez no hace nada.
	if ok, err := svc.Reactivar(ctx, a.ID); err != nil || ok {
		t.Errorf("segunda reactivacion: ok=%v err=%v", ok, err)
	}
}

// Vencido el dia 30, mientras el barrido no la cierre, la puerta sigue abierta.
// Si algo pendiente impide el cierre (dinero que alguien mando, un acuerdo que
// otro abrio), la persona tiene que poder entrar a resolverlo: sin esto quedaria
// sin acceso, con lo pendiente adentro y sin cierre.
func TestReactivar_VencidoSinCerrarTodaviaSePuede(t *testing.T) {
	pool := testutil.TestDB(t)
	ctx := context.Background()
	a := sembrar(t, pool)
	svc := nuevoServicio(pool, nil)
	pedir(t, svc, a.ID)
	vencerPlazo(t, pool, a.ID)

	if _, reactivable, err := svc.SeEliminaEl(ctx, a.ID); err != nil || !reactivable {
		t.Fatalf("vencida y sin cerrar debe ofrecerse: reactivable=%v err=%v", reactivable, err)
	}
	if ok, err := svc.Reactivar(ctx, a.ID); err != nil || !ok {
		t.Fatalf("reactivar vencida y sin cerrar: ok=%v err=%v", ok, err)
	}
	if st := cuenta1[string](t, pool, `SELECT status FROM users WHERE id = $1::uuid`, a.ID); st != "active" {
		t.Errorf("quedo en %s", st)
	}
}

// Una vez cerrada por el barrido ya no se puede volver.
func TestReactivar_NoDespuesDelCierre(t *testing.T) {
	pool := testutil.TestDB(t)
	ctx := context.Background()
	a := sembrar(t, pool)
	svc := nuevoServicio(pool, nil)
	pedir(t, svc, a.ID)
	cerrar(t, pool, svc, a.ID)

	if _, reactivable, err := svc.SeEliminaEl(ctx, a.ID); err != nil || reactivable {
		t.Errorf("cerrada no debe ofrecerse: reactivable=%v err=%v", reactivable, err)
	}
	if ok, err := svc.Reactivar(ctx, a.ID); err != nil || ok {
		t.Fatalf("reactivo una cuenta cerrada: ok=%v err=%v", ok, err)
	}
	if st := cuenta1[string](t, pool, `SELECT status FROM users WHERE id = $1::uuid`, a.ID); st != "closed" {
		t.Errorf("quedo en %s", st)
	}
}

// Una cuenta que operaciones bloquea mientras corre el plazo no se reactiva sola.
// Al desbloquearla vuelve a 'pending_deletion' (la decision de la persona sigue
// en pie) y entonces si puede reactivarla.
func TestReactivar_UnaCuentaBloqueadaNoSeReactivaSola(t *testing.T) {
	pool := testutil.TestDB(t)
	ctx := context.Background()
	a := sembrar(t, pool)
	svc := nuevoServicio(pool, nil)
	pedir(t, svc, a.ID)

	repo := auth.NewRepository(pool, nil)
	if found, _, err := repo.BlockUserAndRevokeSessions(ctx, a.ID, "revision de fraude", ""); err != nil || !found {
		t.Fatalf("bloquear: found=%v err=%v", found, err)
	}
	if ok, err := svc.Reactivar(ctx, a.ID); err != nil || ok {
		t.Fatalf("una cuenta bloqueada se reactivo sola: ok=%v err=%v", ok, err)
	}
	if found, err := repo.UnblockUser(ctx, a.ID); err != nil || !found {
		t.Fatalf("desbloquear: found=%v err=%v", found, err)
	}
	if st := cuenta1[string](t, pool, `SELECT status FROM users WHERE id = $1::uuid`, a.ID); st != "pending_deletion" {
		t.Fatalf("desbloquear una cuenta con la eliminacion en curso la dejo en %s", st)
	}
	if ok, err := svc.Reactivar(ctx, a.ID); err != nil || !ok {
		t.Fatalf("desbloqueada, la persona si puede reactivarla: ok=%v err=%v", ok, err)
	}
}

// El login es la puerta de la reactivacion: con la contrasena correcta avisa que
// la cuenta se va a eliminar (y cuando), y con reactivate la reactiva y entra.
func TestLogin_OfreceReactivarYReactivaConLaContrasena(t *testing.T) {
	pool := testutil.TestDB(t)
	ctx := context.Background()
	a := sembrar(t, pool)
	svc := nuevoServicio(pool, nil)
	r := pedir(t, svc, a.ID)
	login := servicioDeLogin(pool, svc)

	_, err := login.Login(ctx, &auth.LoginRequest{Identifier: a.Cedula, Password: claveDePrueba}, auth.LoginContext{})
	var porEliminar *auth.CuentaPorEliminarError
	if !errors.As(err, &porEliminar) || !errors.Is(err, auth.ErrCuentaPorEliminar) {
		t.Fatalf("se esperaba CuentaPorEliminarError, salio %v", err)
	}
	if !porEliminar.SeEliminaEl.Equal(r.SeEliminaEl) {
		t.Errorf("la fecha del aviso %v no es la del cierre %v", porEliminar.SeEliminaEl, r.SeEliminaEl)
	}
	// Con la contrasena equivocada no se delata nada.
	if _, err := login.Login(ctx, &auth.LoginRequest{Identifier: a.Cedula, Password: "otra-clave-9"}, auth.LoginContext{}); !errors.Is(err, auth.ErrInvalidCredentials) {
		t.Errorf("con la contrasena equivocada: %v", err)
	}
	// Sin reactivar, ninguna sesion.
	if n := cuenta1[int](t, pool, `SELECT COUNT(*) FROM user_sessions WHERE user_id = $1::uuid AND revoked_at IS NULL`, a.ID); n != 0 {
		t.Fatalf("el aviso emitio %d sesiones", n)
	}

	resp, err := login.Login(ctx, &auth.LoginRequest{Identifier: a.Cedula, Password: claveDePrueba, Reactivate: true}, auth.LoginContext{})
	if err != nil || resp == nil || resp.Tokens == nil {
		t.Fatalf("reactivar desde el login: %+v %v", resp, err)
	}
	if st := cuenta1[string](t, pool, `SELECT status FROM users WHERE id = $1::uuid`, a.ID); st != "active" {
		t.Errorf("tras reactivar desde el login quedo en %s", st)
	}
}

// Una cuenta ya cerrada no recibe la oferta, y sin el servicio cableado el login
// la trata como cualquier cuenta que no puede entrar.
func TestLogin_SinOfertaSiYaNoSePuedeReactivar(t *testing.T) {
	ctx := context.Background()

	t.Run("ya cerrada", func(t *testing.T) {
		pool := testutil.TestDB(t)
		a := sembrar(t, pool)
		svc := nuevoServicio(pool, nil)
		pedir(t, svc, a.ID)
		cerrar(t, pool, svc, a.ID)
		resp, err := servicioDeLogin(pool, svc).Login(ctx, &auth.LoginRequest{Identifier: a.Cedula, Password: claveDePrueba, Reactivate: true}, auth.LoginContext{})
		var porEliminar *auth.CuentaPorEliminarError
		if err == nil || resp != nil || errors.As(err, &porEliminar) {
			t.Fatalf("una cuenta cerrada no entra ni se ofrece: resp=%+v err=%v", resp, err)
		}
	})
	t.Run("sin el servicio cableado", func(t *testing.T) {
		pool := testutil.TestDB(t)
		a := sembrar(t, pool)
		pedir(t, nuevoServicio(pool, nil), a.ID)
		_, err := servicioDeLogin(pool, nil).Login(ctx, &auth.LoginRequest{Identifier: a.Cedula, Password: claveDePrueba, Reactivate: true}, auth.LoginContext{})
		if !errors.Is(err, auth.ErrAccountBlocked) {
			t.Fatalf("sin quien responda por la eliminacion debe rechazarse cerrado, salio %v", err)
		}
	})
}

// El motor del libro se niega a asentar en la cuenta de quien pidio cerrarla,
// desde el dia 0. Es la defensa contra un cliente que conserve un id viejo.
func TestLibro_NoAcreditaUnaCuentaConLaEliminacionEnCurso(t *testing.T) {
	pool := testutil.TestDB(t)
	a, b := sembrar(t, pool), sembrar(t, pool)
	pedir(t, nuevoServicio(pool, nil), a.ID)
	fondear(t, pool, b.ID, 1000)
	antes := cuenta1[int](t, pool, `SELECT COUNT(*) FROM journal_entries`)

	_, err := ledger.NewEngine(pool, nil).Post(context.Background(), &ledger.Posting{
		Description: "pago a una cuenta por eliminar",
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

// Una solicitud contra una transferencia entrante. O la transferencia asienta
// antes y la solicitud ve el saldo y se niega, o la solicitud cierra el libro
// primero y la transferencia recibe ErrCuentaCerrada. Lo que NO puede pasar es
// que el dinero llegue a una cuenta que quedo por eliminar.
func TestDiaCero_CarreraContraUnaTransferenciaEntrante(t *testing.T) {
	pool := testutil.TestDB(t)
	ctx := context.Background()
	for ronda := 0; ronda < 6; ronda++ {
		a := sembrar(t, pool)
		b := sembrar(t, pool)
		svc := nuevoServicio(pool, nil)
		eng := ledger.NewEngine(pool, nil)
		fondear(t, pool, b.ID, 5000)

		var wg sync.WaitGroup
		var errPedido, errPago error
		wg.Add(2)
		go func() {
			defer wg.Done()
			_, errPedido = svc.iniciar(ctx, a.ID, opciones{canal: CanalApp})
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

		porEliminar := cuenta1[string](t, pool, `SELECT status FROM users WHERE id = $1::uuid`, a.ID) == "pending_deletion"
		saldoA := cuenta1[int64](t, pool, `
			SELECT COALESCE(SUM(CASE WHEN je.direction = 'credit' THEN je.amount_minor ELSE -je.amount_minor END), 0)
			  FROM journal_entries je JOIN ledger_accounts la ON la.id = je.account_id
			 WHERE la.user_id = $1::uuid AND la.currency = 'CRC'`, a.ID)
		if porEliminar && saldoA != 0 {
			t.Fatalf("ronda %d: la cuenta quedo por eliminar con saldo %d (pedido=%v pago=%v)", ronda, saldoA, errPedido, errPago)
		}
		if !porEliminar && errPedido == nil {
			t.Fatalf("ronda %d: el pedido dijo que salio y la cuenta no quedo por eliminar", ronda)
		}
		var bloqueada *ErrBloqueada
		if !porEliminar && !errors.As(errPedido, &bloqueada) {
			t.Fatalf("ronda %d: sin iniciar, el motivo debia ser un bloqueo por saldo: %v", ronda, errPedido)
		}
	}
}

// ── Dia 30: el cierre efectivo ────────────────────────────────────────────

// El barrido del dia 30 suprime de verdad lo que la persona tiene derecho a
// borrar, revoca las credenciales sin borrar su rastro, depura el texto que
// escribio en filas que se quedan, y CONSERVA identificado lo que la ley obliga.
// Es la prueba que nombra todo lo que la politica promete.
func TestDiaTreinta_SuprimeLoSuyoYConservaLoQueLaLeyExige(t *testing.T) {
	pool := testutil.TestDB(t)
	ctx := context.Background()
	a, b := sembrar(t, pool), sembrar(t, pool)
	comercio := sembrarTodo(t, pool, a, b)
	sembrarTransfronteriza(t, pool, a)
	svc := nuevoServicio(pool, nil)
	pedir(t, svc, a.ID)

	antes := filasDe(t, pool, a.ID)
	asientosAntes := cuenta1[int](t, pool, `SELECT COUNT(*) FROM journal_entries`)
	cerrar(t, pool, svc, a.ID)
	despues := filasDe(t, pool, a.ID)

	// ── Cada tabla segun su tratamiento ─────────────────────────────────────
	for tabla, tratamiento := range Clasificacion {
		switch tratamiento {
		case Suprimir:
			if despues[tabla] != 0 {
				t.Errorf("%s: quedaron %d filas de una tabla que se suprime", tabla, despues[tabla])
			}
		case Revocar, Depurar, Conservar, ConservarSinDatos:
			if despues[tabla] < antes[tabla] {
				t.Errorf("%s (%s): %d filas antes y %d despues; no debia perder filas", tabla, tratamiento, antes[tabla], despues[tabla])
			}
		}
	}
	if n := cuenta1[int](t, pool, `SELECT COUNT(*) FROM webhook_deliveries`); n != 0 {
		t.Errorf("webhook_deliveries: quedaron %d", n)
	}

	// ── Credenciales: la fila queda, el secreto no ──────────────────────────
	for nombre, sql := range map[string]string{
		"refresh":      `SELECT COUNT(*) FROM refresh_tokens WHERE user_id = $1::uuid AND (revoked_at IS NULL OR token_hash = 'h' OR ip_address IS NOT NULL OR user_agent IS NOT NULL)`,
		"reset":        `SELECT COUNT(*) FROM password_reset_tokens WHERE user_id = $1::uuid AND (token_hash NOT LIKE 'revoked:%' OR requested_ip IS NOT NULL)`,
		"mfa":          `SELECT COUNT(*) FROM mfa_challenges WHERE user_id = $1::uuid AND code_hash <> 'revoked'`,
		"totp":         `SELECT COUNT(*) FROM user_totp WHERE user_id = $1::uuid AND (enabled OR disabled_at IS NULL OR secret_enc = '\x01')`,
		"recuperacion": `SELECT COUNT(*) FROM totp_recovery_codes WHERE user_id = $1::uuid AND (invalidated_at IS NULL OR code_hash LIKE 'rc-%')`,
		"llaves":       `SELECT COUNT(*) FROM api_keys WHERE user_id = $1::uuid AND (status <> 'revoked' OR key_hash NOT LIKE 'revoked:%')`,
		"webhooks":     `SELECT COUNT(*) FROM webhook_endpoints WHERE user_id = $1::uuid AND (status <> 'disabled' OR secret <> 'revoked' OR url <> '')`,
		"cajeros":      `SELECT COUNT(*) FROM merchant_staff WHERE merchant_id IN (SELECT id FROM qr_merchants WHERE user_id = $1::uuid) AND status <> 'revoked'`,
	} {
		if n := cuenta1[int](t, pool, sql, a.ID); n != 0 {
			t.Errorf("%s: %d filas conservan la credencial o no quedaron revocadas", nombre, n)
		}
	}

	// ── Depurado: lo que la persona escribio, en filas que se quedan ────────
	if cuenta1[string](t, pool, `SELECT name FROM savings_goals WHERE user_id = $1::uuid`, a.ID) != "Meta eliminada" {
		t.Error("la meta de ahorro conserva su nombre")
	}
	if cuenta1[string](t, pool, `SELECT destination FROM ride_requests WHERE user_id = $1::uuid`, a.ID) != "" {
		t.Error("el viaje conserva el destino")
	}
	var estadoTarjeta, titular, numero string
	if err := pool.QueryRow(ctx, `SELECT status, cardholder_name, card_number FROM virtual_cards WHERE user_id = $1::uuid`, a.ID).
		Scan(&estadoTarjeta, &titular, &numero); err != nil {
		t.Fatal(err)
	}
	if estadoTarjeta != "cancelled" || titular != "Usuario eliminado" || !strings.HasSuffix(numero, "4321") {
		t.Errorf("tarjeta: %s %q %q", estadoTarjeta, titular, numero)
	}
	if cuenta1[string](t, pool, `SELECT status FROM qr_payment_codes WHERE creator_id = $1::uuid`, a.ID) != "revoked" {
		t.Error("el QR de la persona sigue activo")
	}
	if cuenta1[string](t, pool, `SELECT status FROM split_groups WHERE creator_id = $1::uuid`, a.ID) != "cancelled" {
		t.Error("el reparto abierto no se cancelo")
	}
	if n := cuenta1[int](t, pool, `SELECT COUNT(*) FROM split_shares WHERE user_phone IS NOT NULL`); n != 0 {
		t.Errorf("quedaron %d telefonos en las partes del reparto", n)
	}

	// ── Conservado tal cual (Ley 7786) ──────────────────────────────────────
	for nombre, sql := range map[string]string{
		"contraparte":     `SELECT counterparty_name FROM transactions WHERE user_id = $1::uuid AND counterparty_id IS NULL`,
		"sinpe":           `SELECT contact_name FROM sinpe_history WHERE user_id = $1::uuid`,
		"ip de auditoria": `SELECT host(ip_address) FROM audit_logs WHERE user_id = $1::uuid AND action = 'login'`,
		"kyc":             `SELECT document_number FROM kyc_verifications WHERE user_id = $1::uuid`,
		"tamizaje":        `SELECT query_name FROM sanction_screenings WHERE user_id = $1::uuid`,
		"retiro":          `SELECT destination->>'iban' FROM payouts WHERE user_id = $1::uuid`,
		"comercio":        `SELECT legal_name FROM qr_merchants WHERE user_id = $1::uuid`,
	} {
		if v := cuenta1[string](t, pool, sql, a.ID); v == "" || v == "Usuario eliminado" {
			t.Errorf("%s: lo que la ley obliga a conservar quedo vacio (%q)", nombre, v)
		}
	}

	// ── La identidad: fuera de users, aislada y entera ──────────────────────
	if got := descifrar(t, pool, "closed_account_records", "cedula_enc", a.ID); got != a.Cedula {
		t.Errorf("la cedula conservada es %q", got)
	}
	if got := descifrar(t, pool, "closed_account_records", "phone_enc", a.ID); got != a.Telefono {
		t.Errorf("el telefono conservado es %q", got)
	}
	if got := descifrar(t, pool, "closed_account_records", "email_enc", a.ID); got != a.Correo {
		t.Errorf("el correo conservado es %q", got)
	}
	if !cuenta1[bool](t, pool, `SELECT first_name = 'Maria' AND last_name = 'Rojas' AND cedula_hash = fn_pii_hmac($2)
		FROM closed_account_records WHERE user_id = $1::uuid`, a.ID, a.Cedula) {
		t.Error("el nombre o el hash de la cedula conservados no son los de la persona")
	}

	// ── La fila de users ya no identifica a nadie ───────────────────────────
	var (
		nombre, apellido, hashCed, hashTel, pwd string
		username, hashCorreo, idioma            *string
		biometria, cincoAnos                    bool
	)
	if err := pool.QueryRow(ctx, `
		SELECT first_name, last_name, cedula_hash, phone_hash, password_hash, username, email_hash, language,
		       COALESCE(biometric_enabled, false), retention_until = deleted_at + interval '5 years'
		  FROM users WHERE id = $1::uuid`, a.ID,
	).Scan(&nombre, &apellido, &hashCed, &hashTel, &pwd, &username, &hashCorreo, &idioma, &biometria, &cincoAnos); err != nil {
		t.Fatal(err)
	}
	if nombre != "Usuario" || apellido != "eliminado" || username != nil || hashCorreo != nil || idioma != nil || biometria {
		t.Errorf("users conserva datos: %s %s username=%v correo=%v idioma=%v biometria=%v", nombre, apellido, username, hashCorreo, idioma, biometria)
	}
	if !strings.HasPrefix(hashCed, "deleted:") || !strings.HasPrefix(hashTel, "deleted:") || pwd != "!deleted" {
		t.Errorf("los reemplazos de cedula/telefono/clave no son los esperados: %q %q %q", hashCed, hashTel, pwd)
	}
	if !cincoAnos {
		t.Error("la conservacion debe vencer cinco anos despues del cierre")
	}
	if got := descifrar(t, pool, "users", "cedula_enc", a.ID); got == a.Cedula {
		t.Error("users todavia descifra la cedula")
	}

	// ── El comercio queda cerrado, no borrado ───────────────────────────────
	if !cuenta1[bool](t, pool, `SELECT closed_at IS NOT NULL AND NOT active FROM qr_merchants WHERE id = $1::uuid`, comercio) {
		t.Error("el comercio no quedo cerrado e inactivo")
	}

	// ── El dinero ───────────────────────────────────────────────────────────
	if n := cuenta1[int](t, pool, `SELECT COUNT(*) FROM journal_entries`); n != asientosAntes {
		t.Errorf("el diario cambio: %d -> %d", asientosAntes, n)
	}
	if cuenta1[string](t, pool, `SELECT status FROM wallets WHERE user_id = $1::uuid`, a.ID) != "closed" {
		t.Error("la billetera no quedo cerrada")
	}

	// ── Auditoria y la otra persona ─────────────────────────────────────────
	if n := cuenta1[int](t, pool, `SELECT COUNT(*) FROM audit_logs WHERE user_id = $1::uuid AND action = 'account_closed'`, a.ID); n != 1 {
		t.Errorf("auditoria del cierre: %d", n)
	}
	if cuenta1[string](t, pool, `SELECT counterparty_name FROM transactions WHERE user_id = $1::uuid AND counterparty_id = $2::uuid`, b.ID, a.ID) != "Maria Rojas" {
		t.Error("se toco el historial de la otra persona")
	}
	if cuenta1[string](t, pool, `SELECT status FROM users WHERE id = $1::uuid`, b.ID) != "active" {
		t.Error("la otra persona resulto afectada")
	}
}

// Antes del dia 30 el barrido no cierra nada.
func TestDiaTreinta_NoCierraAntesDeTiempo(t *testing.T) {
	pool := testutil.TestDB(t)
	a := sembrar(t, pool)
	svc := nuevoServicio(pool, nil)
	pedir(t, svc, a.ID)

	n, err := svc.CerrarVencidas(context.Background(), time.Now(), 100)
	if err != nil || n != 0 {
		t.Fatalf("el barrido cerro antes del dia 30: n=%d err=%v", n, err)
	}
	if st := cuenta1[string](t, pool, `SELECT status FROM users WHERE id = $1::uuid`, a.ID); st != "pending_deletion" {
		t.Errorf("quedo en %s", st)
	}
}

// Con la marca de conservacion extendida, lo conservado se guarda diez anos.
func TestDiaTreinta_ConLaMarcaSeConservaDiezAnos(t *testing.T) {
	pool := testutil.TestDB(t)
	a := sembrar(t, pool)
	svc := nuevoServicio(pool, nil)
	pedir(t, svc, a.ID)
	exec(t, pool, `UPDATE users SET retention_extended_at = NOW() WHERE id = $1::uuid`, a.ID)
	cerrar(t, pool, svc, a.ID)

	if !cuenta1[bool](t, pool, `SELECT retention_until = deleted_at + interval '10 years' FROM users WHERE id = $1::uuid`, a.ID) {
		t.Error("con la marca, la conservacion debe vencer diez anos despues del cierre")
	}
}

// Una segunda pasada del barrido no hace nada ni audita otra vez.
func TestDiaTreinta_CierraUnaSolaVez(t *testing.T) {
	pool := testutil.TestDB(t)
	a := sembrar(t, pool)
	svc := nuevoServicio(pool, nil)
	pedir(t, svc, a.ID)
	cerrar(t, pool, svc, a.ID)

	if n, err := svc.CerrarVencidas(context.Background(), time.Now(), 100); err != nil || n != 0 {
		t.Fatalf("segunda pasada: n=%d err=%v", n, err)
	}
	if n := cuenta1[int](t, pool, `SELECT COUNT(*) FROM audit_logs WHERE user_id = $1::uuid AND action = 'account_closed'`, a.ID); n != 1 {
		t.Errorf("auditoria del cierre: %d", n)
	}
}

// Una cuenta que operaciones bloqueo durante el plazo se cierra igual el dia 30,
// y el rastro del bloqueo se conserva.
func TestDiaTreinta_UnaCuentaBloqueadaSeCierraIgualYConservaElRastro(t *testing.T) {
	pool := testutil.TestDB(t)
	ctx := context.Background()
	a := sembrar(t, pool)
	svc := nuevoServicio(pool, nil)
	pedir(t, svc, a.ID)
	if _, _, err := auth.NewRepository(pool, nil).BlockUserAndRevokeSessions(ctx, a.ID, "revision de fraude", ""); err != nil {
		t.Fatal(err)
	}
	cerrar(t, pool, svc, a.ID)
	if cuenta1[string](t, pool, `SELECT blocked_reason FROM users WHERE id = $1::uuid`, a.ID) != "revision de fraude" {
		t.Error("el rastro del bloqueo se perdio al cerrar")
	}
}

// Si en el plazo aparecio algo pendiente (no deberia: el libro esta cerrado), el
// barrido no cierra a ciegas: deja la cuenta como esta para que operaciones lo
// mire.
func TestDiaTreinta_NoCierraSiHayAlgoPendiente(t *testing.T) {
	pool := testutil.TestDB(t)
	a := sembrar(t, pool)
	svc := nuevoServicio(pool, nil)
	pedir(t, svc, a.ID)
	exec(t, pool, `INSERT INTO payouts (user_id, rail, amount_minor, destination, idempotency_key, status)
		VALUES ($1::uuid, 'MOCK', 100, '{}', 'pendiente-' || $1::text, 'processing')`, a.ID)
	vencerPlazo(t, pool, a.ID)

	n, err := svc.CerrarVencidas(context.Background(), time.Now(), 100)
	if err != nil || n != 0 {
		t.Fatalf("con algo pendiente no debia cerrar: n=%d err=%v", n, err)
	}
	if st := cuenta1[string](t, pool, `SELECT status FROM users WHERE id = $1::uuid`, a.ID); st != "pending_deletion" {
		t.Errorf("quedo en %s", st)
	}
	if n := cuenta1[int](t, pool, `SELECT COUNT(*) FROM closed_account_records WHERE user_id = $1::uuid`, a.ID); n != 0 {
		t.Error("se copio la identidad de una cuenta que no se cerro")
	}
}

// Quien cerro su cuenta puede volver a registrarse con la misma cedula, telefono
// y correo, y las busquedas encuentran a la persona NUEVA, nunca a la cerrada.
func TestDiaTreinta_LiberaCedulaTelefonoYCorreo(t *testing.T) {
	pool := testutil.TestDB(t)
	ctx := context.Background()
	a := sembrar(t, pool)
	repo := user.NewRepository(pool)
	svc := nuevoServicio(pool, nil)
	pedir(t, svc, a.ID)
	cerrar(t, pool, svc, a.ID)

	for nombre, buscar := range map[string]func() error{
		"cedula":   func() error { _, err := repo.FindByCedula(ctx, a.Cedula); return err },
		"telefono": func() error { _, err := repo.FindByPhone(ctx, a.Telefono); return err },
		"correo":   func() error { _, err := repo.FindByEmail(ctx, a.Correo); return err },
		"id":       func() error { _, err := repo.FindByID(ctx, a.ID); return err },
	} {
		if buscar() == nil {
			t.Errorf("la busqueda por %s todavia encuentra la cuenta cerrada", nombre)
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

// ── Dia 30 + 5 anos: la desasociacion ─────────────────────────────────────

// Vencida la conservacion, lo que se guardo deja de identificar a la persona, de
// forma irreversible. Las filas y los montos quedan (son estadistica y rastro
// contable); los nombres, documentos, telefonos, direcciones e IP no.
func TestDesasociar_AlVencerLaConservacion(t *testing.T) {
	pool := testutil.TestDB(t)
	ctx := context.Background()
	a, b := sembrar(t, pool), sembrar(t, pool)
	comercio := sembrarTodo(t, pool, a, b)
	sembrarTransfronteriza(t, pool, a)
	svc := nuevoServicio(pool, nil)
	pedir(t, svc, a.ID)
	cerrar(t, pool, svc, a.ID)
	antes := filasDe(t, pool, a.ID)

	envejecer(t, pool, a.ID, 5)
	n, err := svc.DesasociarVencidas(ctx, time.Now(), 100)
	if err != nil || n != 1 {
		t.Fatalf("desasociar: n=%d err=%v", n, err)
	}

	// Ninguna fila se pierde: se vacian los datos, no los registros.
	despues := filasDe(t, pool, a.ID)
	for tabla, n := range antes {
		if despues[tabla] < n {
			t.Errorf("%s: %d filas antes y %d despues de desasociar", tabla, n, despues[tabla])
		}
	}

	// La identidad conservada se vacio.
	if !cuenta1[bool](t, pool, `SELECT dissociated_at IS NOT NULL AND first_name IS NULL AND last_name IS NULL
		AND cedula_enc IS NULL AND cedula_hash IS NULL AND phone_enc IS NULL AND phone_hash IS NULL
		AND email_enc IS NULL AND email_hash IS NULL AND birth_date IS NULL AND birth_date_enc IS NULL
		FROM closed_account_records WHERE user_id = $1::uuid`, a.ID) {
		t.Error("la identidad conservada no se vacio")
	}
	if !cuenta1[bool](t, pool, `SELECT dissociated_at IS NOT NULL AND blocked_reason IS NULL FROM users WHERE id = $1::uuid`, a.ID) {
		t.Error("users no marca la desasociacion")
	}

	// Lo conservado ya no nombra a nadie.
	for nombre, sql := range map[string]string{
		"kyc":            `SELECT COUNT(*) FROM kyc_verifications WHERE user_id = $1::uuid AND (full_legal_name <> '' OR document_number <> '' OR birth_date IS NOT NULL OR nationality IS NOT NULL OR reviewer_notes IS NOT NULL)`,
		"documentos kyc": `SELECT COUNT(*) FROM kyc_documents WHERE verification_id IN (SELECT id FROM kyc_verifications WHERE user_id = $1::uuid) AND file_ref <> ''`,
		"identidad":      `SELECT COUNT(*) FROM identity_verifications WHERE user_id = $1::uuid AND (cedula_hash <> 'dissociated' OR verified_name IS NOT NULL)`,
		"tamizaje":       `SELECT COUNT(*) FROM sanction_screenings WHERE user_id = $1::uuid AND (query_name <> '' OR normalized_query <> '')`,
		"uif":            `SELECT COUNT(*) FROM uif_reports WHERE user_id = $1::uuid AND (reason <> '' OR reviewer_notes IS NOT NULL)`,
		"fraude":         `SELECT COUNT(*) FROM fraud_assessments WHERE user_id = $1::uuid AND factors <> '[]'`,
		"alertas":        `SELECT COUNT(*) FROM fraud_alerts WHERE user_id = $1::uuid AND message <> ''`,
		"auditoria":      `SELECT COUNT(*) FROM audit_logs WHERE user_id = $1::uuid AND (ip_address IS NOT NULL OR user_agent IS NOT NULL OR details <> '{}'::jsonb)`,
		"movimientos":    `SELECT COUNT(*) FROM transactions WHERE user_id = $1::uuid AND (counterparty_name IS NOT NULL OR counterparty_phone IS NOT NULL OR metadata <> '{}'::jsonb)`,
		"sinpe":          `SELECT COUNT(*) FROM sinpe_history WHERE user_id = $1::uuid AND (phone <> '' OR contact_name <> '' OR description IS NOT NULL)`,
		"recibos":        `SELECT COUNT(*) FROM payment_history WHERE user_id = $1::uuid AND client_id <> ''`,
		"cripto":         `SELECT COUNT(*) FROM crypto_transactions WHERE user_id = $1::uuid AND counterparty_name IS NOT NULL`,
		"internacional":  `SELECT COUNT(*) FROM cross_border_transfers WHERE sender_id = $1::uuid AND receiver_phone <> ''`,
		"retiros":        `SELECT COUNT(*) FROM payouts WHERE user_id = $1::uuid AND destination <> '{}'::jsonb`,
		"pagos qr":       `SELECT COUNT(*) FROM qr_payments WHERE payer_id = $1::uuid AND note IS NOT NULL`,
		"cobros":         `SELECT COUNT(*) FROM qr_charges WHERE created_by = $1::uuid AND note <> ''`,
		"comercio":       `SELECT COUNT(*) FROM qr_merchants WHERE user_id = $1::uuid AND (cedula <> '' OR legal_name <> '' OR description <> '' OR logo_url IS NOT NULL OR name <> 'Comercio cerrado')`,
		"sedes":          `SELECT COUNT(*) FROM merchant_locations WHERE merchant_id IN (SELECT id FROM qr_merchants WHERE user_id = $1::uuid) AND address <> ''`,
	} {
		if n := cuenta1[int](t, pool, sql, a.ID); n != 0 {
			t.Errorf("%s: %d filas todavia identifican a la persona", nombre, n)
		}
	}
	// Los montos siguen ahi.
	if cuenta1[int64](t, pool, `SELECT amount_minor FROM payouts WHERE user_id = $1::uuid`, a.ID) != 100 {
		t.Error("la desasociacion toco el monto de un retiro")
	}
	if !cuenta1[bool](t, pool, `SELECT closed_at IS NOT NULL FROM qr_merchants WHERE id = $1::uuid`, comercio) {
		t.Error("el comercio dejo de estar cerrado")
	}
	if n := cuenta1[int](t, pool, `SELECT COUNT(*) FROM audit_logs WHERE user_id = $1::uuid AND action = 'account_dissociated'`, a.ID); n != 1 {
		t.Errorf("auditoria de la desasociacion: %d", n)
	}
	// La otra persona conserva su registro: sigue su propio plazo.
	if cuenta1[string](t, pool, `SELECT counterparty_name FROM transactions WHERE user_id = $1::uuid AND counterparty_id = $2::uuid`, b.ID, a.ID) != "Maria Rojas" {
		t.Error("se toco el registro de la otra persona")
	}
	// Una segunda pasada no hace nada.
	if n, err := svc.DesasociarVencidas(ctx, time.Now(), 100); err != nil || n != 0 {
		t.Errorf("segunda pasada: n=%d err=%v", n, err)
	}
}

// Antes de los cinco anos no se desasocia nada.
func TestDesasociar_NoAntesDeTiempo(t *testing.T) {
	pool := testutil.TestDB(t)
	a := sembrar(t, pool)
	svc := nuevoServicio(pool, nil)
	pedir(t, svc, a.ID)
	cerrar(t, pool, svc, a.ID)

	if n, err := svc.DesasociarVencidas(context.Background(), time.Now(), 100); err != nil || n != 0 {
		t.Fatalf("desasocio antes de tiempo: n=%d err=%v", n, err)
	}
	if !cuenta1[bool](t, pool, `SELECT cedula_enc IS NOT NULL FROM closed_account_records WHERE user_id = $1::uuid`, a.ID) {
		t.Error("la identidad conservada se perdio antes de tiempo")
	}
}

// La marca puesta DESPUES del cierre tambien lleva la conservacion a diez anos:
// el barrido la mira al ejecutar, no solo la fecha que quedo al cerrar.
func TestDesasociar_LaMarcaPuestaDespuesDelCierreLlevaADiezAnos(t *testing.T) {
	pool := testutil.TestDB(t)
	a := sembrar(t, pool)
	svc := nuevoServicio(pool, nil)
	pedir(t, svc, a.ID)
	cerrar(t, pool, svc, a.ID)
	exec(t, pool, `UPDATE users SET retention_extended_at = NOW() WHERE id = $1::uuid`, a.ID)

	envejecer(t, pool, a.ID, 5)
	if n, err := svc.DesasociarVencidas(context.Background(), time.Now(), 100); err != nil || n != 0 {
		t.Fatalf("con la marca, a los cinco anos no debia desasociar: n=%d err=%v", n, err)
	}
	envejecer(t, pool, a.ID, 5)
	if n, err := svc.DesasociarVencidas(context.Background(), time.Now(), 100); err != nil || n != 1 {
		t.Fatalf("a los diez anos si: n=%d err=%v", n, err)
	}
}
