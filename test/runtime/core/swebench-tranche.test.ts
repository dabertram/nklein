import { describe, expect, it } from "vitest";
import { SWEBENCH_TRANCHE, SWEBENCH_TRANCHE_EXCLUSIONS } from "../../../src/core/swebench-tranche";

/**
 * N8 — the tranche manifest's integrity: exactly ten instances across the four probe-proven pure-python
 * repos, pytest-repo entries never shadowing their own package, and every probe rejection recorded with its
 * disqualifying evidence (an exclusion must never look like an oversight).
 */
describe("SWEBENCH_TRANCHE", () => {
	it("is exactly ten unique instances across the four suitable repos", () => {
		expect(SWEBENCH_TRANCHE).toHaveLength(10);
		expect(new Set(SWEBENCH_TRANCHE.map((entry) => entry.instanceId)).size).toBe(10);
		const repos = new Set(SWEBENCH_TRANCHE.map((entry) => entry.repo));
		expect([...repos].sort()).toEqual(["pallets/flask", "psf/requests", "pylint-dev/pylint", "pytest-dev/pytest"]);
	});

	it("every instance id belongs to its repo and the whole tranche graders on python 3.9", () => {
		for (const entry of SWEBENCH_TRANCHE) {
			const repoSlug = entry.repo.replace("/", "__");
			expect(entry.instanceId.startsWith(repoSlug), `${entry.instanceId} does not belong to ${entry.repo}`).toBe(
				true,
			);
			expect(entry.python).toBe("3.9");
		}
	});

	it("pytest-repo instances never install another pytest (the editable install IS the pytest under test)", () => {
		for (const entry of SWEBENCH_TRANCHE.filter((candidate) => candidate.repo === "pytest-dev/pytest")) {
			expect(
				entry.extraRequirements.some((requirement) => requirement.startsWith("pytest")),
				`${entry.instanceId} would shadow its own package`,
			).toBe(false);
			// Codeload tarballs carry no git history — without a pretend version, setuptools_scm invents
			// 0.1.dev1 and pytest's own minversion check rejects itself (probe-caught on 7521/6202).
			expect(entry.installEnv.SETUPTOOLS_SCM_PRETEND_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
		}
	});

	it("exclusions carry the disqualifying evidence and never overlap the tranche", () => {
		const trancheIds = new Set(SWEBENCH_TRANCHE.map((entry) => entry.instanceId));
		for (const exclusion of SWEBENCH_TRANCHE_EXCLUSIONS) {
			expect(trancheIds.has(exclusion.instanceId), `${exclusion.instanceId} is both excluded and included`).toBe(
				false,
			);
			expect(exclusion.reason.length).toBeGreaterThan(40);
		}
	});
});
