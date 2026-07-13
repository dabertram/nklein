import { describe, expect, it } from "vitest";

import type {
	AppendNKleinPlanRevisionInput,
	NKleinPlanQuestion,
} from "../../../src/nklein-agent/nklein-plan-artifacts";
import {
	formatInitialDecisionsMarkdown,
	formatInitialRevisionsMarkdown,
	formatQuestionsMarkdown,
	formatRevisionEntry,
	parseQuestionsMarkdown,
} from "../../../src/nklein-agent/plan-artifact-markdown";

const question = (partial: Partial<NKleinPlanQuestion>): NKleinPlanQuestion =>
	({
		id: "q1",
		question: "Which database?",
		status: "open",
		options: [],
		answer: null,
		assumption: null,
		...partial,
	}) as NKleinPlanQuestion;

const revision = (partial: Partial<AppendNKleinPlanRevisionInput>): AppendNKleinPlanRevisionInput =>
	({
		workspacePath: "/w",
		slug: "s",
		kind: "plan_gap",
		description: "desc",
		...partial,
	}) as AppendNKleinPlanRevisionInput;

describe("formatQuestionsMarkdown", () => {
	it("renders an empty-state body when there are no questions", () => {
		expect(formatQuestionsMarkdown([])).toBe("# Questions\n\nNo clarifying questions were recorded.\n");
	});

	it("renders status, options (with recommended/description), and the answer", () => {
		const md = formatQuestionsMarkdown([
			question({
				options: [
					{ id: "a", label: "Postgres", description: " relational ", recommended: true },
					{ id: "b", label: "SQLite", description: null, recommended: false },
				],
				answer: " Postgres ",
			}),
		]);
		expect(md).toContain("## q1");
		expect(md).toContain("Status: open");
		expect(md).toContain("- a: Postgres (recommended) - relational");
		expect(md).toContain("- b: SQLite");
		expect(md).toContain("Answer: Postgres");
	});
});

describe("formatInitialDecisionsMarkdown", () => {
	it("renders an empty-state body when no question has an answer or assumption", () => {
		expect(formatInitialDecisionsMarkdown([question({})])).toBe(
			"# Decisions\n\nNo shared decisions have been recorded yet.\n",
		);
	});

	it("includes decided questions with their Decision/Assumption", () => {
		const md = formatInitialDecisionsMarkdown([
			question({ answer: "Postgres" }),
			question({ id: "q2", assumption: "default" }),
		]);
		expect(md).toContain("Decision: Postgres");
		expect(md).toContain("Assumption: default");
	});
});

describe("formatInitialRevisionsMarkdown", () => {
	it("renders the empty revisions body", () => {
		expect(formatInitialRevisionsMarkdown()).toBe("# Revisions\n\nNo plan revisions have been recorded yet.\n");
	});
});

describe("formatRevisionEntry", () => {
	it("renders an ISO-timestamped heading with the kind, plus task and evidence", () => {
		const md = formatRevisionEntry(
			revision({ createdAt: 0, kind: "scope_change", taskId: " t-1 ", evidence: " logs " }),
		);
		expect(md).toContain("## 1970-01-01T00:00:00.000Z - scope_change");
		expect(md).toContain("Task: t-1");
		expect(md).toContain("desc");
		expect(md).toContain("Evidence: logs");
	});

	it("falls back to plan_gap kind and a default description", () => {
		const md = formatRevisionEntry(revision({ createdAt: 0, kind: "   ", description: "   " }));
		expect(md).toContain("- plan_gap");
		expect(md).toContain("Plan revision recorded.");
	});
});

describe("parseQuestionsMarkdown (F1.3a round-trip)", () => {
	it("round-trips a rich question set through the renderer losslessly", () => {
		const questions = [
			{
				id: "q-storage",
				question: "Which storage backend should the habit log use?\nConsider offline-first constraints.",
				status: "open" as const,
				options: [
					{ id: "sqlite", label: "SQLite", description: "Local file DB", recommended: true },
					{ id: "json", label: "Flat JSON", description: null, recommended: false },
				],
				answer: null,
				assumption: "Assume SQLite (recommended option).",
			},
			{
				id: "q-auth",
				question: "Is authentication in scope?",
				status: "answered" as const,
				options: [],
				answer: "No — single-user local app.",
				assumption: null,
			},
		];
		expect(parseQuestionsMarkdown(formatQuestionsMarkdown(questions))).toEqual(questions);
	});

	it("returns [] for the empty-state body and tolerates hand edits", () => {
		expect(parseQuestionsMarkdown(formatQuestionsMarkdown([]))).toEqual([]);
		expect(parseQuestionsMarkdown("")).toEqual([]);
		const handEdited = [
			"# Questions",
			"",
			"## q-1",
			"",
			"Status: totally-bogus",
			"",
			"What now?",
			"",
			"Options:",
			"- malformed option line without separator",
		].join("\n");
		const parsed = parseQuestionsMarkdown(handEdited);
		expect(parsed).toHaveLength(1);
		expect(parsed[0]).toMatchObject({ id: "q-1", question: "What now?", status: "open" });
		expect(parsed[0]?.options[0]?.label).toBe("malformed option line without separator");
	});
});
