import { describe, expect, it } from "vitest";
import { listDevTestProjectIds } from "../../../src/nklein-agent/dev-test-project-registry";

/**
 * Numeric prefixes must be unique across dev-test projects.
 *
 * Live 2026-09-08: ten new projects were numbered 21–30 after checking only 01–20 and 36, and projects already
 * occupied 21–35. Nothing complained — both folders load fine — but the SELECTOR is ambiguous: the simulated-flow
 * harness resolves `NKLEIN_SIMFLOW_SCENARIO=21` with `dir === selector || dir.startsWith(`${selector}_`)` and takes
 * the first match in sorted order, so a run silently drives a different project than the one asked for and its
 * evidence is filed under the wrong name. A duplicate prefix is therefore not a cosmetic clash; it is a
 * misattribution waiting to happen, and it is invisible without this check.
 */
describe("dev-test project numeric prefixes", () => {
	it("are unique, so a numeric selector can never resolve to two projects", () => {
		const byPrefix = new Map<string, string[]>();
		for (const id of listDevTestProjectIds()) {
			const prefix = /^(\d+)_/u.exec(id)?.[1];
			if (!prefix) {
				continue; // Legacy folders carry stable non-numeric ids and are selected by name.
			}
			byPrefix.set(prefix, [...(byPrefix.get(prefix) ?? []), id]);
		}
		const collisions = [...byPrefix.entries()]
			.filter(([, ids]) => ids.length > 1)
			.map(([prefix, ids]) => `${prefix} → ${ids.join(", ")}`);
		expect(
			collisions,
			`these numeric prefixes name more than one project, so a numeric selector silently picks the first:\n  ${collisions.join("\n  ")}`,
		).toEqual([]);
	});
});
