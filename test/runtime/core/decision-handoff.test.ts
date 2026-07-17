import { describe, expect, it } from "vitest";
import { buildDecisionHandoff, composeDependencyHandoffPreamble } from "../../../src/core/decision-handoff";

describe("buildDecisionHandoff (F12.38)", () => {
	it("renders steps, files, and the shaping review constraint in one compact block", () => {
		const brief = buildDecisionHandoff({
			taskId: "card-a",
			title: "Build the parser",
			completedSteps: ["Chose a recursive-descent parser over regex", "Added the token stream"],
			filesTouched: ["src/parser.ts", "src/tokens.ts"],
			shapingReviewFeedback: "Keep parse errors recoverable — no throws across the module boundary.",
			workerNotes: null,
		});
		expect(brief).toContain('[Handoff from the dependency "Build the parser" (card-a)]');
		expect(brief).toContain("- Chose a recursive-descent parser over regex");
		expect(brief).toContain("src/parser.ts, src/tokens.ts");
		expect(brief).toContain("still binding on follow-up work");
	});

	it("caps long lists and reports the remainder honestly", () => {
		const brief = buildDecisionHandoff({
			taskId: "a",
			title: "T",
			completedSteps: Array.from({ length: 9 }, (_, i) => `step ${i}`),
			filesTouched: Array.from({ length: 14 }, (_, i) => `f${i}.ts`),
			shapingReviewFeedback: null,
			workerNotes: null,
		});
		expect(brief).toContain("…and 3 more step(s)");
		expect(brief).toContain("(+4 more)");
	});

	it("returns null when there is nothing to hand off — no boilerplate", () => {
		expect(
			buildDecisionHandoff({
				taskId: "a",
				title: "T",
				completedSteps: [],
				filesTouched: [],
				shapingReviewFeedback: null,
				workerNotes: null,
			}),
		).toBeNull();
	});
});

describe("composeDependencyHandoffPreamble (F12.38 board-level wire)", () => {
	const card = (id: string, extras: Record<string, unknown> = {}) => ({
		id,
		title: `Card ${id}`,
		prompt: `Do ${id}.`,
		createdAt: 1,
		...extras,
	});
	const board = (input: {
		columns: Array<{ id: string; cards: ReturnType<typeof card>[] }>;
		dependencies: Array<{ fromTaskId: string; toTaskId: string }>;
	}) =>
		({
			columns: input.columns.map((column) => ({ id: column.id, title: column.id, cards: column.cards })),
			dependencies: input.dependencies.map((edge, index) => ({ id: `d${index}`, createdAt: 1, ...edge })),
		}) as never;

	it("briefs only COMPLETED upstream dependencies, honoring the from-depends-on-to edge direction", () => {
		const preamble = composeDependencyHandoffPreamble(
			board({
				columns: [
					{
						id: "completed",
						cards: [
							card("a", {
								focusChain: {
									steps: [
										{ text: "wrote the parser", status: "done" },
										{ text: "skipped docs", status: "skipped" },
									],
								},
								filesLikelyTouched: ["src/parser.ts"],
								review: { status: "approved", round: 1, history: [], lastFeedback: "keep the API frozen" },
							}),
						],
					},
					{ id: "in_progress", cards: [card("busy")] },
					// A card that depends ON b must not brief b's start (wrong direction).
					{ id: "backlog", cards: [card("b"), card("downstream")] },
				],
				dependencies: [
					{ fromTaskId: "b", toTaskId: "a" },
					{ fromTaskId: "b", toTaskId: "busy" },
					{ fromTaskId: "downstream", toTaskId: "b" },
				],
			}),
			"b",
		);
		expect(preamble).toContain('[Handoff from the dependency "Card a" (a)]');
		expect(preamble).toContain("wrote the parser");
		expect(preamble).not.toContain("skipped docs");
		expect(preamble).toContain("src/parser.ts");
		expect(preamble).toContain("keep the API frozen");
		expect(preamble).not.toContain("Card busy");
		expect(preamble.endsWith("\n\n")).toBe(true);
	});

	it("returns empty for no dependencies and caps briefs at 3 with an honest remainder", () => {
		expect(composeDependencyHandoffPreamble(board({ columns: [], dependencies: [] }), "x")).toBe("");
		const upstream = ["a", "b", "c", "d", "e"];
		const preamble = composeDependencyHandoffPreamble(
			board({
				columns: [
					{
						id: "completed",
						cards: upstream.map((id) => card(id, { filesLikelyTouched: [`${id}.ts`] })),
					},
				],
				dependencies: upstream.map((id) => ({ fromTaskId: "x", toTaskId: id })),
			}),
			"x",
		);
		expect(preamble).toContain("(+2 more completed-dependency handoff(s) omitted");
		expect((preamble.match(/\[Handoff from the dependency/g) ?? []).length).toBe(3);
	});
});
