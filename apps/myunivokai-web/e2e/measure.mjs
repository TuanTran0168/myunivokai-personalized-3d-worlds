/**
 * Print what every screenshot in e2e/shots actually contains.
 *
 * Nothing else in this repository can see the canvas, and across this family's
 * development every serious visual bug was invisible to every other check:
 *
 *   - three worlds hundreds of metres apart rendering indistinguishably
 *   - deep water rendering GREY instead of blue (saturation 0.02) because a hue
 *     was tempered toward white instead of toward the water's own colour
 *   - a whole frame clipped flat to white because the post-processing composer
 *     had silently disabled the renderer's tone mapping
 *   - god rays clipping 100% of a reef to white because an additive layer was
 *     being sRGB-encoded before it was added
 *
 * Every one of those is one number away from obvious and, until
 * oceanFrameBudget.test.ts, zero tests away from caught. This prints the numbers;
 * that test enforces them.
 *
 * Usage:  node e2e/measure.mjs [glob-ish substring]
 *         node e2e/measure.mjs demo-
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { isSceneFrame, measureFrame, REFERENCE_PREFIX, SHOTS_ROOT } from "./frameMetrics.mjs";

const filter = process.argv[2] ?? "";
const projects = readdirSync(SHOTS_ROOT, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

for (const project of projects) {
  const directory = join(SHOTS_ROOT, project);
  const files = readdirSync(directory)
    .filter((name) => name.endsWith(".png"))
    .filter((name) => name.includes(filter))
    .sort();
  if (files.length === 0) continue;
  console.log(`\n${project}`);
  console.log("shot                      | luma  | blown | crush | sat  | detail | mean   | crop");
  console.log("--------------------------+-------+-------+-------+------+--------+--------+------");
  const skipped = [];
  for (const name of files) {
    const shot = name.replace(/\.png$/, "");
    if (!isSceneFrame(project, shot)) {
      skipped.push(shot);
      continue;
    }
    const isReference = name.startsWith(REFERENCE_PREFIX);
    const m = measureFrame(join(directory, name), isReference);
    console.log(
      `${name.replace(/\.png$/, "").padEnd(25)} | ${m.luma.toFixed(3)} | ` +
        `${(m.blown * 100).toFixed(1).padStart(4)}% | ${(m.crush * 100).toFixed(1).padStart(4)}% | ` +
        `${m.sat.toFixed(2)} | ${m.detail.toFixed(2).padStart(6)} | ${m.mean} | ` +
        `${isReference ? "ref " : "band"}`,
    );
  }
  if (skipped.length > 0) {
    // Named, not silently dropped: a row that vanishes is indistinguishable from
    // a shot that was never taken.
    console.log(`
  no scene in frame, layout baseline only: ${skipped.join(", ")}`);
  }
}
