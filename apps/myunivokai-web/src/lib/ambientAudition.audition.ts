/* eslint-disable no-console */
// --- Ambient audition harness -------------------------------------------------
//
// Renders the REAL graph module offline against a Node implementation of Web
// Audio and measures what came out. Topology tests prove the graph is wired
// correctly; they cannot tell you it is music, and three versions shipped
// verified-and-wrong before this existed.
//
//   npm install --no-save node-web-audio-api
//   npx vitest run --config vitest.audition.config.ts --disable-console-intercept
//
// Not part of `npm test`: it lives behind its own vitest config because
// node-web-audio-api is a development aid installed `--no-save`, and a missing
// optional dependency must never be able to fail CI. It is IN the repository,
// though, unlike the previous copy — the numbers in PIECE_LEVEL_TRIM cannot be
// re-derived without it, and adding a piece without running it is how an
// accompaniment ends up louder than the tune.
//
// Two things this measures that no assertion elsewhere can:
//
//   RMS per world      -> PIECE_LEVEL_TRIM. Loudness is driven by how many notes
//                         a piece has per bar far more than by any gain.
//   Melody lead        -> each line rendered with the others silenced. Gain is
//                         not balance: the accompaniment plays three to five
//                         times as many notes, so `harmony.gain < melody.gain`
//                         being true proves nothing. This is what caught the
//                         accompaniment winning in four of ten worlds, and it
//                         caught two more when the catalogue went from six
//                         pieces to twelve.
//
// See notes/knowledge/frontend/ambient-audio-mechanism.md, "Auditioning it".

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "vitest";
import { OfflineAudioContext } from "node-web-audio-api";
import { buildAmbientSoundscapeRecipe } from "./ambientSoundscape";
import { parseArrangement, type ArrangementPieceId } from "@/features/audio/arrangements";
import { createAmbientSoundscapeGraph } from "@/features/audio/ambientSoundscapeGraph";
import {
  SAMPLED_INSTRUMENT_NOTE_NAMES,
  noteNameToMidiNumber,
  type LoadedInstrument,
  type SampledInstrumentKey
} from "@/features/audio/instrumentSamples";
import type { SceneConfig } from "./types";

const SAMPLE_RATE = 44100;
const RENDER_SECONDS = 60;
const SCHEDULER_STEP_SECONDS = 0.2;
const ASSET_ROOT = join(process.cwd(), "public", "assets", "audio");

// node-web-audio-api's context is structurally a BaseAudioContext but is not
// typed as one, and this harness deliberately reaches past both (shadowing
// currentTime, swapping setInterval). One named escape hatch rather than a cast
// at each of the six sites.
// eslint-disable-next-line
type Any = any;

async function loadInstrumentFromDisk(
  audioContext: Any,
  key: SampledInstrumentKey
): Promise<LoadedInstrument> {
  const buffers = new Map<number, AudioBuffer>();
  for (const noteName of SAMPLED_INSTRUMENT_NOTE_NAMES[key]) {
    const bytes = readFileSync(join(ASSET_ROOT, key, `${noteName}.mp3`));
    const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    buffers.set(noteNameToMidiNumber(noteName), await audioContext.decodeAudioData(copy));
  }
  return { key, midiNumbers: [...buffers.keys()].sort((a, b) => a - b), buffers };
}

function readArrangement(pieceId: ArrangementPieceId) {
  return parseArrangement(
    pieceId,
    JSON.parse(readFileSync(join(process.cwd(), "public", "assets", "audio", "arrangements", `${pieceId}.json`), "utf8"))
  );
}

type IsolatedLayer = "all" | "melodyOnly" | "accompanimentOnly";

/**
 * Silence the layers this pass is not measuring. Layer isolation is what caught
 * the accompaniment outrunning the tune in four of ten worlds while every gain
 * assertion was green — gain is not balance, note density is.
 */
function isolate(recipe: ReturnType<typeof buildAmbientSoundscapeRecipe>, layer: IsolatedLayer) {
  if (layer === "all") {
    return recipe;
  }
  const melodyOnly = layer === "melodyOnly";
  return {
    ...recipe,
    bedGain: 0,
    performance: {
      ...recipe.performance,
      melody: { ...recipe.performance.melody, gain: melodyOnly ? recipe.performance.melody.gain : 0 },
      harmony: { ...recipe.performance.harmony, gain: melodyOnly ? 0 : recipe.performance.harmony.gain },
      bass: { ...recipe.performance.bass, gain: melodyOnly ? 0 : recipe.performance.bass.gain }
    }
  };
}

