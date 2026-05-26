package hash

import (
	"testing"
)

func TestHashAndVerifyPin(t *testing.T) {
	pin := "1234"

	hashed, err := HashPin(pin)
	if err != nil {
		t.Fatalf("HashPin() error: %v", err)
	}

	if hashed == pin {
		t.Fatal("hash should not equal plaintext")
	}

	valid, err := VerifyPin(pin, hashed)
	if err != nil {
		t.Fatalf("VerifyPin() error: %v", err)
	}
	if !valid {
		t.Fatal("VerifyPin() should return true for correct pin")
	}
}

func TestVerifyPinWrong(t *testing.T) {
	hashed, err := HashPin("1234")
	if err != nil {
		t.Fatalf("HashPin() error: %v", err)
	}

	valid, err := VerifyPin("5678", hashed)
	if err != nil {
		t.Fatalf("VerifyPin() error: %v", err)
	}
	if valid {
		t.Fatal("VerifyPin() should return false for wrong pin")
	}
}

func TestHashUniqueSalts(t *testing.T) {
	hash1, _ := HashPin("1234")
	hash2, _ := HashPin("1234")

	if hash1 == hash2 {
		t.Fatal("two hashes of same pin should differ (unique salts)")
	}
}

func TestVerifyInvalidHash(t *testing.T) {
	_, err := VerifyPin("1234", "invalid-hash")
	if err == nil {
		t.Fatal("VerifyPin() should error on invalid hash format")
	}
}
