package contracts

import (
	"strings"
	"testing"
)

// Every valid family has a claim subject, and none of them collides.
//
// Written as a loop over the family registry rather than as three assertions,
// because the failure this guards is adding a FOURTH family: ClaimCommandSubject's
// default branch returns an error, and a family whose claim subject is an
// error is a family whose worlds silently cannot be claimed. There is no
// caller anywhere that would report it — dna-service's fan-out would fail the
// whole transaction and retry for ever.
func TestEveryFamilyHasItsOwnClaimCommandSubject(t *testing.T) {
	// Enumerated from allowedWorldStylesByFamily rather than from a list
	// written here, because that map is the registry a new family cannot skip:
	// a family missing from it has no world styles and cannot pass validation
	// at all. A list of three in this file would go on passing while a fourth
	// family shipped with no claim subject.
	if len(allowedWorldStylesByFamily) == 0 {
		t.Fatal("there are no families at all; this test would otherwise pass by finding nothing to contradict")
	}
	subjectOwners := map[string]WorldFamily{}
	for family := range allowedWorldStylesByFamily {
		if !family.Valid() {
			t.Fatalf("%q is a registered family but Valid() refuses it", family)
		}
		subject, err := family.ClaimCommandSubject()
		if err != nil {
			t.Fatalf("family %q has no claim subject: %v", family, err)
		}
		if existingOwner, taken := subjectOwners[subject]; taken {
			t.Fatalf("%q is the claim subject of both %q and %q. One consumer would take the other family's claims off a WorkQueue stream and apply them to its own database, where they match nothing", subject, existingOwner, family)
		}
		subjectOwners[subject] = family
		// A command, not a query and not an event. The distinction is enforced
		// by the broker: nats-server.conf grants publish permission per
		// prefix, so a claim subject under queries.> would be refused at
		// runtime by a service that compiles perfectly.
		if !strings.HasPrefix(subject, "myunivokai.commands.") {
			t.Errorf("claim subject %q is not under myunivokai.commands. A claim is durable work with nobody waiting for the answer; the ACLs and the stream filter are both keyed on that prefix", subject)
		}
		if !strings.Contains(subject, string(family)) {
			t.Errorf("claim subject %q does not name family %q, so an operator reading the stream cannot tell which service it belongs to", subject, family)
		}
	}
	if _, err := WorldFamily("plateau").ClaimCommandSubject(); err == nil {
		t.Error("an unsupported family was given a claim subject. A subject invented from an unknown family string is one no service subscribes to and no user may publish")
	}
}

// The gateway's single claim subject is DNA's, and it is not one of the three
// family ones. That asymmetry IS the design: the gateway may publish exactly
// one command subject, and dna-service is the only service that knows which
// families a visitor used.
func TestTheGatewaysClaimSubjectIsDNAsAndNotAFamilys(t *testing.T) {
	if !strings.HasPrefix(ClaimDNAWorldsCommandSubject, "myunivokai.commands.dna.") {
		t.Fatalf("the gateway's claim subject is %q, which is not DNA's. nats-server.conf admits the gateway on one command prefix only", ClaimDNAWorldsCommandSubject)
	}
	for _, familySubject := range []string{ClaimUniverseWorldsCommandSubject, ClaimNatureWorldsCommandSubject, ClaimOceanWorldsCommandSubject} {
		if familySubject == ClaimDNAWorldsCommandSubject {
			t.Fatalf("%q is both the fan-in and a fan-out subject. dna-service subscribes to the first and publishes the second, so one subject would be a loop", familySubject)
		}
	}
}

// A claim is refused unless both halves are UUIDs, and the empty account id is
// the case worth naming: it would be an UPDATE that sets owner_account_id to
// nothing across every unowned profile carrying that anonymous id.
func TestWorldClaimDataRequiresTwoUUIDs(t *testing.T) {
	const accountID = "11111111-1111-1111-1111-111111111111"
	const anonymousID = "22222222-2222-2222-2222-222222222222"

	claims := []struct {
		description string
		data        WorldClaimData
		valid       bool
	}{
		{description: "two UUIDs", data: WorldClaimData{AccountID: accountID, AnonymousID: anonymousID}, valid: true},
		{description: "uppercase, which Postgres accepts", data: WorldClaimData{AccountID: strings.ToUpper(accountID), AnonymousID: anonymousID}, valid: true},
		{description: "surrounding whitespace", data: WorldClaimData{AccountID: " " + accountID + " ", AnonymousID: anonymousID}, valid: true},
		{description: "nothing at all", data: WorldClaimData{}},
		{description: "no account id", data: WorldClaimData{AnonymousID: anonymousID}},
		{description: "no anonymous id", data: WorldClaimData{AccountID: accountID}},
		{description: "a word", data: WorldClaimData{AccountID: accountID, AnonymousID: "mine"}},
		{description: "a UUID with braces", data: WorldClaimData{AccountID: "{" + accountID + "}", AnonymousID: anonymousID}},
		{description: "a UUID with no dashes", data: WorldClaimData{AccountID: strings.ReplaceAll(accountID, "-", ""), AnonymousID: anonymousID}},
		{description: "SQL in the anonymous id", data: WorldClaimData{AccountID: accountID, AnonymousID: "' OR '1'='1"}},
	}
	for _, claim := range claims {
		t.Run(claim.description, func(t *testing.T) {
			err := claim.data.Validate()
			if claim.valid && err != nil {
				t.Fatalf("a valid claim was refused: %v", err)
			}
			if !claim.valid && err == nil {
				t.Fatal("an invalid claim was accepted")
			}
		})
	}
}
