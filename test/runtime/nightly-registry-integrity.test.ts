import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
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
		const boardLanes = new Set(["backlog", "planning", "ready", "in_progress", "review", "completed", "trash"]);
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
			projects?: { id: string; invariantPack?: string }[];
		};
		for (const project of manifest.projects ?? []) {
			if (project.invariantPack) {
				expect(
					NIGHTLY_PACK_REGISTRY.has(project.invariantPack),
					`project "${project.id}" names pack "${project.invariantPack}", which is not registered`,
				).toBe(true);
			}
		}
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
