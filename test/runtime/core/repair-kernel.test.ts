import { describe, expect, it } from "vitest";
import {
	type CandidateValidation,
	type RepairCandidate,
	type RepairKernelDeps,
	rankCandidateValidations,
	runRepairKernel,
} from "../../../src/core/repair-kernel";

function validation(candidateId: string, partial: Partial<CandidateValidation>): CandidateValidation {
	return { candidateId, reproPass: false, regressionPass: false, checksPass: false, diffSize: 10, ...partial };
}

function candidate(id: string): RepairCandidate {
	return { id, patch: `patch-${id}` };
}

/** Build deps from a fixed candidate list + a validator map, with reproduce defaulting to true. */
function deps(
	over: Partial<RepairKernelDeps> & { validations?: Record<string, Partial<CandidateValidation>> },
): RepairKernelDeps {
	const validations = over.validations ?? {};
	return {
		reproduce: over.reproduce ?? (async () => true),
		localize: over.localize ?? (async () => ["src/foo.ts:bar"]),
		generateCandidates: over.generateCandidates ?? (async () => [candidate("a"), candidate("b")]),
		validate: over.validate ?? (async (c) => validation(c.id, validations[c.id] ?? {})),
	};
}

describe("rankCandidateValidations", () => {
	it("ranks repro > regression > checks, then smaller diff", () => {
		const ranked = rankCandidateValidations([
			validation("partial", { reproPass: true, regressionPass: false, diffSize: 5 }),
			validation("full-big", { reproPass: true, regressionPass: true, checksPass: true, diffSize: 99 }),
			validation("full-small", { reproPass: true, regressionPass: true, checksPass: true, diffSize: 4 }),
		]);
		expect(ranked.map((v) => v.candidateId)).toEqual(["full-small", "full-big", "partial"]);
	});
});

describe("runRepairKernel", () => {
	it("short-circuits when the bug cannot be reproduced", async () => {
		const outcome = await runRepairKernel(deps({ reproduce: async () => false }));
		expect(outcome.status).toBe("cannot_reproduce");
	});

	it("returns the fully-passing candidate as fixed", async () => {
		const outcome = await runRepairKernel(
			deps({
				validations: {
					a: { diffSize: 8 },
					b: { reproPass: true, regressionPass: true, checksPass: true, diffSize: 3 },
				},
			}),
		);
		expect(outcome.status).toBe("fixed");
		if (outcome.status === "fixed") {
			expect(outcome.candidate.id).toBe("b");
			expect(outcome.rounds).toBe(1);
		}
	});

	it("returns the best partial when no candidate fully passes (real progress, not a dead end)", async () => {
		const outcome = await runRepairKernel(
			deps({ validations: { a: { reproPass: true, diffSize: 7 }, b: { diffSize: 2 } } }),
			{ candidateCount: 2, refineRounds: 0 },
		);
		expect(outcome.status).toBe("no_candidate_passed");
		if (outcome.status === "no_candidate_passed") {
			// 'a' reproduces (rank score 4) — the best partial despite a bigger diff than 'b'.
			expect(outcome.best.candidate.id).toBe("a");
		}
	});

	it("uses refine rounds: a later round can land the fix", async () => {
		let round = 0;
		const outcome = await runRepairKernel(
			deps({
				generateCandidates: async () => {
					round += 1;
					// Round 1 only a non-passing candidate; round 2 the fix.
					return round === 1 ? [candidate("p")] : [candidate("fix")];
				},
				validate: async (c) =>
					c.id === "fix"
						? validation("fix", { reproPass: true, regressionPass: true, checksPass: true, diffSize: 1 })
						: validation(c.id, { reproPass: true, diffSize: 9 }),
			}),
			{ candidateCount: 1, refineRounds: 1 },
		);
		expect(outcome.status).toBe("fixed");
		if (outcome.status === "fixed") {
			expect(outcome.candidate.id).toBe("fix");
			expect(outcome.rounds).toBe(2);
		}
	});

	it("reports no_candidate when generation yields nothing", async () => {
		const outcome = await runRepairKernel(deps({ generateCandidates: async () => [] }), {
			candidateCount: 3,
			refineRounds: 0,
		});
		expect(outcome.status).toBe("no_candidate");
	});
});
