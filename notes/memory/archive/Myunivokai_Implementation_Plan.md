# Myunivokai — Technical Implementation Plan for Codex Agent

> **Document status:** Archived historical baseline
> **Last source review:** 2026-07-18

> Historical baseline. The active backend now has `api-gateway`,
> `universe-service`, and `nature-service`; current routing/security/deployment
> contracts live in `notes/knowledge/backend/source-overview.md` and `notes/vision/`.

> **Project name:** Myunivokai  
> **Hidden joke:** “My universe, okay” + “AI”  
> **Tagline:** My universe, okay?  
> **Product tagline:** Turn your personality into a living 3D universe.  
> **Repository:** `myunivokai`  
> **Stack:** Next.js + Go + PostgreSQL/Neon + AI provider abstraction  
> **Primary AI providers:** Gemini and OpenAI, switchable by environment config  
> **UI direction:** Premium dark-mode cosmic dashboard, glassmorphism, neon purple/cyan, 3D galaxy canvas

---

## 0. Codex Agent Mission

Build an MVP web application named **Myunivokai**.

Users enter personal information such as nickname, interests, personality traits, current goal, challenge/fear, mood, favorite colors, and preferred universe style. The backend calls an AI provider to generate **Personality DNA** as structured JSON. The backend then creates a deterministic **World Seed** and **World Scene Config**. The frontend renders the result as a personalized 3D universe using React Three Fiber.

The codebase must be production-minded but MVP-scoped. The architecture must avoid hardcoding a single AI provider. Gemini and OpenAI must be swappable by config without changing business logic.

### Non-negotiable engineering rules

1. Never expose AI API keys to the browser.
2. Do not call AI from the frontend.
3. Backend owns AI orchestration, validation, persistence, rate limiting, and provider switching.
4. Frontend owns UI, 3D rendering, animation, export/share interactions, and local UX state.
5. AI output must be validated against a schema before being saved or returned.
6. Regenerating visual variants should not call AI by default. It should reuse the saved Personality DNA and generate a new World Seed.
7. Public share pages must not expose raw sensitive input such as fear/challenge unless explicitly marked public later.
8. Keep provider-specific request/response code isolated inside adapter files.
9. Tests must use a mock AI provider, not real Gemini/OpenAI calls.
10. Keep the app deployable with Vercel for web, Railway/Fly/Render for Go API, and Neon for PostgreSQL.

---

## 1. Product Concept

### Product summary

**Myunivokai** transforms a user's personality into a living 3D universe.

Flow:

```txt
User input
  -> Go backend validates input
  -> AI provider generates Personality DNA JSON
  -> Backend validates AI JSON
  -> Backend creates World Seed and World Scene Config
  -> PostgreSQL/Neon stores world + variant
  -> Next.js frontend renders a 3D universe
  -> User can regenerate visual variants, save, export, and share
```

### Core metaphor

```txt
Human profile -> Personality DNA -> World Seed -> 3D Universe -> Shared Orbit
```

### MVP screens from Stitch UI

The uploaded Stitch UI already has the right high-level product structure. Keep these six screens:

1. Landing Page
2. Create Universe Form
3. AI Generating Screen
4. 3D Universe Dashboard
5. Saved Worlds Gallery
6. Public Share Page

The current visual language is good for MVP:

- Deep cosmic dark background
- Glassmorphism cards
- Neon purple/cyan accent
- 3D core/orbit metaphor
- Trait bars
- World DNA side panel
- Share/export actions

Do not restart the UI concept from scratch. Convert the Stitch design into reusable Next.js components and progressively replace mock 3D placeholders with React Three Fiber scenes.

---

## 2. Recommended Architecture

### Repository structure

Use a monorepo with clear separation between frontend, backend, contracts, and docs.

```txt
myunivokai/
  README.md
  AGENTS.md
  .gitignore
  .env.example
  docker-compose.yml

  apps/
    web/
      package.json
      next.config.ts
      tsconfig.json
      tailwind.config.ts
      postcss.config.mjs
      src/
        app/
        components/
        features/
        lib/
        styles/
        types/

    api/
      go.mod
      go.sum
      cmd/
        api/
          main.go
      internal/
        ai/
        config/
        db/
        handlers/
        middleware/
        models/
        repositories/
        services/
        seed/
        validation/
      migrations/
      tests/

  contracts/
    openapi.yaml
    schemas/
      world-input.schema.json
      personality-dna.schema.json
      world-scene-config.schema.json
      match-report.schema.json

  docs/
    architecture.md
    api.md
    deployment.md
    ai-provider-switching.md
    ui-notes.md
```

### Why this structure

- `clients/web-client`: all Next.js UI and 3D rendering logic.
- `services/universe-service`: all Go API, AI orchestration, persistence, and business rules.
- `contracts`: shared truth for API and JSON schemas.
- `docs`: implementation notes for humans and agents.

Do not create a shared TypeScript package for Go types. Instead, keep stable JSON contracts in `contracts/schemas` and manually mirror the minimum required types in Go and TypeScript.

