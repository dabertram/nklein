import { describe, expect, it } from "vitest";

import { EVAL_PROMPT_CORPUS, type ReviewEvalPrompt } from "../../../src/core/eval-prompt-corpus.js";
import {
	evalDifficultyToFitnessTier,
	type ModelEvalChat,
	runModelEval,
} from "../../../src/nklein-agent/model-eval-runner.js";

/** Serve each corpus row its OWN answer key, so every cell scores 1.0 (the corpus self-tests to 1). */
function perfectChat(): ModelEvalChat {
	const reviewById = new Map<string, ReviewEvalPrompt>();
	const decomposeById = new Map<string, { nodes: string[]; edges: { from: string; to: string }[] }>();
	for (const row of EVAL_PROMPT_CORPUS) {
		if (row.family === "review") {
			reviewById.set(row.prompt.slice(0, 40), row);
		} else if (row.family === "decompose") {
			decomposeById.set(row.prompt.slice(0, 40), row.reference);
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
		for (const [needle, row] of reviewById) {
			if (userText.includes(needle)) {
				// Name every seeded defect in review-friendly phrasing so the matchers credit each finding.
				const findings = row.seededDefects.map((id) => `Defect: ${id.replaceAll("-", " ")} — ${id}`);
				return { message: { content: findings.join("\n") } };
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
		// implement cells are skipped ⇒ only architect + reviewer roles fold.
		expect(Object.keys(result.fitnessByRole).sort()).toEqual(["architect", "reviewer"]);
		expect(result.fitnessByRole.architect?.reliability).toBe(1);
		expect(result.cells.every((cell) => cell.score === 1)).toBe(true);
	});

	it("produces settled_pass stability once repeats reach the target and thin below the minimum", async () => {
		const chat = perfectChat();
		const settled = await runModelEval({ modelId: "coder-test", repeats: 6 }, { chat, now: () => 1 });
		expect(settled.stability.length).toBeGreaterThan(0);
		expect(settled.stability.every((cell) => cell.verdict === "settled_pass")).toBe(true);

		const thin = await runModelEval({ modelId: "coder-test", repeats: 3 }, { chat, now: () => 1 });
		// 3 < minSettledRuns(4) ⇒ every cell is still thin.
		expect(thin.stability.every((cell) => cell.verdict === "thin")).toBe(true);
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
});
