#!/usr/bin/env node
/**
 * Stages the runtime + web-ui bundle from root dist/ into packages/desktop/cli/
 * for electron-builder. Validates completeness to fail loudly if the root build
 * was skipped.
 */

import { cpSync, existsSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(here, "..");
const repoRoot = resolve(desktopRoot, "../..");
const distDir = resolve(repoRoot, "dist");
const webUiIndex = resolve(distDir, "web-ui/index.html");
const cliEntry = resolve(distDir, "cli.js");
const stageDir = resolve(desktopRoot, "cli");

function fail(message) {
	console.error(`\n[stage:cli] ERROR: ${message}\n`);
	console.error("[stage:cli] Run the root build first:");
	console.error("[stage:cli]   (cd ../.. && npm run build)\n");
	process.exit(1);
}

if (!existsSync(distDir)) {
	fail(`${distDir} does not exist.`);
}
if (!existsSync(cliEntry)) {
	fail(`${cliEntry} is missing.`);
}
if (!existsSync(webUiIndex)) {
	fail(
		`${webUiIndex} is missing — the runtime is built but the web UI assets were not staged into dist/web-ui/.`,
	);
}

// Freshness, not just completeness (audit 2026-08-28, A10): a 5-week-old dist/ passed the existence checks while
// 453 src files had moved on — a local package would silently ship stale code (CI rebuilds; the LOCAL path is the
// hazard). If any src/ file is newer than the built entrypoint, the root build was skipped: fail loudly.
function newestMtimeMs(dir) {
	let newest = 0;
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			newest = Math.max(newest, newestMtimeMs(full));
		} else if (entry.isFile() && /\.(ts|tsx|mts|js|mjs|css|html)$/.test(entry.name)) {
			newest = Math.max(newest, statSync(full).mtimeMs);
		}
	}
	return newest;
}
const newestSrc = newestMtimeMs(resolve(repoRoot, "src"));
const distBuiltAt = statSync(cliEntry).mtimeMs;
if (newestSrc > distBuiltAt) {
	fail(
		`dist/ is STALE: at least one src/ file is newer (${new Date(newestSrc).toISOString()}) than dist/cli.js (${new Date(distBuiltAt).toISOString()}).`,
	);
}

rmSync(stageDir, { recursive: true, force: true });
cpSync(distDir, stageDir, { recursive: true });

// The CLI bundle is ESM (esbuild emits `import` statements). Inside the
// packaged app, this file lives at `app.asar.unpacked/cli/cli.js`. Node's
// nearest-package.json walk-up from `app.asar.unpacked/cli/` doesn't see
// the desktop package.json inside the sibling `app.asar` archive, so
// without a local package.json Node defaults to CJS and chokes on the
// `import` statement at module top. Drop a minimal package.json next to
// the staged cli.js so Node treats it as ESM regardless of what lives
// further up the tree.
writeFileSync(
	resolve(stageDir, "package.json"),
	`${JSON.stringify({ type: "module" }, null, 2)}\n`,
);

console.log(`[stage:cli] Staged ${distDir} → ${stageDir}`);
