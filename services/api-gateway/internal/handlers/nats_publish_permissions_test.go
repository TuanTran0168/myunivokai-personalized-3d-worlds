package handlers

import (
	"os"
	"regexp"
	"strings"
	"testing"
)

// natsServerConfigurationPath is the local broker's permission file, relative
// to this package. Production runs one shared Synadia account user with no
// per-user allow-list, so this file is where the boundary is written down and
// where it can be checked.
const natsServerConfigurationPath = "../../../../infra/nats/nats-server.conf"

const (
	commandSubjectPrefix        = "myunivokai.commands."
	gatewayConfigurationUser    = "NATS_GATEWAY_USERNAME"
	dnaServiceConfigurationUser = "NATS_DNA_USERNAME"
	universeConfigurationUser   = "NATS_UNIVERSE_USERNAME"
	natureConfigurationUser     = "NATS_NATURE_USERNAME"
	oceanConfigurationUser      = "NATS_OCEAN_USERNAME"
	// bootstrapConfigurationUser is the local stack's setup user, which
	// creates the streams. It is not a service and does not exist in
	// production, where every service shares one Synadia account user.
	bootstrapConfigurationUser = "NATS_BOOTSTRAP_USERNAME"
)

// commandSubjectRoute is one command subject and the two users the broker
// admits on it. Nothing else may publish it, and a subscriber that is missing
// is a command that arrives nowhere.
type commandSubjectRoute struct {
	subject    string
	publisher  string
	subscriber string
}

// commandSubjectRoutes is the whole command half of the trust boundary as a
// table, and it is the assertion the entire ownership design leans on.
//
// A family service does not verify the `ownerAccountId` it receives, and
// cannot: it holds no public key and never sees a token. It is right to trust
// the field anyway, for exactly one reason — the gateway is the only publisher
// the broker admits on the generate subject, and the gateway sets the field
// from a signature it verified itself. One hop later, dna-service is the only
// publisher admitted on a compose or claim subject, which is what makes the
// same field trustworthy again.
//
// So the boundary is a claim about configuration rather than about Go, and it
// is checked against the configuration. A second publisher added to the file
// would move it silently: every Go test in every service would still pass,
// and ownership would quietly become something a caller can assert about
// itself.
//
// Written as a table rather than as one test per rule because the failure that
// actually happens is a subject being ADDED — the claim added four, and a
// per-rule test has to be remembered and edited, while a missing row here
// fails on its own.
var commandSubjectRoutes = []commandSubjectRoute{
	{subject: "myunivokai.commands.dna.generate.v1", publisher: gatewayConfigurationUser, subscriber: dnaServiceConfigurationUser},
	// The claim's fan-in. The gateway's second and only other command grant,
	// and it is DNA's rather than one per family because dna-service is the
	// only service that knows which families a visitor used.
	{subject: "myunivokai.commands.dna.world.claim.v1", publisher: gatewayConfigurationUser, subscriber: dnaServiceConfigurationUser},
	{subject: "myunivokai.commands.universe.compose.v1", publisher: dnaServiceConfigurationUser, subscriber: universeConfigurationUser},
	{subject: "myunivokai.commands.nature.compose.v1", publisher: dnaServiceConfigurationUser, subscriber: natureConfigurationUser},
	{subject: "myunivokai.commands.ocean.compose.v1", publisher: dnaServiceConfigurationUser, subscriber: oceanConfigurationUser},
	// The claim's fan-out, one per family.
	{subject: "myunivokai.commands.universe.world.claim.v1", publisher: dnaServiceConfigurationUser, subscriber: universeConfigurationUser},
	{subject: "myunivokai.commands.nature.world.claim.v1", publisher: dnaServiceConfigurationUser, subscriber: natureConfigurationUser},
	{subject: "myunivokai.commands.ocean.world.claim.v1", publisher: dnaServiceConfigurationUser, subscriber: oceanConfigurationUser},
}

// Each command subject is publishable by exactly the one user the table names.
//
// Both halves matter and they fail differently. A publisher that has LOST its
// grant is an outage — no world can be created, or no claim can be applied —
// and shows up as a runtime authorization error in a service that compiles
// perfectly. An EXTRA publisher is worse and quieter: a service that can
// publish a command subject can forge the identity on it.
func TestEachCommandSubjectHasExactlyOnePermittedPublisher(t *testing.T) {
	publishPermissions := readNATSPermissions(t, "publish")

	for _, route := range commandSubjectRoutes {
		grant, found := publishPermissions[route.publisher]
		if !found {
			t.Fatalf("%s has no user block in %s", route.publisher, natsServerConfigurationPath)
		}
		if !strings.Contains(grant, route.subject) {
			t.Errorf("%s may no longer publish %s. Nothing downstream of that subject can happen at all, and it fails as a runtime authorization error rather than at startup", route.publisher, route.subject)
		}
		for user, otherGrant := range publishPermissions {
			if user == route.publisher || user == bootstrapConfigurationUser {
				continue
			}
			if strings.Contains(otherGrant, route.subject) {
				t.Errorf("%s may publish %s, which only %s may. A service that can publish a command subject can forge the identity on it, and the identity is the whole of the ownership design", user, route.subject, route.publisher)
			}
		}
	}
}

