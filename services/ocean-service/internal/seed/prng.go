package seed

import (
	"hash/fnv"
	"math/rand"
)

// NewPRNG is a byte-identical copy of universe-service/internal/seed/prng.go.
// Keep the two in sync: both services derive every visual number from this
// exact FNV-64a → math/rand construction, so the determinism story stays one
// story across the fleet.
func NewPRNG(seed string) *rand.Rand {
	h := fnv.New64a()
	_, _ = h.Write([]byte(seed))
	return rand.New(rand.NewSource(int64(h.Sum64())))
}
