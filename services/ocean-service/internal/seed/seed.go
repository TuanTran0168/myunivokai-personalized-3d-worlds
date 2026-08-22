package seed

import (
	"crypto/rand"
	"encoding/base32"
	"fmt"
	"strings"
)

// NewWorldSeed uses an OCN- prefix (universe-service uses WLD-, nature-service
// NAT-) so a seed's owning service is readable at a glance in logs and shared
// URLs.
func NewWorldSeed() (string, error) {
	suffix, err := randomBase32(10)
	if err != nil {
		return "", err
	}
	return "OCN-" + suffix, nil
}

func NewVariantSeed(worldID string, variantNo int) (string, error) {
	suffix, err := randomBase32(4)
	if err != nil {
		return "", err
	}
	short := strings.ToUpper(strings.ReplaceAll(worldID, "-", ""))
	if len(short) > 3 {
		short = short[:3]
	}
	return fmt.Sprintf("VAR-%s-%d-%s", short, variantNo, suffix), nil
}

const defaultShareSlugSuffixLength = 10

// NewShareSlugSuffix returns a lowercase random suffix for public share slugs.
// A fresh suffix is generated on every publish retry, so collisions resolve
// instead of failing the request.
func NewShareSlugSuffix(length int) (string, error) {
	if length <= 0 {
		length = defaultShareSlugSuffixLength
	}
	suffix, err := randomBase32(length)
	if err != nil {
		return "", err
	}
	return strings.ToLower(suffix), nil
}

func randomBase32(length int) (string, error) {
	buf := make([]byte, length)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	encoded := base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(buf)
	if len(encoded) > length {
		encoded = encoded[:length]
	}
	return encoded, nil
}
