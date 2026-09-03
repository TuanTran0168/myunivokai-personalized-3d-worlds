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
	generateCommandSubject       = "myunivokai.commands.dna.generate.v1"
	commandSubjectPrefix         = "myunivokai.commands."
	gatewayConfigurationUser     = "NATS_GATEWAY_USERNAME"
	dnaServiceConfigurationUser  = "NATS_DNA_USERNAME"
	bootstrapConfigurationUser   = "NATS_BOOTSTRAP_USERNAME"
	commandPublishersByDesignNot = "a service that can publish a command subject can forge the identity on it"
)

// This is the negative case S8-IDENTITY-008 asks for, and it is the assertion
// the whole ownership design leans on.
//
// A family service does not verify the `ownerAccountId` it receives, and
// cannot: it holds no public key and never sees a token. It is right to trust
// the field anyway, for exactly one reason — the gateway is the only publisher
// the broker will admit on the command subject, and the gateway sets the field
// from a signature it verified itself. The trust boundary is this file.
//
// That makes it a claim about configuration rather than about Go, so it is
// checked against the configuration. A second publisher added here would move
// the boundary silently: every test in every service would still pass, and
// ownership would quietly become something a caller can assert about itself.
func TestOnlyTheGatewayMayPublishTheGenerateCommand(t *testing.T) {
	publishPermissions := readNATSPublishPermissions(t)

	gatewayPermission, found := publishPermissions[gatewayConfigurationUser]
	if !found {
		t.Fatalf("the gateway has no user block in %s", natsServerConfigurationPath)
	}
	if !strings.Contains(gatewayPermission, generateCommandSubject) {
		t.Fatalf("the gateway may no longer publish %s, so no world can be created at all", generateCommandSubject)
	}

	for user, permission := range publishPermissions {
		if user == gatewayConfigurationUser || user == bootstrapConfigurationUser {
			continue
		}
		if strings.Contains(permission, generateCommandSubject) {
			t.Errorf("%s may publish %s. Only the gateway may: %s", user, generateCommandSubject, commandPublishersByDesignNot)
		}
	}
}

// The same boundary one hop downstream. dna-service copies the owner onto the
// compose command, and a family service trusts THAT for the same reason: only
// dna-service can reach a compose subject.
func TestOnlyDNAServiceMayPublishAComposeCommand(t *testing.T) {
	publishPermissions := readNATSPublishPermissions(t)

	dnaPermission, found := publishPermissions[dnaServiceConfigurationUser]
	if !found {
		t.Fatalf("dna-service has no user block in %s", natsServerConfigurationPath)
	}
	if !strings.Contains(dnaPermission, commandSubjectPrefix) {
		t.Fatal("dna-service may no longer publish any compose command, so no world can be composed at all")
	}

	for user, permission := range publishPermissions {
		if user == dnaServiceConfigurationUser || user == bootstrapConfigurationUser {
			continue
		}
		for _, subject := range strings.Split(permission, ",") {
			subject = strings.Trim(strings.TrimSpace(subject), `"`)
			if !strings.HasPrefix(subject, commandSubjectPrefix) {
				continue
			}
			if user == gatewayConfigurationUser && subject == generateCommandSubject {
				continue
			}
			t.Errorf("%s may publish the command subject %s. Only dna-service may reach a compose subject: %s", user, subject, commandPublishersByDesignNot)
		}
	}
}

// A wildcard is the other way the boundary disappears, and it disappears
// without any subject being named — which is why it is checked separately
// rather than left to the two tests above.
func TestNoServiceMayPublishACommandWildcard(t *testing.T) {
	for user, permission := range readNATSPublishPermissions(t) {
		if user == bootstrapConfigurationUser {
			// The local stack's setup user, which creates the streams. It is
			// not a service and does not exist in production, where every
			// service shares one Synadia account user instead.
			continue
		}
		if strings.Contains(permission, commandSubjectPrefix+">") || strings.Contains(permission, `"myunivokai.>"`) {
			t.Errorf("%s may publish a command wildcard. Every command subject is granted literally so that adding a service cannot silently grant it the right to forge an identity", user)
		}
	}
}

// readNATSPublishPermissions returns each configured user's publish grant
// exactly as written, keyed by the environment variable naming that user.
// Parsed rather than unmarshalled because the file is NATS's own config
// dialect, and because the thing under test is the literal text somebody
// edits.
func readNATSPublishPermissions(t *testing.T) map[string]string {
	t.Helper()
	contents, err := os.ReadFile(natsServerConfigurationPath)
	if err != nil {
		t.Fatalf("read %s: %v", natsServerConfigurationPath, err)
	}
	configuration := string(contents)

	userPattern := regexp.MustCompile(`user:\s*\$(\w+)`)
	publishPattern := regexp.MustCompile(`publish:\s*(\[[^\]]*\]|"[^"]*")`)

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
		publishMatch := publishPattern.FindStringSubmatch(block)
		if publishMatch == nil {
			t.Fatalf("%s has no publish permission at all, which this test cannot tell apart from a parse failure", userName)
		}
		permissions[userName] = publishMatch[1]
	}
	return permissions
}
