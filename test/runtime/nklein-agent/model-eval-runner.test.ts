import { describe, expect, it } from "vitest";

import { EVAL_PROMPT_CORPUS, type ReviewEvalPrompt } from "../../../src/core/eval-prompt-corpus.js";
import {
	evalDifficultyToFitnessTier,
	type ModelEvalChat,
	runModelEval,
} from "../../../src/nklein-agent/model-eval-runner.js";
import type { StoredDistractorObservation } from "../../../src/state/distractor-observation-store.js";
import type { StoredReasoningObservation } from "../../../src/state/reasoning-observation-store.js";

/** Serve each corpus row its OWN answer key, so every cell scores 1.0 (the corpus self-tests to 1). */
function perfectChat(): ModelEvalChat {
	const reviewById = new Map<string, ReviewEvalPrompt>();
	const decomposeById = new Map<string, { nodes: string[]; edges: { from: string; to: string }[] }>();
	const toolUseById = new Map<string, { name: string; args: Record<string, unknown> } | null>();
	const contextProbeById = new Map<string, string>();
	for (const row of EVAL_PROMPT_CORPUS) {
		if (row.family === "review") {
			reviewById.set(row.prompt.slice(0, 40), row);
		} else if (row.family === "decompose") {
			decomposeById.set(row.prompt.slice(0, 40), row.reference);
		} else if (row.family === "tool_use") {
			toolUseById.set(row.prompt.slice(0, 40), row.expected);
		} else if (row.family === "context_probe") {
			contextProbeById.set(row.prompt.slice(0, 40), row.expectedFragments[0] ?? "");
		}
	}
	return async (messages) => {
		const userText = messages
			.filter((message) => message.role === "user")
			.map((message) => message.content)
			.join("\n");
		for (const [needle, reference] of decomposeById) {
			if (userText.includes(needle)) {
				const depsByNode = new Map<string, string[]>();
				for (const edge of reference.edges) {
					depsByNode.set(edge.to, [...(depsByNode.get(edge.to) ?? []), edge.from]);
				}
				const tasks = reference.nodes.map((node) => ({ id: node, dependsOn: depsByNode.get(node) ?? [] }));
				return { message: { content: JSON.stringify({ tasks }) } };
			}
		}
		for (const [needle, expected] of toolUseById) {
			if (userText.includes(needle)) {
				// Emit the expected call (or NO call for an irrelevance probe, which is the correct answer there).
				return expected
					? {
							message: {
								tool_calls: [{ function: { name: expected.name, arguments: JSON.stringify(expected.args) } }],
							},
						}
					: { message: { content: "The ocean breathes slow / a haiku needs no weather / just salt on the wind" } };
			}
		}
		for (const [needle, row] of reviewById) {
			if (userText.includes(needle)) {
				// Name every seeded defect in review-friendly phrasing so the matchers credit each finding.
				const findings = row.seededDefects.map((id) => `Defect: ${id.replaceAll("-", " ")} — ${id}`);
				return { message: { content: findings.join("\n") } };
			}
		}
		for (const [needle, fragment] of contextProbeById) {
			if (userText.includes(needle)) {
				return { message: { content: `The log states: ${fragment}.` } };
			}
		}
		return null;
	};
}