async function renderScene(scene: SceneConfig, layer: IsolatedLayer = "all") {
  const recipe = isolate(buildAmbientSoundscapeRecipe(scene), layer);
  const audioContext: Any = new OfflineAudioContext(2, SAMPLE_RATE * RENDER_SECONDS, SAMPLE_RATE);

  const arrangement = readArrangement(recipe.performance.pieceId);
  const instruments = {
    melody: await loadInstrumentFromDisk(audioContext, recipe.performance.melody.instrument),
    harmony: await loadInstrumentFromDisk(audioContext, recipe.performance.harmony.instrument),
    bass: await loadInstrumentFromDisk(audioContext, recipe.performance.bass.instrument)
  };

  // The graph runs its scheduler on a wall clock it cannot have here, so the
  // interval callback is captured and driven by hand, and currentTime is
  // shadowed with an own property (a Proxy breaks the library's private fields).
  // Held in an object rather than a bare `let`: TypeScript's control flow sees
  // the assignment only inside a callback and narrows the variable to `null` at
  // every later read.
  const scheduler: { run: (() => void) | null } = { run: null };
  const realSetInterval = globalThis.setInterval;
  (globalThis as Any).setInterval = (callback: () => void) => {
    scheduler.run = callback;
    return 0 as Any;
  };
  let virtualTime = 0;
  Object.defineProperty(audioContext, "currentTime", {
    get: () => virtualTime,
    configurable: true
  });

  try {
    createAmbientSoundscapeGraph(audioContext, recipe, 0.5, instruments, arrangement);
    for (virtualTime = 0; virtualTime <= RENDER_SECONDS; virtualTime += SCHEDULER_STEP_SECONDS) {
      scheduler.run?.();
    }
  } finally {
    (globalThis as Any).setInterval = realSetInterval;
  }
  virtualTime = 0;

  const rendered = await audioContext.startRendering();
  const left = rendered.getChannelData(0);
  const right = rendered.getChannelData(1);
  let sumOfSquares = 0;
  let peak = 0;
  for (let index = 0; index < left.length; index++) {
    const value = (left[index] + right[index]) / 2;
    sumOfSquares += value * value;
    peak = Math.max(peak, Math.abs(value));
  }
  return { rms: Math.sqrt(sumOfSquares / left.length), peak, recipe };
}

const WORLDS: { label: string; scene: SceneConfig }[] = [
  ...["cosmic-galaxy", "nebula", "crystal", "aurora", "cyber-orbit"].map((theme) => ({
    label: `universe/${theme}`,
    scene: { seed: `trim-${theme}`, theme, postFX: { bloomIntensity: 1 } } as SceneConfig
  })),
  ...["clear", "sunRays", "overcast", "rain", "snow"].map((weather) => ({
    label: `forest/${weather}`,
    scene: {
      seed: `trim-${weather}`,
      sceneType: "forest",
      season: { kind: "summer" },
      lighting: { timeOfDay: "day" },
      weather: { kind: weather, intensity: 0.6 }
    } as SceneConfig
  })),
  ...["still", "drift", "surge"].map((current) => ({
    label: `ocean/${current}`,
    scene: {
      seed: `trim-${current}`,
      sceneType: "ocean",
      current: { kind: current, intensity: 0.6 },
      depth: { metres: 40, zone: "sunlitShallows" }
    } as SceneConfig
  }))
];

describe("offline trim measurement", () => {
  it("reports RMS and peak for every world", { timeout: 900000 }, async () => {
      const rows: { label: string; piece: string; rms: number; peak: number; trim: number; lead: number }[] = [];
      for (const world of WORLDS) {
        const { rms, peak, recipe } = await renderScene(world.scene);
        const melodyOnly = await renderScene(world.scene, "melodyOnly");
        const accompanimentOnly = await renderScene(world.scene, "accompanimentOnly");
        const lead = melodyOnly.rms / accompanimentOnly.rms;
        rows.push({
          label: world.label,
          piece: recipe.performance.pieceId,
          rms,
          peak,
          trim: recipe.masterGain / 0.6,
          lead
        });
        console.log(
          `${world.label.padEnd(20)} ${recipe.performance.pieceId.padEnd(28)} ` +
            `rms ${rms.toFixed(4)}  peak ${peak.toFixed(3)}  trim ${(recipe.masterGain / 0.6).toFixed(2)}  ` +
            `melody lead ${lead.toFixed(2)}x${lead < 1 ? "   <-- ACCOMPANIMENT LOUDER" : ""}`
        );
      }
      const rmsValues = rows.map((row) => row.rms).sort((left, right) => left - right);
      const leadValues = rows.map((row) => row.lead).sort((left, right) => left - right);
      const peakValues = rows.map((row) => row.peak).sort((left, right) => left - right);
      console.log(
        `\nrms ${rmsValues[0].toFixed(4)}-${rmsValues[rmsValues.length - 1].toFixed(4)} ` +
          `(${(rmsValues[rmsValues.length - 1] / rmsValues[0]).toFixed(2)}x spread)  ` +
          `peak ${peakValues[0].toFixed(2)}-${peakValues[peakValues.length - 1].toFixed(2)}  ` +
          `melody lead ${leadValues[0].toFixed(2)}x-${leadValues[leadValues.length - 1].toFixed(2)}x`
      );
  });
});
