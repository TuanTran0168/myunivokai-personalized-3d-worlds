package httpx

import (
	"context"
	"sync"
)

type requestIDKey struct{}
type clientIPKey struct{}
type errorCodeKey struct{}

func WithRequestID(ctx context.Context, requestID string) context.Context {
	return context.WithValue(ctx, requestIDKey{}, requestID)
}

func RequestID(ctx context.Context) string {
	requestID, _ := ctx.Value(requestIDKey{}).(string)
	return requestID
}

func WithClientIP(ctx context.Context, clientIP string) context.Context {
	return context.WithValue(ctx, clientIPKey{}, clientIP)
}

func ClientIP(ctx context.Context) string {
	clientIP, _ := ctx.Value(clientIPKey{}).(string)
	return clientIP
}

// errorCodeRecorder is a one-slot mailbox carried on the request context so
// that the code WriteError chose can be read again after the handler chain has
// returned.
//
// A context value has to be a mutable cell for this, because a context cannot
// be replaced from inside the handler that WriteError was called from. The
// alternative - passing a code back up through every handler signature - would
// touch every route in the gateway to serve one optional counter.
//
// It is installed by exactly one caller (the telemetry middleware) and only
// when telemetry is enabled. With telemetry off nothing installs it, and
// recordErrorCode below is a context lookup that finds nothing.
type errorCodeRecorder struct {
	mutex sync.Mutex
	code  string
}

// WithErrorCodeRecorder attaches a fresh recorder to a request's context.
func WithErrorCodeRecorder(ctx context.Context) context.Context {
	return context.WithValue(ctx, errorCodeKey{}, &errorCodeRecorder{})
}

// RecordedErrorCode returns the first error code written for this request, or
// "" if the request produced no error body or no recorder was installed.
func RecordedErrorCode(ctx context.Context) string {
	recorder, found := ctx.Value(errorCodeKey{}).(*errorCodeRecorder)
	if !found {
		return ""
	}
	recorder.mutex.Lock()
	defer recorder.mutex.Unlock()
	return recorder.code
}

// recordErrorCode keeps the FIRST code, not the last. Only one response is
// ever written, and the first WriteError is the call that wrote it; a later
// one - from a deferred handler, say - describes something the client never
// saw.
func recordErrorCode(ctx context.Context, code string) {
	recorder, found := ctx.Value(errorCodeKey{}).(*errorCodeRecorder)
	if !found {
		return
	}
	recorder.mutex.Lock()
	defer recorder.mutex.Unlock()
	if recorder.code == "" {
		recorder.code = code
	}
}
