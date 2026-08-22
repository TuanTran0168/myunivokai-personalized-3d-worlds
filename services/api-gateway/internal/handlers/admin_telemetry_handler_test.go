package handlers

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
)

// telemetryReadRoutes is every admin route answered by telemetry-service.
// They are listed separately from analyticsReadRoutes rather than folded into
// it because they cross a different data boundary: a Telemetry page must not
// reach analytics-service any more than it may reach universe, and only a
// separate list can assert that.
var telemetryReadRoutes = []struct {
	path       string
	permission contracts.PermissionCode
	subject    string
}{
	{"/api/admin/telemetry/overview", contracts.PermissionChartRead, contracts.TelemetryOverviewGetQuerySubject},
	{"/api/admin/telemetry/routes", contracts.PermissionChartRead, contracts.TelemetryRouteListQuerySubject},
}

// Everything a Telemetry page must never publish. The domain services are the
// same prohibition every admin read carries; analytics is added because these
// two read models own different data and a relay that "helpfully" merged them
// would put one service's outage on the other's screen.
var telemetryForbiddenSubjectPrefixes = append(
	[]string{"myunivokai.queries.analytics."},
	domainServiceSubjectPrefixes...,
)

func TestTelemetryAdminRoutesQueryTelemetryAndNothingElse(t *testing.T) {
	for _, route := range telemetryReadRoutes {
		t.Run(route.path, func(t *testing.T) {
			payload, err := contracts.SuccessRPCEnvelope("request-telemetry", http.StatusOK, map[string]any{"sink": contracts.TelemetrySinkPostgres})
			if err != nil {
				t.Fatal(err)
			}
			brokerClient := &fakeBroker{responsesBySubject: map[string]contracts.Envelope[contracts.RPCResponseData]{
				contracts.AuthTokenVersionQuerySubject:       tokenVersionResponseEnvelope(t),
				contracts.AuthAccountPermissionsQuerySubject: accountPermissionsResponseEnvelope(t, []string{string(route.permission)}, false),
				route.subject: payload,
			}}
			router := NewRouter(testAdminGatewayConfig(), brokerClient, newFakeEdgeStore(), nil, nil)
			request := httptest.NewRequest(http.MethodGet, route.path+"?hours=24", nil)
			request.AddCookie(&http.Cookie{Name: "myunivokai_admin_access", Value: mintAdminAccessToken(t, "account-1")})
			response := httptest.NewRecorder()
			router.ServeHTTP(response, request)

			if response.Code != http.StatusOK {
				t.Fatalf("status = %d, body=%s", response.Code, response.Body.String())
			}
			sawTelemetrySubject := false
			for _, subject := range brokerClient.requestedSubjects {
				for _, forbiddenPrefix := range telemetryForbiddenSubjectPrefixes {
					if strings.HasPrefix(subject, forbiddenPrefix) {
						t.Fatalf("%s published %q; a telemetry read must reach telemetry-service and auth only", route.path, subject)
					}
				}
				if subject == route.subject {
					sawTelemetrySubject = true
				}
			}
			if !sawTelemetrySubject {
				t.Fatalf("%s never published %q; requested %v", route.path, route.subject, brokerClient.requestedSubjects)
			}
		})
	}
}

func TestTelemetryAdminRoutesRejectWithoutChartRead(t *testing.T) {
	for _, route := range telemetryReadRoutes {
		t.Run(route.path, func(t *testing.T) {
			brokerClient := &fakeBroker{responsesBySubject: map[string]contracts.Envelope[contracts.RPCResponseData]{
				contracts.AuthTokenVersionQuerySubject:       tokenVersionResponseEnvelope(t),
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

// The relay must not clamp the window. telemetry-service owns the tables the
// bound protects and applies NormalizeTelemetryHours itself; a second opinion
// here could only ever disagree with the first.
func TestTheTelemetryRelayPassesTheWindowThroughUntouched(t *testing.T) {
	cases := map[string]int{
		"?hours=6":    6,
		"?hours=9999": 9999,
		"?hours=-3":   -3,
		"?hours=":     0,
		"":            0,
		"?hours=soon": 0,
	}
	for query, expectedHours := range cases {
		t.Run(query, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodGet, "/api/admin/telemetry/overview"+query, nil)
			if actualHours := intFromQuery(request, "hours"); actualHours != expectedHours {
				t.Fatalf("hours = %d, want %d", actualHours, expectedHours)
			}
		})
	}
}