---

## 3. Tech Stack Decisions

### Frontend

Use:

```txt
Next.js App Router
TypeScript
Tailwind CSS
React Hook Form
Zod
Zustand
Framer Motion
Three.js
@react-three/fiber
@react-three/drei
@react-three/postprocessing
html-to-image or custom WebGL screenshot export
```

Frontend responsibilities:

- Landing page
- Multi-step create form
- Loading/generating animation
- Result dashboard
- 3D scene rendering
- Gallery based on local saved world IDs
- Public share page
- Export PNG
- Share link copy
- Responsive UI

### Backend

Use Go with a small, explicit dependency set:

```txt
net/http
chi router
pgx/v5 + pgxpool
pressly/goose for migrations
zerolog for logging
go-playground/validator for request validation
google/uuid for UUID helpers
```

Suggested Go packages:

```txt
github.com/go-chi/chi/v5
github.com/go-chi/cors
github.com/jackc/pgx/v5
github.com/jackc/pgx/v5/pgxpool
github.com/pressly/goose/v3
github.com/rs/zerolog
github.com/go-playground/validator/v10
github.com/google/uuid
```

Backend responsibilities:

- Validate user input
- Call Gemini/OpenAI through provider abstraction
- Validate AI structured JSON
- Generate deterministic world variants
- Store worlds, variants, AI generations, and matches
- Provide public share endpoints
- Protect API with rate limiting and CORS
- Keep raw private input out of public responses

### Database

Use **PostgreSQL on Neon**.

Recommended deployment:

```txt
Web: Vercel
API: Railway or Fly.io
Database: Neon PostgreSQL
```

Use two connection strings:

```txt
DATABASE_URL=pooled Neon connection string for app runtime
DATABASE_DIRECT_URL=direct Neon connection string for migrations
```

Reason:

- App runtime benefits from pooled connections.
- Migrations should use direct connections because some migration operations require a stable direct connection.

---

## 4. Environment Variables

Create a root `.env.example` and app-specific examples.

### Root `.env.example`

```env
# App
APP_ENV=development
APP_NAME=Myunivokai
PUBLIC_WEB_URL=http://localhost:3000
PUBLIC_API_URL=http://localhost:8080

# Web
NEXT_PUBLIC_API_BASE_URL=http://localhost:8080/api/v1

# API
API_HOST=0.0.0.0
API_PORT=8080
API_ALLOWED_ORIGINS=http://localhost:3000

# Database - Neon PostgreSQL
DATABASE_URL=postgresql://USER:PASSWORD@HOST/myunivokai?sslmode=require
DATABASE_DIRECT_URL=postgresql://USER:PASSWORD@HOST/myunivokai?sslmode=require

# AI Provider Switch
AI_PROVIDER=gemini
AI_FALLBACK_PROVIDER=openai
AI_ENABLE_FALLBACK=true
AI_TIMEOUT_SECONDS=35
AI_MAX_RETRIES=2
AI_PROMPT_VERSION=world-dna-v1

# Gemini
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.5-flash

# OpenAI
OPENAI_API_KEY=
OPENAI_MODEL=

# Rate limiting
RATE_LIMIT_RPS=2
RATE_LIMIT_BURST=8

# Public sharing
SHARE_SLUG_LENGTH=10
```

### Important AI config rule

`AI_PROVIDER` controls which provider is used first.

Valid values:

```txt
gemini
openai
mock
```

`mock` must exist for tests and local UI development without API keys.

---

## 5. AI Provider Switching Design

### Goal

Business logic should never know whether the app is using Gemini or OpenAI.

Only this layer should know provider-specific payloads:

```txt
services/universe-service/internal/ai/providers/gemini.go
services/universe-service/internal/ai/providers/openai.go
services/universe-service/internal/ai/providers/mock.go
```

### Interface

Create:

```txt
services/universe-service/internal/ai/provider.go
```

Recommended Go interface:

```go
package ai

import (
    "context"
    "encoding/json"
)

type ProviderName string

const (
    ProviderGemini ProviderName = "gemini"
    ProviderOpenAI ProviderName = "openai"
    ProviderMock   ProviderName = "mock"
)

type StructuredRequest struct {
    Task          string
    PromptVersion string
    SystemPrompt  string
    UserPrompt    string
    SchemaName    string
    Schema        map[string]any
    Temperature   float32
    MaxTokens     int
}

type Usage struct {
    InputTokens  int `json:"inputTokens,omitempty"`
    OutputTokens int `json:"outputTokens,omitempty"`
    TotalTokens  int `json:"totalTokens,omitempty"`
}

type StructuredResponse struct {
    Provider ProviderName     `json:"provider"`
    Model    string           `json:"model"`
    JSON     json.RawMessage  `json:"json"`
    Usage    Usage            `json:"usage"`
    Raw      json.RawMessage  `json:"raw,omitempty"`
}

type Provider interface {
    Name() ProviderName
    GenerateStructured(ctx context.Context, req StructuredRequest) (*StructuredResponse, error)
}
```

