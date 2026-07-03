#!/usr/bin/env node
// Run the VENDORED Cline SDK's own test suites — the repo `vitest`/`test:fast` config excludes `vendor/**`, so
// these never run in the normal gate and !Klein fork edits (§5.BD boundary tolerances, the `.cline`→`.nklein`
// rebrand, …) can silently rot them. This runner is the release-gate net (todo §5.AZ): it runs each vendored
// package's suite (each has its OWN vitest.config) and fails if any package fails.
//
// Usage: `npm run test:vendor`  (add `-- <pkg>` to run a single package, e.g. `npm run test:vendor -- core`).

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const packagesDir = join(repoRoot, "vendor", "cline-sdk", "packages");

// Packages that ship a vitest config (sdk has none). Order: leaf deps first for readable output.
const ALL_PACKAGES = ["shared", "llms", "agents", "core"];

const only = process.argv.slice(2).filter((arg) => !arg.startsWith("-"));
const packages = only.length > 0 ? only : ALL_PACKAGES;

let failed = 0;
for (const pkg of packages) {
	const cwd = join(packagesDir, pkg);
	if (!existsSync(join(cwd, "vitest.config.ts"))) {
		console.error(`\n⚠️  vendored package "${pkg}" has no vitest.config.ts — skipping.`);
		continue;
	}
	console.log(`\n=== vendored suite: @cline/${pkg} ===`);
	const result = spawnSync("npx", ["vitest", "run"], { cwd, stdio: "inherit", env: process.env });
	if (result.status !== 0) {
		failed += 1;
		console.error(`✗ @cline/${pkg} vendored suite FAILED (exit ${result.status ?? "signal"}).`);
	}
}

if (failed > 0) {
	console.error(`\n✗ test:vendor — ${failed} vendored package(s) failed.`);
	process.exit(1);
}
console.log(`\n✓ test:vendor — all ${packages.length} vendored package suite(s) green.`);
