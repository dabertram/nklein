import { describe, expect, it } from "vitest";
import {
	buildScenarioDriftReport,
	chatRequestFromJournalEntry,
	formatScenarioDriftReport,
	isUnmatchedJournalEntry,
} from "../src/aimock/drift-report.js";
import type { ScenarioScript } from "../src/scenario/track-types.js";

// A minimal worker-shaped request: the "leaf scope:" marker classifies it as `worker` (the classifier's contract).
const workerRequest = (userText: string, assistantTurns = 0) => ({
	body: {
		messages: [
			{ role: "system", content: "You are a worker." },
			{ role: "user", content: `Leaf scope: complete only this card. ${userText}` },
			...Array.from({ length: assistantTurns }, () => ({ role: "assistant" as const, content: "done" })),
		],
		tools: [],
	},
	response: { fixture: null },
});

const script = (overrides: Partial<ScenarioScript> = {}): ScenarioScript => ({
	name: "drift-demo",
	seed: 1,
	tracks: [
		{
			id: "worker-alpha",
			requestClass: "worker",
			userMessageIncludes: "Create the core domain module for orders",
			turns: [{ behavior: { kind: "text", content: "ok" } }, { behavior: { kind: "text", content: "ok" } }],
		},
	],
	...overrides,
});

describe("buildScenarioDriftReport (N12)", () => {
	it("classifies a needle-only miss as PROMPT DRIFT with the first diverging byte", () => {
		// The request says "orders v2" where the recording expects "orders" followed by nothing — drift begins
		// exactly where the shared prefix ends.
		const report = buildScenarioDriftReport(
			[workerRequest("Create the core domain module for invoices.")],
			script(),
		);
		expect(report.verdict).toBe("re_record_needed");
		expect(report.requests[0]?.kind).toBe("prompt_drift");
		const drift = report.requests[0]?.closestTracks[0]?.needleDrift;
		expect(drift?.needle).toBe("Create the core domain module for orders");
		// "Create the core domain module for " is shared (34 bytes); "orders" vs "invoices" diverges there.
		expect(drift?.firstDivergingByte).toBe(34);
		expect(drift?.expectedFromDivergence).toBe("orders");
		expect(drift?.requestExcerpt).toContain("invoices");
	});

	it("classifies an assistant-count overrun on a matching track as TURN-SHAPE DRIFT (behavior broken)", () => {
		const report = buildScenarioDriftReport(
			[workerRequest("Create the core domain module for orders now.", 5)],
			script(),
		);
		expect(report.verdict).toBe("behavior_broken");
		expect(report.requests[0]?.kind).toBe("turn_shape_drift");
		expect(report.requests[0]?.closestTracks[0]?.assistantCountDrift).toEqual({
			observed: 5,
			accepted: "count 0–1",
		});
	});

	it("classifies a request class no track scripts as UNSCRIPTED (behavior broken)", () => {
		const reviewRequest = {
			body: {
				messages: [{ role: "user", content: "Please review the work in this diff." }],
				tools: [{ function: { name: "submit_review" } }],
			},
			response: { fixture: null },
		};
		const report = buildScenarioDriftReport([reviewRequest], script());
		expect(report.requests[0]?.requestClass).toBe("review");
		expect(report.requests[0]?.kind).toBe("unscripted_request_class");
		expect(report.verdict).toBe("behavior_broken");
	});

	it("mixed drift + broken requests yield the MIXED verdict and both remedies in the rendered report", () => {
		const reviewRequest = {
			body: { messages: [{ role: "user", content: "review please" }], tools: [{ function: { name: "submit_review" } }] },
			response: { fixture: null },
		};
		const report = buildScenarioDriftReport(
			[workerRequest("Create the core domain module for invoices."), reviewRequest],
			script(),
		);
		expect(report.verdict).toBe("mixed");
		const rendered = formatScenarioDriftReport(report, "npm run scenario:rerecord -- 07");
		expect(rendered).toContain("PROMPT DRIFT (re-record needed)");
		expect(rendered).toContain("UNSCRIPTED REQUEST (behavior broken)");
		expect(rendered).toContain("npm run scenario:rerecord -- 07");
		expect(rendered).toContain("investigate the behavior change");
	});

	it("a fully-matched journal renders clean and never suggests a re-record", () => {
		const report = buildScenarioDriftReport([], script());
		expect(report.verdict).toBe("clean");
		expect(formatScenarioDriftReport(report, "npm run scenario:rerecord -- 07")).not.toContain("re-record the cell");
	});

	it("respects cycleTurns / repeatLastTurn count contracts (no false turn-shape drift on resumed sessions)", () => {
		const cycling = script({
			tracks: [
				{
					id: "review-cycle",
					requestClass: "worker",
					userMessageIncludes: "Create the core domain module for orders",
					turns: [{ behavior: { kind: "text", content: "ok" } }],
					cycleTurns: true,
				},
			],
		});
		const report = buildScenarioDriftReport(
			[workerRequest("Create the core domain module for invoices.", 9)],
			cycling,
		);
		// Count 9 is fine for a cycling track — the ONLY failure is the needle, so this is prompt drift.
		expect(report.requests[0]?.kind).toBe("prompt_drift");
	});
});

describe("journal-entry helpers", () => {
	it("isUnmatchedJournalEntry keys on response.fixture === null", () => {
		expect(isUnmatchedJournalEntry({ response: { fixture: null } })).toBe(true);
		expect(isUnmatchedJournalEntry({ response: { fixture: { match: {} } } })).toBe(false);
		expect(isUnmatchedJournalEntry({})).toBe(false);
	});

	it("chatRequestFromJournalEntry reads body objects, JSON strings, and legacy request keys", () => {
		const body = { messages: [{ role: "user", content: "hi" }] };
		expect(chatRequestFromJournalEntry({ body })).toEqual(body);
		expect(chatRequestFromJournalEntry({ body: JSON.stringify(body) })).toEqual(body);
		expect(chatRequestFromJournalEntry({ request: body })).toEqual(body);
		expect(chatRequestFromJournalEntry({ body: { no: "messages" } })).toBeNull();
		expect(chatRequestFromJournalEntry({})).toBeNull();
	});
});