### Provider factory

Create:

```txt
services/universe-service/internal/ai/factory.go
```

Behavior:

```txt
Read AI_PROVIDER
  -> gemini: return GeminiProvider
  -> openai: return OpenAIProvider
  -> mock: return MockProvider
```

Also create an orchestrator that supports fallback:

```txt
services/universe-service/internal/ai/orchestrator.go
```

Behavior:

```txt
Try primary provider
  -> validate JSON
  -> if success, return
  -> if fails and AI_ENABLE_FALLBACK=true, try fallback provider
  -> save both success/failure attempts in ai_generations
```

### Provider-specific implementation notes

#### Gemini adapter

File:

```txt
services/universe-service/internal/ai/providers/gemini.go
```

Use Gemini structured output mode with JSON schema. Keep the exact request format in this adapter only.

The adapter should:

1. Build provider-specific request.
2. Include system instruction and user prompt.
3. Request JSON output using the supplied schema.
4. Parse returned text/JSON into `json.RawMessage`.
5. Return `StructuredResponse`.

Pseudo-shape:

```go
// Do not import this shape into business services.
// Keep it private inside providers/gemini.go.
type geminiGenerateContentRequest struct {
    SystemInstruction any `json:"systemInstruction,omitempty"`
    Contents          any `json:"contents"`
    GenerationConfig  any `json:"generationConfig,omitempty"`
}
```

#### OpenAI adapter

File:

```txt
services/universe-service/internal/ai/providers/openai.go
```

Use OpenAI structured outputs with JSON schema. Keep the exact request format in this adapter only.

The adapter should:

1. Build provider-specific request.
2. Send system/user input.
3. Configure JSON schema response.
4. Extract final output JSON.
5. Return `StructuredResponse`.

Pseudo-shape:

```go
// Do not import this shape into business services.
// Keep it private inside providers/openai.go.
type openAIResponsesRequest struct {
    Model string `json:"model"`
    Input any    `json:"input"`
    Text  any    `json:"text,omitempty"`
}
```

### Why not use provider SDKs in MVP

For this project, prefer simple REST adapters using `net/http`.

Reason:

- Less SDK lock-in.
- Easier to keep Gemini/OpenAI adapters symmetrical.
- Easier for Codex to implement and test.
- Provider-specific payload changes remain isolated.

SDKs can be added later if needed.

### AI fallback policy

Fallback should happen only for technical failures:

```txt
HTTP timeout
HTTP 5xx
rate limit if retry exhausted
invalid JSON
schema validation failure
provider unavailable
```

Fallback should not happen for:

```txt
input validation errors
content policy/safety rejection that should be shown to user
missing API key
misconfigured model
```

### AI generation logging

Every attempt should be logged in table `ai_generations`:

```txt
provider
model
task
prompt_version
input_hash
request_json
response_json
usage_json
latency_ms
status
error
created_at
```

Never store API keys.

---

## 6. AI Task Design

### MVP AI task

Use one AI task for MVP:

```txt
world-dna-v1
```

The AI should generate **Personality DNA**, not the full 3D scene.

Reason:

- Personality DNA benefits from language understanding.
- 3D scene config should be deterministic and controlled by backend rules.
- Regenerate variants should be cheap and not call AI.
- Provider switching is safer when AI output is smaller and schema-constrained.

### AI input

The user input is normalized before sending to AI.

Example:

```json
{
  "nickname": "Tuan",
  "role": "Developer",
  "interests": ["coding", "travel", "photography"],
  "traits": ["curious", "builder", "optimizer"],
  "goal": "Build a beautiful AI product",
  "challenge": "I overthink product direction",
  "mood": "futuristic calm",
  "favoriteColors": ["#8B5CF6", "#06B6D4"],
  "preferredWorldStyle": "cosmic-galaxy"
}
```

### Personality DNA output schema

The AI must return only JSON matching this conceptual schema:

```json
{
  "schemaVersion": "1.0",
  "archetype": "Builder Explorer",
  "sceneName": "The Cyan Builder Galaxy",
  "quote": "I build worlds from curious ideas.",
  "shortNarrative": "A curious builder who turns ideas into useful worlds.",
  "traitScores": {
    "creativity": 92,
    "discipline": 84,
    "curiosity": 95,
    "energy": 78,
    "focus": 88
  },
  "energySignature": {
    "primary": "creative",
    "secondary": "explorer",
    "intensity": 86
  },
  "planets": [
    {
      "key": "coding",
      "name": "Code Atlas",
      "type": "Interest Planet",
      "meaning": "Your builder mindset and ability to solve complex problems.",
      "energy": 90
    }
  ],
  "visualHints": {
    "theme": "cosmic-galaxy",
    "coreSymbol": "crystal",
    "paletteIntent": "purple cyan premium nebula",
    "motionIntent": "calm orbiting energy"
  }
}
```

### Personality DNA validation rules

Backend must enforce:

