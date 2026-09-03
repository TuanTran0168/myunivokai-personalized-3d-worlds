package handlers

import (
	"net/http"
	"strconv"
	"strings"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/httpx"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/wake"
)

// The two query-string parameters, named as constants because they are part of
// a public contract: a rename here is a break for every client.
const (
	worldListCursorParameter = "cursor"
	worldListLimitParameter  = "limit"
)

// ProductWorldListHandler answers GET /api/me/worlds.
//
// It relays and nothing more: no cache, no response model of its own, no
// merging with anything. The list is per-account and changes the moment its
// owner creates or deletes a world, so a shared edge cache would show one
// person a page that is already wrong and would be keyed on a token to avoid
// showing it to somebody else - which is a per-account cache, which is what
// the browser already is.
type ProductWorldListHandler struct {
	transport *RPCTransport
}

func NewProductWorldListHandler(transport *RPCTransport) *ProductWorldListHandler {
	return &ProductWorldListHandler{transport: transport}
}

// List returns one keyset page of the caller's own worlds.
//
// The owner comes from the verified access token and from nowhere else, which
// is what makes this route safe to have at all: there is no path, query or
// body parameter naming an account, so there is no request that asks for
// somebody else's worlds. The middleware on this group has already refused a
// caller with no session, so a missing subject here is the gateway's own bug
// rather than a client's - hence a 500 and not a 401.
func (handler *ProductWorldListHandler) List(responseWriter http.ResponseWriter, request *http.Request) {
	ownerAccountIdentifier := requestingAccountIdentifier(request)
	if ownerAccountIdentifier == nil {
		httpx.WriteError(responseWriter, request, http.StatusInternalServerError, "INTERNAL_ERROR",
			"The request could not be identified.")
		return
	}
	pageSize, pageSizeAcceptable := worldListPageSizeFromRequest(responseWriter, request)
	if !pageSizeAcceptable {
		return
	}
	// dna-service holds the list and sleeps on a free tier, so a request after
	// a quiet period pays a cold start. Woken proactively rather than
	// reactively for the reason the create path gives: reactive waking hangs
	// off a no-responders reply, and by the time that arrives the visitor has
	// already been waiting for the request timeout.
	handler.transport.Wake(wake.ServiceDNA)
	handler.transport.Proxy(responseWriter, request, contracts.DNALibraryListQuerySubject, contracts.LibraryListQueryData{
		OwnerAccountID: *ownerAccountIdentifier,
		Cursor:         strings.TrimSpace(request.URL.Query().Get(worldListCursorParameter)),
		Limit:          pageSize,
	}, cachePolicy{})
}

// worldListPageSizeFromRequest reads ?limit=, and refuses only what is not a
// number.
//
// A limit ABOVE the maximum is clamped by the contract rather than refused,
// and the asymmetry is deliberate: "give me 500" has an honest answer, which
// is 50 rows and a cursor, while "give me abc" has none. Refusing the first
// would make a client that guessed wrong about the page size unable to read
// its own list at all.
func worldListPageSizeFromRequest(responseWriter http.ResponseWriter, request *http.Request) (int, bool) {
	rawLimit := strings.TrimSpace(request.URL.Query().Get(worldListLimitParameter))
	if rawLimit == "" {
		return 0, true
	}
	pageSize, err := strconv.Atoi(rawLimit)
	if err != nil {
		httpx.WriteError(responseWriter, request, http.StatusBadRequest, "VALIDATION_ERROR",
			"The limit must be a whole number.")
		return 0, false
	}
	return pageSize, true
}
