import { describe, expect, it } from "vitest";
import type { BoardCard, BoardDependency, CardSelection } from "@/types";
import {
	buildPlanningDagNodes,
	formatDagModelLabel,
	getDagNodeToneClassName,
	isRevisedPlanningCard,
	parseComplexityFromPrompt,
	parseModelFitFromPrompt,
} from "./planning-dag-model";

const card = (id: string, extra: Partial<BoardCard> = {}): BoardCard =>
	({ id, title: id, prompt: "", ...extra }) as BoardCard;
const dep = (fromTaskId: string, toTaskId: string): BoardDependency => ({ fromTaskId, toTaskId }) as BoardDependency;

describe("parseComplexityFromPrompt", () => {
	it("parses a Complexity marker and clamps to 0..100", () => {
		expect(parseComplexityFromPrompt("Complexity: 42/100")).toBe(42);
		expect(parseComplexityFromPrompt("intro\nComplexity: 150/100\n")).toBe(100);
		expect(parseComplexityFromPrompt("no marker here")).toBeNull();
	});
});

describe("parseModelFitFromPrompt", () => {
	it("returns pending when there is no marker", () => {
		expect(parseModelFitFromPrompt("nothing")).toMatchObject({ label: "Backend fit pending", tone: "waiting" });
	});
	it("marks validated routing-guard fits as done, others as starts-later", () => {
		expect(parseModelFitFromPrompt("Model fit: validated by !Klein routing guard (x)")).toMatchObject({
			label: "Backend fit validated",
			tone: "done",
		});
		expect(parseModelFitFromPrompt("Model fit: needs a bigger model")).toMatchObject({
			label: "Backend fit starts later",
			tone: "waiting",
		});
	});
});

describe("isRevisedPlanningCard", () => {
	it("flags decomposition-blocked cards and plan-gap titles", () => {
		expect(isRevisedPlanningCard(card("a", { blockedKind: "needs_decomposition" }))).toBe(true);
		expect(isRevisedPlanningCard(card("a", { title: "Integrate plan gap from card X" }))).toBe(true);
		expect(isRevisedPlanningCard(card("a", { title: "Ordinary task" }))).toBe(false);
	});
});

describe("formatDagModelLabel", () => {
	it("prefers provider/model, then !Klein local, then agentId, then default", () => {
		expect(formatDagModelLabel(card("a", { nkleinSettings: { providerId: "lmstudio", modelId: "m" } }))).toBe(
			"lmstudio / m",
		);
		expect(formatDagModelLabel(card("a", { agentId: "nklein" }))).toBe("!Klein local model");
		expect(formatDagModelLabel(card("a"))).toBe("Default agent");
	});
});

describe("getDagNodeToneClassName", () => {
	it("maps each relation to a distinct class", () => {
		const classes = (["selected", "blocked-by", "unblocks", "related"] as const).map(getDagNodeToneClassName);
		expect(new Set(classes).size).toBe(4);
	});
});

describe("buildPlanningDagNodes", () => {
	it("labels the selected card, its prerequisites (blocked-by), and its dependents (unblocks)", () => {
		const a = card("a");
		const b = card("b");
		const c = card("c");
		const selection = {
			card: a,
			column: { title: "Planning" },
			allColumns: [{ title: "Planning", cards: [a, b, c] }],
		} as unknown as CardSelection;
		// a depends on b (b is a prerequisite ⇒ blocked-by); c depends on a (c is a dependent ⇒ unblocks).
		const nodes = buildPlanningDagNodes(selection, [dep("a", "b"), dep("c", "a")]);
		const byId = new Map(nodes.map((n) => [n.card.id, n.relation]));
		expect(byId.get("a")).toBe("selected");
		expect(byId.get("b")).toBe("blocked-by");
		expect(byId.get("c")).toBe("unblocks");
	});
});