```txt
archetype: 2-40 chars
sceneName: 3-80 chars
quote: <= 100 chars
shortNarrative: <= 240 chars
traitScores values: integers 0-100
energySignature.intensity: integer 0-100
planets: 3-7 items
planet.name: 2-40 chars
planet.meaning: <= 180 chars
visualHints.theme: allowed enum
```

If AI returns invalid JSON or invalid fields:

1. Retry once with same provider using a repair prompt.
2. If still invalid and fallback enabled, try fallback provider.
3. If still invalid, return a safe error to frontend.

---

## 7. Backend World Config Generation

### Principle

Do not let AI directly control arbitrary 3D values. Use AI Personality DNA plus a backend-generated seed to build a bounded, safe scene config.

```txt
Personality DNA + World Seed + Config Builder Rules -> World Scene Config
```

### World seed generation

Create:

```txt
services/universe-service/internal/seed/seed.go
```

Use cryptographically random seed for new worlds:

```txt
WLD-[10 uppercase base32 chars]
```

Example:

```txt
WLD-8KQ3MZP9RA
```

For variants:

```txt
VAR-[world short id]-[variant index]-[random suffix]
```

### Scene config builder

Create:

```txt
services/universe-service/internal/services/world_config_builder.go
```

Inputs:

```go
type BuildWorldConfigInput struct {
    DNA       models.PersonalityDNA
    Seed      string
    VariantNo int
}
```

Output:

```go
type WorldSceneConfig struct {
    SchemaVersion string
    SceneName     string
    Archetype     string
    Quote         string
    Theme         string
    Palette       Palette
    Core          CoreConfig
    Planets       []PlanetSceneConfig
    Particles     ParticleConfig
    Camera        CameraConfig
    PostFX        PostFXConfig
    HUD           HUDConfig
}
```

### Visual bounds

Keep values within these limits:

```txt
Planets: 3-7
Planet size: 0.45-1.25
Orbit radius: 3.2-9.5
Orbit speed: 0.04-0.36
Particle count desktop: 600-1500
Particle count mobile: 250-700
Bloom intensity: 0.3-1.4
Camera distance: 7-12
```

### Deterministic random

Implement a deterministic PRNG from seed for visual values. The same seed should always produce the same scene config.

Do not rely on global random for layout.

---

## 8. Database Schema

Create migration:

```txt
services/universe-service/migrations/000001_init.sql
```

### SQL migration

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE worlds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nickname TEXT NOT NULL,
  role TEXT,
  input JSONB NOT NULL,
  personality_dna JSONB NOT NULL,
  archetype TEXT NOT NULL,
  scene_name TEXT NOT NULL,
  quote TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'public')),
  share_slug TEXT UNIQUE,
  selected_variant_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE world_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id UUID NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  variant_no INTEGER NOT NULL,
  seed TEXT NOT NULL,
  config JSONB NOT NULL,
  thumbnail_url TEXT,
  is_selected BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(world_id, variant_no),
  UNIQUE(world_id, seed)
);

ALTER TABLE worlds
  ADD CONSTRAINT worlds_selected_variant_fk
  FOREIGN KEY (selected_variant_id)
  REFERENCES world_variants(id)
  ON DELETE SET NULL;

CREATE TABLE ai_generations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  task TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  request_json JSONB,
  response_json JSONB,
  usage_json JSONB,
  latency_ms INTEGER,
  status TEXT NOT NULL CHECK (status IN ('success', 'failed')),
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  world_a_id UUID NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  world_b_id UUID NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  match_seed TEXT NOT NULL,
  compatibility_score INTEGER NOT NULL CHECK (compatibility_score >= 0 AND compatibility_score <= 100),
  match_archetype TEXT NOT NULL,
  analysis JSONB NOT NULL,
  scene_config JSONB NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'public')),
  share_slug TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_worlds_share_slug ON worlds(share_slug);
