import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runDevModelFitCommand } from "../../../src/commands/dev-model-fit-command";
import { type ModelCandidate, rankModelCandidatesByFit } from "../../../src/core/model-candidate-ranking";

/**
 * P25.3 phase 2 — "what is new" becomes "what is new AND runnable here".
 *
 * The load-bearing case is the one a naive implementation gets backwards: an `exceeds` verdict from the
 * GQA-blind heuristic is NOT evidence a model is too big, and burying it hides the candidates most worth having.
 */

const GIB = 1024 ** 3;

function candidate(overrides: Partial<ModelCandidate> = {}): ModelCandidate {
	return { key: "vendor/model", paramB: 8, weightBitsPerParam: 4, ...overrides };
}

function rank(candidates: readonly ModelCandidate[], budgetGib: number, contextTokens = 32_768) {
	return rankModelCandidatesByFit({ candidates, budgetBytes: budgetGib * GIB, contextTokens });
}

describe("rankModelCandidatesByFit", () => {
	it("calls a comfortably-fitting model runnable", () => {
		// 8B Q4 with real Llama-3-8B geometry: ~3.7 GiB weights + ~4 GiB KV at 32k, so 64 GiB is ample.
		const result = rank([candidate({ architecture: { layers: 32, kvHeads: 8, headDim: 128 } })], 64);
		expect(result.ranked[0]?.tier).toBe("runnable");
	});

	it("separates a TIGHT fit from a comfortable one", () => {
		const architecture = { layers: 32, kvHeads: 8, headDim: 128 };
		const comfortable = rank([candidate({ architecture })], 64).ranked[0]?.tier;
		// ~9.3 GiB total, so a 10 GiB budget leaves under 10% headroom.
		const squeezed = rank([candidate({ architecture })], 10).ranked[0]?.tier;
		expect(comfortable).toBe("runnable");
		expect(squeezed).toBe("runnable_tight");
	});

	it("calls a DECLARED-architecture overflow a real refusal", () => {
		const result = rank([candidate({ paramB: 120, architecture: { layers: 80, kvHeads: 8, headDim: 128 } })], 8);
		expect(result.ranked[0]?.tier).toBe("exceeds_budget");
	});

	it("does NOT call a heuristic overflow a refusal — it is undetermined", () => {
		// No architecture supplied, so KV is estimated assuming NO grouped-query attention: over-stated 4-8x.
		// Reporting this as "too big" would hide a model that almost certainly runs.
		const result = rank([candidate({ paramB: 8 })], 8);
		expect(result.ranked[0]?.tier).toBe("undetermined_needs_architecture");
		expect(result.ranked[0]?.notes.join(" ")).toMatch(/fetch this model's layer\/kv-head\/head-dim geometry/u);
	});

	it("ranks undetermined ABOVE known-too-big — a maybe beats a no", () => {
		const tooBig = candidate({
			key: "known/too-big",
			paramB: 120,
			architecture: { layers: 80, kvHeads: 8, headDim: 128 },
		});
		const unknown = candidate({ key: "maybe/runnable", paramB: 8 });
		// Deliberately supplied worst-first, so passing cannot be an artifact of input order.
		const result = rank([tooBig, unknown], 8);
		expect(result.ranked.map((entry) => entry.candidate.key)).toEqual(["maybe/runnable", "known/too-big"]);
	});

	it("preserves the SOURCE's order within a tier rather than inventing a quality score", () => {
		const architecture = { layers: 32, kvHeads: 8, headDim: 128 };
		const result = rank(
			[
				candidate({ key: "first", architecture }),
				candidate({ key: "second", paramB: 4, architecture }),
				candidate({ key: "third", paramB: 2, architecture }),
			],
			64,
		);
		// All three are runnable; a smaller model does NOT get promoted for being smaller.
		expect(result.ranked.map((entry) => entry.candidate.key)).toEqual(["first", "second", "third"]);
	});

	it("orders across all four tiers at once", () => {
		const architecture = { layers: 32, kvHeads: 8, headDim: 128 };
		const result = rank(
			[
				candidate({ key: "d-too-big", paramB: 400, architecture: { layers: 126, kvHeads: 8, headDim: 128 } }),
				candidate({ key: "c-unknown", paramB: 70 }),
				candidate({ key: "b-tight", paramB: 8, architecture }),
				candidate({ key: "a-fits", paramB: 1, architecture }),
			],
			10,
		);
		expect(result.ranked.map((entry) => entry.tier)).toEqual([
			"runnable",
			"runnable_tight",
			"undetermined_needs_architecture",
			"exceeds_budget",
		]);
	});

	it("flags a catalogue size that disagrees with the stated parameters", () => {
		// The metadata describes a different artefact than the one that would download — worth knowing before
		// committing to tens of gigabytes.
		const result = rank([candidate({ paramB: 8, weightBitsPerParam: 4, sizeBytes: 40 * GIB })], 64);
		expect(result.ranked[0]?.notes.join(" ")).toMatch(/catalogue size .* disagrees/u);
	});

	it("does not flag a catalogue size that roughly agrees", () => {
		// 8B at 4 bits ≈ 3.7 GiB; quantisation schemes mix bit-widths, so near-misses must stay quiet.
		const result = rank([candidate({ paramB: 8, weightBitsPerParam: 4, sizeBytes: 4 * GIB })], 64);
		expect(result.ranked[0]?.notes.join(" ")).not.toMatch(/disagrees/u);
	});

	it("says plainly that undetermined candidates are not rejects", () => {
		expect(rank([candidate({ paramB: 8 })], 8).summary).toMatch(/NOT rejects/u);
	});

	it("re-ranks when the SERVED context changes, not just when the model does", () => {
		// The same model at 8k and at 128k are different residency questions — the point of costing KV at all.
		const architecture = { layers: 32, kvHeads: 8, headDim: 128 };
		const short = rankModelCandidatesByFit({
			candidates: [candidate({ architecture })],
			budgetBytes: 8 * GIB,
			contextTokens: 8_192,
		});
		const long = rankModelCandidatesByFit({
			candidates: [candidate({ architecture })],
			budgetBytes: 8 * GIB,
			contextTokens: 131_072,
		});
		expect(short.ranked[0]?.tier).toBe("runnable");
		expect(long.ranked[0]?.tier).toBe("exceeds_budget");
	});

	it("handles an empty candidate list without inventing one", () => {
		expect(rank([], 64).ranked).toEqual([]);
	});
});

/**
 * The `dev model-fit --shortlist` WIRE.
 *
 * The core above is tested exhaustively; this proves the command reaches it, reads the file, and applies the
 * SAME budget precedence as the single-model path — a shortlist and a one-off check disagreeing about how much
 * memory this machine has would be worse than either being wrong alone.
 */
describe("dev model-fit --shortlist", () => {
	function runShortlist(candidates: readonly ModelCandidate[], budgetGb: string): string {
		const directory = mkdtempSync(join(tmpdir(), "nklein-shortlist-"));
		const file = join(directory, "candidates.json");
		writeFileSync(file, JSON.stringify(candidates), "utf8");
		const originalWrite = process.stdout.write.bind(process.stdout);
		const originalExit = process.exitCode;
		let out = "";
		process.stdout.write = ((chunk: string) => {
			out += chunk;
			return true;
		}) as typeof process.stdout.write;
		try {
			runDevModelFitCommand({ shortlist: file, budgetGb, context: "32768" });
			return out;
		} finally {
			process.stdout.write = originalWrite;
			process.exitCode = originalExit;
			rmSync(directory, { recursive: true, force: true });
		}
	}

	it("ranks a real shortlist, putting the undetermined candidate above the known-too-big one", () => {
		const out = runShortlist(
			[
				{
					key: "deepseek/v4-671b",
					paramB: 671,
					weightBitsPerParam: 4,
					architecture: { layers: 61, kvHeads: 128, headDim: 128 },
				},
				{ key: "qwen/qwen3-next-80b", paramB: 80, weightBitsPerParam: 4 },
				{
					key: "meta/llama-3-8b",
					paramB: 8,
					weightBitsPerParam: 4,
					architecture: { layers: 32, kvHeads: 8, headDim: 128 },
				},
			],
			"48",
		);
		expect(out.indexOf("meta/llama-3-8b")).toBeLessThan(out.indexOf("qwen/qwen3-next-80b"));
		expect(out.indexOf("qwen/qwen3-next-80b")).toBeLessThan(out.indexOf("deepseek/v4-671b"));
		expect(out).toContain("UNDETERMINED_NEEDS_ARCHITECTURE");
	});

	it("reports the budget SOURCE, so a surprising verdict can be traced to its input", () => {
		expect(runShortlist([{ key: "m", paramB: 1, weightBitsPerParam: 4 }], "48")).toContain("via --budget-gb");
	});

	it("fails loudly on an unreadable shortlist rather than ranking nothing", () => {
		const originalWrite = process.stdout.write.bind(process.stdout);
		const originalExit = process.exitCode;
		let out = "";
		process.stdout.write = ((chunk: string) => {
			out += chunk;
			return true;
		}) as typeof process.stdout.write;
		try {
			runDevModelFitCommand({ shortlist: join(tmpdir(), "nklein-no-such-shortlist.json") });
			expect(process.exitCode).toBe(1);
			expect(out).toContain("Could not read a candidate array");
		} finally {
			process.stdout.write = originalWrite;
			process.exitCode = originalExit;
		}
	});
});
