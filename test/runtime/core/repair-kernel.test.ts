import { describe, expect, it } from "vitest";
import {
	aggregateCandidateValidation,
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

describe("aggregateCandidateValidation", () => {
	const gates = {
		candidateId: "c1",
		reproPassAfter: true,
		regressionFailures: 0,
		typecheckFailures: 0,
		lintFailures: 0,
		diffSize: 12,
	};

	it("folds all-clean raw gates into an all-pass validation", () => {
		expect(aggregateCandidateValidation(gates)).toEqual({
			candidateId: "c1",
			reproPass: true,
			regressionPass: true,
			checksPass: true,
			diffSize: 12,
		});
	});

	it("any regression failure ⇒ regressionPass false", () => {
		expect(aggregateCandidateValidation({ ...gates, regressionFailures: 2 }).regressionPass).toBe(false);
	});

	it("a typecheck OR lint failure ⇒ checksPass false", () => {
		expect(aggregateCandidateValidation({ ...gates, typecheckFailures: 1 }).checksPass).toBe(false);
		expect(aggregateCandidateValidation({ ...gates, lintFailures: 1 }).checksPass).toBe(false);
	});

	it("a not-passing repro ⇒ reproPass false", () => {
		expect(aggregateCandidateValidation({ ...gates, reproPassAfter: false }).reproPass).toBe(false);
	});

	it("clamps negative counts / diff size (fail-safe on garbage)", () => {
		const out = aggregateCandidateValidation({
			...gates,
			regressionFailures: -1,
			typecheckFailures: -3,
			lintFailures: -2,
			diffSize: -5,
		});
		expect(out).toMatchObject({ regressionPass: true, checksPass: true, diffSize: 0 });
	});

	it("the aggregate feeds the ranker (an all-pass small diff outranks a repro-only failure)", () => {
		const good = aggregateCandidateValidation(gates);
		const bad = aggregateCandidateValidation({ ...gates, candidateId: "c2", regressionFailures: 1 });
		expect(rankCandidateValidations([bad, good])[0].candidateId).toBe("c1");
	});
});

describe("rankCandidateValidations injectable tiebreaks (§5.AK)", () => {
	// Two all-pass candidates with the SAME diff size — only the injected evidence separates them.
	const a = validation("a", { reproPass: true, regressionPass: true, checksPass: true, diffSize: 10 });
	const b = validation("b", { reproPass: true, regressionPass: true, checksPass: true, diffSize: 10 });

	it("touched-file plausibility breaks a gate+diff tie", () => {
		const ranked = rankCandidateValidations([a, b], (id) =>
			id === "b" ? { touchedFilePlausibility: 1 } : undefined,
		);
		expect(ranked[0].candidateId).toBe("b");
	});

	it("reviewer-evidence + learned-prior sum into the tiebreak score", () => {
		const ranked = rankCandidateValidations([a, b], (id) =>
			id === "a" ? { reviewerEvidence: 0.4, learnedPrior: 0.3 } : { touchedFilePlausibility: 0.2 },
		);
		expect(ranked[0].candidateId).toBe("a"); // 0.7 > 0.2
	});

	it("tiebreaks NEVER override the hard gates (a passing candidate outranks a failing one with big evidence)", () => {
		const failing = validation("fail", { reproPass: false, diffSize: 1 });
		const passing = validation("pass", { reproPass: true, regressionPass: true, checksPass: true, diffSize: 99 });
		const ranked = rankCandidateValidations([failing, passing], (id) =>
			id === "fail" ? { reviewerEvidence: 999 } : undefined,
		);
		expect(ranked[0].candidateId).toBe("pass");
	});

	it("absent tiebreaks ⇒ classic gate-then-smaller-diff order (byte-identical)", () => {
		const small = validation("small", { reproPass: true, regressionPass: true, checksPass: true, diffSize: 5 });
		const big = validation("big", { reproPass: true, regressionPass: true, checksPass: true, diffSize: 50 });
		expect(rankCandidateValidations([big, small])[0].candidateId).toBe("small");
	});
});

describe("runRepairKernel — best partial across rounds (regression: bug-hunt 2026-07-05)", () => {
	it("keeps the BEST partial across rounds, not just the first (a later round can improve it)", async () => {
		let round = 0;
		const outcome = await runRepairKernel(
			deps({
				generateCandidates: async () => {
					round += 1;
					return round === 1 ? [candidate("weak")] : [candidate("strong")];
				},
				validate: async (c) =>
					c.id === "strong"
						? validation("strong", { reproPass: true, regressionPass: true, diffSize: 2 }) // score 6
						: validation("weak", { reproPass: true, diffSize: 9 }), // score 4
			}),
			{ candidateCount: 1, refineRounds: 1 },
		);
		expect(outcome.status).toBe("no_candidate_passed");
		if (outcome.status === "no_candidate_passed") {
			expect(outcome.best.candidate.id).toBe("strong"); // round 2's better partial, not round 1's weak
		}
	});

	it("keeps the earlier partial when a later round is strictly worse", async () => {
		let round = 0;
		const outcome = await runRepairKernel(
			deps({
				generateCandidates: async () => {
					round += 1;
					return round === 1 ? [candidate("good")] : [candidate("bad")];
				},
				validate: async (c) =>
					c.id === "good"
						? validation("good", { reproPass: true, regressionPass: true, diffSize: 2 }) // score 6
						: validation("bad", { reproPass: true, diffSize: 1 }), // score 4
			}),
			{ candidateCount: 1, refineRounds: 1 },
		);
		if (outcome.status === "no_candidate_passed") {
			expect(outcome.best.candidate.id).toBe("good"); // round 1 kept (round 2 worse)
		}
	});
});
