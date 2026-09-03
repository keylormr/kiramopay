package auth

import (
	"context"
	"fmt"
)

// Helpers expuestos SOLO para las pruebas del paquete auth_test.

// HashOTPForTest expone el hash interno del codigo para sembrar valores.
func HashOTPForTest(code string) string { return hashOTP(code) }

// PutRegistrationOTPRaw siembra un valor OTP en el formato PLANO de la version
// anterior (el hash del codigo sin envolver en JSON), para probar que el
// consumidor nuevo sigue verificando codigos en vuelo tras el deploy.
func (r *Repository) PutRegistrationOTPRaw(ctx context.Context, phone, codeHash string) error {
	if r.redis == nil {
		return fmt.Errorf("otp store unavailable")
	}
	pipe := r.redis.TxPipeline()
	pipe.Set(ctx, regOTPKey(phone), codeHash, regOTPTTL)
	pipe.Set(ctx, regOTPAttemptsKey(phone), 0, regOTPTTL)
	_, err := pipe.Exec(ctx)
	return err
}

// RegisterErrorResponseForTest expone el mapeo error -> respuesta HTTP del
// registro para probar el contrato de POST /auth/register sin base de datos.
func RegisterErrorResponseForTest(err error) (int, string, string) {
	return registerErrorResponse(err)
}
