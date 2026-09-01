package security

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"

	"golang.org/x/crypto/argon2"
)

const argon2idVariant = "argon2id"

var ErrPasswordMismatch = errors.New("password does not match")

// PasswordHasher wraps golang.org/x/crypto/argon2's IDKey with parameters
// tuned for a 512 MB free-plan instance rather than the library defaults -
// see agent-system/plans/services/auth-and-admin-plan.md#passwords.
type PasswordHasher struct {
	memoryKiB   uint32
	iterations  uint32
	parallelism uint8
	saltLength  uint32
	keyLength   uint32
}

func NewPasswordHasher(memoryKiB, iterations uint32, parallelism uint8, saltLength, keyLength uint32) PasswordHasher {
	return PasswordHasher{memoryKiB: memoryKiB, iterations: iterations, parallelism: parallelism, saltLength: saltLength, keyLength: keyLength}
}

// Hash produces a self-describing encoded string so the cost parameters can
// be raised later without invalidating hashes stored under the old ones.
func (hasher PasswordHasher) Hash(password string) (string, error) {
	salt := make([]byte, hasher.saltLength)
	if _, err := rand.Read(salt); err != nil {
		return "", fmt.Errorf("generate salt: %w", err)
	}
	key := argon2.IDKey([]byte(password), salt, hasher.iterations, hasher.memoryKiB, hasher.parallelism, hasher.keyLength)
	encodedSalt := base64.RawStdEncoding.EncodeToString(salt)
	encodedKey := base64.RawStdEncoding.EncodeToString(key)
	return fmt.Sprintf("$%s$v=%d$m=%d,t=%d,p=%d$%s$%s", argon2idVariant, argon2.Version, hasher.memoryKiB, hasher.iterations, hasher.parallelism, encodedSalt, encodedKey), nil
}

// Verify recomputes the hash using the parameters embedded in the encoded
// string, not the hasher's current configuration, so a stored hash keeps
// verifying correctly across a future cost increase.
func (hasher PasswordHasher) Verify(password, encodedHash string) error {
	variant, version, memoryKiB, iterations, parallelism, salt, key, err := decodeHash(encodedHash)
	if err != nil {
		return err
	}
	if variant != argon2idVariant || version != argon2.Version {
		return errors.New("unsupported password hash variant")
	}
	candidateKey := argon2.IDKey([]byte(password), salt, iterations, memoryKiB, parallelism, uint32(len(key)))
	if subtle.ConstantTimeCompare(candidateKey, key) != 1 {
		return ErrPasswordMismatch
	}
	return nil
}

func decodeHash(encodedHash string) (variant string, version int, memoryKiB, iterations uint32, parallelism uint8, salt, key []byte, err error) {
	parts := strings.Split(encodedHash, "$")
	if len(parts) != 6 {
		return "", 0, 0, 0, 0, nil, nil, errors.New("malformed password hash")
	}
	variant = parts[1]
	if _, scanErr := fmt.Sscanf(parts[2], "v=%d", &version); scanErr != nil {
		return "", 0, 0, 0, 0, nil, nil, fmt.Errorf("parse hash version: %w", scanErr)
	}
	var memory, time, parallel int
	if _, scanErr := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &memory, &time, &parallel); scanErr != nil {
		return "", 0, 0, 0, 0, nil, nil, fmt.Errorf("parse hash parameters: %w", scanErr)
	}
	if salt, err = base64.RawStdEncoding.DecodeString(parts[4]); err != nil {
		return "", 0, 0, 0, 0, nil, nil, fmt.Errorf("decode hash salt: %w", err)
	}
	if key, err = base64.RawStdEncoding.DecodeString(parts[5]); err != nil {
		return "", 0, 0, 0, 0, nil, nil, fmt.Errorf("decode hash key: %w", err)
	}
	return variant, version, uint32(memory), uint32(time), uint8(parallel), salt, key, nil
}