CREATE INDEX idx_worlds_created_at ON worlds(created_at DESC);
CREATE INDEX idx_world_variants_world_id ON world_variants(world_id);
CREATE INDEX idx_matches_share_slug ON matches(share_slug);
CREATE INDEX idx_ai_generations_task_created_at ON ai_generations(task, created_at DESC);
```

### Privacy note

`worlds.input` can contain sensitive free text. Never return it from public share APIs.

---

## 9. API Contract

All API routes use prefix:

```txt
/api/v1
```

### Health

```txt
GET /healthz
```

Response:

```json
{
  "ok": true,
  "service": "myunivokai-api"
}
```

### Create world

```txt
POST /api/v1/worlds
```

Request:

```json
{
  "nickname": "Tuan",
  "role": "Developer",
  "interests": ["coding", "travel", "photography"],
  "traits": ["curious", "builder", "optimizer"],
  "goal": "Build a beautiful AI product",
  "challenge": "I overthink product direction",
  "mood": "futuristic-calm",
  "favoriteColors": ["#8B5CF6", "#06B6D4"],
  "preferredWorldStyle": "cosmic-galaxy"
}
```

Validation:

```txt
nickname: required, 2-32 chars
role: optional, <= 80 chars
interests: required, 3-8 items, each 2-32 chars
traits: required, 3-6 items, each 2-32 chars
goal: required, 10-220 chars
challenge: optional, <= 220 chars
mood: required enum
favoriteColors: required, 1-4 hex colors
preferredWorldStyle: required enum
```

Response:

```json
{
  "world": {
    "id": "uuid",
    "nickname": "Tuan",
    "archetype": "Builder Explorer",
    "sceneName": "The Cyan Builder Galaxy",
    "quote": "I build worlds from curious ideas.",
    "visibility": "private",
    "shareSlug": null,
    "createdAt": "2026-05-30T00:00:00Z"
  },
  "variant": {
    "id": "uuid",
    "variantNo": 1,
    "seed": "WLD-8KQ3MZP9RA",
    "config": {}
  },
  "personalityDNA": {}
}
```

### Get world by ID

```txt
GET /api/v1/worlds/{worldId}
```

Return private world details. For MVP without auth, this endpoint can return by ID only if the user already has the ID. Do not list all worlds.

### Regenerate variant

```txt
POST /api/v1/worlds/{worldId}/variants
```

Behavior:

```txt
Load world
Use saved Personality DNA
Generate new seed
Build new scene config
Save variant
Return variant
```

This endpoint must not call AI by default.

Response:

```json
{
  "variant": {
    "id": "uuid",
    "variantNo": 2,
    "seed": "VAR-8KQ-2-ZX1P",
    "config": {}
  }
}
```

### Select variant

```txt
POST /api/v1/worlds/{worldId}/variants/{variantId}/select
```

Behavior:

```txt
Set selected_variant_id on worlds
Set is_selected=true for chosen variant
Set is_selected=false for other variants of same world
```

### Publish world

```txt
POST /api/v1/worlds/{worldId}/publish
```

Behavior:

```txt
Generate share_slug if missing
Set visibility='public'
Return public URL
```

Response:

```json
{
  "shareSlug": "tuan-8kq3mz",
  "shareUrl": "https://myunivokai.app/share/tuan-8kq3mz"
}
```

### Public share world

```txt
GET /api/v1/share/worlds/{shareSlug}
```

Return only safe public data:

```json
{
  "world": {
    "nickname": "Tuan",
    "archetype": "Builder Explorer",
    "sceneName": "The Cyan Builder Galaxy",
    "quote": "I build worlds from curious ideas.",
    "shortNarrative": "A curious builder who turns ideas into useful worlds."
  },
  "variant": {
    "seed": "WLD-8KQ3MZP9RA",
    "config": {}
  },
  "publicDNA": {
    "traitScores": {},
    "planets": []
  }
}
```

Must not return:

```txt
raw input.challenge
raw input.goal if later marked private
AI request_json
AI response raw payload
internal IDs if not needed
```

---

## 10. Phase 2 API: Shared Orbit Match

Do not implement in first MVP unless explicitly requested, but reserve data model and names.

### Create match

```txt
POST /api/v1/matches
```

Request:

```json
{
  "worldAId": "uuid",
  "worldBShareSlug": "friend-slug"
}
```

Behavior:

```txt
Resolve world A and public world B
Use Personality DNA from both worlds
Call AI with match-report-v1 schema
Validate match report
Generate dual-universe scene config
Save match
Return match result
```

Feature name:

```txt
Shared Orbit
```

Score name:

```txt
Resonance Score
```

Safety rule:

Do not claim romantic certainty or psychological truth. This is a fun reflective compatibility visualization.

---

## 11. Frontend Plan

### App routes

Use Next.js App Router.

```txt
/                  Landing page
/create            Create universe form
/generating         Generating transition screen, optional route
/world/[id]         Result dashboard
/gallery            Saved worlds gallery
/share/[slug]       Public share page
/match              Phase 2 Shared Orbit entry
/match/[id]         Phase 2 match result
```

### Frontend feature structure

```txt
clients/web-client/src/
  app/
    page.tsx
    create/page.tsx
    world/[id]/page.tsx
    gallery/page.tsx
    share/[slug]/page.tsx

  components/
    ui/
    layout/
    effects/

  features/
    create-universe/
      CreateUniverseForm.tsx
      formSchema.ts
      constants.ts
    universe-scene/
      PersonalUniverseCanvas.tsx
      UniverseScene.tsx
      CoreObject.tsx
      Planet.tsx
      OrbitRing.tsx
      ParticleField.tsx
      SceneLabels.tsx
      SceneControls.tsx
    dashboard/
      UniverseDashboard.tsx
      ProfilePanel.tsx
      PlanetDetailsPanel.tsx
      WorldDNAPanel.tsx
      BottomActionBar.tsx
    gallery/
      SavedWorldCard.tsx
      useSavedWorlds.ts
    share/
      PublicWorldView.tsx

  lib/
    api.ts
    env.ts
    format.ts
    exportImage.ts

  types/
    world.ts
    api.ts
