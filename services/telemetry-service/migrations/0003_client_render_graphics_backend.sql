-- Which renderer actually drew, which 0002 could not have asked because there
-- was only ever one.
--
-- §19.5 of agent-system/research/webgpu-full-migration-feasibility-2026.md is
-- an ESTIMATE and says so: "~80% with navigator.gpu present and ~75-85%
-- acquiring a hardware device — i.e. roughly 20% on WebGL2, plausibly more." It
-- then names two reasons the real figure is likely worse for this product —
-- caniuse weights GLOBAL traffic while this audience is Vietnam-skewed, and the
-- in-app browsers a shared universe link arrives through (Facebook, Instagram,
-- TikTok, Zalo) are WebView-backed and unverified — and concludes that one
-- field on the envelope that already exists would replace the estimate with a
-- measurement. This column is that field.
--
-- Four values, closed by the contract exactly as the other three components
-- are: 'webgl' (WebGLRenderer), 'webgpu' and 'webgl2' (WebGPURenderer on each
-- of its backends), and 'unknown'.
--
-- **'unknown' IS NOT A TOLERANCE, IT IS THE BACKWARD-COMPATIBLE BUCKET.** A
-- browser holds a cached bundle for as long as it holds it, so reports with no
-- graphicsBackend at all arrive for days after the deploy that adds the field.
-- The gateway normalises those to 'unknown' rather than refusing them, because
-- turning a schema addition into an outage of the platform's own numbers is a
-- strange way to learn what share of visitors are on WebGL2. The DEFAULT below
-- does the same job for rows that already exist.
--
-- The key space grows from 3 x 4 x 2 = 24 to 3 x 4 x 2 x 4 = 96 per minute,
-- which is still bounded by the contract rather than by this schema's
-- tolerance, and still far under the cardinality rule's limits. As in 0002,
-- there is no CHECK here on purpose: the closed set is enforced by
-- contracts.ClientRenderReportData.Validate at the gateway and by
-- HttpRollupData::validate here, both of which are code that a change to the
-- set already touches.
--
-- There is still nothing in this table that identifies anybody. A graphics
-- backend is a property of roughly a fifth of all visitors at a time; it
-- singles out nobody, which is what keeps this an unauthenticated write.
ALTER TABLE client_render_rollups
  ADD COLUMN graphics_backend TEXT NOT NULL DEFAULT 'unknown';

-- The primary key has to grow with the row, or the first WebGPU report for a
-- tier and family would be folded into the WebGL count for the same one and the
-- split this column exists to measure would never appear.
--
-- Dropping and recreating rather than adding a unique index beside it: the
-- upsert's ON CONFLICT names the key, and two overlapping constraints would
-- make which one it resolves against a question about Postgres rather than
-- about this schema.
ALTER TABLE client_render_rollups
  DROP CONSTRAINT client_render_rollups_pkey;
ALTER TABLE client_render_rollups
  ADD CONSTRAINT client_render_rollups_pkey
  PRIMARY KEY (bucket_start, quality_tier, family, outcome, graphics_backend);