describe("runModelEval", () => {
	it("scores every non-implement cell 1.0 against the answer keys and folds per-role fitness", async () => {
		let clock = 0;
		const result = await runModelEval(
			{ modelId: "coder-test", repeats: 1, passBar: 0.6 },
			{ chat: perfectChat(), now: () => (clock += 5) },
		);
		expect(result.scoredAttempts).toBeGreaterThan(0);
		expect(result.meanScore).toBe(1);
		// implement cells are skipped ⇒ architect (decompose) + reviewer (review) + worker (tool_use) roles fold.
		expect(Object.keys(result.fitnessByRole).sort()).toEqual(["architect", "reviewer", "worker"]);
		expect(result.fitnessByRole.architect?.reliability).toBe(1);
		expect(result.cells.every((cell) => cell.score === 1)).toBe(true);
	});

	it("produces settled_pass stability once repeats reach the target and thin below the minimum", async () => {
		const chat = perfectChat();
		const settled = await runModelEval({ modelId: "coder-test", repeats: 6 }, { chat, now: () => 1 });
		expect(settled.stability.length).toBeGreaterThan(0);
		expect(settled.stability.every((cell) => cell.verdict === "settled_pass")).toBe(true);

		// Stability cells aggregate by (role, tier), so runs-per-cell = repeats × prompts-in-cell (the §5.AD
		// context probes added a second worker prompt to some tiers). One repeat keeps every cell under
		// minSettledRuns(4) ⇒ still thin.
		const thin = await runModelEval({ modelId: "coder-test", repeats: 1 }, { chat, now: () => 1 });
		expect(thin.stability.length).toBe(0); // repeats=1 ⇒ the runner skips the stability pass entirely
		const thin2 = await runModelEval({ modelId: "coder-test", repeats: 2 }, { chat, now: () => 1 });
		expect(thin2.stability.some((cell) => cell.verdict === "thin")).toBe(true);
	});

	it("counts a no-answer attempt as a failed run without crediting the mean", async () => {
		const silentChat: ModelEvalChat = async () => null;
		const result = await runModelEval({ modelId: "coder-test", repeats: 1 }, { chat: silentChat, now: () => 1 });
		expect(result.scoredAttempts).toBe(0);
		expect(result.meanScore).toBe(0);
		expect(result.totalAttempts).toBeGreaterThan(0);
		expect(result.runs.every((run) => run.passed === false)).toBe(true);
	});

	it("maps corpus difficulty tiers to fitness tiers", () => {
		expect(evalDifficultyToFitnessTier("easy")).toBe("easy");
		expect(evalDifficultyToFitnessTier("hard")).toBe("hard");
		expect(evalDifficultyToFitnessTier("bogus")).toBe("medium");
	});

	describe("F3.16 reasoning A/B", () => {
		it("records baseline + enforced observations per scored cell when both deps are supplied", async () => {
			const observations: StoredReasoningObservation[] = [];
			const result = await runModelEval(
				{ modelId: "coder-test", repeats: 1, promptIds: ["decompose-cli-version-flag"] },
				{
					chat: perfectChat(),
					enforcedChat: perfectChat(),
					recordReasoningBenefit: (batch) => observations.push(...batch),
					now: () => 0,
				},
			);
			// One scored cell ⇒ exactly one off + one on observation, both from the perfect chat (score 1).
			expect(result.scoredAttempts).toBe(1);
			expect(observations).toHaveLength(2);
			expect(observations.map((o) => o.reasoningEnabled).sort()).toEqual([false, true]);
			expect(observations.every((o) => o.qualityScore === 1 && o.modelId === "coder-test")).toBe(true);
			expect(observations.every((o) => o.role === "architect" && o.difficulty === "easy")).toBe(true);
		});

		it("is byte-identical (no A/B pass, no recording) when the enforced deps are omitted", async () => {
			let called = false;
			await runModelEval(
				{ modelId: "coder-test", repeats: 1, promptIds: ["decompose-cli-version-flag"] },
				{ chat: perfectChat(), recordReasoningBenefit: () => (called = true), now: () => 0 },
			);
			// recordReasoningBenefit without an enforcedChat must NOT fire — the A/B pass is gated on both.
			expect(called).toBe(false);
		});
	});

	describe("F4.13 distractor noise A/B", () => {
		it("records the baseline-vs-noisy quality pair per scored cell when the noise deps are supplied", async () => {
			const observations: StoredDistractorObservation[] = [];
			await runModelEval(
				{ modelId: "coder-test", repeats: 1, promptIds: ["decompose-cli-version-flag"] },
				{
					chat: perfectChat(),
					noisyChat: perfectChat(),
					noiseFraction: 0.4,
					recordDistractorSensitivity: (batch) => observations.push(...batch),
					now: () => 0,
				},
			);
			expect(observations).toHaveLength(1);
			expect(observations[0]).toMatchObject({
				modelId: "coder-test",
				role: "architect",
				difficulty: "easy",
				noiseFraction: 0.4,
				baselineQuality: 1,
				noisyQuality: 1,
			});
		});

		it("does not fire when the noisy deps are omitted", async () => {
			let called = false;
			await runModelEval(
				{ modelId: "coder-test", repeats: 1, promptIds: ["decompose-cli-version-flag"] },
				{ chat: perfectChat(), recordDistractorSensitivity: () => (called = true), now: () => 0 },
			);
			expect(called).toBe(false);
		});
	});
});
