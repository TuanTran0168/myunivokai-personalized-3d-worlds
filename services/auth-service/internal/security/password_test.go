package security

import "testing"

func testHasher() PasswordHasher {
	// Deliberately cheap parameters so the test suite stays fast; production
	// values live in .env.example, tuned for a real instance.
	return NewPasswordHasher(64*1024, 1, 1, 16, 32)
}

func TestPasswordHasher_HashAndVerify_RoundTrips(t *testing.T) {
	hasher := testHasher()
	encodedHash, err := hasher.Hash("a-strong-password")
	if err != nil {
		t.Fatalf("hash: %v", err)
	}
	if err := hasher.Verify("a-strong-password", encodedHash); err != nil {
		t.Fatalf("expected matching password to verify, got %v", err)
	}
}

func TestPasswordHasher_Verify_RejectsWrongPassword(t *testing.T) {
	hasher := testHasher()
	encodedHash, err := hasher.Hash("a-strong-password")
	if err != nil {
		t.Fatalf("hash: %v", err)
	}
	if err := hasher.Verify("a-different-password", encodedHash); err != ErrPasswordMismatch {
		t.Fatalf("expected ErrPasswordMismatch, got %v", err)
	}
}

func TestPasswordHasher_Hash_ProducesDistinctSaltsPerCall(t *testing.T) {
	hasher := testHasher()
	firstHash, err := hasher.Hash("same-password")
	if err != nil {
		t.Fatalf("hash: %v", err)
	}
	secondHash, err := hasher.Hash("same-password")
	if err != nil {
		t.Fatalf("hash: %v", err)
	}
	if firstHash == secondHash {
		t.Fatal("expected two hashes of the same password to differ by salt")
	}
}

func TestPasswordHasher_Verify_RejectsMalformedHash(t *testing.T) {
	hasher := testHasher()
	if err := hasher.Verify("anything", "not-a-real-hash"); err == nil {
		t.Fatal("expected a malformed hash to fail verification")
	}
}
