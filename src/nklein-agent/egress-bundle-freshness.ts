import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
	EGRESS_BUNDLE_STAMP_FILENAME,
	type EgressBundleFreshness,
	evaluateEgressBundleFreshness,
	formatEgressBundleStaleWarning,
	parseEgressBundleStamp,
} from "../core/egress-bundle-stamp";
import type { SelfObservationEventInput } from "../telemetry/self-observation-sink";

/**
 * Stale-bundle guard for the egress proxy (factory outage 2026-09-06 — see src/core/egress-bundle-stamp.ts). Runs
 * right before the proxy container is ensured: reads `build-stamp.json` beside the bundle, re-hashes the bundled
 * sources from the tree the runtime is running from, and when they differ (or the bundle carries no stamp) rebuilds
 * it in place with `scripts/build-egress-proxy.mjs` — a source-tree run never rebuilt it otherwise. A packaged app
 * (no `src/`, no build script) is "unverifiable" and skipped: its bundle shipped with the same build as the runtime.
 *
 * Nothing here blocks the proxy: a failed rebuild warns + records `egress_bundle_stale` and the old bundle still runs.
 */

export const EGRESS_PROXY_AUTOREBUILD_ENV = "NKLEIN_EGRESS_PROXY_AUTOREBUILD";
export const EGRESS_BUNDLE_REBUILD_SCRIPT_RELATIVE_PATH = ["scripts", "build-egress-proxy.mjs"] as const;
const REBUILD_TIMEOUT_MS = 180_000;

export interface EgressBundleFreshnessDeps {
	readFile?: (path: string) => string | null;
	fileExists?: (path: string) => boolean;
	/** Runs the rebuild script (default: `node scripts/build-egress-proxy.mjs` in the repo root). */
	runRebuild?: (scriptPath: string, cwd: string) => Promise<{ ok: boolean; error: string | null }>;
	env?: NodeJS.ProcessEnv;
	warn?: (message: string) => void;
	observe?: (event: SelfObservationEventInput) => void;
}

export interface EgressBundleFreshnessOutcome {
	freshness: EgressBundleFreshness;
	rebuilt: boolean;
	rootDir: string;
}

function defaultReadFile(path: string): string | null {
	try {
		return readFileSync(path, "utf8");
	} catch {
		return null;
	}
}

function defaultRunRebuild(scriptPath: string, cwd: string): Promise<{ ok: boolean; error: string | null }> {
	return new Promise((resolveRun) => {
		execFile(
			process.execPath,
			[scriptPath],
			{ cwd, timeout: REBUILD_TIMEOUT_MS, maxBuffer: 1024 * 1024 },
			(error, _stdout, stderr) => {
				if (error) {
					resolveRun({ ok: false, error: `${error.message}${stderr ? `\n${stderr.slice(0, 600)}` : ""}` });
					return;
				}
				resolveRun({ ok: true, error: null });
			},
		);
	});
}

/** The repo root a `<root>/dist/egress-proxy/entrypoint.mjs` bundle belongs to. */
export function egressBundleRootDir(bundleHostPath: string): string {
	return resolve(dirname(bundleHostPath), "..", "..");
}

function assess(
	bundleHostPath: string,
	rootDir: string,
	readFile: (path: string) => string | null,
): EgressBundleFreshness {
	const stampText = readFile(join(dirname(bundleHostPath), EGRESS_BUNDLE_STAMP_FILENAME));
	return evaluateEgressBundleFreshness({
		stamp: stampText === null ? null : parseEgressBundleStamp(stampText),
		readInput: (relativePath) => readFile(join(rootDir, relativePath)),
	});
}

/**
 * Verify the bundle against the running source tree; rebuild when stale/unstamped and a build script is at hand.
 * Never throws — the proxy ensure continues with whatever bundle is on disk.
 */
export async function ensureEgressBundleFresh(
	bundleHostPath: string,
	deps: EgressBundleFreshnessDeps = {},
): Promise<EgressBundleFreshnessOutcome> {
	const readFile = deps.readFile ?? defaultReadFile;
	const fileExists = deps.fileExists ?? existsSync;
	const env = deps.env ?? process.env;
	const rootDir = egressBundleRootDir(bundleHostPath);
	let freshness = assess(bundleHostPath, rootDir, readFile);
	if (freshness.status === "fresh" || freshness.status === "unverifiable") {
		return { freshness, rebuilt: false, rootDir };
	}
	const scriptPath = join(rootDir, ...EGRESS_BUNDLE_REBUILD_SCRIPT_RELATIVE_PATH);
	const rebuildCommand = `node ${EGRESS_BUNDLE_REBUILD_SCRIPT_RELATIVE_PATH.join("/")} (in ${rootDir})`;
	const warning = formatEgressBundleStaleWarning({ bundlePath: bundleHostPath, freshness, rebuildCommand });
	const canRebuild = fileExists(scriptPath) && env[EGRESS_PROXY_AUTOREBUILD_ENV]?.trim() !== "0";
	if (!canRebuild) {
		if (freshness.status === "stale" || fileExists(scriptPath)) {
			// An unstamped bundle in a packaged app (no script) is the pre-stamp world — nothing to shout about.
			deps.warn?.(warning);
			deps.observe?.({
				signal: "custom",
				severity: "warning",
				message: warning,
				metadata: { category: "egress_bundle_stale", status: freshness.status, rebuilt: false },
			});
		}
		return { freshness, rebuilt: false, rootDir };
	}
	const rebuild = await (deps.runRebuild ?? defaultRunRebuild)(scriptPath, rootDir).catch((error: unknown) => ({
		ok: false,
		error: error instanceof Error ? error.message : String(error),
	}));
	if (!rebuild.ok) {
		const message = `${warning} Automatic rebuild failed: ${rebuild.error ?? "unknown error"}`;
		deps.warn?.(message);
		deps.observe?.({
			signal: "custom",
			severity: "warning",
			message,
			metadata: { category: "egress_bundle_stale", status: freshness.status, rebuilt: false, error: rebuild.error },
		});
		return { freshness, rebuilt: false, rootDir };
	}
	const previousStatus = freshness.status;
	freshness = assess(bundleHostPath, rootDir, readFile);
	const message =
		`Rebuilt the egress proxy bundle ${bundleHostPath} before starting the proxy — it was ${previousStatus} ` +
		`(now ${freshness.status}). A stale proxy fail-closes every sandbox network call, so this is not optional.`;
	deps.warn?.(message);
	deps.observe?.({
		signal: "custom",
		severity: "info",
		message,
		metadata: { category: "egress_bundle_rebuilt", previousStatus, status: freshness.status },
	});
	return { freshness, rebuilt: true, rootDir };
}
