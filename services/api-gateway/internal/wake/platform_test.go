package wake

import (
	"testing"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
)

// TestServiceForSubjectNamesTheResponderOfEveryQuerySubject is the drift guard
// for the derivation in ServiceForSubject. Subjects are taken from the
// contract constants rather than written out as strings, so renaming a subject
// in contracts/go breaks this test instead of silently producing a service the
// gateway can no longer wake.
func TestServiceForSubjectNamesTheResponderOfEveryQuerySubject(t *testing.T) {
	testCases := map[string]struct {
		subject         string
		expectedService string
	}{
		"dna job":              {contracts.DNAJobGetQuerySubject, ServiceDNA},
		"universe world get":   {contracts.UniverseWorldGetQuerySubject, ServiceUniverse},
		"universe variant":     {contracts.UniverseVariantSelectSubject, ServiceUniverse},
		"universe share":       {contracts.UniverseShareGetQuerySubject, ServiceUniverse},
		"nature world list":    {contracts.NatureWorldListQuerySubject, ServiceNature},
		"nature publish":       {contracts.NatureWorldPublishSubject, ServiceNature},
		"auth login":           {contracts.AuthLoginQuerySubject, ServiceAuth},
		"auth account list":    {contracts.AuthAccountListQuerySubject, ServiceAuth},
		"auth permissions":     {contracts.AuthAccountPermissionsQuerySubject, ServiceAuth},
		"analytics overview":   {contracts.AnalyticsOverviewGetQuerySubject, ServiceAnalytics},
		"analytics world list": {contracts.AnalyticsWorldListQuerySubject, ServiceAnalytics},
		"analytics timeseries": {contracts.AnalyticsTimeseriesGetQuerySubject, ServiceAnalytics},
		// telemetry needed no branch of its own. Its query subjects follow the
		// same myunivokai.queries.<service>.* shape as everyone else's, which
		// is exactly why joining the wake mechanism cost two list entries and
		// no request-path change.
		"telemetry overview": {contracts.TelemetryOverviewGetQuerySubject, ServiceTelemetry},
		"telemetry routes":   {contracts.TelemetryRouteListQuerySubject, ServiceTelemetry},
		// The rollup event is not a query. It travels over JetStream, which
		// holds it for a sleeping consumer - the whole reason the gateway does
		// not need to wake telemetry-service in order to publish.
		"telemetry rollup event is not a query": {contracts.TelemetryHTTPRollupEventSubject, ""},
		// Commands and events travel over JetStream, which holds them for a
		// sleeping consumer rather than failing, so there is nothing to wake
		// reactively and nothing here should resolve to a service.
		"command is not a query": {contracts.GenerateDNACommandSubject, ""},
		"event is not a query":   {contracts.UniverseCompletedEventSubject, ""},
		"unknown service":        {"myunivokai.queries.city.world.get.v1", ""},
		"wrong prefix":           {"other.queries.dna.job.get.v1", ""},
		"empty":                  {"", ""},
		"prefix only":            {"myunivokai.queries.", ""},
	}
	for name, testCase := range testCases {
		t.Run(name, func(t *testing.T) {
			if service := ServiceForSubject(testCase.subject); service != testCase.expectedService {
				t.Fatalf("ServiceForSubject(%q) = %q, want %q", testCase.subject, service, testCase.expectedService)
			}
		})
	}
}

// TestEveryListedServiceIsResolvable keeps Services and ServiceForSubject from
// disagreeing: a name in Services that no subject resolves to would be a
// service an operator can configure a URL for and never see woken.
func TestEveryListedServiceIsResolvable(t *testing.T) {
	for _, service := range Services {
		if resolved := ServiceForSubject(querySubjectPrefix + service + ".anything.v1"); resolved != service {
			t.Fatalf("Services lists %q but ServiceForSubject does not resolve it (got %q)", service, resolved)
		}
	}
}

// TestRefusedSeparatesADeclinedCallFromABootingInstance is the guard on the
// one distinction DEFECT-WAKE-001 turned on. Production answered every wake
// call 429, and "wake call sent" was logged for all of them; the fix was to
// classify the status as a DELIVERY verdict while leaving readiness
// undecidable. Both halves are asserted here, because widening Refused to
// "any 4xx or 5xx" is the natural-looking change that breaks the useful half.
func TestRefusedSeparatesADeclinedCallFromABootingInstance(t *testing.T) {
	testCases := map[string]struct {
		statusCode      int
		expectedRefused bool
		reason          string
	}{
		"429 measured in production": {429, true, "the edge declined before routing; the origin was never asked"},
		"502 from a booting instance": {502, false, "a wake that DID happen - the instance is starting"},
		"503 while starting":          {503, false, "same as 502: the origin was reached"},
		"504 upstream timeout":        {504, false, "the origin was reached and was slow, which is a cold start"},
		"404 router not attached yet": {404, false, "documented on WakeObservation as a wake that happened"},
		"200 something answered":      {200, false, "delivered; whether it woke anything is not knowable here"},
		"no response at all":          {0, false, "no status means no verdict, not a refusal"},
	}

	for name, testCase := range testCases {
		t.Run(name, func(t *testing.T) {
			observation := WakeObservation{StatusCode: testCase.statusCode}
			if refused := observation.Refused(); refused != testCase.expectedRefused {
				t.Errorf("status %d: Refused() = %t, want %t — %s",
					testCase.statusCode, refused, testCase.expectedRefused, testCase.reason)
			}
		})
	}
}