```

### UI design tokens

Base on the Stitch design system:

```txt
Background: #050816
Surface: #0B1020
Surface glass: rgba(15, 23, 42, 0.72)
Primary purple: #8B5CF6
Secondary cyan: #06B6D4
Accent gold: #FACC15
Text primary: #F8FAFC
Text secondary: #CBD5E1
Border glow: rgba(139, 92, 246, 0.35)
```

Typography:

```txt
Headings: Space Grotesk
Body: Inter
Stats: JetBrains Mono
```

### 3D rendering rules

Use dynamic import to disable SSR for WebGL canvas.

```tsx
import dynamic from "next/dynamic";

const PersonalUniverseCanvas = dynamic(
  () => import("@/features/universe-scene/PersonalUniverseCanvas"),
  { ssr: false }
);
```

Canvas rules:

```txt
Do not render WebGL on server.
Keep planet count <= 7.
Use procedural geometry first; avoid heavy textures in MVP.
Disable expensive shadows by default.
Use adaptive particle count for mobile.
Use Suspense fallback for loading.
```

### 3D scene mapping

```txt
config.palette.background -> Canvas background
config.core.shape -> sphere/octahedron/box/torus
config.core.color -> material color and emissive
config.planets -> orbiting spheres
planet.orbitRadius -> orbit ring radius
planet.speed -> animation speed
planet.meaning -> tooltip/right panel
config.particles.count -> star/particle field count
config.postFX.bloom -> post-processing bloom intensity
```

### Export image

MVP approach:

1. Use `html-to-image` to export the dashboard/card container.
2. For WebGL accuracy, set `gl={{ preserveDrawingBuffer: true }}` only if needed.
3. Provide a fallback export that captures a static share card if full WebGL export is unstable.

Do not block MVP on perfect WebGL export.

### Local gallery

No auth in MVP. Use localStorage to store world IDs the user created or saved.

```txt
localStorage key: myunivokai.savedWorldIds
value: string[]
```

Gallery loads IDs from localStorage and calls `GET /api/v1/worlds/{id}`.

---

## 12. Backend Plan

### Go package structure

```txt
services/universe-service/internal/
  config/
    config.go
  db/
    pool.go
    migrations.go
  ai/
    provider.go
    factory.go
    orchestrator.go
    prompts/
      world_dna_v1.go
      match_report_v1.go
    providers/
      gemini.go
      openai.go
      mock.go
  models/
    world.go
    dna.go
    scene.go
    match.go
  validation/
    request_validation.go
    ai_validation.go
  seed/
    seed.go
    prng.go
  repositories/
    world_repository.go
    variant_repository.go
    ai_generation_repository.go
    match_repository.go
  services/
    world_service.go
    world_config_builder.go
    match_service.go
  handlers/
    health_handler.go
    world_handler.go
    share_handler.go
    match_handler.go
  middleware/
    request_id.go
    logging.go
    recover.go
    cors.go
    rate_limit.go
```

### Request lifecycle for world creation

```txt
HTTP handler
  -> decode JSON
  -> validate user request
  -> service.GenerateWorld
  -> normalize input
  -> AI orchestrator GeneratePersonalityDNA
  -> validate AI output
  -> seed service creates seed
  -> config builder creates scene config
  -> repository transaction saves world + variant + AI logs
  -> return DTO
```

### Transaction requirement

Creation must be atomic:

```txt
begin tx
  insert world
  insert world_variant
  update world.selected_variant_id
  insert ai_generation logs
commit
```

If any step fails, rollback.

---

## 13. Prompt Design

Create:

```txt
services/universe-service/internal/ai/prompts/world_dna_v1.go
```

### System prompt

```txt
You are Myunivokai's Personality DNA engine.
You convert a user's self-described profile into a structured, positive, visually useful personality DNA object.
Return only JSON matching the provided schema.
Do not include markdown.
Do not diagnose mental health.
Do not make deterministic claims about the user's future.
Keep the tone imaginative, warm, and concise.
The output will be used to render a 3D personal universe.
```

### User prompt template

```txt
Generate Personality DNA for this user profile.

Nickname: {{nickname}}
Role: {{role}}
Interests: {{interests}}
Traits: {{traits}}
Goal: {{goal}}
Challenge: {{challenge}}
Mood: {{mood}}
Favorite colors: {{favoriteColors}}
Preferred world style: {{preferredWorldStyle}}

Rules:
- Return 3 to 7 planets.
- Trait scores must be integers from 0 to 100.
- Quote must be under 100 characters.
- Narrative must be under 240 characters.
- Planet meanings must be positive and specific.
- Do not reveal or repeat sensitive challenge text directly.
```

### Repair prompt

If JSON validation fails, retry once:

```txt
Your previous output did not match the required schema.
Return a corrected JSON object only.
Do not include explanations.
Use the same intended meaning but fix schema/type/range issues.
```

---

## 14. API Error Format

Use one consistent error envelope:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Please check the highlighted fields.",
    "details": [
      {
        "field": "interests",
        "message": "Select at least 3 interests."
      }
    ],
    "requestId": "req_abc123"
  }
}
```

