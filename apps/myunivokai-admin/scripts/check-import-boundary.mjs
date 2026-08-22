#!/usr/bin/env node
// Enforces notes/vision/auth-and-admin-plan.md#the-admin-app's hard
// constraint: this app shares no code with apps/myunivokai-web and never
// imports three.js — the two are meant to have zero runtime dependency on
// each other, and a stray import here is exactly how that would happen
// silently. See sprint-04 user-stories.md's S4-AUTH-004 task list.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SOURCE_ROOT = join(import.meta.dirname, "..", "src");
const FORBIDDEN_PATTERNS = [
  { name: "apps/myunivokai-web", regex: /myunivokai-web/ },
  { name: "three.js", regex: /(?:^|["'\s])three(?:["'/]|$)/, importOnly: true },
  { name: "@react-three/*", regex: /@react-three\// }
];
const SOURCE_FILE_EXTENSIONS = new Set([".ts", ".tsx"]);
const IMPORT_LINE = /^\s*import .*from\s+["']([^"']+)["']|require\(["']([^"']+)["']\)/;

function collectSourceFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory)) {
    const entryPath = join(directory, entry);
    const entryStat = statSync(entryPath);
    if (entryStat.isDirectory()) {
      files.push(...collectSourceFiles(entryPath));
    } else if (SOURCE_FILE_EXTENSIONS.has(entry.slice(entry.lastIndexOf(".")))) {
      files.push(entryPath);
    }
  }
  return files;
}

function findViolations(filePath) {
  const violations = [];
  const lines = readFileSync(filePath, "utf-8").split("\n");
  for (const [index, line] of lines.entries()) {
    const match = line.match(IMPORT_LINE);
    const importSource = match?.[1] ?? match?.[2];
    if (!importSource) {
      continue;
    }
    for (const pattern of FORBIDDEN_PATTERNS) {
      if (pattern.regex.test(importSource)) {
        violations.push({ filePath, line: index + 1, importSource, rule: pattern.name });
      }
    }
  }
  return violations;
}

const violations = collectSourceFiles(SOURCE_ROOT).flatMap(findViolations);

if (violations.length > 0) {
  console.error("Import boundary violations (apps/myunivokai-admin must not depend on myunivokai-web or three.js):");
  for (const violation of violations) {
    console.error(`  ${violation.filePath}:${violation.line} imports "${violation.importSource}" (${violation.rule})`);
  }
  process.exit(1);
}

console.log("Import boundary check passed: no imports from myunivokai-web or three.js.");
