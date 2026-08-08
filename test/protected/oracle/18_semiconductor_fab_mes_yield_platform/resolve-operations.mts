/**
 * P23.6 — the binding layer that lets ONE oracle grade BOTH spec variants.
 *
 * The prescriptive spec pins module paths (`src/domain/route/lot-split.ts`); the discovery variant deliberately
 * does not, because prescribing the file map is exactly the thinking it wants the agent to do. But a held-out
 * probe can only exist if SOMETHING stable is callable — an oracle that binds to paths the agent invented is not
 * an oracle. So the discovery variant pins one thing and only one thing: a public entry point (`src/index.ts`)
 * re-exporting the named operations. Architecture is free; the public surface is not.
 *
 * This resolver therefore binds to the OPERATION, wherever the variant's own contract says it lives: the public
 * entry point first, then the prescriptive module paths. That is not a loosening of the oracle — under both
 * variants the probe still calls a surface the SPEC fixed in advance, never one the agent chose.
 *
 * It fails LOUDLY when neither exists. A resolver that quietly returned undefined would turn "the agent built
 * nothing callable" into "the probe found nothing to assert", which is the null-agent hole this oracle exists
 * to close.
 */

import { join } from "node:path";
import { pathToFileURL } from "node:url";

export interface RouteAlgebra {
	// biome-ignore lint/suspicious/noExplicitAny: the workspace under grade is untyped by construction.
	readonly splitLot: (...args: any[]) => any;
	// biome-ignore lint/suspicious/noExplicitAny: the workspace under grade is untyped by construction.
	readonly mergeLots: (...args: any[]) => any;
	// biome-ignore lint/suspicious/noExplicitAny: the workspace under grade is untyped by construction.
	readonly recordRework: (...args: any[]) => any;
}

const OPERATIONS = ["splitLot", "mergeLots", "recordRework"] as const;

/** Where each operation is pinned, per variant. Order matters: public surface first, prescribed layout second. */
const CANDIDATE_PATHS: Record<(typeof OPERATIONS)[number], readonly string[]> = {
	splitLot: ["src/index.ts", "src/domain/route/lot-split.ts"],
	mergeLots: ["src/index.ts", "src/domain/route/lot-merge.ts"],
	recordRework: ["src/index.ts", "src/domain/route/lot-rework.ts"],
};

async function importIfPresent(workspace: string, relativePath: string): Promise<Record<string, unknown> | null> {
	try {
		return (await import(pathToFileURL(join(workspace, relativePath)).href)) as Record<string, unknown>;
	} catch {
		// A missing or unloadable module is a legitimate "not this variant"; the caller reports the real failure
		// only after every candidate has been tried, so a typo in one path can never masquerade as the other variant.
		return null;
	}
}

export async function resolveRouteAlgebra(workspace: string): Promise<RouteAlgebra> {
	const resolved: Record<string, unknown> = {};
	const missing: string[] = [];

	for (const operation of OPERATIONS) {
		let found: unknown;
		for (const candidate of CANDIDATE_PATHS[operation]) {
			const loaded = await importIfPresent(workspace, candidate);
			if (typeof loaded?.[operation] === "function") {
				found = loaded[operation];
				break;
			}
		}
		if (found === undefined) {
			missing.push(`${operation} (looked in ${CANDIDATE_PATHS[operation].join(", ")})`);
			continue;
		}
		resolved[operation] = found;
	}

	if (missing.length > 0) {
		throw new Error(
			`The workspace exposes no callable route algebra — ${missing.join("; ")}. ` +
				"Under the prescriptive spec these live at their prescribed module paths; under the discovery variant " +
				"they must be re-exported from src/index.ts.",
		);
	}
	return resolved as unknown as RouteAlgebra;
}
