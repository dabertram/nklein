/**
 * P1.NPMSEED — a warm, per-workspace npm cache SEED so sandbox installs are offline-fast.
 *
 * Slice-2 drive 2026-09-07 (docs/journal/hitl-findings-2026-09-06.md #52): four `npm ci` failures in one afternoon
 * over a phone-hotspot uplink — the prime of S94/S95, s63's delivery gate, S72's acceptance ("the BASE tree already
 * failed"). Every placement installed into its OWN empty cache, so every card re-downloaded the same 48 tarballs
 * through the same flaky link with `fetch-retries` 0 (the fast-offline design). The seed removes the download from
 * the hot path: the runtime copies a workspace-wide seed into a fresh placement's cache before its first install
 * (`npm ci --prefer-offline` then never touches the registry), and merges the tarballs a successful install fetched
 * back into the seed.
 *
 * Trust boundary. The sandbox runs cap-dropped: in-container root has no CAP_DAC_OVERRIDE, so it cannot read a task's
 * `700` cache — the harvest therefore runs in two steps: the TASK user first makes its own cache world-readable
 * (public npm artifacts, nothing secret), then ROOT merges into the root-owned seed with a filter that copies ONLY
 * content blobs and index entries whose key is a tarball (`….tgz`) — never packuments. A poisoned tarball can then
 * never be consumed: `npm ci` pins its integrity through the lockfile and `npm install` through the live packument,
 * and npm's cacache rejects content whose hash does not match. Junk can only cost space (size-capped). Seeding INTO a
 * task copies (no shared inodes), so tasks cannot reach each other through the cache. A host directory named by
 * `NKLEIN_SANDBOX_NPM_CACHE_SEED_IMPORT` (a trusted `_cacache`, e.g. from `npm ci --cache <dir>` on the host) is
 * imported whole at container boot — the offline simulated-flow harness needs it because its sandboxes have no egress.
 *
 * Default-on; `NKLEIN_SANDBOX_NPM_CACHE_SEED=0` disables seed + harvest (the import is a path, not a flag).
 */

import { isEnabledByDefaultEnv } from "../core/env-flag";
import { recordSelfObservation } from "../telemetry/self-observation-sink";

export const SANDBOX_NPM_CACHE_SEED_ENV = "NKLEIN_SANDBOX_NPM_CACHE_SEED";
export const SANDBOX_NPM_CACHE_SEED_IMPORT_ENV = "NKLEIN_SANDBOX_NPM_CACHE_SEED_IMPORT";
/** Above this the seed is neither copied into placements nor grown (a runaway project must not tax every start). */
export const NPM_CACHE_SEED_MAX_KB = 512 * 1024;
export const NPM_CACHE_SEED_IMPORTED_MARKER = ".imported";

export interface PackageCacheSeedPaths {
	/** Root-owned, world-readable seed (`<cache root>/.seed/npm`). */
	seedDir: string;
	/** The placement's private cache root (`mkdir -m 700` by the task uid). */
	taskCacheDir: string;
	/** `${taskCacheDir}/npm` — exactly what `NPM_CONFIG_CACHE` points at. */
	taskNpmCacheDir: string;
}

export interface PackageCacheSeedOutcome {
	status: "seeded" | "harvested" | "skipped" | "error";
	detail: string;
}

/** Narrow seam the callers need — implemented by AgentSandboxManager over its docker-exec plumbing. */
export interface PackageCacheSeedManager {
	seedTaskPackageCache?(taskId: string): Promise<PackageCacheSeedOutcome>;
	harvestTaskPackageCache?(taskId: string): Promise<PackageCacheSeedOutcome>;
}

