import { createHash } from "node:crypto";

/**
 * Egress-proxy bundle stamp (factory outage 2026-09-06). The proxy container runs ONE esbuild bundle
 * (`dist/egress-proxy/entrypoint.mjs`) bind-mounted from the host; a source-tree run (`tsx src/cli.ts`) never rebuilds
 * it. Live: the bundle was from 2026-07-21, the per-task credential protocol changed on the runtime side afterwards, and
 * the old proxy closed every sandbox CONNECT without a byte — `npm install` failed in 458 ms in every sandbox, so
 * acceptance runs, plan gates and reviewer verification all ran "offline" for weeks with nothing naming the cause.
 *
 * The build script writes `build-stamp.json` next to the bundle: the bundled source inputs (repo-relative) and a hash
 * over their contents. At proxy-ensure time the runtime recomputes the hash from the CURRENT source tree (when it has
 * one) and compares; a mismatch is stale. Pure helpers here; the file/process seams live in the lifecycle.
 */

export const EGRESS_BUNDLE_STAMP_FILENAME = "build-stamp.json";
export const EGRESS_BUNDLE_STAMP_VERSION = 1;

export interface EgressBundleStamp {
	version: number;
	builtAt: string;
	/** Repo-relative POSIX paths of every source file esbuild folded into the bundle. */
	inputs: string[];
	/** sha256 over the sorted inputs' `path\0content\0` records. */
	sourceHash: string;
}

export interface EgressBundleSourceEntry {
	path: string;
	content: string | Uint8Array;
}

/** The stamp's hash: order-independent over `path` + content, so a moved-but-identical file still counts as a change. */
export function computeEgressBundleSourceHash(entries: readonly EgressBundleSourceEntry[]): string {
	const hash = createHash("sha256");
	for (const entry of [...entries].sort((left, right) => left.path.localeCompare(right.path))) {
		hash.update(entry.path);
		hash.update("\0");
		hash.update(entry.content);
		hash.update("\0");
	}
	return hash.digest("hex");
}

export function parseEgressBundleStamp(text: string): EgressBundleStamp | null {
	try {
		const parsed = JSON.parse(text) as Partial<EgressBundleStamp> | null;
		if (
			!parsed ||
			typeof parsed !== "object" ||
			parsed.version !== EGRESS_BUNDLE_STAMP_VERSION ||
			typeof parsed.builtAt !== "string" ||
			typeof parsed.sourceHash !== "string" ||
			!Array.isArray(parsed.inputs) ||
			!parsed.inputs.every((input) => typeof input === "string" && input.length > 0)
		) {
			return null;
		}
		return {
			version: EGRESS_BUNDLE_STAMP_VERSION,
			builtAt: parsed.builtAt,
			inputs: [...parsed.inputs],
			sourceHash: parsed.sourceHash,
		};
	} catch {
		return null;
	}
}

export type EgressBundleFreshness =
	| { status: "fresh"; stamp: EgressBundleStamp }
	| { status: "stale"; stamp: EgressBundleStamp; currentHash: string }
	/** No stamp beside the bundle — a build from before stamping; nothing to compare. */
	| { status: "unstamped" }
	/** The stamp names inputs the running tree does not have (a packaged app without `src/`) — cannot compare. */
	| { status: "unverifiable"; stamp: EgressBundleStamp; missingInputs: string[] };

/** Pure verdict from the stamp and whatever the current tree could read (`null` content = file missing). */
export function evaluateEgressBundleFreshness(input: {
	stamp: EgressBundleStamp | null;
	readInput: (relativePath: string) => string | Uint8Array | null;
}): EgressBundleFreshness {
	if (!input.stamp) {
		return { status: "unstamped" };
	}
	const entries: EgressBundleSourceEntry[] = [];
	const missingInputs: string[] = [];
	for (const path of input.stamp.inputs) {
		const content = input.readInput(path);
		if (content === null) {
			missingInputs.push(path);
		} else {
			entries.push({ path, content });
		}
	}
	if (missingInputs.length > 0) {
		return { status: "unverifiable", stamp: input.stamp, missingInputs };
	}
	const currentHash = computeEgressBundleSourceHash(entries);
	return currentHash === input.stamp.sourceHash
		? { status: "fresh", stamp: input.stamp }
		: { status: "stale", stamp: input.stamp, currentHash };
}

export function formatEgressBundleStaleWarning(input: {
	bundlePath: string;
	freshness: Extract<EgressBundleFreshness, { status: "stale" | "unstamped" }>;
	rebuildCommand: string;
}): string {
	const cause =
		input.freshness.status === "stale"
			? `built ${input.freshness.stamp.builtAt} from sources that have changed since`
			: "carries no build stamp, so it cannot be matched against the current sources";
	return (
		`The egress proxy bundle ${input.bundlePath} is stale: ${cause}. ` +
		"A stale proxy silently fail-closes every sandbox network call (npm install, typecheck deps), " +
		`so acceptance and plan gates run offline. Rebuild it: ${input.rebuildCommand}`
	);
}
