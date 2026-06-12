package b2b

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"io"
	"strings"
)

// Cipher encrypts webhook signing secrets at rest (AES-256-GCM, key hashed
// from an operator-provided value — derive it from JWT_SECRET like the TOTP
// secrets). A nil/zero Cipher is a no-op passthrough so the package still
// works without a key configured (e.g. older deployments).
type Cipher struct {
	aead cipher.AEAD
}

const encPrefix = "enc:"

// NewCipher builds a Cipher from any non-empty key material. Empty key →
// passthrough cipher.
func NewCipher(key []byte) *Cipher {
	if len(key) == 0 {
		return &Cipher{}
	}
	sum := sha256.Sum256(key)
	block, err := aes.NewCipher(sum[:])
	if err != nil {
		return &Cipher{}
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return &Cipher{}
	}
	return &Cipher{aead: aead}
}

// Encrypt returns "enc:" + base64(nonce || ciphertext); plaintext passthrough
// when no key is configured.
func (c *Cipher) Encrypt(plain string) (string, error) {
	if c == nil || c.aead == nil {
		return plain, nil
	}
	nonce := make([]byte, c.aead.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}
	blob := c.aead.Seal(nonce, nonce, []byte(plain), nil)
	return encPrefix + base64.StdEncoding.EncodeToString(blob), nil
}

// Decrypt reverses Encrypt. Values without the "enc:" prefix are returned
// as-is (legacy plaintext rows).
func (c *Cipher) Decrypt(stored string) (string, error) {
	if !strings.HasPrefix(stored, encPrefix) {
		return stored, nil
	}
	if c == nil || c.aead == nil {
		return "", errors.New("b2b: encrypted secret but no cipher key configured")
	}
	blob, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(stored, encPrefix))
	if err != nil {
		return "", err
	}
	ns := c.aead.NonceSize()
	if len(blob) < ns {
		return "", errors.New("b2b: ciphertext too short")
	}
	plain, err := c.aead.Open(nil, blob[:ns], blob[ns:], nil)
	if err != nil {
		return "", err
	}
	return string(plain), nil
}
