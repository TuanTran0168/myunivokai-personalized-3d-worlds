package middleware

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/httpx"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/telemetry"
)

// Telemetry records one bucket per served request.
//
// It is registered only when TELEMETRY_ENABLED is set, so with telemetry off
// none of this runs: no wrapper, no context value, no map lookup. That is the
// point of building it as its own middleware rather than folding the counters
// into Logging, which is always on.
//
// The recording happens AFTER next.ServeHTTP returns, because that is the only
// moment chi's route context holds the matched template. Reading it before
// would yield an empty pattern for every request, and reading request.URL.Path
// instead would put a world id in a bucket key - see internal/telemetry's
// package comment for why that ends the pipeline.
func Telemetry(collector *telemetry.Collector) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
			startTime := time.Now()
			recordingRequest := request.WithContext(httpx.WithErrorCodeRecorder(request.Context()))
			wrappedWriter := &telemetryStatusWriter{ResponseWriter: responseWriter, status: http.StatusOK}

			next.ServeHTTP(wrappedWriter, recordingRequest)

			collector.RecordHTTPRequest(
				routePatternOf(recordingRequest),
				request.Method,
				wrappedWriter.status,
				time.Since(startTime),
				httpx.RecordedErrorCode(recordingRequest.Context()),
			)
		})
	}
}

// routePatternOf reads chi's matched template, collapsing everything unmatched
// into one key.
//
// A 404 has no template, and a sweep of random URLs against a public gateway
// is a routine event - one bucket per probed URL would be exactly the
// unbounded growth this design exists to prevent, arriving through the one
// path that has no route to key on.
func routePatternOf(request *http.Request) string {
	routeContext := chi.RouteContext(request.Context())
	if routeContext == nil {
		return telemetry.UnmatchedRoutePattern
	}
	routePattern := routeContext.RoutePattern()
	// "/*" is what chi reports for a mount that matched nothing beneath it,
	// which is a miss wearing a pattern.
	if routePattern == "" || routePattern == "/*" {
		return telemetry.UnmatchedRoutePattern
	}
	return routePattern
}

// telemetryStatusWriter captures the status the same way Logging's own wrapper
// does. The duplication is deliberate: the two middlewares have independent
// lifetimes - Logging ships in every deploy, this one is switched off by
// default - and sharing one wrapper would couple them for the sake of a single
// int.
type telemetryStatusWriter struct {
	http.ResponseWriter
	status int
}

func (writer *telemetryStatusWriter) WriteHeader(status int) {
	writer.status = status
	writer.ResponseWriter.WriteHeader(status)
}

// Unwrap keeps http.ResponseController working through this wrapper, exactly
// as Logging's does. Without it, anything reaching for Flush or SetWriteDeadline
// through the chain stops at this struct.
func (writer *telemetryStatusWriter) Unwrap() http.ResponseWriter {
	return writer.ResponseWriter
}