Common error codes:

```txt
VALIDATION_ERROR
AI_PROVIDER_ERROR
AI_OUTPUT_INVALID
NOT_FOUND
RATE_LIMITED
INTERNAL_ERROR
```

---

## 15. Deployment Plan

### Neon PostgreSQL

1. Create Neon project.
2. Create database: `myunivokai`.
3. Copy pooled connection string to `DATABASE_URL`.
4. Copy direct connection string to `DATABASE_DIRECT_URL`.
5. Run migrations with direct URL.
6. App runtime uses pooled URL.

### Go API deployment

Recommended easiest option: Railway.

Required environment variables:

```txt
APP_ENV=production
API_PORT=${PORT}
API_ALLOWED_ORIGINS=https://your-vercel-domain.vercel.app
DATABASE_URL=<Neon pooled URL>
DATABASE_DIRECT_URL=<Neon direct URL>
AI_PROVIDER=gemini
AI_FALLBACK_PROVIDER=openai
AI_ENABLE_FALLBACK=true
GEMINI_API_KEY=<secret>
GEMINI_MODEL=gemini-2.5-flash
OPENAI_API_KEY=<secret optional>
OPENAI_MODEL=<model optional>
PUBLIC_WEB_URL=https://your-vercel-domain.vercel.app
```

### Next.js deployment

Recommended: Vercel.

Required environment variables:

```txt
NEXT_PUBLIC_API_BASE_URL=https://your-api-domain.com/api/v1
```

### CORS

Production API must allow only:

```txt
https://your-vercel-domain.vercel.app
https://your-custom-domain.com
```

Do not use `*` in production.

---

## 16. Testing Plan

### Backend tests

Must include:

```txt
config loading test
request validation test
mock AI provider test
AI orchestrator fallback test
Personality DNA validation test
world seed generation test
world config builder deterministic test
handler tests with httptest
repository integration test optional
```

Commands:

```bash
cd services/universe-service
go test ./...
go vet ./...
gofmt -w .
```

### Frontend tests/checks

Must include:

```txt
TypeScript typecheck
ESLint
form schema validation tests if test framework is added
manual responsive check
manual WebGL check on desktop/mobile
```

Commands:

```bash
cd clients/web-client
npm run lint
npm run typecheck
npm run build
```

### AI tests

Do not use real API calls in automated tests.

Use `AI_PROVIDER=mock`.

Mock provider should return a stable Personality DNA object.

---

## 17. MVP Build Order

### Phase 0 — Repo and contracts

1. Create monorepo structure.
2. Add root README.
3. Add `AGENTS.md` with coding instructions.
4. Add `.env.example`.
5. Add API contract skeleton.
6. Add JSON schemas.

Acceptance:

```txt
Repo structure exists.
Docs explain how to run web/api locally.
```

### Phase 1 — Backend foundation

1. Create Go API server.
2. Add config loader.
3. Add logging/middleware.
4. Add health endpoint.
5. Add database pool.
6. Add migrations.
7. Add repositories.

Acceptance:

```txt
GET /healthz works.
Migrations run against local or Neon database.
```

### Phase 2 — AI abstraction

1. Add `ai.Provider` interface.
2. Add mock provider.
3. Add Gemini provider.
4. Add OpenAI provider.
5. Add orchestrator with fallback.
6. Add AI generation logging.
7. Add schema validation.

Acceptance:

```txt
AI_PROVIDER=mock creates stable world.
AI_PROVIDER=gemini uses Gemini adapter.
AI_PROVIDER=openai uses OpenAI adapter.
Fallback behavior is unit-tested.
```

### Phase 3 — World generation endpoints

1. Implement `POST /worlds`.
2. Implement `GET /worlds/{id}`.
3. Implement `POST /worlds/{id}/variants`.
4. Implement `POST /worlds/{id}/variants/{variantId}/select`.
5. Implement publish/share endpoints.

Acceptance:

```txt
User can create a world.
User can regenerate variant without AI call.
User can publish and open share page data.
```

### Phase 4 — Frontend UI

1. Convert Stitch landing page.
2. Convert create form.
3. Add generating screen.
4. Add dashboard layout.
5. Add gallery.
6. Add share page.
7. Connect API client.

Acceptance:

```txt
Complete frontend flow works with AI_PROVIDER=mock.
```

### Phase 5 — 3D scene

1. Add React Three Fiber canvas.
2. Render core object.
3. Render orbit rings.
4. Render planets.
5. Render particles/stars.
6. Add hover/click planet interactions.
7. Add postprocessing bloom.
8. Add performance fallbacks.

Acceptance:

```txt
World Scene Config renders as a usable interactive 3D scene.
```

### Phase 6 — Export and polish

1. Export PNG.
2. Copy share link.
3. Toast notifications.
4. Responsive polish.
5. Loading and error states.

Acceptance:

```txt
User can create, view, regenerate, save locally, export, and share a universe.
```

### Phase 7 — Deploy

