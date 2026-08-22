package handlers

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
)

// analyticsReadRoutes is every admin route that answers from the read model,
// with the permission it requires. Adding another analytics route without
// adding it here means it is never checked against the rules below — which is
// exactly what happened to /service-starts, added with the fleet work and
// listed here only once a later route noticed the omission.
var analyticsReadRoutes = []struct {
	path       string
	permission contracts.PermissionCode
	subject    string
}{
	{"/api/admin/overview", contracts.PermissionChartRead, contracts.AnalyticsOverviewGetQuerySubject},
	{"/api/admin/timeseries", contracts.PermissionChartRead, contracts.AnalyticsTimeseriesGetQuerySubject},
	{"/api/admin/worlds", contracts.PermissionWorldRead, contracts.AnalyticsWorldListQuerySubject},
	{"/api/admin/worlds/2f1c9b2e-6d54-4a1f-9c3b-7e8a0d5f1234", contracts.PermissionWorldRead, contracts.AnalyticsWorldGetQuerySubject},
	{"/api/admin/jobs", contracts.PermissionJobRead, contracts.AnalyticsJobListQuerySubject},
	{"/api/admin/service-starts", contracts.PermissionChartRead, contracts.AnalyticsServiceStartListQuerySubject},
}

// domainServiceSubjectPrefixes are the subjects an admin read must never
// touch. This is the S4-ANALYTICS-005 requirement stated as a test: an admin
// page waits on auth and analytics only, never on a domain service that the
// free tier may have put to sleep. A future refactor that "helpfully" fans a
// world list out to universe/nature fails here.
var domainServiceSubjectPrefixes = []string{
	"myunivokai.queries.universe.",
	"myunivokai.queries.nature.",
	"myunivokai.queries.dna.",
	"myunivokai.commands.",
}

func TestAnalyticsAdminRoutesQueryAnalyticsAndNoDomainService(t *testing.T) {
	for _, route := range analyticsReadRoutes {
		t.Run(route.path, func(t *testing.T) {
			payload, err := contracts.SuccessRPCEnvelope("request-analytics", http.StatusOK, map[string]any{"ok": true})
			if err != nil {
				t.Fatal(err)
			}
			brokerClient := &fakeBroker{responsesBySubject: map[string]contracts.Envelope[contracts.RPCResponseData]{
				contracts.AuthTokenVersionQuerySubject:       tokenVersionResponseEnvelope(t),
				contracts.AuthAccountPermissionsQuerySubject: accountPermissionsResponseEnvelope(t, []string{string(route.permission)}, false),
				route.subject:                                payload,
			}}
			router := NewRouter(testAdminGatewayConfig(), brokerClient, newFakeEdgeStore(), nil, nil)
			request := httptest.NewRequest(http.MethodGet, route.path+"?family=universe&pageSize=25&days=30", nil)
			request.AddCookie(&http.Cookie{Name: "myunivokai_admin_access", Value: mintAdminAccessToken(t, "account-1")})
			response := httptest.NewRecorder()
			router.ServeHTTP(response, request)

			if response.Code != http.StatusOK {
				t.Fatalf("status = %d, body=%s", response.Code, response.Body.String())
			}
			sawAnalyticsSubject := false
			for _, subject := range brokerClient.requestedSubjects {
				for _, forbiddenPrefix := range domainServiceSubjectPrefixes {
					if strings.HasPrefix(subject, forbiddenPrefix) {
						t.Fatalf("%s published %q; an admin read must never reach a domain service", route.path, subject)
					}
				}
				if subject == route.subject {
					sawAnalyticsSubject = true
				}
			}
			if !sawAnalyticsSubject {
				t.Fatalf("%s never published %q; requested %v", route.path, route.subject, brokerClient.requestedSubjects)
			}
		})
	}
}

func TestAnalyticsAdminRoutesRejectWithoutTheirPermission(t *testing.T) {
	for _, route := range analyticsReadRoutes {
		t.Run(route.path, func(t *testing.T) {
			brokerClient := &fakeBroker{responsesBySubject: map[string]contracts.Envelope[contracts.RPCResponseData]{
				contracts.AuthTokenVersionQuerySubject: tokenVersionResponseEnvelope(t),
				// A staff member holding only account:read must not be able
				// to read business data or job diagnostics.
				contracts.AuthAccountPermissionsQuerySubject: accountPermissionsResponseEnvelope(t, []string{string(contracts.PermissionAccountRead)}, false),
			}}
			router := NewRouter(testAdminGatewayConfig(), brokerClient, newFakeEdgeStore(), nil, nil)
			request := httptest.NewRequest(http.MethodGet, route.path, nil)
			request.AddCookie(&http.Cookie{Name: "myunivokai_admin_access", Value: mintAdminAccessToken(t, "account-1")})
			response := httptest.NewRecorder()
			router.ServeHTTP(response, request)
			if response.Code != http.StatusForbidden {
				t.Fatalf("status = %d, want 403, body=%s", response.Code, response.Body.String())
			}
		})
	}
}

// An absent ?published= must mean "every world", not "only unpublished
// ones" — the difference between a nil filter and a false one, which is why
// the query type carries a pointer.
func TestPublishedFilterDistinguishesAbsentFromFalse(t *testing.T) {
	cases := map[string]*bool{
		"":          nil,
		"nonsense":  nil,
		"true":      boolPointer(true),
		"false":     boolPointer(false),
		"1":         boolPointer(true),
		"0":         boolPointer(false),
		"  true  ":  boolPointer(true),
		" \tfalse ": boolPointer(false),
	}
	for rawValue, expected := range cases {
		query := url.Values{"published": []string{rawValue}}
		request := httptest.NewRequest(http.MethodGet, "/api/admin/worlds?"+query.Encode(), nil)
		actual := boolFromQuery(request, "published")
		switch {
		case expected == nil && actual != nil:
			t.Fatalf("published=%q parsed to %v, want no filter", rawValue, *actual)
		case expected != nil && actual == nil:
			t.Fatalf("published=%q parsed to no filter, want %v", rawValue, *expected)
		case expected != nil && *expected != *actual:
			t.Fatalf("published=%q parsed to %v, want %v", rawValue, *actual, *expected)
		}
	}
}

func boolPointer(value bool) *bool {
	return &value
}