// The other half: a command nobody may subscribe to is a command that arrives
// nowhere.
//
// This is the failure the claim would have shipped with. A missing subscribe
// grant produces no error anywhere — the publish succeeds, JetStream stores
// the message, the consumer's own subscription call fails at startup in a
// service nobody is watching, and the visitor's worlds simply stay anonymous.
func TestEachCommandSubjectHasAPermittedSubscriber(t *testing.T) {
	subscribePermissions := readNATSPermissions(t, "subscribe")

	for _, route := range commandSubjectRoutes {
		grant, found := subscribePermissions[route.subscriber]
		if !found {
			t.Fatalf("%s has no user block in %s", route.subscriber, natsServerConfigurationPath)
		}
		if !strings.Contains(grant, route.subject) {
			t.Errorf("%s may not subscribe to %s, so every message on it waits in the stream for a consumer that cannot exist", route.subscriber, route.subject)
		}
	}
}

// Every command subject the file names is in the table above.
//
// The table's own blind spot, closed: the two tests above prove the subjects
// they know about are wired correctly, and say nothing about a subject added
// to the configuration and to no test. This is what turns the table from a
// list of examples into the boundary itself.
func TestTheConfigurationNamesNoCommandSubjectThisTableDoesNot(t *testing.T) {
	tabledSubjects := map[string]bool{}
	for _, route := range commandSubjectRoutes {
		tabledSubjects[route.subject] = true
	}
	for _, permissionKey := range []string{"publish", "subscribe"} {
		for user, grant := range readNATSPermissions(t, permissionKey) {
			if user == bootstrapConfigurationUser {
				continue
			}
			for _, subject := range grantedSubjects(grant) {
				if !strings.HasPrefix(subject, commandSubjectPrefix) {
					continue
				}
				if !tabledSubjects[subject] {
					t.Errorf("%s has a %s grant on the command subject %s, which commandSubjectRoutes does not name. Add it there with its one publisher and its one subscriber, so the boundary stays written down in one place", user, permissionKey, subject)
				}
			}
		}
	}
}

// A wildcard is the other way the boundary disappears, and it disappears
// without any subject being named — which is why it is checked separately
// rather than left to the tests above.
func TestNoServiceMayPublishACommandWildcard(t *testing.T) {
	for user, grant := range readNATSPermissions(t, "publish") {
		if user == bootstrapConfigurationUser {
			continue
		}
		if strings.Contains(grant, commandSubjectPrefix+">") || strings.Contains(grant, `"myunivokai.>"`) {
			t.Errorf("%s may publish a command wildcard. Every command subject is granted literally so that adding a service cannot silently grant it the right to forge an identity", user)
		}
	}
}

// grantedSubjects splits one grant into the literal subjects it lists.
func grantedSubjects(grant string) []string {
	subjects := make([]string, 0, strings.Count(grant, ",")+1)
	for _, rawSubject := range strings.Split(grant, ",") {
		subjects = append(subjects, strings.Trim(strings.TrimSpace(rawSubject), `[]"`))
	}
	return subjects
}

// readNATSPermissions returns each configured user's grant for one permission
// key, exactly as written, keyed by the environment variable naming that user.
// Parsed rather than unmarshalled because the file is NATS's own config
// dialect, and because the thing under test is the literal text somebody
// edits.
func readNATSPermissions(t *testing.T, permissionKey string) map[string]string {
	t.Helper()
	contents, err := os.ReadFile(natsServerConfigurationPath)
	if err != nil {
		t.Fatalf("read %s: %v", natsServerConfigurationPath, err)
	}
	configuration := string(contents)

	userPattern := regexp.MustCompile(`user:\s*\$(\w+)`)
	grantPattern := regexp.MustCompile(permissionKey + `:\s*(\[[^\]]*\]|"[^"]*")`)

	userMatches := userPattern.FindAllStringSubmatchIndex(configuration, -1)
	if len(userMatches) == 0 {
		t.Fatalf("no user blocks were found in %s; this test would otherwise pass by finding nothing to contradict", natsServerConfigurationPath)
	}
	permissions := make(map[string]string, len(userMatches))
	for matchIndex, match := range userMatches {
		userName := configuration[match[2]:match[3]]
		blockEnd := len(configuration)
		if matchIndex+1 < len(userMatches) {
			blockEnd = userMatches[matchIndex+1][0]
		}
		block := configuration[match[1]:blockEnd]
		grantMatch := grantPattern.FindStringSubmatch(block)
		if grantMatch == nil {
			t.Fatalf("%s has no %s permission at all, which this test cannot tell apart from a parse failure", userName, permissionKey)
		}
		permissions[userName] = grantMatch[1]
	}
	return permissions
}
