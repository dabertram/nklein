import { describe, expect, it, vi } from "vitest";
import type { RuntimeTaskSessionSummary } from "../../../src/core/api-contract";
import {
	createDefaultSummary,
	createMessage,
	type NKleinTaskSessionEntry,
} from "../../../src/nklein-agent/nklein-session-state";
import {
	collectCompletedAssistantTurns,
	formatTurnLoopParkMessage,
	TURN_LOOP_AUTO_RESOLVE_NUDGE_LIMIT,
	TurnLoopGuard,
	type TurnLoopGuardCallbacks,
} from "../../../src/nklein-agent/turn-loop-guard";

const LOOPING_QUESTION =
	"The task says to run tests with `npm test -- tests/*.js`, but the sources are TypeScript — should the test command target *.ts instead?";

function buildEntry(taskId: string, options?: { startPrompt?: string }): NKleinTaskSessionEntry {
	const summary = createDefaultSummary(taskId);
	summary.state = "running";
	return {
		summary,
		messages: options?.startPrompt !== undefined ? [createMessage(taskId, "user", options.startPrompt)] : [],
		activeAssistantMessageId: null,
		activeReasoningMessageId: null,
		toolMessageIdByToolCallId: new Map(),
		toolInputByToolCallId: new Map(),
	};
}

function pushAssistantTurns(entry: NKleinTaskSessionEntry, texts: readonly string[]): void {
	for (const text of texts) {
		entry.messages.push(createMessage(entry.summary.taskId, "assistant", text));
	}
}

interface Harness {
	guard: TurnLoopGuard;
	entry: NKleinTaskSessionEntry;
	sent: string[];
	parked: Array<{ message: string; metadata: Record<string, unknown> }>;
	escalated: Array<{ boundary: string; modelId: string }>;
	observations: Array<Record<string, unknown>>;
}

function buildHarness(options?: {
	startPrompt?: string;
	escalationModel?: { providerId: string; modelId: string } | null;
	withEscalationHandler?: boolean;
	/** Simulate the run having already ended by itself: cancelTaskTurn resolves null. */
	cancelFails?: boolean;
}): Harness {
	const entry = buildEntry("task-1", { startPrompt: options?.startPrompt ?? "Implement the feature." });
	const sent: string[] = [];
	const parked: Harness["parked"] = [];
	const escalated: Harness["escalated"] = [];
	const observations: Array<Record<string, unknown>> = [];
	const callbacks: TurnLoopGuardCallbacks = {
		getTaskEntry: (taskId) => (taskId === "task-1" ? entry : null),
		cancelTaskTurn: async () => (options?.cancelFails ? null : (entry.summary as RuntimeTaskSessionSummary)),
		sendTaskSessionInput: async (_taskId, text) => {
			sent.push(text);
			return null;
		},
		pickEscalationModel: async () => options?.escalationModel ?? null,
		parkTaskForAutonomyBudget: (input) => {
			parked.push({ message: input.message, metadata: input.metadata });
			entry.summary = { ...entry.summary, state: "awaiting_review", reviewReason: "attention" };
			return entry.summary as RuntimeTaskSessionSummary;
		},
		recordObservation: (event) => {
			observations.push(event.metadata);
		},
		...(options?.withEscalationHandler !== false
			? {
					onEscalateModel: async (event) => {
						escalated.push({ boundary: event.boundary, modelId: event.model.modelId });
					},
				}
			: {}),
	};
	return { guard: new TurnLoopGuard(callbacks), entry, sent, parked, escalated, observations };
}

/** check() fires effects asynchronously — flush the microtask queue. */
async function flush(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 0));
	await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("collectCompletedAssistantTurns", () => {
	it("collects assistant turns but excludes the still-streaming active message and non-assistant roles", () => {
		const entry = buildEntry("task-1", { startPrompt: "spec" });
		pushAssistantTurns(entry, ["turn one", "turn two"]);
		entry.messages.push(createMessage("task-1", "system", "a system note"));
		const streaming = createMessage("task-1", "assistant", "partial…");
		entry.messages.push(streaming);
		entry.activeAssistantMessageId = streaming.id;
		const turns = collectCompletedAssistantTurns(entry);
		expect(turns.map((turn) => turn.text)).toEqual(["turn one", "turn two"]);
	});
});

