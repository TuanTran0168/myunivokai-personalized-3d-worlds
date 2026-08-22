# Ocean fauna ecosystem expansion — BA research report

> **Document status:** Research + business analysis. Nothing in this document
> is implemented. All 16 research agents (2 root-cause code audits, 10 marine
> biology taxon clusters, 4 asset-licensing clusters) have now completed —
> several clusters ran more than once across two interrupted sessions
> (weekly usage cap), and every extra pass is folded in below rather than
> discarded, since each independent run occasionally surfaced a source or
> nuance the others missed.
> **Written:** 2026-08-22, branch `feat/repo/ocean-service`.
> **Companions:** [ocean-visual-direction-research.md](ocean-visual-direction-research.md)
> (the art-direction diagnosis this document's §2 root-cause work extends),
> [ocean-demo-port-ba.md](ocean-demo-port-ba.md) (sibling BA format this document
> follows), [../vision/ocean-service-plan.md](../vision/ocean-service-plan.md)
> (the contract, untouched by this document), [../../apps/myunivokai-web/src/lib/rarity.ts](../../apps/myunivokai-web/src/lib/rarity.ts)
> and [../../apps/myunivokai-web/public/assets/ocean/ATTRIBUTION.md](../../apps/myunivokai-web/public/assets/ocean/ATTRIBUTION.md)
> (the two existing mechanisms §7/§8 build directly on top of, not replace).

## 0. TL;DR (tiếng Việt)

- **Đây là báo cáo research, KHÔNG phải code.** Đúng yêu cầu "research trước,
  code sau" — chưa sửa một dòng code nào.
- **3 phát hiện thay đổi cách nhìn so với bản nháp đầu:**
  1. **Sứa (jellyfish) đã có sẵn một phần** — `oceanRigDrifters.ts` đã có
     `createJellyfish()` với đúng shader co-bóp-chuông tỏa tròn (radial pulse)
     mà nghiên cứu sinh học nói là "cần công thức hoàn toàn mới". Hiện tại nó
     chỉ là MỘT loài trang trí chung chung (không phân biệt loài, không thuộc
     hệ `FaunaSpecies`/rarity) — nhưng phần cơ học nặng nhất đã xong.
  2. **`oceanFaunaModels.ts` đã có sẵn bảng `GIANT_MODEL_BINDINGS`** với 5 entry
     — bao gồm `giant-sperm-whale` (dùng lại `fauna-whale.glb`, scale 16m) và
     `giant-whale-shark` (dùng lại `fauna-shark.glb`, scale 9m) — **NHƯNG cả
     hai đều là dead code**, chưa được nối vào bất kỳ rarity roll nào trong
     `rarity.ts`. Nghĩa là cá nhà táng và cá mập voi — hai loài user yêu cầu —
     có thể thêm vào gần như miễn phí (chỉ cần nối dây, không cần asset mới).
  3. **Không tìm được model CC0 nào** cho: cua, tôm, sứa, bạch tuộc/mực thường,
     lươn (moray/garden/điện), cá đuối điện, cá mập khổng lồ tiền sử (megalodon)
     — đúng như pattern cũ của dự án (không có CC0 cho loài biển sâu/cephalopod).
     **Một ngoại lệ:** tìm được 1 model cua CC0 thật, đã rig sẵn animation đi
     bộ, trên OpenGameArt — dùng được ngay.
- **Research giờ đã đầy đủ 16/16 agent**, bao gồm cả 3 cụm sinh học bị lỡ lần
  trước (cá rạn/viễn dương, cá đuối/cá mập bao gồm megalodon + cá mập voi,
  lươn/lươn điện) và toàn bộ 4 cụm 3D asset.
- **Phát hiện quan trọng nhất về code hiện tại (không đổi từ bản nháp):** hệ
  rarity (`rarity.ts`) là 4 lượt roll "world-level feature" độc lập, không
  phải per-species population rarity. Cả 27 species hiện tại luôn xuất hiện
  theo depth band. Muốn có 30-45% xác suất gặp ít nhất 1 sinh vật hiếm + nhiều
  hiếm cùng lúc thì phải thêm một tầng mới tái dùng đúng pattern Bernoulli độc
  lập đã có — xem §7.
- **Locomotion hiện tại chủ yếu chỉ có MỘT công thức** (sóng ngang dọc thân),
  cộng với sứa (một phần, xem trên). Cua/tôm/bạch tuộc vẫn cần cơ chế hoàn
  toàn mới (đi bộ nhiều chân rời rạc, arm-crawl độc lập từng tay) — xem §6.
- **2 bug camera/pop-in:** camera-independence đã fixed. Pop-in CHƯA fix —
  nguyên nhân thật: rig bị teardown/rebuild đồng bộ không cross-fade, và
  GLB-adopt đổi hình dạng tức thời. Xem §2.

---

## 1. Scope and method

A Workflow of 16 parallel research agents ran across two sessions (interrupted
once by a weekly usage cap, resumed after reset): 2 read the actual
`oceanRig*.ts`/`oceanFaunaModels.ts` source to root-cause the camera/pop-in/
visual-quality complaints and to inventory the existing giant-species/rarity
plumbing; 10 researched real marine biology per taxon cluster (citing
peer-reviewed papers, NOAA/MBARI/WHOI/FishBase, or explicitly saying "not
found" rather than inventing a number); 4 searched Poly Pizza / Quaternius /
Kenney / itch.io / OpenGameArt / Sketchfab for license-clean 3D models of the
new taxa. **All 16 completed; several ran twice** (silversides-style deep-sea/
jellyfish/cephalopod/cetacean/crustacean/scaling-law clusters each got a
second independent pass before the final resume finished the 7 that had
failed) — every pass's findings are folded in below, since a second run
sometimes accessed a source the first one couldn't (e.g. the scaling-laws
cluster's second pass got the *actual* Hirt et al. 2017 closed-form equation
after the first pass's PDF fetch had failed).

The user's instruction — *"Không được bịa thông số"* — is honored in its strict
sense throughout: every number below is attributed to a real source, and every
field a research agent could not source is marked "not found" rather than
filled with a plausible-sounding guess.

---

## 2. Current problems — root cause (report §A)

Read directly from source: `oceanRig.ts`, `oceanRigFraming.ts`,
`oceanRigFauna.ts`, `oceanRigBodies.ts`, `oceanFishSkinTexture.ts`,
`oceanRigDrifters.ts`, `oceanFaunaModels.ts`, `OceanRenderer.tsx`.

### 2.1 Camera independence — already fixed, one adjacent check clears too

| Symptom | Status | Evidence |
|---|---|---|
| Fauna heading/position derived from camera elsewhere than the already-known shark fix | **already-fixed** | Every leader's heading comes from `leaderDelta.copy(leaderTarget).sub(leader.position)` (oceanRigFauna.ts:1566-1579) — displacement, never camera orientation. The only remaining `cameraPosition` read is the guarded `species.approachesCamera` block (only `shark`, line 293), which blends the *ring target*, not the heading formula. |
| Jellyfish/marine-snow field re-centring to camera x/z each frame | **not-a-bug** | oceanRig.ts:856-860 — the whole field's parent transform follows the viewer (same technique for both), never a per-individual heading/position leak; jellyfish carry no leader/heading state at all (see §2.3/§6 on what they do carry). |

### 2.2 Visibility pop-in — real, but not the culling mechanism originally suspected

| Symptom | Status | Evidence |
|---|---|---|
| InstancedMesh bounding-sphere frustum culling killing a whole school | **not-a-bug** | `mesh.frustumCulled = false` is set uniformly across fauna/flora/drifters/surface — already disabled everywhere, correctly, because per-instance offsets (up to ~118 m for the whale) would break the default bounding sphere. |
| **Whole rig (every species + seabed + flora) appears/disappears in one frame** | **confirmed-bug** | `OceanRenderer.tsx`'s rig-owning `useEffect` (lines 185-250) tears down and synchronously rebuilds the *entire* `oceanRig` — with **zero cross-fade** — on every change to `viewerMetres, seafloorMetres, waterType, windSpeedMps, cameraDistanceMetres`, sun settings, or `isMobile`. Every species is fully populated to `species.count` from frame 1. New random seeds redraw every position from scratch on rebuild. |
| **A species' whole InstancedMesh geometry snaps from placeholder to loaded GLB with no fade** | **confirmed-bug** | `school.adopt()` (oceanRigFauna.ts:1453-1464) does `mesh.geometry = model.geometry` in one synchronous assignment — every instance of that species changes shape/silhouette in the same frame the async GLB fetch resolves. |
| Fog (`FogExp2`) producing a perceptual hard edge near the visibility boundary | **needs-further-repro** | Mathematically continuous by construction; whether the chosen density reads as "sudden" for a given Jerlov water type needs a live frame capture, not static reading. |

### 2.3 Angular/low-poly close-up and missing anatomy — confirmed, four distinct causes

Two premises from the original bug report were **wrong** and are corrected
here: normal shading on procedural bodies is **not** flat — `bodyGeometry()`
computes an analytic per-vertex normal and `wingGeometry()` calls real
`computeVertexNormals()`, so there are no lighting facets anywhere. And
"purely procedural" is the wrong set to examine: 11 of 27 species carry a real
GLB that replaces the placeholder once it loads. The 16 species that are
procedural **forever** — silversides, anthias, lanternfish, barracuda, orca,
clownfish, pufferfish, viperfish, blackDragonfish, fangtooth, gulperEel,
hatchetfish, giantOarfish, giantIsopod, giantSquid, vampireSquid — are what
the findings below are actually about.

| Root cause | Status | Evidence |
|---|---|---|
| Fixed 8-10 sided cross-section, no LOD, no camera-distance tessellation | **confirmed-bug** | `radialSegments ?? 10` (8 for gulperEel/ribbon, 5 for cephalopod tentacles), built once into a module-level cache and only `.clone()`d per school. No LOD system anywhere in the family — the only "LOD-like" hit is the seabed's static device-quality flag, unrelated to fauna. A decagon reads visibly polygonal once its screen radius exceeds a few pixels, regardless of smooth shading. |
| No eye, mouth, gill, or any facial primitive anywhere in `bodyGeometry()` | **confirmed-bug** | Confirmed by reading all 16 `BodyArchetype` builders — the anglerfish archetype's own comment concedes it: adopted a GLB specifically because "a 13-segment procedural silhouette cannot" carry eyes/teeth. |
| Baked texture paints colour/photophores/isopod-bands only, never a face marking | **confirmed-bug** | `createFishSkinBake()` has exactly 3 draw paths — none is an eye, mouth line, or gill slit. |
| Many species share one byte-identical mesh (deliberate, documented) | **confirmed** (design tradeoff) | `reefFish` is identical for 8 species; `shark` for 4 (a swordfish has no bill, a goblin shark no elongated rostrum); `dolphin` for 2. Differentiation today is size/colour/depth/`SwimStyle` only. |

**Direction, not yet actioned:** a minimal eye primitive for the 16
forever-procedural species; a distance-scaled segment count or 2-tier LOD
swap targeted at `nearField`/`approachesCamera` species; cross-fade the rig
rebuild and the GLB-adopt swap; accept archetype-sharing as-is unless a
specific species' silhouette confusion is reported.

### 2.4 New this pass — two existing-but-dormant mechanisms discovered

Reading `oceanFaunaModels.ts` and `oceanRigDrifters.ts` for the asset-research
and jellyfish clusters surfaced two things not previously known to be there:

1. **`GIANT_MODEL_BINDINGS`** (`oceanFaunaModels.ts:51-56`) already maps 5
   "giant" keys to rescaled existing GLBs: `giant-humpback`/`giant-blue-whale`
   → `fauna-whale.glb` at 14m/25m, `giant-manta` → `fauna-manta-ray.glb` at
   5.5m — these 3 are consumed by `rarity.ts`'s `ocean-whale-passage` roll
   (species: humpback/blue-whale/manta-parade). **But `giant-sperm-whale`
   (→ `fauna-whale.glb` at 16m) and `giant-whale-shark` (→ `fauna-shark.glb`
   at 9m) are dead code today — bound to a model, but never referenced by any
   rarity roll or species table.** This is the same class of finding the
   prior ocean-fauna plan already recorded for a disconnected `giant-squid`
   abyss-visitor label — a real, pre-existing gap, not new debt from this
   research.
2. **`oceanRigDrifters.ts`'s `createJellyfish()`** already implements a real
   bell-contraction-and-relaxation vertex shader on an open-hemisphere
   `SphereGeometry` (`p.xz *= 1.0 + pulse * 0.22; p.y *= 1.0 - pulse * 0.30`,
   driven by `sin(uJellyTime * 1.15 + aJellySeed * 2π)`), rim-lit and
   additively blended for the "95% water" translucency look. This is one
   generic, undifferentiated jellyfish decoration (`uJellyColor` one cyan,
   `uJellyGlow` one constant 0.4) — not tied to `FaunaSpecies`, the rarity
   system, or per-species behavior. §6/§9 below treat this as the real
   starting point for jellyfish species work, not a from-scratch problem.

---

## 3. Current architecture baseline (context for everything below)

- **27 species today** in `OCEAN_RIG_SPECIES` (`oceanRigFauna.ts`). All 27 are
  **always present** within their depth band — no population-level rarity
  gate on the species table itself.
- **One locomotion formula for 26 of 27 species**: `GLSL_UNDULATION`, a
  traveling sine wave along a nose(0)→tail(1) `along` attribute, parameterized
  by `swim.onset/amplitude/waves/beat`, `swim.vertical` (cetaceans),
  `swim.mobuliform`+`span` (manta). Giant squid/vampire squid arms extend the
  `along` range past 1.0 — a geometry trick, not a new gait.
- **One additional, separate mechanism**: `oceanRigDrifters.ts`'s generic
  jellyfish, a radial bell-pulse (see §2.4) — real, but undifferentiated by
  species and outside the `FaunaSpecies`/rarity architecture entirely.
- **No crab-walk, no independent octopus-arm crawl, and no jet-propulsion
  burst mode anywhere in the code.**
- **Rarity today (`rarity.ts`) is 4 independent world-level "rare scene
  feature" Bernoulli rolls**, seeded once per generated world from the
  variant seed: `ocean-bioluminescent-bloom` (p=0.35), `ocean-sunken-relic`
  (p=0.20), `ocean-whale-passage` (p=0.12, species sub-roll among
  `[humpback, blue-whale, manta-parade]`, backed by 3 of the 5
  `GIANT_MODEL_BINDINGS` entries), `ocean-abyss-visitor` (p=0.05, sub-roll
  among `[anglerfish, giant-squid, gulper-eel]`, which **are** roster
  species). This system is fully decoupled from whether the 27
  `OCEAN_RIG_SPECIES` populate — they always do, regardless of these 4 rolls.
  **This is the gap §7 closes**, and the 2 dead `GIANT_MODEL_BINDINGS`
  entries (§2.4) are a nearly-free extension point for it.

---

## 4. Biodiversity proposal (report §B) — full roster with sources

Existing 27 species keep their current tier (effectively "always present")
except where a completed cluster found and sourced a real discrepancy —
those are called out explicitly in §5 rather than silently changed here.

**Existing-roster corrections found (not new species — fixes):**

| Species | Roster value | Real value | Source |
|---|---|---|---|
| turbot | depth 0-400m | ~20-70m, rarely to 100m | FishBase, MarLIN — **largest single existing-data gap found in this whole research pass** |
| shark (reef shark) | 3.4m | grey reef shark max 2.55-2.6m (or ~3.0m if intended as Caribbean reef shark) | FishBase, Aquarium of the Pacific |
| lionfish | 0.52m | FishBase max 0.457m | FishBase |
| goblinShark | depth 700-4000m | real max documented catch depth 1300m | Shark Research Institute, PMC4901258 |
| giantIsopod | 0.5m size | defensible only as max-recorded individual; typical 0.19-0.36m (0.5m is fine to KEEP as the modeled individual, just don't call it "typical") | Briones-Fourzán & Lozano-Alvarez 1991 |
| giantIsopod | locomotion (undulation shader) | **real locomotion is 7-pair-pereopod leg walking + separate pleopod/uropod swim — not a fish-style body wave at all.** Pre-existing mismatch, not introduced by any recent work. | Multiple crustacean-biology sources, cross-confirmed twice |

**New species, by suggested tier** (tier = the researching agent's own
suggestion; ★ = a real, cited, genuinely novel locomotion mode with zero
overlap in the current codebase):

**Common:** moon jelly ★, reef/common octopus (*Octopus vulgaris* recommended;
*O. cyanea* as a more colorful alternate) ★, bigfin reef squid, common
(brown) shrimp ★, moray eel & garden eel ★ (garden eel's real behavior —
burrow-anchored, near-sessile — is a genuine architecture mismatch against
"every species swims freely on a ring," flagged not resolved), Sally
lightfoot crab / Atlantic sand fiddler crab ★, stoplight parrotfish, Pacific
sardine, dolphin/orca/whale (unchanged, verified).

**Uncommon:** manta (verified, unchanged — real kinematic data now on file,
see §5.3), spotted eagle ray, southern stingray, crystal jelly, black
seadevil (redundancy risk vs. existing `anglerfish`, see §5.6 open question),
sarcastic fringehead (real, striking, but shallow — 3-73m — a genuine
habitat mismatch for a "mysterious/deep-sea" label), emperor angelfish,
Nassau grouper, yellowfin tuna.

**Rare:** barreleye fish, cookiecutter shark, box jellyfish ★ (the only true
"jetter," see §5.2), goblin shark (verified, depth corrected), giant isopod
(verified, locomotion flagged).

**Very-rare/legendary:** frilled shark, lion's mane jellyfish, giant Pacific
octopus ★, Japanese spider crab, sperm whale (**nearly-free**: reuse the
already-bound-but-dead `giant-sperm-whale` entry, see §2.4/§7.4), whale shark
(**also nearly-free**: reuse `giant-whale-shark`), megalodon (**zero-asset-cost
via a new giant-species binding to the existing CC0 `fauna-shark.glb`**, see
§8), yeti crab.

**Mysterious/deep-sea:** sea pig ★, headless chicken monster ★, giant sea
spider ★, Atolla jellyfish, deep-sea batfish ★ (walking on fin-derived
"limbs"), giant siphonophore ★ (a colonial multi-body organism — the single
most structurally novel candidate in the whole research pass; may need to be
faked as a stylized long-ribbon reusing the giant oarfish archetype rather
than a true colonial rig), electric eel (real biology is exclusively
freshwater — a deliberate fantasy-license decision if kept in an ocean scene,
see §5.6), torpedo/electric ray or stargazer (the ecologically honest marine
electrogenic alternatives, see §5.6), glass squid and dumbo octopus (weaker
sourcing, cross-cluster overlap with cephalopods — pick one owner before
implementing).

---

## 5. Scientific research (report §C)

All figures are directly attributed; anywhere a source could not be found,
that is stated in-line. Full source lists live in the workflow journal
(`wf_f2a2a939-925/journal.jsonl`); the most load-bearing ones are repeated
here.

### 5.1 Marine locomotion scaling laws — the general formulas §12/§25 asked for

The scaling-laws cluster ran twice; the second pass obtained the full text of
the primary paper the first pass could only get secondary coverage of. This
is the single most reusable output of the whole research pass:

| Relationship | Real shape | Source |
|---|---|---|
| Max/burst speed vs. body mass | **Genuinely a hump, not a plateau — and now with the actual equation.** Hirt, Jetz, Rall & Brose (2017), *Nat. Ecol. Evol.* 1:1116-1122 (full text obtained on the second pass): `v_max = a · M^b · (1 − e^(−h·M^i))`. For the swimming subset (n=109 species): `b = 0.36` (steeper than running's 0.26 or flying's 0.24 — water is 800× denser/60× more viscous than air), `i = −0.56` (this exponent being negative is *why* the curve declines again at very large mass — it is the paper's headline finding, not a plateau). **The constants `a` and `h` sit in a paywalled supplementary table and were not recovered — do not invent them; back-calibrate against 2-3 known real top speeds instead** (e.g. a small reef fish, a fast tuna/marlin, orca). Within water, ectotherms (fish) are significantly *faster* than endotherms (marine mammals) of equal mass — the opposite of the pattern on land — because semi-aquatic-to-aquatic transitions carry much higher cost-of-transport plus thermoregulation overhead. |
| Cruise (steady) speed vs. body size | **Flat / near-independent of size**: `U = 1.88 × mass^-0.05` (not significant, i.e. genuinely flat) across 0.5-30,000 kg, seabirds to sperm whales, clustering at ~1-2 m/s. Independently reproduced within just baleen whales: cruise speed ∝ length^0.08 (~2 m/s, "roughly invariant," 9-30m body-length range). This flat-cruise result is shown for diving megafauna — small reef fish instead follow Bainbridge's classic relationship (declining max tail-beat frequency with size; amplitude plateaus at ~0.2 body length at ~5Hz). | Sato et al. (2007), *Proc. R. Soc. B* 274:471-477 (full text read); Gough et al. (2019), *J. Exp. Biol.* 222:jeb204172 (full text read); Bainbridge (1958), *J. Exp. Biol.* 35:109-133. |
| Fin/fluke beat frequency vs. body size | **Monotonically decreasing power law, no plateau — the best "one formula for everything" candidate.** `f = 3.56 × mass^-0.29` (R²=0.99) birds→sperm whales; `f ∝ length^-0.53` within rorquals. Recommend `beat ∝ size^-b`, `b` in 0.3-0.5. | Sato et al. (2007); Gough et al. (2019). |
| Turning radius vs. body size | **Not monotonic — body *plan* matters more than raw size**, now with real anchors across the FULL small-to-giant range: reef fish (angelfish *Pterophyllum eimekei* and 7 others, Domenici & Blake 1997 review, full PDF read, their Table 2) 0.055-0.09 BL at up to ~8000°/s during a fast-start C-turn; bottlenose dolphin (2024 arXiv biologging study, `arXiv:2411.17688`, original measurements) 0.45-0.8 BL, 75-105°/s peak; **manta ray** (Fish, Schreiber et al. 2018, *J. Exp. Biol.* 221:jeb166041 — dense kinematic dataset, directly usable) mean turn rate 18.26±5.90°/s (max 67.32°/s), mean radius 5.82±2.16m but median only 1.75m, min radius-to-body-length ratio 0.38, banks 3-80° like an aircraft; Pacific bluefin tuna 0.4-1.7 BL (Marras et al. 2023, *J. Exp. Biol.* 226:jeb244144); blue whale — no direct radius/rate figure exists, but Segre et al. (2022, *J. Exp. Biol.* 225:jeb243224, 700 turns over a 29-hour tag deployment) give median centripetal acceleration 0.06 m/s² for ordinary turns (vs. 0.46 m/s² for an actively bubble-net-feeding humpback's banked turn — 8× higher, a genuinely different behavioral regime) — combining that with the ~2 m/s rorqual cruise speed via `r=v²/a` gives a **derived (not directly sourced) engineering estimate of ~67m radius / ~1.7°/s** for an ordinary blue-whale turn, which normalizes to only ~2.2× body length — i.e. *relative* turning radius does **not** explode with size the way naive isometric scaling predicts, matching Segre et al.'s "larger whales outperform expectations" finding. | Domenici & Blake (1997); arXiv:2411.17688 (2024); Fish et al. (2018); Marras et al. (2023); Segre et al. (2022); Gough et al. (2019). |

**Engineering read:** turning radius should key off body-plan archetype
(reef-fish-tight / dolphin-agile / tuna-rigid / whale-large-but-flexible),
not size alone — a real, sourced argument for a second axis beside the
already-shipped size-scaled turn-rate cap. The manta ray dataset in
particular is dense enough (turn rate, radius, banking angle, centripetal
acceleration, all with means and maxima) to implement directly rather than
extrapolate.

### 5.2 Jellyfish — partially implemented already (§2.4), rower vs. jetter is real

| Species | Bell size | Depth | Locomotion style | Key sourced numbers |
|---|---|---|---|---|
| Moon jelly (*Aurelia aurita*) | 0.25-0.40m (max ~0.50m) | 0-200m (records to 1000-1250m) | **Rower**: thrust on *both* the contraction and the passive relaxation/refill (a second vortex-ring pair slips under the bell) | Cruise ~3-6 cm/s (secondary-sourced, not traced to a primary paper); optimal pulse frequency 0.50±0.05 Hz; passive-recapture adds ~30% distance/cycle, 48% cost-of-transport saving; turns via *asymmetric* contraction (inside-of-turn margin fires earlier/stronger, ~30ms neural delay) — the animal "skids" rather than yawing a nose vector |
| Crystal jelly (*Aequorea victoria*) | 0.02-0.25m | not found | Inefficient swimmer, mostly passive drift | No cm/s or Hz figure found anywhere. **Correction to common belief: no equivalent green-eye-bioluminescence tension here** — its GFP glow is real but faint, bell-margin only. |
| Atolla jellyfish (*Atolla wyvillei*) | 0.02-0.174m bell + one tentacle to 6× bell diameter | 500-5000m (MBARI; a secondary source says 1000-4000m) | Slow rower, hover-and-drift | Famous "burglar alarm" bioluminescent defense — rotating flashes at 5-50 cm/s propagation, meant to attract a *third-party* predator to attack the attacker |
| Lion's mane (*Cyanea capillata*) | Bell 0.5-1.0m typical, record 2.29m; tentacles to 37m (rivals a blue whale in linear extent — the 1870 record is widely repeated but not independently primary-verified) | not found (cold epipelagic) | Weak rower, current-dominated drifter | Only quantified figure: 3.75 bell-diameters/min *vertical* swim speed |
| Box jellyfish (*Chironex fleckeri*) | Bell 0.16-0.35m | mostly <5m (rare records >50m) | **True jetter**: a *velarium* concentrates the jet; 2-3 Hz pulse (higher when smaller); below ~4cm bell size propulsion is almost pure jet, above it becomes a jet/rowing hybrid; low Froude efficiency (<20-40%) traded for speed | Measured 16.6 cm/s (Shorten et al. 2005, *J. Zoology* 267:371-380 — peer-reviewed, prefer this over the widely-repeated but untraceable "4 knots" claim); **experimentally demonstrated active visual steering** in the congeneric *Tripedalia cystophora* (24 image-forming eyes across 4 rhopalia; darkening on one side of the visual field biases contraction/reorients heading — obstacle avoidance) — the only jellyfish with anything resembling the fish-style "intended heading" model |

**Architecture implication:** §2.4 already found the existing
`createJellyfish()` bell-pulse shader — real rower-family mechanics, already
built. What's missing is (a) species differentiation (color, size, glow,
pulse rate — all straightforward parameters on the existing shader), (b) a
genuinely different **jetter** pulse profile for box jellyfish (faster,
tighter, hybrid-thrust), and (c) real steering — every current jellyfish
"heading" is passive drift; only box jellyfish has sourced grounds for active
heading-seeking, and even that is extrapolated from a different (but
same-clade) species.

### 5.3 Cephalopods — a real two-mode system, direction independent of orientation

Ran twice; consistent findings, richer citations on the second pass (Levy,
Flash & Hochner 2015, *Current Biology* 25:1195-1200, read in full).

| Species | Size | Depth | Locomotion | Key numbers |
|---|---|---|---|---|
| Common octopus (*Octopus vulgaris*, recommended) | Mantle 0.15-0.25m | 1-200m | **Dual-mode + direction-independent-of-orientation.** Levy et al. (2015), studying *O. vulgaris* directly: arms are recruited opportunistically (whichever points roughly opposite the desired travel direction), **not** in a fixed sequence — crawling direction is fully decoupled from body/eye orientation, something no fish-style species can do. | No *O. vulgaris*-specific speed found; best proxy (*Abdopus aculeatus*, Huffard 2006, *J. Exp. Biol.* 209:3697-3707): crawl 7.3 cm/s (0.62 BL/s avg), jet burst up to 70 cm/s (~10× crawl). A rare bipedal "rolling gait" (2 arms walk, 6 curl for camouflage) is documented in 2 *other* octopus species (Huffard, Boneka & Full 2005, *Science* 307:1927) — not confirmed for *O. vulgaris* but real evidence the genus has no fixed leg count. |
| Giant Pacific octopus (*Enteroctopus dofleini*) | Mantle 0.3-0.6m, arm span 2-4+m | 750-1500m (2 institutions disagree) | Same dual-mode, larger scale; swims head-first via jet (looks "backward" per Monterey Bay Aquarium) | No species-specific speed found at all; every online "25mph jet" claim is unverified folklore. |
| Bigfin reef squid (*Sepioteuthis lessoniana*) | 0.25-0.38m | 0-100m | **Fin-undulation cruise** (closer to manta's mobuliform mode than the existing arm-wave squid archetype) + jet burst; documented schooling in belt/ball/sheet formations, 8-100+ individuals, ~2.0 mantle-length spacing | Only juvenile/paralarval speed data exists (17.1→4.6 BL/s over first 2 months) — not an adult figure. |
| Humboldt squid (*Dosidicus gigas*, alternate mid-rarity pick) | Mantle to ~1.5-2m, ~50kg | Diel migrator, ~200-250m by day | **Best-sourced cephalopod kinematics of the whole cluster** — Gilly et al. (2012), *J. Exp. Biol.* 215:3175-3190, read in full via archival pop-up tags: >80% of time spent gliding at near-zero velocity, punctuated by jet bursts | Sustained horizontal 0.5 m/s; active descent 0.16±0.07 m/s (vs. passive sink 0.054±0.004 m/s); ascent 0.27±0.02 m/s; peak vertical jetting to 1.0 m/s, max recorded vertical 3 m/s. |

**Architecture implication (stated directly by the research):** the existing
`GLSL_UNDULATION` extended-`along` trick captures arm *extension* motion but
none of: independent per-arm activation/timing, the crawl-vs-jet dual-speed
regime, or orientation-independent crawling direction. A real octopus
implementation is a materially different locomotion feature. The research
also surveyed how games/robotics fake this without full soft-body physics:
**FABRIK (Forward And Backward Reaching IK)** is the standard tentacle-chain
solver, often with per-bone axis-cycling (X/Y/Z alternating) to fake a
muscular hydrostat's any-axis bend with single-axis joints, plus procedural
noise layered on top — real robotics/soft-robotics surveys confirm nobody
fully simulates true hydrostat physics either, so a stylized IK approximation
is not a compromise unique to this project.

### 5.4 Cetaceans — verification + one genuinely new species (ran twice, consistent)

Dolphin (2.6m) and orca (7m) sizes check out against NOAA figures — no size
change needed. Real, actionable findings:

- **Dolphin turning, fully quantified**: 0.08-0.20 BL radius, 561.6°/s mean /
  1372°/s max (Maresh et al. 2004); a 2024 biologging paper independently
  confirms 0.45-0.8 BL / 75-105°/s peak on 3 live individuals — two
  independent real datasets agreeing.
- **Orca has a real, uncaptured dual-speed-regime fact**: wild orcas travel at
  only ~1.6 m/s most of the time (60-66.5% of observed time) despite a more
  efficient 2.6-3.1 m/s pace being available (Williams & Noren 2009, *Marine
  Mammal Sci.*, full text read twice) — they mostly don't use it. The current
  "reuses dolphin archetype" shortcut cannot express this. Orca turning
  radius has **no** peer-reviewed species-specific figure — any number used
  is an assumption extrapolated from dolphin (same family, larger body).
- **Generic `whale` (13m) has no committed species identity** — defensible for
  either humpback (12-16m) or gray whale (12.8-15m); the two have materially
  different real cruise speeds (humpback 3.58-9.2 km/h depending on migration
  direction and whether singing; gray whale a flatter ~2-2.2 m/s). **Open
  decision, not a research gap** (§5.6).
- **Sperm whale** (new, or rather: *already bound* — see §2.4/§7.4): ~16m
  typical large male. The causal chain is real and citable: head ~1/3 of
  body length houses the spermaceti organ that focuses echolocation clicks,
  which is *why* it dives 600-1000m+ routinely to hunt squid in lightless
  water (NOAA). Descent is continuous powered stroking (glide fraction 5.3%);
  ascent is intermittent stroke-and-glide (37.7% glide) — Miller et al.
  (2004), *J. Exp. Biol.* 207:1953-1967, descent 1.45±0.19 m/s / ascent
  1.63±0.22 m/s, directly measured. Surfaces to "raft" and breathe roughly
  once per 10s for up to ~10 min after a dive. Real predator of the roster's
  existing giant squid, at the same depth band (300-2000m).

### 5.5 Reef & pelagic bony fish (previously missing, now complete)

| Species | Roster status | Key finding |
|---|---|---|
| Butterflyfish, lionfish, turbot, reef shark, swordfish, barracuda, clownfish, pufferfish | Existing, verified | See §4's correction table — turbot and reef-shark size/depth are the two clearest mismatches found in the whole research pass. |
| **Speed-claim myth-busting** (cross-cutting, applies beyond fish) | — | Svendsen et al. (2016), *Biology Open*, PMC5087677, directly re-measured several "impossibly fast" pelagic predators via muscle-contraction-time/stride-length methodology and found real maxima **3-10× lower** than popular claims: sailfish 8.3±1.4 m/s (not ~30 m/s), barracuda 6.2±1.0 m/s (not ~16 m/s / 36mph). **Recommend treating any similarly "too-fast" popular figure for a fast pelagic predator (swordfish "50mph", yellowfin "40-50mph") with the same skepticism** — the swordfish and tuna entries below explicitly flag this. |
| Stoplight parrotfish (*Sparisoma viride*, new) | 0.64m max, 3-50m | Labriform swimmer; real, sourced, striking behavior: secretes a mucus cocoon at night — only 10% of cocooned fish were attacked by parasites vs. 95% uncovered (Univ. of Queensland 2010 study) |
| Nassau grouper (*Epinephelus striatus*, new) | 1.22m max, 1-90m | Sit-and-wait ambush; famous multi-thousand-fish lunar-cycle spawning aggregations; Critically Endangered (IUCN) |
| Yellowfin tuna (*Thunnus albacares*, new) | 2.39m max, 1-1602m | Thunniform obligate ram-ventilator; tracked cruise 0.72-1.54 m/s; burst speed is a same-tribe proxy (little tunny, 5.6 m/s, Svendsen et al.), not a direct measurement; turning radius proxied from Pacific bluefin (0.4-1.7 BL) |
| Pacific sardine (*Sardinops sagax*, new) | 0.36-0.40m max, 0-200m | Classic clupeid schooler; South Africa's "Sardine Run" is a real, cited, massive migration (shoals up to 15km long) — a strong visual set-piece precedent |
| Emperor angelfish (*Pomacanthus imperator*, new) | 0.40m max, 1-100m | Dramatic ontogenetic color change (juvenile rings vs. adult stripes); turning-radius data is the general reef-fish proxy (Gerstner 1999), not species-specific |

### 5.6 Elasmobranchs — manta verified in depth, megalodon and whale shark now sourced

| Species | Size | Depth | Key finding |
|---|---|---|---|
| Manta ray (existing, verified) | 4.2m — matches real 3-5m typical adults | 0-220m (dives to 400-1000m+) | **Fully quantified kinematics**, see §5.1 — directly implementable. |
| Reef shark, goblin shark (existing) | See §4 correction table | — | Both roster values exceed documented real maxima/depth; flagged as likely deliberate gameplay embellishments, not errors, but now explicitly on the record. |
| Spotted eagle ray (*Aetobatus narinari*, new) | Disc width to ~3.0-3.05m, total length to ~5m | 0-80m | **Aetobatiform** — a real third locomotion mode between manta's oscillatory flap and a stingray's rippling wave; documented full-body leaps clear of the water when pursued. |
| Southern stingray (*Hypanus americanus*, new) | Disc width to 2.0m | 0-55m | **True rajiform** — a continuous chordwise wave down the fin margin at roughly constant amplitude (visually distinct from manta: more waves visible at once, no flap phase); measured only in smaller related species (0.22-0.55 m/s, *Taeniura lymma*/*Potamotrygon orbignyi*) — extrapolating to a 2m adult is a flagged assumption. |
| Whale shark (*Rhincodon typus*, new) | Verified max 18.8m (largest fish alive) | 0-200m mostly, tagged dives to ~1900m | Cruise ~1.3 m/s, feeding ~1.0 m/s (NOAA/FishBase); **can reuse the already-bound-but-dead `giant-whale-shark` entry (§2.4) at zero new asset cost.** |
| Megalodon (*Otodus megalodon*, new, extinct) | **Genuinely disputed in the literature** — 15-16m robust-body reconstruction (Cooper et al. 2020/2022, *Scientific Reports*/*Science Advances*) vs. ~24.3m slender-body reassessment; a third study (Shimada et al. 2023, skin-scale texture) argues against sustained fast swimming altogether, contradicting the 2022 model's "faster than any living shark" framing | Inferred, not measured (extinct — cartilage doesn't fossilize, known only from teeth/rare vertebrae) | Modeled by all cited studies on modern lamniform sharks (great white, mako, salmon shark, porbeagle) — **fully compatible with the existing shark archetype/GLB, scaled up.** Present as an explicit range with the disagreement stated, not one settled number. |

### 5.7 Eels and electrogenic fishes — a real taxonomic tension, resolved with alternatives

| Species | Locomotion | Key finding |
|---|---|---|
| Moray eel (*Gymnothorax* spp.) | **Purest anguilliform case in nature** — no pectoral/pelvic fins at all, ~100% axial body-wave with nothing else to offload propulsion onto | Documented interspecific cooperative hunting with groupers (Bshary et al. 2006, *PLOS Biology*) and a second, independently-mobile set of pharyngeal jaws that launch forward to drag prey back (Mehta & Wainwright 2007, *Nature*) — both real, citable, and outside this task's locomotion scope but worth flagging. |
| Garden eel (*Heterocongrinae*) | Vestigial — spends its whole life tail-anchored in a burrow | Real behavior is anterior-third sway while feeding + near-instant full-body retraction when alarmed, **not** free swimming — a genuine architecture mismatch against "every species swims on a ring" if implemented faithfully. |
| **Electric eel** (*Electrophorus*) | Gymnotiform — undulates a long ventral anal fin, keeping the trunk rigid; **mechanically distinct from anguilliform**, reusing the fish-body wave would misrepresent it | **Confirmed exclusively freshwater**, and not a true eel (Gymnotiformes, phylogenetically closer to catfish than to Anguilliformes) — an ocean-scene placement is a deliberate fantasy-license call, not a biology question. Real EOD biology has two separable purposes: a high-voltage brief stun/defense discharge (up to ~600-860V) and a *separate*, low-voltage (<10V) continuous electrolocation organ (Sachs' organ) — a real, generalizable pattern for any "electric" visual effect design. |
| Torpedo/electric ray (*Torpedo nobiliana*, marine alternative) | Mobuliform-adjacent (batoid disc undulation), **not** anguilliform | 8-220V depending on genus; two discharge types (repeated warning pulses vs. sharp hunting stun) parallel the electric eel's two-organ split. Can reuse the existing `manta` archetype (rounder disc, stubby tail) rather than a new archetype. |
| Stargazer (*Astroscopus* spp., marine alternative) | Buried ambush, minimal locomotion | Electric organ derived from modified eye muscle (not trunk muscle), ~50V (lower-confidence source); closer behaviorally to the existing turbot/garden-eel buried-ambush niche than to a swimming eel. |
| Gulper eel (existing, verified) | Consistent with roster's 500-3000m/0.8m | Real biology suggests a *low*-effort drifter parameterization (low onset/amplitude/beat), not an active cruiser — a tuning note, not a new number. |

**Open decision, not a gap:** does the team want the electric eel as a
deliberate freshwater-cameo fantasy inclusion, swap it for a marine
electrogenic species (torpedo ray or stargazer, both real and sourced), or
ship both?

---

## 6. Locomotion taxonomy (report §D) — updated with what's actually built

| Family | Real examples | Current shader fit |
|---|---|---|
| Body/caudal undulation (fish) | Existing 27, frilled shark, moray/garden eel | **Already implemented** |
| Fluke oscillation (cetaceans) | Dolphin, orca, whale, sperm whale | **Already implemented** — `swim.vertical` |
| Mobuliform fin-wave (rays) | Manta, torpedo ray (proposed reuse) | **Already implemented** — `swim.mobuliform`+`span` |
| Rajiform fin-wave (true stingray) | Southern stingray | **Not implemented** — a new parameter combination (continuous chordwise wave, constant amplitude, no flap phase) on the mobuliform family, not new shader code |
| Fin-undulation cruise (finned squid) | Bigfin reef squid | **Likely cheap** — reuse mobuliform math on different fin geometry |
| Arm-wave via extended geometry (existing trick) | Giant squid, vampire squid | **Already implemented**, but a geometry trick, not a real per-arm gait |
| Independent per-arm crawl + mantle-jet burst, direction independent of orientation | Octopus (all species) | **Not implemented, real architectural lift** |
| **Radial bell contraction/relaxation** | All jellyfish | **Partially implemented** — `createJellyfish()` already has the core shader (§2.4); missing per-species differentiation and a distinct jetter profile |
| Discrete multi-limb walk (rigid body) | Crab, shrimp (walking phase), Japanese spider crab, giant isopod (*currently mis-modeled*), giant sea spider, yeti crab, deep-sea batfish | **Not implemented at all** — turning decouples from body shape entirely |
| Caridoid tail-flip burst | Shrimp, krill (analog) | **Not implemented** — a ~42ms near-instant reflex |
| Hydraulic tube-foot stilt-walk | Sea pig | **Not implemented**, novel |
| Multi-part soft-body swim + ballast-dump launch | Headless chicken monster | **Not implemented**, novel |
| Colonial multi-body pulsation | Giant siphonophore | **Not implemented, structurally hardest** — genuinely not a single-mesh organism; likely needs a stylized fake (long-ribbon reuse of the giant oarfish archetype) rather than a true multi-body rig |
| Near-motionless hover with rare reorientation | Barreleye fish | **Not implemented** — the opposite of every species' always-cruising ring pattern; needs a low-activity idle state |

---

## 7. Rare spawn design (report §E) — proposal, using the existing pattern

**The existing `rarity.ts` mechanism already solves the hard part —
independent concurrent Bernoulli rolls — it is just scoped to world-level
scene features, not species population.** The proposal below extends the
*same* pattern to species presence.

### 7.1 Mechanism

Add a `rarityTier` field to `FaunaSpecies`. `common`/`uncommon` species keep
today's behavior exactly. `rare`+ get a second, independent gate: a
per-species Bernoulli roll seeded `variantSeed + "-ocean-species-" +
species.key` (exactly `rarity.ts`'s existing `<seed><suffix>` pattern).
Eligible only if the world's depth band overlaps the species' habitat.
Because every species rolls independently, multiple rares can co-exist with
no `maxRareCreatures=1` rule — architecturally identical to how
`bioluminescent-bloom` and `whale-passage` can already both hit today.

### 7.2 Calibrating the 30-45% target

```
P(at least one rare species present) = 1 − ∏ᵢ (1 − p_i)
```

Worked example — 8 eligible rare-tier species at p=0.05 each (mirroring the
existing `ocean-abyss-visitor` probability): `1 − 0.95^8 ≈ 33.7%`, inside the
target band from a non-arbitrary starting point. **Must be verified by
simulation across many real seeds once implemented**, not trusted from the
formula alone.

### 7.3 Concurrency and performance

No hard cap proposed. Every very-rare/legendary/mysterious candidate
researched here is solitary or near-solitary (`count` 1-4), unlike the mass
schools already running in the hundreds — concurrent rares add a handful of
instances at most.

### 7.4 Two nearly-free wins found this pass

`giant-sperm-whale` and `giant-whale-shark` in `GIANT_MODEL_BINDINGS` are
**already bound to existing CC0 GLBs at correct rescaled proportions** (§2.4)
but connected to no rarity roll. The cheapest possible implementation of two
of the user's explicitly-requested legendary species is: add both as a species
sub-roll (either folded into a new roll, or added to `ocean-whale-passage`'s
existing species list) — zero new downloads, zero new licensing, zero new
archetype code. Megalodon can follow the identical pattern against
`fauna-shark.glb` (§8) for the same zero-asset cost.

### 7.5 Open naming/placement decisions this section surfaced

- Should Atolla jellyfish be a depth-banded population member or folded into
  `ocean-abyss-visitor`'s existing species list?
- The yeti crab is strictly vent-endemic — better modeled as a new
  scene-feature roll (a vent-chimney set-piece) than a depth-banded species.
- Black seadevil vs. the existing generic `anglerfish` needs one decision
  before either is implemented.

---

## 8. 3D asset research (report §F) — complete

All 4 asset-research agents completed. The pattern from the prior ocean-fauna
plan repeats almost exactly: **no CC0 model exists for any newly-researched
species except one.**

| Taxon | Finding | Recommendation |
|---|---|---|
| **Crab** | A real, usable, CC0, already-rigged (idle + walk cycle) low-poly crab exists on **OpenGameArt**: `opengameart.org/content/crab-low-poly-animated-3d-model` (832 tri, hosted as a direct download, not gated behind Sketchfab) | **use-as-is** (or lightly reskin with a baked canvas texture to match house style) |
| Shrimp, giant isopod, Japanese spider crab | No CC0/CC-BY-with-a-workable-download-path model found anywhere (Sketchfab hits exist for isopod/spider-crab but are unverifiable client-rendered pages, and the spider-crab museum scan specifically risks a non-commercial research license) | **create-procedural** — extend the existing procedural pipeline; a purpose-built segmented/plated geometry helper + baked texture |
| Jellyfish (all 3 species) | Quaternius (this project's preferred, CC0, already the source of all 13 shipped fauna GLBs) has **no jellyfish at all** in its catalog. Every real Sketchfab candidate (moon jelly by foxcc, box jellyfish by "n-") is CC-BY, which breaks this project's own documented **CC0-only bar** for the ocean family (`ATTRIBUTION.md`), and Sketchfab's download endpoint is independently documented (same file) to **401 without an OAuth token**, making it non-automatable regardless of license | **create-procedural** — and cheaper than it sounds: `createJellyfish()` already exists (§2.4); this is species-differentiation + one new jetter profile, not new geometry from zero |
| Reef octopus, giant Pacific octopus, reef squid | The one standout find — `ffish.asia`/`floraZia.com`'s **genuine CC0** photogrammetry scan of the exact right species (*Sepioteuthis lessoniana*) — is a raw ~2.3-million-triangle static scan with zero rig; retopology+rigging from scratch costs as much as building fresh. Every rigged Sketchfab candidate is CC-BY and/or has an unverified/likely-generic (not per-arm) rig | **create-procedural** — reuse the existing `tentacleGeometry()` helper (already built for giant/vampire squid), optionally using the ffish.asia scan as a free anatomical reference only |
| Moray/garden eel, electric eel, torpedo/electric ray | No CC0 model for any of the three anywhere checked; real CC-BY candidates exist on Sketchfab but hit the same 401-without-OAuth wall | **create-procedural** — extend the existing `gulperEel` archetype (moray: shorter/thicker; electric eel: near-finless, periodic discharge glow like `blackDragonfish`'s override) and the existing `manta` archetype (torpedo ray: rounder disc, stubby tail) |
| **Sperm whale** | Best free candidate found (Sketchfab, CC-BY, 634 faces, 13 real animation clips) is good but not CC0 — **moot regardless, since `giant-sperm-whale` already reuses the existing CC0 `fauna-whale.glb` rescaled (§2.4)** | **use-as-is** (already committed asset, just needs wiring — §7.4) |
| **Megalodon** | The only genuinely CC0 Sketchfab result is a digitized fossil *tooth*, not a body. Every full-body megalodon found is CC-BY and hits the 401 wall | **use-as-is** — bind a new `giant-megalodon` entry directly to the existing CC0 `fauna-shark.glb` at 15-18m, following the exact pattern already proven for `giant-whale-shark` and for barracuda-reusing-shark |

**Two project conventions this pass reconfirmed, not new:** the ocean family
holds to a **CC0-only bar** (documented in `ATTRIBUTION.md`, and the reason
several technically-usable CC-BY finds above were still marked
create-procedural), and **Sketchfab is not agent-automatable** — its download
endpoint 401s without an OAuth token regardless of a model's license or
`isDownloadable` flag, so any Sketchfab asset would need a human to log in
and download it manually.

---

## 9. Visual quality plan (report §G)

Unchanged from the root-cause findings in §2.3, in priority order: (1) a
minimal eye primitive for the 16 forever-procedural species; (2) a
distance-scaled segment count or 2-tier LOD swap for `nearField`/
`approachesCamera` species; (3) accept archetype-sharing as-is unless a
specific silhouette confusion is reported; (4) fix the giant isopod's
locomotion mismatch (§4/§5.6) independent of adding any new crustacean.

---

## 10. Recommended parameters (report §H)

Values in **bold** are directly sourced; values in *italic* are a flagged
engineering assumption (a related species' congener figure); "—" means no
findable source at all — use §5.1's general scaling formulas rather than
guessing a per-species number.

| Species | Size (m) | Cruise speed | Max/escape | Turn note | Confidence |
|---|---|---|---|---|---|
| Manta (existing) | 4.2 (unchanged) | **1.42±0.50 m/s** (0.46-2.51 range), 0.25-0.47 foraging | **2.78-4.17 m/s** (mating-train pursuit) | **18.26±5.90°/s mean, 67.32°/s max, 0.38 min radius/BL** | high — dense peer-reviewed dataset |
| Dolphin (existing) | 2.6 (unchanged) | **1.5-3.8 m/s** (definition-dependent) | **5.7-8.1 m/s measured** | **0.08-0.8 BL, 75-1372°/s** (two independent studies) | high |
| Orca (existing) | 7 (unchanged) | **1.6 m/s typical / 2.6-3.1 m/s efficient** | *~48-65 km/h (unverified secondary)* | *extrapolated from dolphin, no orca-specific figure* | mixed |
| Sperm whale (bind existing GLB) | **~16 typical male** | *~2.06 m/s surface (secondary)* | **1.45-1.63 m/s vertical dive/ascent (peer-reviewed)** | not researched | mixed |
| Whale shark (bind existing GLB) | **18.8 verified max, 5.5-12 typical** | **~1.3 m/s cruise, ~1.0 m/s feeding** | *~1 BL/s brief burst (lower-tier source)* | — | mixed |
| Megalodon (bind existing GLB) | **15-16m (Cooper et al.) to ~24.3m (slender-body reassessment) — disputed** | **~1.4 m/s (16m model) or ~0.6-1.0 m/s (24m model) — disputed** | — | — | low, by nature of the source (extinct) |
| Barracuda (existing) | 1.8 (unchanged, matches real data) | — | **6.2±1.0 m/s measured (prefer over popular ~16 m/s claim)** | — | high |
| Swordfish (existing) | 2.6 (unchanged) | — | *~8 m/s (sailfish proxy; reject the popular ~22 m/s claim)* | — | mixed |
| Yellowfin tuna (new) | **2.39 max** | **0.72-1.54 m/s tracked** | *5.6 m/s (little tunny proxy)* | *0.4-1.7 BL (Pacific bluefin proxy)* | mixed |
| Reef octopus (new) | **~0.25 mantle** | *7.3 cm/s / 0.62 BL/s (congener)* | *70 cm/s / 1.73 BL/s (congener)* | near-instant, orientation-independent | congener extrapolation |
| Humboldt squid (new, alternate) | **~1.5-2 mantle** | **0.5 m/s sustained (direct measurement)** | **1.0 m/s peak vertical, 3 m/s max recorded** | — | high — direct tag study |
| Box jellyfish (new) | **0.16-0.35** | **0.166 m/s (measured)** | *~2.06 m/s ("4 knots", unverified* | vision-guided, ~1 Hz pacemaker | mixed |
| Moon jelly (new) | **0.25-0.40** | *~0.05 m/s (secondary)* | — | asymmetric-contraction skid, ~30ms lag | mixed |
| Fiddler/reef crab (new) | **0.02-0.10 carapace** | **1.7-4.4 cm/s sustained (direct)** | *2.1 m/s (ghost-crab congener sprint)* | differential-leg stepping, no body bend | high for cruise, congener for sprint |
| Japanese spider crab (new) | **leg span to 3.7-4m, 16-20kg** | — | — | — | size only |
| Giant isopod (existing, correct) | 0.5 max-confirmed, **typical 0.19-0.36** | — | — | **walks on 7 leg pairs, does not undulate** | high |
| Sea pig, headless chicken monster, giant sea spider (new) | **sourced, see §5.7/§4** | — | — | — | size/depth only, zero kinematic data exists in the literature for any of them |

Full detail and every citation for every row is in §5 above and the workflow
journal.

---

## 11. Proposed architecture (report §I)

1. **Rarity** (§7): extend `FaunaSpecies` with `rarityTier`; per-species
   Bernoulli gate for `rare`+ reusing `rarity.ts`'s exact pattern. Two
   species (sperm whale, whale shark) are nearly free (§7.4); megalodon
   follows the identical zero-asset pattern via a new `giant-megalodon`
   binding to the existing shark GLB.
2. **Jellyfish**: NOT a from-scratch system — extend the existing
   `createJellyfish()` shader with per-species uniforms (color, glow, pulse
   rate/amplitude) for the rower species, and a genuinely new **jetter**
   profile (faster, tighter pulse, lower amplitude, real steering) for box
   jellyfish specifically.
3. **New locomotion families as new, parallel systems**, not shader
   parameters on the existing one:
   - A **per-arm crawl + jet-burst system** for octopus (each arm its own
     phase; direction independent of body orientation, per Levy et al. 2015)
     — the research recommends an IK-chain (FABRIK) + traveling bend-wave
     hybrid, matching how the field itself approximates this without full
     soft-body physics.
   - A **discrete multi-limb walk system** for crab/shrimp/isopod/sea-spider/
     yeti-crab/batfish (leg IK or phase-offset leg-swing; heading decoupled
     entirely from body deformation).
   - A **tube-foot stilt-walk** (sea pig) and a **veil-flap pulse-swim +
     ballast-dump launch** (headless chicken monster) — both low
     species-count (1 each), low total cost.
   - A **caridoid tail-flip** reflex layered onto the shrimp walk/swim state.
   - **Giant siphonophore deferred or stylized**: the research is explicit
     this is the structurally hardest candidate (a true colonial organism);
     recommend a long-ribbon stylization reusing the giant oarfish archetype
     rather than a genuine multi-body rig, at least for v1.
4. **Visual quality** (§9): additive — an eye primitive helper, an optional
   LOD parameter threaded through `bodyGeometry()`/`tentacleGeometry()`.
5. **Pop-in fix** (§2.2): cross-fade the rig-rebuild `useEffect` and the
   `adopt()` GLB swap, or patch `createOceanRig` in place for live-changing
   props instead of full teardown.

---

## 12. Implementation roadmap (report §J)

1. **Nearly-free wins first**: wire `giant-sperm-whale` and
   `giant-whale-shark` into a rarity roll; add `giant-megalodon` bound to the
   existing shark GLB. Zero new assets, zero new geometry — pure plumbing
   plus the sourced parameters in §10.
2. **Rarity mechanism** (§7) for the rest of the roster — additive, lowest
   architectural risk, calibrate via seed simulation.
3. **Visual quality quick wins** (§9): eye primitive, LOD for near-field
   species, giant-isopod locomotion correction.
4. **Pop-in fix** (§2.2).
5. **Jellyfish species differentiation** on the existing `createJellyfish()`
   shader (moon jelly, crystal jelly, Atolla as rowers; box jellyfish as the
   first real jetter) — cheapest of the "new locomotion family" work since
   the core mechanism already exists.
6. **Crab** — the one taxon with a real, usable, already-rigged CC0 asset
   (§8); reskin to match house style, build the discrete-walk system around
   it, then reuse that same walk system for shrimp/isopod/spider-crab/
   sea-spider/yeti-crab/batfish (§11 item 3).
7. **Octopus per-arm system** — reef squid can likely ride the existing manta
   mobuliform math instead of needing this system.
8. **One-off novel systems** (sea pig, headless chicken monster, giant
   siphonophore) only if those specific species are prioritized — lowest
   species-count-per-system ratio in the whole roadmap.
9. **Content pass**: bodies/textures/roster entries for whichever systems
   from steps 5-8 are built, using §10's sourced parameters, flagging any
   still-missing figure explicitly in code comments rather than inventing
   one at commit time.

---

## 13. Consolidated open questions carried from research agents

- Which real species (if any) is the existing generic `anglerfish` modeled
  on? Determines whether black seadevil is a new entry or a correction.
- Does the generic `whale` (13m) represent humpback or gray whale? Their real
  cruise-speed citations differ.
- Should Atolla jellyfish be a depth-banded population member or folded into
  `ocean-abyss-visitor`'s roll?
- Should the yeti crab become a vent-chimney scene-feature roll rather than a
  depth-banded species?
- Is a genuine ectoparasitic attach-and-bite mechanic wanted for the
  cookiecutter shark, or a small background species with no unique flag?
- Should orca get its own swim parameters (the real 1.6 vs. 2.6-3.1 m/s
  dual-speed finding) instead of reusing the dolphin archetype wholesale?
- *Octopus vulgaris* (better-sourced, drabber) vs. *O. cyanea* (Indo-Pacific,
  more colorful, matches the roster's existing Indo-Pacific reef skew) for
  the "reef octopus" slot?
- Bigfin reef squid (common, weaker-sourced adult speed) vs. Humboldt squid
  (uncommon, much better-sourced kinematics, larger/more aggressive) for the
  "reef/mid-rarity squid" slot — or both?
- Electric eel: deliberate freshwater-cameo fantasy inclusion, swap for a
  marine electrogenic species (torpedo ray or stargazer), or ship both?
- Should the "mysterious" rarity bucket require literal deep-sea depth, or
  can behaviorally bizarre shallow species (sarcastic fringehead) qualify on
  spectacle alone?
- Megalodon's canonical in-game size/speed: the more widely-cited
  robust-body estimate (16m, ~5km/h) or the slender-body reassessment
  (~24m, ~2-3.5km/h)? Recommend the former as primary with the latter as
  flavor text, but this is an editorial call, not a scientific one.
- Giant siphonophore: genuinely colonial rig, or descope to a stylized
  long-ribbon reuse of the giant oarfish archetype?
