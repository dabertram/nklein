import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MECHANISM_REGISTRY } from "../../src/core/mechanism-observation-audit";
import { resolvePack } from "../../src/core/nightly-invariant-pack";
import { NIGHTLY_PACK_REGISTRY } from "../../src/core/nightly-pack-registry";
import { TRACKED_REQUIREMENTS } from "../../src/core/tracked-requirements";

/**
 * Integrity guards for two DATA modules that ship without logic of their own.
 *
 * Both were written today and both carry the same hazard: a map that points at something which does not exist
 * fails SILENTLY. A pack naming a lane the board never produces fails every cell; a requirement naming a symbol
 * that was renamed reports `built_but_unwired` forever. Neither has a wrong-looking line to spot in review.
 */

describe("nightly pack registry", () => {
	it("every pack resolves — an unresolvable pack asserts nothing while appearing to pass", () => {
		for (const id of NIGHTLY_PACK_REGISTRY.keys()) {
			expect(resolvePack(id, NIGHTLY_PACK_REGISTRY), `pack "${id}" does not resolve`).not.toBeNull();
		}
	});

	it("every expected lane is a REAL board lane", () => {
		// The bug this catches, caught by hand hours before this test existed: the pack said `done` while the
		// board's lane is `completed`. That fails EVERY cell spuriously, and the symptom reads as "the nightly is
		// broken" rather than "the pack is wrong" — a confident wrong verdict, which is worse than silence.
		//
		// The vocabulary is the COLLECTOR's, not the board's: `parseTerminalLanes` derives lanes from the drain's
		// `finalCounts` keys, so `inProgress` (camelCase, the counts key) and `failed` (the session-state pseudo
		// lane real flaky violations reported as "failed#1→failed") are producible; `in_progress` never was.
		const boardLanes = new Set([
			"backlog",
			"planning",
			"ready",
			"inProgress",
			"review",
			"completed",
			"failed",
			"trash",
		]);
		for (const [id, pack] of NIGHTLY_PACK_REGISTRY) {
			for (const lane of pack.expectedTerminalLanes) {
				expect(boardLanes.has(lane), `pack "${id}" expects lane "${lane}", which the board never produces`).toBe(
					true,
				);
			}
		}
	});

	it("every project in the manifest names a pack that EXISTS", () => {
		// nightly-manifest.json named `core-invariants` for weeks with nothing defining it, so no cell was ever
		// judged against anything. A dangling name is invisible until someone looks for the pack.
		const manifestPath = "nightly-manifest.json";
		if (!existsSync(manifestPath)) {
			return;
		}
		const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
			projects?: { id: string; invariantPack?: string; invariantPackByProfile?: Record<string, string> }[];
		};
		for (const project of manifest.projects ?? []) {
			if (project.invariantPack) {
				expect(
					NIGHTLY_PACK_REGISTRY.has(project.invariantPack),
					`project "${project.id}" names pack "${project.invariantPack}", which is not registered`,
				).toBe(true);
			}
			// The per-profile overrides carry the same dangling-name hazard as the project-level pack — a typo here
			// silently judges that profile's cell against nothing (found as a coverage gap while registering the
			// turn_loop cell, 2026-07-28).
			for (const [profile, packId] of Object.entries(project.invariantPackByProfile ?? {})) {
				expect(
					NIGHTLY_PACK_REGISTRY.has(packId),
					`project "${project.id}" profile "${profile}" names pack "${packId}", which is not registered`,
				).toBe(true);
			}
		}
	});
});

describe("mechanism registry self-consistency", () => {
	// ⚠️ A CHECK DELIBERATELY NOT WRITTEN (attempted and withdrawn 2026-07-30). It looked obvious that an entry
	// declaring `enabledBy: null` + `expectation: "every_run"` while listing a flag under `covers` must be
	// self-contradictory — that shape is exactly what made `knows_today_injection` the registry's only false alarm.
	// But running it flagged `review_path` and `sysprompt_level` too, and MEASUREMENT refutes the rule: both of
	// those fired in three real campaign runs. They are the legitimate version of the shape — an observation that
	// records unconditionally WHICH WAY a flag went, which is precisely what this file's `covers` doc describes.
	// The true discriminator is behavioural: does the emission site gate on the flag? That is not visible from the
	// registry, so a static check here would look thorough and prove nothing — the failure mode this whole file
	// exists to prevent. `knows_today_injection` was corrected from its emission site instead.
	it("every declared gate flag looks like a real NKLEIN env flag", () => {
		const malformed = MECHANISM_REGISTRY.map((entry) => entry.enabledBy)
			.filter((flag): flag is string => Boolean(flag))
			.filter((flag) => !/^NKLEIN_[A-Z0-9_]+$/.test(flag));
		expect(malformed, `not env-flag shaped: ${malformed.join(", ")}`).toEqual([]);
	});
});

describe("tracked-requirement map", () => {
	it("every declared provider module EXISTS", () => {
		// A renamed or deleted module leaves the map pointing at nothing, and the audit then reports the element as
		// built_but_unwired forever — a permanent false finding that looks like a real one.
		for (const requirement of TRACKED_REQUIREMENTS) {
			for (const element of requirement.elements) {
				if (!element.providedBy) {
					continue;
				}
				expect(
					existsSync(join("src/core", element.providedBy.module)),
					`${requirement.id}/${element.element} names ${element.providedBy.module}, which does not exist`,
				).toBe(true);
			}
		}
	});

	it("every declared provider SYMBOL is exported by its module", () => {
		for (const requirement of TRACKED_REQUIREMENTS) {
			for (const element of requirement.elements) {
				if (!element.providedBy) {
					continue;
				}
				const source = readFileSync(join("src/core", element.providedBy.module), "utf8");
				expect(
					source.includes(`export function ${element.providedBy.symbol}`) ||
						source.includes(`export const ${element.providedBy.symbol}`) ||
						source.includes(`export async function ${element.providedBy.symbol}`),
					`${requirement.id}/${element.element} names ${element.providedBy.symbol}, not exported by ${element.providedBy.module}`,
				).toBe(true);
			}
		}
	});

	it("requirement ids are unique", () => {
		const ids = TRACKED_REQUIREMENTS.map((requirement) => requirement.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it("no requirement declares zero elements — that would pass while asserting nothing", () => {
		for (const requirement of TRACKED_REQUIREMENTS) {
			expect(requirement.elements.length, `${requirement.id} declares no elements`).toBeGreaterThan(0);
		}
	});
});
