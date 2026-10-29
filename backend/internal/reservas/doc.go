// Package reservas no tiene codigo de produccion: guarda la prueba que fija el
// invariante "siempre al 100 %" del libro.
//
// En cada moneda, la reserva (SYSTEM:RESERVE) es EXACTAMENTE igual a lo que se
// les debe a los usuarios (billeteras, saldos de comercios, metas de ahorro y
// escrow), despues de cualquier operacion. La prueba recorre cada tipo de
// operacion que mueve plata y compara las dos cifras sin tolerancia.
package reservas