function sq(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Runs AS THE TASK USER before the first install: copy the seed into the task's own (still absent) npm cache. */
export function buildSeedIntoTaskCacheScript(paths: PackageCacheSeedPaths): string {
	return [
		`seed=${sq(paths.seedDir)}; task=${sq(paths.taskNpmCacheDir)}`,
		`[ -d "$seed/_cacache" ] || { echo "skipped: no seed"; exit 0; }`,
		`[ -e "$task/_cacache" ] && { echo "skipped: task cache present"; exit 0; }`,
		`kb=$(du -sk "$seed" 2>/dev/null | cut -f1); [ "\${kb:-0}" -gt ${NPM_CACHE_SEED_MAX_KB} ] && { echo "skipped: seed too large \${kb}k"; exit 0; }`,
		// POSIX `cp -p`: failing to preserve the seed's root ownership is NOT an error — the copies become task-owned.
		`mkdir -p "$task" && cp -Rp "$seed/." "$task/" && echo "seeded \${kb}k"`,
	].join("\n");
}

/** Harvest step 1, AS THE TASK USER: expose the task's cache to the cap-dropped root harvester. */
export function buildExposeTaskCacheScript(paths: PackageCacheSeedPaths): string {
	return [
		`task=${sq(paths.taskNpmCacheDir)}; root=${sq(paths.taskCacheDir)}`,
		`[ -d "$task/_cacache/content-v2" ] || { echo "skipped: no task cache"; exit 0; }`,
		`chmod a+rx "$root" "$task" && chmod -R a+rX "$task/_cacache" && echo "exposed"`,
	].join("\n");
}

/** Harvest step 2, AS ROOT: merge content blobs + tarball-keyed index entries into the seed, no-clobber, size-capped. */
export function buildHarvestIntoSeedScript(paths: PackageCacheSeedPaths): string {
	return [
		`seed=${sq(paths.seedDir)}; src=${sq(paths.taskNpmCacheDir)}/_cacache`,
		`[ -d "$src/content-v2" ] || { echo "skipped: no task cache"; exit 0; }`,
		`kb=$(du -sk "$seed" 2>/dev/null | cut -f1); [ "\${kb:-0}" -gt ${NPM_CACHE_SEED_MAX_KB} ] && { echo "skipped: seed full \${kb}k"; exit 0; }`,
		`mkdir -p "$seed/_cacache/content-v2" "$seed/_cacache/index-v5"`,
		`cp -Rpn "$src/content-v2/." "$seed/_cacache/content-v2/" 2>/dev/null || true`,
		// Index entries name the cache key; only tarball keys (…/-/name-1.2.3.tgz) may cross the task boundary.
		`if [ -d "$src/index-v5" ]; then (cd "$src/index-v5" && find . -type f | while read -r f; do`,
		`  grep -q '\\.tgz"' "$f" || continue`,
		`  dest="$seed/_cacache/index-v5/\${f#./}"; [ -e "$dest" ] && continue`,
		`  mkdir -p "$(dirname "$dest")" && cp -p "$f" "$dest"`,
		`done); fi`,
		`chmod -R a+rX "$seed" && echo "harvested $(du -sk "$seed" 2>/dev/null | cut -f1)k"`,
	].join("\n");
}

/** Boot-time import of a trusted host `_cacache` (already copied into the container): finalize + mark. */
export function buildFinalizeImportedSeedScript(paths: Pick<PackageCacheSeedPaths, "seedDir">): string {
	return [
		`seed=${sq(paths.seedDir)}`,
		`[ -d "$seed/_cacache" ] || { echo "skipped: import has no _cacache"; exit 0; }`,
		`chmod -R a+rX "$seed" && touch "$seed/${NPM_CACHE_SEED_IMPORTED_MARKER}" && echo "imported $(du -sk "$seed" 2>/dev/null | cut -f1)k"`,
	].join("\n");
}

export function isPackageCacheSeedEnabled(env?: NodeJS.ProcessEnv): boolean {
	// The literal read keeps the F4.8b flag ratchet able to see this default-on flag in source.
	return env
		? isEnabledByDefaultEnv(env[SANDBOX_NPM_CACHE_SEED_ENV])
		: isEnabledByDefaultEnv(process.env.NKLEIN_SANDBOX_NPM_CACHE_SEED);
}

/** Interpret a seed/harvest script's exec result: "skipped: …" lines are skips, non-zero exits are errors. */
export function classifySeedScriptResult(
	phase: "seed" | "harvest" | "import",
	result: { exitCode: number | null; stdout: string; stderr: string },
): PackageCacheSeedOutcome {
	const line = result.stdout.trim().split("\n").at(-1)?.trim() ?? "";
	if (result.exitCode !== 0) {
		return {
			status: "error",
			detail: (result.stderr.trim() || line || `exit ${result.exitCode ?? "?"}`).slice(0, 300),
		};
	}
	if (line.startsWith("skipped")) {
		return { status: "skipped", detail: line };
	}
	return { status: phase === "harvest" || phase === "import" ? "harvested" : "seeded", detail: line || phase };
}

/**
 * Seed a placement's npm cache from the workspace seed before its first install. Never throws; one observation
 * per non-skip outcome so the operator can see the mechanism working (or failing) per placement.
 */
export async function seedSandboxPackageCache(input: {
	manager: PackageCacheSeedManager;
	taskId: string;
	env?: NodeJS.ProcessEnv;
	recordObservation?: typeof recordSelfObservation;
}): Promise<PackageCacheSeedOutcome | null> {
	if (!isPackageCacheSeedEnabled(input.env ?? process.env) || !input.manager.seedTaskPackageCache) {
		return null;
	}
	const outcome = await input.manager.seedTaskPackageCache(input.taskId).catch(
		(error): PackageCacheSeedOutcome => ({
			status: "error",
			detail: error instanceof Error ? error.message : String(error),
		}),
	);
	observe(input, "seed", outcome);
	return outcome;
}

/** Merge a placement's freshly installed tarballs into the workspace seed (after a successful install). */
export async function harvestSandboxPackageCache(input: {
	manager: PackageCacheSeedManager;
	taskId: string;
	env?: NodeJS.ProcessEnv;
	recordObservation?: typeof recordSelfObservation;
}): Promise<PackageCacheSeedOutcome | null> {
	if (!isPackageCacheSeedEnabled(input.env ?? process.env) || !input.manager.harvestTaskPackageCache) {
		return null;
	}
	const outcome = await input.manager.harvestTaskPackageCache(input.taskId).catch(
		(error): PackageCacheSeedOutcome => ({
			status: "error",
			detail: error instanceof Error ? error.message : String(error),
		}),
	);
	observe(input, "harvest", outcome);
	return outcome;
}

function observe(
	input: { taskId: string; recordObservation?: typeof recordSelfObservation },
	phase: "seed" | "harvest",
	outcome: PackageCacheSeedOutcome,
): void {
	if (outcome.status === "skipped") {
		return;
	}
	(input.recordObservation ?? recordSelfObservation)({
		signal: "custom",
		severity: outcome.status === "error" ? "warning" : "info",
		message: `Sandbox npm cache ${phase} for ${input.taskId}: ${outcome.status} (${outcome.detail}).`,
		taskId: input.taskId,
		metadata: { category: "sandbox_npm_cache_seed", phase, status: outcome.status, detail: outcome.detail },
	});
}