describe("formatTurnLoopParkMessage", () => {
	it("names the SPECIFIC contested question, never a generic stuck", () => {
		const message = formatTurnLoopParkMessage({
			kind: "repeat",
			occurrences: 4,
			fingerprint: "x",
			contestedQuestion: LOOPING_QUESTION,
		});
		expect(message).toContain(LOOPING_QUESTION);
		expect(message).toContain("4 turns");
	});

	it("describes oscillation distinctly", () => {
		const message = formatTurnLoopParkMessage({
			kind: "oscillation",
			occurrences: 4,
			fingerprint: "a|b",
			contestedQuestion: null,
		});
		expect(message).toContain("bouncing between the same two proposals");
	});
});

describe("TurnLoopGuard", () => {
	it("does nothing below the repeat window", async () => {
		const harness = buildHarness();
		pushAssistantTurns(harness.entry, [LOOPING_QUESTION, LOOPING_QUESTION]);
		harness.guard.check("task-1");
		await flush();
		expect(harness.sent).toEqual([]);
		expect(harness.parked).toEqual([]);
		expect(harness.escalated).toEqual([]);
	});

	it("auto-resolves the exact *.js-vs-*.ts boundary from the acceptance context with ONE mid-session nudge", async () => {
		const harness = buildHarness({
			startPrompt: "Implement the parser.\n\nAcceptance check: npm test -- tests/*.js",
		});
		pushAssistantTurns(harness.entry, [LOOPING_QUESTION, LOOPING_QUESTION, LOOPING_QUESTION]);
		harness.guard.check("task-1");
		await flush();
		expect(harness.sent).toHaveLength(1);
		expect(harness.sent[0]).toContain("acceptance command is authoritative");
		expect(harness.sent[0]).toContain("npm test -- tests/*.js");
		expect(harness.parked).toEqual([]);
		expect(harness.escalated).toEqual([]);
		expect(harness.observations[0]?.category).toBe("turn_loop_auto_resolve");
	});

	it("drops the nudge (and keeps the budget) when the run already ended before the cancel landed", async () => {
		const harness = buildHarness({
			startPrompt: "Implement the parser.\n\nAcceptance check: npm test -- tests/*.js",
			cancelFails: true,
		});
		pushAssistantTurns(harness.entry, [LOOPING_QUESTION, LOOPING_QUESTION, LOOPING_QUESTION]);
		harness.guard.check("task-1");
		await flush();
		expect(harness.sent).toEqual([]);
		expect(harness.parked).toEqual([]);
		expect(harness.escalated).toEqual([]);
	});

	it("does not re-fire until enough NEW completed turns arrive after a nudge", async () => {
		const harness = buildHarness({
			startPrompt: "Implement the parser.\n\nAcceptance check: npm test -- tests/*.js",
		});
		pushAssistantTurns(harness.entry, [LOOPING_QUESTION, LOOPING_QUESTION, LOOPING_QUESTION]);
		harness.guard.check("task-1");
		await flush();
		expect(harness.sent).toHaveLength(1);
		// One more looping turn — inside the re-arm window, must stay quiet.
		pushAssistantTurns(harness.entry, [LOOPING_QUESTION]);
		harness.guard.check("task-1");
		await flush();
		expect(harness.sent).toHaveLength(1);
		expect(harness.escalated).toEqual([]);
	});

	it("escalates to the lineage-diverse model once the nudge budget is spent and the loop continues", async () => {
		const harness = buildHarness({
			startPrompt: "Implement the parser.\n\nAcceptance check: npm test -- tests/*.js",
			escalationModel: { providerId: "lmstudio", modelId: "bigger-model" },
		});
		pushAssistantTurns(harness.entry, [LOOPING_QUESTION, LOOPING_QUESTION, LOOPING_QUESTION]);
		harness.guard.check("task-1");
		await flush();
		expect(harness.sent).toHaveLength(TURN_LOOP_AUTO_RESOLVE_NUDGE_LIMIT);
		// The model ignores the nudge and keeps looping for 3 MORE turns.
		pushAssistantTurns(harness.entry, [LOOPING_QUESTION, LOOPING_QUESTION, LOOPING_QUESTION]);
		harness.guard.check("task-1");
		await flush();
		expect(harness.escalated).toEqual([{ boundary: LOOPING_QUESTION, modelId: "bigger-model" }]);
		expect(harness.parked).toEqual([]);
	});

	it("parks with the SPECIFIC question when the boundary is not groundable and no escalation model exists", async () => {
		const harness = buildHarness({ startPrompt: "Implement the parser.", escalationModel: null });
		pushAssistantTurns(harness.entry, [LOOPING_QUESTION, LOOPING_QUESTION, LOOPING_QUESTION]);
		harness.guard.check("task-1");
		await flush();
		expect(harness.sent).toEqual([]);
		expect(harness.parked).toHaveLength(1);
		expect(harness.parked[0]?.message).toContain(LOOPING_QUESTION);
		expect(harness.parked[0]?.metadata.guardrail).toBe("turn_loop");
	});

	it("parks (not escalates) when no escalation handler is wired even if a model exists", async () => {
		const harness = buildHarness({
			startPrompt: "Implement the parser.",
			escalationModel: { providerId: "lmstudio", modelId: "bigger-model" },
			withEscalationHandler: false,
		});
		pushAssistantTurns(harness.entry, [LOOPING_QUESTION, LOOPING_QUESTION, LOOPING_QUESTION]);
		harness.guard.check("task-1");
		await flush();
		expect(harness.parked).toHaveLength(1);
	});

	it("stays quiet mid-stream (active assistant message) and for non-running / derived / home sessions", async () => {
		const harness = buildHarness({ startPrompt: "Implement the parser." });
		pushAssistantTurns(harness.entry, [LOOPING_QUESTION, LOOPING_QUESTION, LOOPING_QUESTION]);
		const streaming = createMessage("task-1", "assistant", LOOPING_QUESTION);
		harness.entry.messages.push(streaming);
		harness.entry.activeAssistantMessageId = streaming.id;
		harness.guard.check("task-1");
		await flush();
		expect(harness.parked).toEqual([]);
		harness.entry.activeAssistantMessageId = null;
		harness.entry.summary = { ...harness.entry.summary, state: "awaiting_review" };
		harness.guard.check("task-1");
		await flush();
		expect(harness.parked).toEqual([]);
		harness.guard.check("task-1::spec");
		harness.guard.check("task-1::review");
		await flush();
		expect(harness.parked).toEqual([]);
	});

	it("acts at most once terminally per task session and re-arms after resetTask", async () => {
		const harness = buildHarness({ startPrompt: "Implement the parser.", escalationModel: null });
		pushAssistantTurns(harness.entry, [LOOPING_QUESTION, LOOPING_QUESTION, LOOPING_QUESTION]);
		harness.guard.check("task-1");
		await flush();
		expect(harness.parked).toHaveLength(1);
		// Same state, more turns — resolvedTerminally holds.
		harness.entry.summary = { ...harness.entry.summary, state: "running", reviewReason: null };
		pushAssistantTurns(harness.entry, [LOOPING_QUESTION, LOOPING_QUESTION, LOOPING_QUESTION]);
		harness.guard.check("task-1");
		await flush();
		expect(harness.parked).toHaveLength(1);
		// A fresh session (resetTask) re-arms the guard.
		harness.guard.resetTask("task-1");
		harness.guard.check("task-1");
		await flush();
		expect(harness.parked).toHaveLength(2);
	});

	it("never parks a task already held for attention", async () => {
		const harness = buildHarness({ startPrompt: "Implement the parser.", escalationModel: null });
		pushAssistantTurns(harness.entry, [LOOPING_QUESTION, LOOPING_QUESTION, LOOPING_QUESTION]);
		harness.entry.summary = { ...harness.entry.summary, reviewReason: "attention" };
		harness.guard.check("task-1");
		await flush();
		expect(harness.parked).toEqual([]);
	});

	it("ignores unrelated healthy progress (distinct turns)", async () => {
		const harness = buildHarness();
		pushAssistantTurns(harness.entry, [
			"Reading the spec and the existing files first.",
			"Now writing src/parser.ts with the tokenizer.",
			"Running the tests to verify the new module.",
			"All green — summarizing the change.",
		]);
		const spy = vi.fn();
		harness.guard.check("task-1");
		await flush();
		expect(harness.sent).toEqual([]);
		expect(harness.parked).toEqual([]);
		expect(harness.escalated).toEqual([]);
		expect(spy).not.toHaveBeenCalled();
	});
});
