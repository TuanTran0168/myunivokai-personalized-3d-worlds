package httpx

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/rs/zerolog/log"
)

type ErrorBody struct {
	Code      string `json:"code"`
	Message   string `json:"message"`
	Details   any    `json:"details,omitempty"`
	RequestID string `json:"requestId,omitempty"`
}

type ErrorEnvelope struct {
	Error ErrorBody `json:"error"`
}

func WriteJSON(responseWriter http.ResponseWriter, status int, value any) {
	payload, err := json.Marshal(value)
	if err != nil {
		log.Error().Err(err).Msg("marshal json response")
		responseWriter.Header().Set("Content-Type", "application/json")
		responseWriter.WriteHeader(http.StatusInternalServerError)
		_, _ = responseWriter.Write([]byte(`{"error":{"code":"INTERNAL_ERROR","message":"Something went wrong."}}`))
		return
	}
	responseWriter.Header().Set("Content-Type", "application/json")
	responseWriter.Header().Set("Content-Length", strconv.Itoa(len(payload)))
	responseWriter.WriteHeader(status)
	_, _ = responseWriter.Write(payload)
}

func WriteError(responseWriter http.ResponseWriter, request *http.Request, status int, code, message string) {
	WriteErrorWithDetails(responseWriter, request, status, code, message, nil)
}

func WriteErrorWithDetails(responseWriter http.ResponseWriter, request *http.Request, status int, code, message string, details any) {
	// The response written below is unchanged by this line. It only leaves the
	// code where the telemetry middleware can read it after the handler chain
	// returns, and does nothing at all when no recorder was installed - which
	// is every request when TELEMETRY_ENABLED is off.
	recordErrorCode(request.Context(), code)
	WriteJSON(responseWriter, status, ErrorEnvelope{Error: ErrorBody{
		Code:      code,
		Message:   message,
		Details:   details,
		RequestID: RequestID(request.Context()),
	}})
}

func WriteRawJSON(responseWriter http.ResponseWriter, status int, payload []byte) {
	responseWriter.Header().Set("Content-Type", "application/json")
	responseWriter.Header().Set("Content-Length", strconv.Itoa(len(payload)))
	responseWriter.WriteHeader(status)
	_, _ = responseWriter.Write(payload)
}
