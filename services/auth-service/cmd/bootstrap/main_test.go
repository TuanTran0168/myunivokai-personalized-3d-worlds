package main

import (
	"os"
	"strings"
	"testing"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
)

// S8-IDENTITY-003's bootstrap guardrail. This command is the only way an
// account comes to exist without another account creating it, so what it
// creates has to stay pinned: a staff account, super-admin, forced to change
// its password. The plan's §15 states "the bootstrap command stays staff-only"
// and this is what keeps that from being only a sentence in a document.
func TestBootstrapCreatesAStaffSuperAdminAndNothingElse(t *testing.T) {
	params := bootstrapAccountParams("  Operator@Example.COM ", "a-hash")

	if params.Kind != contracts.AccountKindStaff {
		t.Fatalf("kind = %q, want %q - bootstrap must never be a path to an end-user account", params.Kind, contracts.AccountKindStaff)
	}
	if !params.IsSuperAdmin {
		t.Fatal("bootstrap must create a super admin; it is the one bypass path back into an unadministerable system")
	}
	if !params.ForcePasswordChange {
		t.Fatal("bootstrap must force a password change: the operator typed this password on a command line")
	}
	if params.Email != "operator@example.com" {
		t.Fatalf("email = %q, want it lowercased and trimmed to match the store's own normalisation", params.Email)
	}
}

// The assertion above cannot catch a `--kind` flag being added, because such a
// flag would change what bootstrapAccountParams is given rather than what it
// returns. This reads the command's own source instead.
//
// A source-reading test is the right shape here and not a shortcut: the thing
// being forbidden is a value appearing anywhere in this package, which is a
// property of the text and not of any one function's behaviour.
func TestTheBootstrapCommandNeverMentionsTheEndUserKind(t *testing.T) {
	source, err := os.ReadFile("main.go")
	if err != nil {
		t.Fatalf("read the bootstrap command's source: %v", err)
	}
	if strings.Contains(string(source), "AccountKindEndUser") {
		t.Fatal("cmd/bootstrap names AccountKindEndUser; the only account this command may create is staff")
	}
	// A flag named for the kind would be the other route to the same place.
	for _, forbidden := range []string{`flag.String("kind"`, `flag.String("account-kind"`} {
		if strings.Contains(string(source), forbidden) {
			t.Fatalf("cmd/bootstrap declares %s; the account kind is not the operator's choice", forbidden)
		}
	}
}
