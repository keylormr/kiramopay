// Package accountdeletion elimina una cuenta sin romper el libro del dinero.
//
// La fila de users no se borra nunca: el diario es append-only por trigger y
// varias tablas la referencian con ON DELETE RESTRICT. Eliminar es dejarla como
// TUMBA (status 'closed', PII reemplazada) y tratar cada tabla segun la
// clasificacion de este archivo. Ver la migracion 074.
package accountdeletion

// Tratamiento es lo que se hace con las filas de una tabla cuando se elimina la
// cuenta que las posee.
type Tratamiento string

const (
	// Borrar: la fila se elimina. Credenciales, sesiones, contactos, contenido
	// libre y todo lo que no tiene funcion contable.
	Borrar Tratamiento = "borrar"

	// Anonimizar: la fila queda y se le borran los campos con datos de la
	// persona. Se hace en SQL, en la misma transaccion.
	Anonimizar Tratamiento = "anonimizar"

	// Conservar: rastro financiero que no se toca. Sin datos de contacto de la
	// persona o con datos que la propia clasificacion marca aparte.
	Conservar Tratamiento = "conservar"

	// ConservarAbogado: guarda PII (identificacion de contrapartes, KYC, UIF,
	// fraude, IP) cuya conservacion o borrado depende de una decision legal que
	// todavia no esta tomada. Mientras tanto se CONSERVA tal cual: perder un
	// registro que la ley exige es irreversible, conservar de mas unas semanas
	// no. Cuando el abogado defina plazos, aplicarlos es un cambio de esta tabla
	// y un trabajo de purga, no un rediseno.
	ConservarAbogado Tratamiento = "conservar_abogado"

	// Tumba: la fila de users. Se anonimiza en sitio; ver anonimizarUsuario.
	Tumba Tratamiento = "tumba"
)

// Clasificacion dice que se hace con CADA tabla que apunta a una persona, ya sea
// por clave foranea hacia users o por una columna user_id.
//
// La prueba TestClasificacionCubreElEsquema compara esta lista con el esquema
// real tras aplicar todas las migraciones y falla si una tabla nueva con
// user_id no esta aqui, o si aqui queda una que ya no existe. Esa es la defensa
// contra lo que de otro modo pasa solo: alguien agrega una tabla con datos
// personales y nadie decide que se hace con ellos al eliminar una cuenta.
var Clasificacion = map[string]Tratamiento{
	"users": Tumba,

	// ── Credenciales, sesiones y dispositivos ───────────────────────────────
	// user_sessions NO se borra: queda revocada y sin IP ni agente, para que
	// IsAccessJTIRevoked siga viendo la sesion cerrada (ver anonimizar.go).
	"user_sessions":         Anonimizar,
	"refresh_tokens":        Borrar,
	"password_reset_tokens": Borrar,
	"mfa_challenges":        Borrar,
	"user_totp":             Borrar,
	"totp_recovery_codes":   Borrar,
	"user_devices":          Borrar,
	"push_subscriptions":    Borrar,
	"push_dispositivos":     Borrar,
	"api_keys":              Borrar,
	"webhook_endpoints":     Borrar,

	// ── Contactos y contenido de la persona ─────────────────────────────────
	"sinpe_contacts":           Borrar,
	"linked_bank_accounts":     Borrar,
	"saved_services":           Borrar,
	"budgets":                  Borrar,
	"recurring_payments":       Borrar,
	"crypto_price_alerts":      Borrar,
	"assistant_conversations":  Borrar,
	"notification_history":     Borrar,
	"plan_interest":            Borrar,
	"user_partner_connections": Borrar,

	// ── Texto o lugares que la persona escribio, en filas que se quedan ─────
	"savings_goals":    Anonimizar,       // el nombre de la meta es texto libre
	"ride_requests":    Anonimizar,       // origen y destino son ubicaciones
	"virtual_cards":    Anonimizar,       // numero y titular; la tarjeta se cancela
	"qr_payment_codes": Anonimizar,       // se revocan y se les quita la nota
	"split_groups":     Anonimizar,       // titulo y descripcion; los activos se cancelan
	"split_shares":     Anonimizar,       // nombre y telefono de quien participo
	"merchant_staff":   Anonimizar,       // la vinculacion queda revocada
	"qr_merchants":     ConservarAbogado, // identidad legal del comercio; queda inactivo

	// ── Rastro financiero ───────────────────────────────────────────────────
	"wallets":                Conservar, // queda cerrada y en cero
	"regional_wallets":       Conservar, // queda inactiva y en cero
	"ledger_accounts":        Conservar, // queda cerrada (closed_at); el diario no se toca
	"journal_postings":       Conservar, // append-only por trigger; sin PII
	"crypto_assets":          Conservar, // en cero
	"crypto_staking":         Conservar, // ninguno activo
	"crypto_platform_fees":   Conservar,
	"loyalty_accounts":       Conservar,
	"loyalty_transactions":   Conservar,
	"loyalty_redemptions":    Conservar,
	"escrow_agreements":      Conservar,        // acuerdo entre dos personas; liquidado
	"payouts":                ConservarAbogado, // destino del pago (cuenta bancaria)
	"qr_payments":            Conservar,        // la nota solo se borra si la escribio esta persona
	"qr_charges":             Conservar,
	"card_transactions":      Conservar,
	"food_orders":            Conservar,
	"transactions":           ConservarAbogado, // contraparte, descripcion y geolocalizacion
	"sinpe_history":          ConservarAbogado, // telefono y nombre de la contraparte
	"sinpe_history_archive":  ConservarAbogado,
	"payment_history":        ConservarAbogado, // numero de cliente del servicio pagado
	"crypto_transactions":    ConservarAbogado, // nombre de la contraparte
	"cross_border_transfers": ConservarAbogado, // telefono del receptor

	// ── Cumplimiento y seguridad (decide el abogado) ────────────────────────
	"kyc_verifications":      ConservarAbogado,
	"identity_verifications": ConservarAbogado,
	"sanction_screenings":    ConservarAbogado,
	"uif_reports":            ConservarAbogado,
	"fraud_assessments":      ConservarAbogado,
	"fraud_alerts":           ConservarAbogado,
	"user_risk_profiles":     ConservarAbogado,
	"audit_logs":             ConservarAbogado, // IP y agente de usuario

	// La cola de solicitudes hechas desde la web guarda solo HMAC del contacto y
	// el resultado; no hay nada personal que borrar y es la prueba de que la
	// solicitud se atendio.
	"account_deletion_requests": Conservar,
}

// tablasDeApoyo son tablas que cuelgan de una de arriba SIN columna de usuario
// propia y que la eliminacion tambien trata. Estan aqui solo para que quede
// escrito; la prueba de cobertura no las exige porque no tienen user_id.
var tablasDeApoyo = map[string]Tratamiento{
	"webhook_deliveries":     Borrar,           // cuelga de webhook_endpoints
	"food_order_items":       Conservar,        // cuelga de food_orders
	"merchant_catalog_items": ConservarAbogado, // cuelga de qr_merchants
	"merchant_locations":     ConservarAbogado, // direccion del comercio; cuelga de qr_merchants
	"journal_entries":        Conservar,        // append-only por trigger
}
