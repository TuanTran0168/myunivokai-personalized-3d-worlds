// Package platforms holds one adapter per hosting mechanism, mirroring
// services/dna-service/internal/ai/providers. An adapter knows how its vendor
// starts a stopped instance and nothing else; deduplication, detached
// contexts and fire-and-forget belong to wake.Coordinator.
package platforms

import (
	"context"

	"github.com/myunivokai/myunivokai/services/api-gateway/internal/wake"
)

// None is the always-on adapter: it supports nothing, so wake.Coordinator
// short-circuits before any work and the gateway keeps reporting plain
// SERVICE_UNAVAILABLE for a missing responder.
//
// This is the right adapter, not a disabled one, wherever instances do not
// sleep — paid plans, real background workers, a Kubernetes Deployment. It is
// also the default, so a deploy that has configured nothing makes no outbound
// call to anybody.
type None struct{}

func NewNone() *None { return &None{} }

func (platform *None) Name() wake.PlatformName { return wake.PlatformNone }

func (platform *None) Supports(string) bool { return false }

// Wake is unreachable through Coordinator, which checks Supports first. It
// returns nil rather than an error so that a caller holding a Platform
// directly still treats "nothing to do" as success.
func (platform *None) Wake(context.Context, string) error { return nil }
