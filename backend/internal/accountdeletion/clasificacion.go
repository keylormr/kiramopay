// Package accountdeletion lleva la eliminacion de una cuenta de punta a punta
// sin romper el libro del dinero ni lo que la ley obliga a conservar.
//
// La linea de tiempo (decision del dueno del 2026-10-18):
//
//   - Dia 0: la persona lo pide (app o web) y acepta el plazo. La cuenta queda
//     en 'pending_deletion': sin sesiones, sin avisos, sin poder operar ni
//     recibir dinero. No se borra nada. Recibe una respuesta escrita.
//   - Dias 0 a 30: puede reactivarla desde el login; reactivar cancela todo.
//   - Dia 30: el barrido la cierra segun la clasificacion de este archivo.
//   - Dia 30 + 5 anos (10 con la marca de conservacion extendida): el barrido
//     desasocia lo conservado.
//
// La fila de users no se borra nunca: el diario es append-only por trigger y
// varias tablas la referencian con ON DELETE RESTRICT. Ver la migracion 077.
package accountdeletion

// Tratamiento es lo que se hace con las filas de una tabla cuando se cierra la
// cuenta que las posee.
type Tratamiento string

const (
	// Expediente: la fila de users y la copia aislada de la identidad
	// (closed_account_records). El dia 30 la identidad pasa de una a la otra;
	// al vencer la conservacion se vacia. Ver pasos.go.
	Expediente Tratamiento = "expediente"

	// Suprimir: el dia 30 la fila se borra de verdad. Es lo que la persona
	// tiene derecho a suprimir (Ley 8968) y ninguna ley obliga a conservar:
	// preferencias, contactos de terceros, presupuestos, recurrentes, alertas,
	// conversaciones, avisos, tokens push, dispositivos y sesiones.
	Suprimir Tratamiento = "suprimir"

	// Revocar: una credencial. La fila queda como rastro (regla del dueno:
	// quitar acceso no es borrar registros) pero queda revocada y sin el
	// secreto: nada que pudiera autenticar sobrevive.
	Revocar Tratamiento = "revocar"

	// Depurar: la fila se queda porque es parte del rastro de una operacion,
	// pero pierde el texto o los lugares que la persona escribio.
	Depurar Tratamiento = "depurar"

	// Conservar: lo que la Ley 7786 (art. 16) y el Decreto 36948 (art. 21)
	// obligan a guardar: identificacion, operaciones, contrapartes, auditoria,
	// cumplimiento, UIF y fraude. Se conserva identificado y sin tocar hasta
	// users.retention_until; ese dia se desasocia (pasosDeLaDesasociacion).
	Conservar Tratamiento = "conservar"

	// ConservarSinDatos: rastro contable sin datos de la persona, o registro
	// que comparte con otra persona y sigue el plazo de esa otra. No hay nada
	// que desasociar en las filas propias.
	ConservarSinDatos Tratamiento = "conservar_sin_datos"
)

