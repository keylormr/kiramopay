package auth

import (
	"context"
	"testing"

	"github.com/kiramopay/backend/internal/testutil"
)

func TestGenerateNumericOTP(t *testing.T) {
	code, err := generateNumericOTP(6)
	if err != nil {
		t.Fatalf("generateNumericOTP: %v", err)
	}
	if len(code) != 6 {
		t.Fatalf("want 6 digits, got %d (%q)", len(code), code)
	}
	for _, c := range code {
		if c < '0' || c > '9' {
			t.Fatalf("non-digit in code %q", code)
		}
	}
	// Sanity that the generator is not returning a constant. Two independent
	// draws colliding is ~1e-6; retry once to keep this from being flaky.
	if other, _ := generateNumericOTP(6); code == other {
		if again, _ := generateNumericOTP(6); code == again {
			t.Errorf("codes look constant: %q", code)
		}
	}
}

func TestHashOTP(t *testing.T) {
	first, second := hashOTP("123456"), hashOTP("123456")
	if first != second {
		t.Error("hashOTP is not stable for the same code")
	}
	if hashOTP("123456") == hashOTP("654321") {
		t.Error("different codes produced the same hash")
	}
	if got := len(hashOTP("123456")); got != 64 { // sha256 hex
		t.Errorf("unexpected hash length %d, want 64", got)
	}
}

// El contador de intentos del OTP tiene que tener vencimiento SIEMPRE, tambien
// cuando la operacion se lo encuentra ausente.
//
// Nace con el suyo en PutRegistrationOTP, junto con la llave del codigo y en la
// misma transaccion, pero eso no basta: el desalojo de Redis elige llave por
// llave, asi que la del codigo puede seguir viva cuando la de los intentos ya
// no esta. Con un INCR pelado esa llave se recreaba sin vencimiento, y una
// llave sin vencimiento tampoco vuelve a ser candidata al desalojo: se queda.
func TestOTPDeRegistro_ElContadorDeIntentosNuncaQuedaSinVencimiento(t *testing.T) {
	client := testutil.TestRedis(t)
	ctx := context.Background()

	r := NewRepository(nil, client)
	const phone = "+50688887777"
	if err := r.PutRegistrationOTP(ctx, phone, hashOTP("123456"), ""); err != nil {
		t.Fatalf("PutRegistrationOTP: %v", err)
	}

	// Redis desalojo la llave de los intentos; la del codigo sobrevivio.
	if err := client.Del(ctx, regOTPAttemptsKey(phone)).Err(); err != nil {
		t.Fatalf("simular el desalojo: %v", err)
	}

	if ok, _, err := r.VerifyRegistrationOTP(ctx, phone, hashOTP("000000")); err != nil {
		t.Fatalf("VerifyRegistrationOTP: %v", err)
	} else if ok {
		t.Fatal("un codigo equivocado se dio por bueno")
	}

	ttl, err := client.PTTL(ctx, regOTPAttemptsKey(phone)).Result()
	if err != nil {
		t.Fatalf("leer el vencimiento: %v", err)
	}
	if ttl < 0 {
		t.Fatalf("el contador de intentos quedo con pttl = %v (-1 es sin vencimiento): esa llave se queda en Redis para siempre", ttl)
	}
	if ttl > regOTPTTL {
		t.Fatalf("el contador de intentos vence en %v, mas que el propio codigo (%v)", ttl, regOTPTTL)
	}
}