1. Deploy Neon database.
2. Run migrations.
3. Deploy Go API.
4. Deploy Next.js web.
5. Configure CORS.
6. Test production flow.

Acceptance:

```txt
Production URL works end-to-end.
```

---

## 18. Phase 2 Product Plan: Shared Orbit

After MVP:

```txt
User A creates universe
User A publishes Orbit Link
User B opens link or enters share slug
User B creates/selects own universe
Backend compares both Personality DNA objects
AI returns match report
Frontend renders dual-universe Shared Orbit scene
```

Feature names:

```txt
Shared Orbit
Resonance Score
Compatibility Constellation
Dual Galaxy
Orbit Link
```

Safety rules:

```txt
Do not infer personality from face photos.
Do not claim psychological truth.
Do not say people should date or not date.
Frame result as playful reflective compatibility.
```

---

## 19. Common Mistakes to Avoid

1. Do not let the frontend call Gemini/OpenAI directly.
2. Do not store API keys in `.env.example` or Git.
3. Do not make AI generate arbitrary Three.js code.
4. Do not render too many meshes in MVP.
5. Do not call AI every time the user opens a saved world.
6. Do not call AI for visual variant regeneration by default.
7. Do not expose raw input on public share pages.
8. Do not hardcode `gemini` or `openai` inside world service.
9. Do not skip AI JSON validation.
10. Do not use production CORS wildcard.
11. Do not use direct DB connection for high-concurrency serverless runtime unless intentionally configured.
12. Do not block MVP on auth, payment, or video export.
13. Do not overbuild custom 3D assets before the data flow works.
14. Do not make public share pages depend on localStorage.
15. Do not let Stitch-generated static HTML remain as unstructured one-off pages; convert into components.

---

## 20. Definition of Done for MVP

MVP is done when:

```txt
A user can open landing page.
A user can fill create form.
Backend validates input.
Backend generates Personality DNA using selected AI provider.
Backend saves world and first variant in Neon.
Frontend renders the returned 3D universe config.
User can regenerate visual variant without AI.
User can select/save a variant.
User can publish a share link.
Public share page works without exposing sensitive raw input.
Project deploys with Vercel + Go API hosting + Neon.
AI provider can switch by changing env only.
```

---

## 21. Suggested AGENTS.md Content

Create `AGENTS.md` at repo root:

```md
# AGENTS.md — Myunivokai

## Mission
Build Myunivokai: an AI-powered personal 3D universe generator.

## Stack
- Web: Next.js, TypeScript, Tailwind, React Three Fiber
- API: Go, chi, pgxpool
- DB: PostgreSQL on Neon
- AI: provider abstraction supporting gemini, openai, mock

## Rules
- Do not call AI from frontend.
- Do not expose secrets.
- Keep provider-specific logic in internal/ai/providers.
- Business services depend only on ai.Provider interface.
- Validate user input and AI output.
- Use mock provider in tests.
- Regenerate variants without AI by default.
- Run tests and type checks before final response.

## Commands
Backend:
cd services/universe-service && go test ./... && go vet ./...

Frontend:
cd clients/web-client && npm run lint && npm run typecheck && npm run build
```

---

## 22. External Documentation References

Use official docs when implementing provider adapters and deployment details:

- OpenAI Structured Outputs: https://platform.openai.com/docs/guides/structured-outputs
- OpenAI Responses API: https://platform.openai.com/docs/api-reference/responses
- Gemini Structured Outputs: https://ai.google.dev/gemini-api/docs/structured-output
- Gemini Rate Limits: https://ai.google.dev/gemini-api/docs/rate-limits
- Neon Connection Pooling: https://neon.com/docs/connect/connection-pooling
- Neon Go Guide: https://neon.com/docs/guides/go
- Neon Connection Methods: https://neon.com/docs/connect/choose-connection

---

## 23. First Codex Task Prompt

Use this as the first prompt to Codex after creating the repo:

```txt
Create the initial Myunivokai monorepo using the plan in Myunivokai_Implementation_Plan.md.

Implement only Phase 0 and Phase 1 first:
- repo structure
- README.md
- AGENTS.md
- .env.example
- services/universe-service Go server with chi
- config loader
- health endpoint
- pgxpool database connection
- goose migration setup
- initial SQL migration for worlds, world_variants, ai_generations, matches
- middleware: request ID, recover, logging, CORS

Do not implement real Gemini/OpenAI calls yet.
Do not implement frontend 3D yet.
Make sure `cd services/universe-service && go test ./...` passes.
```

Then continue with Phase 2 in a separate Codex task.

---

## 24. Final Naming Lock

Use this naming consistently across UI, API, docs, and database:

```txt
Product: Myunivokai
Repo: myunivokai
Frontend: Myunivokai Web
Backend: Myunivokai API
Database: myunivokai
Main feature: Personal Universe
AI output: Personality DNA
Render input: World Seed
Generated object: Universe
Regenerated object: Universe Variant
Public page: Cosmic Profile
Share ID: Orbit Link
Phase 2 feature: Shared Orbit
Match score: Resonance Score
```

