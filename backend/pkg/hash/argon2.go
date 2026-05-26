package hash

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"fmt"
	"strings"

	"golang.org/x/crypto/argon2"
)

type Argon2Params struct {
	Memory      uint32
	Iterations  uint32
	Parallelism uint8
	SaltLength  uint32
	KeyLength   uint32
}

// Production-grade parameters per OWASP 2024 guidance for password hashing.
// Memory: 128 MiB, time cost: 4, parallelism: 2.
// These are intentionally heavier than the prior 64 MiB / t=3 defaults.
var DefaultParams = &Argon2Params{
	Memory:      128 * 1024, // 128 MiB
	Iterations:  4,
	Parallelism: 2,
	SaltLength:  16,
	KeyLength:   32,
}

// DummyHash is a precomputed hash with DefaultParams used for constant-time
// comparison when a user is not found. Without this, login latency leaks
// account existence (Argon2 only runs when the user exists). Set lazily.
var dummyHashCache string

// DummyVerify performs an Argon2id computation against a constant invalid
// hash so callers can spend the same CPU budget when a user lookup fails.
// This is the anti-enumeration step.
func DummyVerify() {
	if dummyHashCache == "" {
		h, err := HashPassword("anti-enumeration-dummy", DefaultParams)
		if err == nil {
			dummyHashCache = h
		}
	}
	if dummyHashCache != "" {
		_, _ = VerifyPassword("never-matches-this-input", dummyHashCache)
	}
}

func HashPin(pin string) (string, error) {
	return HashPassword(pin, DefaultParams)
}

func VerifyPin(pin, encodedHash string) (bool, error) {
	return VerifyPassword(pin, encodedHash)
}

func HashPassword(password string, params *Argon2Params) (string, error) {
	salt := make([]byte, params.SaltLength)
	if _, err := rand.Read(salt); err != nil {
		return "", fmt.Errorf("generate salt: %w", err)
	}

	key := argon2.IDKey(
		[]byte(password),
		salt,
		params.Iterations,
		params.Memory,
		params.Parallelism,
		params.KeyLength,
	)

	encoded := fmt.Sprintf(
		"$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s",
		argon2.Version,
		params.Memory,
		params.Iterations,
		params.Parallelism,
		base64.RawStdEncoding.EncodeToString(salt),
		base64.RawStdEncoding.EncodeToString(key),
	)

	return encoded, nil
}

func VerifyPassword(password, encodedHash string) (bool, error) {
	params, salt, key, err := decodeHash(encodedHash)
	if err != nil {
		return false, err
	}

	otherKey := argon2.IDKey(
		[]byte(password),
		salt,
		params.Iterations,
		params.Memory,
		params.Parallelism,
		params.KeyLength,
	)

	return subtle.ConstantTimeCompare(key, otherKey) == 1, nil
}

func decodeHash(encodedHash string) (*Argon2Params, []byte, []byte, error) {
	parts := strings.Split(encodedHash, "$")
	if len(parts) != 6 {
		return nil, nil, nil, fmt.Errorf("invalid hash format")
	}

	var version int
	if _, err := fmt.Sscanf(parts[2], "v=%d", &version); err != nil {
		return nil, nil, nil, fmt.Errorf("parse version: %w", err)
	}

	params := &Argon2Params{}
	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &params.Memory, &params.Iterations, &params.Parallelism); err != nil {
		return nil, nil, nil, fmt.Errorf("parse params: %w", err)
	}

	salt, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil {
		return nil, nil, nil, fmt.Errorf("decode salt: %w", err)
	}
	params.SaltLength = uint32(len(salt))

	key, err := base64.RawStdEncoding.DecodeString(parts[5])
	if err != nil {
		return nil, nil, nil, fmt.Errorf("decode key: %w", err)
	}
	params.KeyLength = uint32(len(key))

	return params, salt, key, nil
}
