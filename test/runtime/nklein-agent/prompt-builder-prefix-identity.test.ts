import { describe, expect, it } from "vitest";
import { renderChatTurnPrompt } from "../../../src/chat/chat-turn-context";
import { buildReviewSeedPrompt, type ReviewSeedPromptInput } from "../../../src/core/review-orchestration";
import { buildNKleinStartPromptParts } from "../../../src/nklein-agent/nklein-task-prompt-builders";

/**
 * F4.40 prefix-IDENTITY net over the non-session prompt builders (the session system prompt has its own net in
 * nklein-session-system-prompt.test.ts). These lock BYTE relations, not just volatility absence (F12.7's audit):
 * the static head of each builder must be byte-shared across inputs, optional sections must append in a fixed
 * order after it, and the volatile payload (diff, temporal block) must trail — so provider KV-prefix reuse and
 * deterministic replay both survive refactors.
 */
describe("prompt-builder prefix identity (F4.40)", () => {
	describe("decompose planning seed", () => {
		const plain = buildNKleinStartPromptParts(
			"Decompose this idea into dependent implementation cards: build a chess PWA.",
			true,
		);

		it("is byte-identical across different ideas (the idea lives in the user prompt, never the system head)", () => {
			const other = buildNKleinStartPromptParts(
				"Decompose this idea into dependent implementation cards: build a habit tracker.",
				true,
			);
			expect(other.systemPrompt).toBe(plain.systemPrompt);
			expect(plain.systemPrompt).not.toBeNull();
		});

		it("inserts prompt-derived directives after the shared static head, never reordering it", () => {
			const withMin = buildNKleinStartPromptParts(
				"Decompose this idea into at least 12 dependent implementation cards: build a chess PWA.",
				true,
			);
			expect(withMin.systemPrompt).toContain("minimumTaskCount: 12");
			const staticHead = (plain.systemPrompt ?? "").split("\n").slice(0, 4).join("\n");
			expect(staticHead.length).toBeGreaterThan(200);
			expect(withMin.systemPrompt?.startsWith(staticHead)).toBe(true);
		});

		it("appends the framework preamble as a TRUE suffix of the plain prompt", () => {
			const withPreamble = buildNKleinStartPromptParts(
				"Decompose this idea into dependent implementation cards: build a chess PWA.",
				true,
				false,
				null,
				["This workspace uses React 19 with the app router."],
			);
			expect(withPreamble.systemPrompt?.startsWith(plain.systemPrompt ?? "")).toBe(true);
			expect(withPreamble.systemPrompt).not.toBe(plain.systemPrompt);
		});
	});

	describe("review seed", () => {
		const base: ReviewSeedPromptInput = {
			taskTitle: "Add retry to the fetch layer",
			taskObjective: "Wrap fetchJson in bounded exponential-backoff retries.",
			diff: "diff --git a/src/fetch.ts b/src/fetch.ts\n+retry(3)",
			round: 1,
		};
		const baseSeed = buildReviewSeedPrompt(base);
		const diffHeaderIndex = baseSeed.indexOf("## Diff under review");
		const head = baseSeed.slice(0, diffHeaderIndex);

		it("is deterministic — the same input serializes to the same bytes", () => {
			expect(buildReviewSeedPrompt(base)).toBe(baseSeed);
			expect(diffHeaderIndex).toBeGreaterThan(0);
		});

		it("keeps the head byte-stable when optional sections are added (they insert between head and diff)", () => {
			const variants = [
				buildReviewSeedPrompt({ ...base, acceptanceSummary: "Acceptance check passed: npm test." }),
				buildReviewSeedPrompt({ ...base, priorFeedback: "Bound the retry count." }),
				buildReviewSeedPrompt({ ...base, riskDirective: "High-risk surface: review failure modes in depth." }),
			];
			for (const variant of variants) {
				expect(variant.startsWith(head)).toBe(true);
				expect(variant).toContain("## Diff under review");
			}
		});

		it("treats the diff as a volatile TAIL — diff-only changes share every byte through the diff header", () => {
			const otherDiff = buildReviewSeedPrompt({ ...base, diff: "diff --git a/src/other.ts b/src/other.ts\n+x" });
			const sharedThroughHeader = baseSeed.slice(0, diffHeaderIndex + "## Diff under review".length);
			expect(otherDiff.startsWith(sharedThroughHeader)).toBe(true);
			expect(otherDiff).not.toBe(baseSeed);
		});
	});

	describe("chat turn prompt", () => {
		const context = {
			goal: "Ship the reporting dashboard.",
			summary: "Earlier: agreed on the schema and the export format.",
			recalledMemories: [],
			recentMessages: [],
		};

		it("is byte-identical across days when the temporal block is disabled", () => {
			const dayOne = renderChatTurnPrompt(context, "What is today's date?", {
				now: new Date("2026-07-19T09:00:00Z"),
				enabled: false,
			});
			const dayTwo = renderChatTurnPrompt(context, "What is today's date?", {
				now: new Date("2026-07-20T09:00:00Z"),
				enabled: false,
			});
			expect(JSON.stringify(dayTwo)).toBe(JSON.stringify(dayOne));
		});

		it("keeps the goal/summary system head byte-stable across days even when the date block injects", () => {
			const dayOne = renderChatTurnPrompt(context, "What is today's date?", {
				now: new Date("2026-07-19T09:00:00Z"),
				enabled: true,
			});
			const dayTwo = renderChatTurnPrompt(context, "What is today's date?", {
				now: new Date("2026-07-20T09:00:00Z"),
				enabled: true,
			});
			// Head = goal + summary system notes; the temporal block (if injected) trails them, so the head
			// messages are byte-identical across days and any difference is confined to the trailing block.
			expect(dayOne.length).toBe(dayTwo.length);
			expect(dayOne[0]).toEqual(dayTwo[0]);
			expect(dayOne[1]).toEqual(dayTwo[1]);
			const injected = dayOne.length > 3;
			if (injected) {
				expect(dayOne[2]?.role).toBe("system");
				expect(dayOne[2]).not.toEqual(dayTwo[2]);
			}
			expect(dayOne.at(-1)).toEqual({ role: "user", content: "What is today's date?" });
		});
	});
});
