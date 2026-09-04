package services

import (
	"context"
	"testing"

	"github.com/myunivokai/myunivokai/services/ocean-service/internal/config"
	"github.com/myunivokai/myunivokai/services/ocean-service/internal/models"
	"github.com/myunivokai/myunivokai/services/ocean-service/internal/repositories"
)

// The share URL this service prints is the ONE value a visitor copies out of
// the product and hands to somebody else, and it was wrong in all three
// families at once: PublicWebURL + "/share/" + slug, against a route of
// /ocean/share/worlds/{slug}. Every share link ever handed out was a 404.
//
// It survived because the only correct spelling of the URL anywhere in the
// backend lived inside a gateway test's canned response - a fixture, which
// asserts nothing about the code that builds the real one - and because a
// comment on the share page asserted the link "lands exactly here" without
// ever naming the segment that was missing.
//
// So the route is written out below as a literal rather than assembled from
// sharePagePathPrefix. A test that rebuilds the value from the constant it is
// checking agrees with itself and proves nothing; this one disagrees with the
// frontend out loud if either side moves. The route has exactly one
// declaration: apps/myunivokai-personalization/src/lib/worldRoutes.ts.
const (
	shareURLTestPublicWebURL   = "https://myunivokai.test/ocean"
	shareURLTestExpectedPrefix = "https://myunivokai.test/ocean/share/worlds/"
)

func newShareURLTestWorldService(publicWebURL string) *WorldService {
	serviceConfig := config.Config{PublicWebURL: publicWebURL, ShareSlugLength: 10}
	return NewWorldService(serviceConfig, repositories.NewMemoryStore(), NewOceanConfigBuilder())
}

func publishOneWorldForShareURLTest(t *testing.T, publicWebURL string) models.PublishResponse {
	t.Helper()
	service := newShareURLTestWorldService(publicWebURL)
	created, err := service.ComposeWorld(context.Background(), validComposeEnvelope())
	if err != nil {
		t.Fatalf("compose world: %v", err)
	}
	published, err := service.PublishWorld(context.Background(), created.World.ID, noRequestingAccount)
	if err != nil {
		t.Fatalf("publish world: %v", err)
	}
	return published
}

func TestPublishedShareURLMatchesTheRouteTheWebAppServes(t *testing.T) {
	published := publishOneWorldForShareURLTest(t, shareURLTestPublicWebURL)
	expectedShareURL := shareURLTestExpectedPrefix + published.ShareSlug
	if published.ShareURL != expectedShareURL {
		t.Fatalf("share URL does not match the route the web app serves: got %q, want %q", published.ShareURL, expectedShareURL)
	}
}

// PUBLIC_WEB_URL is typed by an operator into a dashboard, so a trailing slash
// is a matter of time. The construction already trims one, and this keeps that
// true: a doubled slash is the kind of break that is only ever noticed by the
// person the link was sent to.
func TestPublishedShareURLTrimsATrailingSlashOnPublicWebURL(t *testing.T) {
	published := publishOneWorldForShareURLTest(t, shareURLTestPublicWebURL+"/")
	expectedShareURL := shareURLTestExpectedPrefix + published.ShareSlug
	if published.ShareURL != expectedShareURL {
		t.Fatalf("trailing slash was not trimmed: got %q, want %q", published.ShareURL, expectedShareURL)
	}
}