// Clasificacion dice que se hace con CADA tabla que apunta a una persona, ya sea
// por clave foranea hacia users o por una columna user_id.
//
// La prueba TestClasificacionCubreElEsquema compara esta lista con el esquema
// real tras aplicar todas las migraciones y falla si una tabla nueva con
// user_id no esta aqui, o si aqui queda una que ya no existe. Esa es la defensa
// contra lo que de otro modo pasa solo: alguien agrega una tabla con datos
// personales y nadie decide que se hace con ellos al cerrar una cuenta.
var Clasificacion = map[string]Tratamiento{
	"users":                  Expediente,
	"closed_account_records": Expediente,

	// ── Acceso: el dia 0 se revoca; el dia 30 se suprime ────────────────────
	// Las sesiones se revocan el dia 0 (IsAccessJTIRevoked lee la fila, y una
	// fila ausente no es lo mismo que una revocada) y se borran el dia 30,
	// cuando ningun token de acceso de 15 minutos puede seguir vivo.
	"user_sessions":      Suprimir,
	"user_devices":       Suprimir,
	"push_subscriptions": Suprimir, // el dia 0: sin avisos durante el plazo
	"push_dispositivos":  Suprimir, // el dia 0

	// ── Credenciales: la fila queda, el secreto no ──────────────────────────
	"refresh_tokens":        Revocar,
	"password_reset_tokens": Revocar,
	"mfa_challenges":        Revocar,
	"user_totp":             Revocar,
	"totp_recovery_codes":   Revocar,
	"api_keys":              Revocar, // el dia 0
	"webhook_endpoints":     Revocar,
	"merchant_staff":        Revocar, // el vinculo de cajero es un acceso

	// ── Lo que la persona guardo para si ────────────────────────────────────
	"sinpe_contacts":           Suprimir,
	"linked_bank_accounts":     Suprimir,
	"saved_services":           Suprimir,
	"budgets":                  Suprimir,
	"recurring_payments":       Suprimir,
	"crypto_price_alerts":      Suprimir,
	"assistant_conversations":  Suprimir,
	"notification_history":     Suprimir, // copias de avisos; las operaciones se conservan aparte
	"plan_interest":            Suprimir,
	"user_partner_connections": Suprimir,

	// ── Texto o lugares que la persona escribio, en filas que se quedan ─────
	"savings_goals":    Depurar, // el nombre de la meta es texto libre
	"ride_requests":    Depurar, // origen, destino y datos del conductor
	"virtual_cards":    Depurar, // se cancela y pierde el titular
	"qr_payment_codes": Depurar, // se revocan y pierden la nota
	"split_groups":     Depurar, // titulo y descripcion; los activos se cancelan
	"split_shares":     Depurar, // nombre y telefono de quien participo

	// ── Rastro financiero sin datos de la persona ───────────────────────────
	"wallets":              ConservarSinDatos, // queda cerrada y en cero
	"regional_wallets":     ConservarSinDatos, // queda inactiva y en cero
	"ledger_accounts":      ConservarSinDatos, // cerrada desde el dia 0 (closed_at); el diario no se toca
	"journal_postings":     ConservarSinDatos, // append-only por trigger
	"crypto_assets":        ConservarSinDatos, // en cero
	"crypto_staking":       ConservarSinDatos, // ninguno activo
	"crypto_platform_fees": ConservarSinDatos,
	"loyalty_accounts":     ConservarSinDatos,
	"loyalty_transactions": ConservarSinDatos,
	"loyalty_redemptions":  ConservarSinDatos,
	"card_transactions":    ConservarSinDatos, // el comercio donde se uso no es dato de la persona
	"food_orders":          ConservarSinDatos,
	// El acuerdo es de dos personas y su descripcion la escribio cualquiera de
	// las dos: sigue el plazo de la otra parte, como sus movimientos.
	"escrow_agreements": ConservarSinDatos,

	// ── Operaciones y contrapartes (Ley 7786) ───────────────────────────────
	"transactions":           Conservar, // contraparte, metadatos y ubicacion
	"sinpe_history":          Conservar, // telefono y nombre de la contraparte
	"sinpe_history_archive":  Conservar,
	"payment_history":        Conservar, // numero de cliente del servicio pagado
	"crypto_transactions":    Conservar, // nombre de la contraparte
	"cross_border_transfers": Conservar, // telefono del receptor
	"payouts":                Conservar, // destino del retiro (cuenta bancaria)
	"qr_payments":            Conservar, // la nota que escribio quien pago
	"qr_charges":             Conservar, // la nota del cobro
	"qr_merchants":           Conservar, // identidad legal del comercio; queda cerrado

	// ── Cumplimiento y seguridad (Ley 7786) ─────────────────────────────────
	"kyc_verifications":      Conservar,
	"identity_verifications": Conservar,
	"sanction_screenings":    Conservar,
	"uif_reports":            Conservar,
	"uif_movimientos":        Conservar, // lo que evaluo la UIF de cada movimiento (080)
	"fraud_assessments":      Conservar,
	"fraud_alerts":           Conservar,
	"user_risk_profiles":     ConservarSinDatos, // solo contadores
	"audit_logs":             Conservar,         // IP, agente y detalles

	// La cola de solicitudes web guarda el HMAC del contacto y el resultado: es
	// la prueba de que la solicitud se atendio, y el HMAC se vacia al desasociar.
	"account_deletion_requests": Conservar,
}

// tablasDeApoyo son tablas que cuelgan de una de arriba SIN columna de usuario
// propia y que el cierre tambien trata. Estan aqui solo para que quede escrito;
// la prueba de cobertura no las exige porque no tienen user_id.
var tablasDeApoyo = map[string]Tratamiento{
	"webhook_deliveries":     Suprimir,          // cuelga de webhook_endpoints; copias de eventos
	"food_order_items":       ConservarSinDatos, // cuelga de food_orders
	"merchant_catalog_items": ConservarSinDatos, // cuelga de qr_merchants; queda inactivo
	"merchant_locations":     Conservar,         // direccion del comercio; cuelga de qr_merchants
	"kyc_documents":          Conservar,         // referencia a la imagen del documento; cuelga de kyc_verifications
	"journal_entries":        ConservarSinDatos, // append-only por trigger
}
