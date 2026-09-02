package config

import "time"

// The `web` audience's two token lifetimes, decided in §4.4 of
// agent-system/plans/architecture/end-user-identity-and-ownership.md and
// deliberately Go constants rather than fields on Config.
//
// They are not environment variables and must not become ones. S8-IDENTITY-012
// makes both of them `system_settings` rows — `auth.token.web.access_ttl` and
// `auth.token.web.refresh_ttl` — and a value that starts life as a setting
// needs a compiled-in default, not an env var that would then have to be
// removed from `.env`, `.env.example` and `render.yaml` again. The invariant
// that governs every setting applies to them from today: the named constant is
// the default and the platform must behave correctly with an empty settings
// table, so a setting is always an override and never the only copy of a value.
//
// The admin audience's pair stays on Config (AccessTokenTTL,
// RefreshTokenTTL) because it is already an environment variable in a deployed
// service; §9.3's audit is what moves those, not this file.
//
// Why these numbers are defensible rests on one fact: the gateway checks the
// Redis `tokenVersion` on every request, not only on refresh, so revocation is
// instant at any access TTL and the TTL decides only how often a refresh round
// trip happens. Without that check a 7-day access token would be indefensible.
const (
	WebAccessTokenTTL = 7 * 24 * time.Hour

	// Three months, written as 90 days because a duration cannot express a
	// calendar month and rounding it to 90 explicitly is better than leaving
	// a reader to work out which month was meant.
	WebRefreshTokenTTL = 90 * 24 * time.Hour
)
