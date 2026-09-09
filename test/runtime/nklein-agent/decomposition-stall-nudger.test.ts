import { describe, expect, it } from "vitest";
import type { RuntimeTaskHookActivity, RuntimeTaskSessionSummary } from "../../../src/core/api-contract";
import {
	DecompositionStallNudger,
	isChatOnlyDecompositionActivity,
	isDecompositionProgressTool,
} from "../../../src/nklein-agent/decomposition-stall-nudger";

function activity(over: Partial<RuntimeTaskHookActivity> = {}): RuntimeTaskHookActivity {
	return {
		activityText: null,
		toolName: null,
		toolInputSummary: null,
		finalMessage: null,
		hookEventName: "assistant_delta",
		notificationType: null,
		source: "nklein-sdk",
		...over,
	};
}

function summary(latestHookActivity: RuntimeTaskHookActivity | null): RuntimeTaskSessionSummary {
	return {
		taskId: "t1",
		state: "running",
		agentId: "nklein",
		workspacePath: null,
		pid: null,
		startedAt: null,
		updatedAt: 0,
		lastOutputAt: null,
		reviewReason: null,
		exitCode: null,
		lastHookAt: null,
		latestHookActivity,
	};
}

describe("isChatOnlyDecompositionActivity", () => {
	it("flags a running assistant delta that narrates a plan instead of calling the tool", () => {
		expect(
			isChatOnlyDecompositionActivity(
				summary(activity({ activityText: "Based on my analysis, the task graph is..." })),
			),
		).toBe(true);
		expect(
			isChatOnlyDecompositionActivity(summary(activity({ finalMessage: "Here is the implementation plan." }))),
		).toBe(true);
	});

	it("flags the driver's actual decompose-narration phrasings (2026-06-29 live C1 finding)", () => {
		// These ran to the deadline WITHOUT a decompose call because the old pattern missed them.
		for (const text of [
			"The spec is small: a local habit tracker with CRUD, check-ins, streaks. Let me decompose this into cards.",
			"Good — I have a clear picture of the spec and current skeleton codebase. Let me decompose this into dependency-ordered cards.",
		]) {
			expect(isChatOnlyDecompositionActivity(summary(activity({ finalMessage: text })))).toBe(true);
		}
	});

	it("does NOT flag ordinary implementation prose (no false positive)", () => {
		for (const text of [
			"I read the file and edited storage.ts to add a function.",
			"Running the tests now to verify the change.",
		]) {
			expect(isChatOnlyDecompositionActivity(summary(activity({ activityText: text })))).toBe(false);
		}
	});

	it("is false when the model is actually calling decompose_project", () => {
		expect(
			isChatOnlyDecompositionActivity(
				summary(activity({ toolName: "decompose_project", activityText: "task graph" })),
			),
		).toBe(false);
	});

	it("is false while the model drives the F1.7 incremental construction (add_task/add_dependency)", () => {
		for (const toolName of ["add_task", "add_dependency", " Add_Task "]) {
			expect(isChatOnlyDecompositionActivity(summary(activity({ toolName, activityText: "task graph" })))).toBe(
				false,
			);
		}
		expect(isDecompositionProgressTool("decompose_project")).toBe(true);
		expect(isDecompositionProgressTool("read_files")).toBe(false);
		expect(isDecompositionProgressTool(null)).toBe(false);
	});

	it("is false for the wrong source, the wrong hook event, or no matching prose", () => {
		expect(
			isChatOnlyDecompositionActivity(summary(activity({ source: "terminal", activityText: "task graph" }))),
		).toBe(false);
		expect(
			isChatOnlyDecompositionActivity(summary(activity({ hookEventName: "tool_call", activityText: "task graph" }))),
		).toBe(false);
		expect(isChatOnlyDecompositionActivity(summary(activity({ activityText: "just some normal output" })))).toBe(
			false,
		);
	});

	it("is false when there is no activity", () => {
		expect(isChatOnlyDecompositionActivity(summary(null))).toBe(false);
	});
});

describe("DecompositionStallNudger.maybeContinueStalledDecomposition (#30 turn-end path)", () => {
	function makeNudger(over: { finalMessage: string; toolName: string | null; reviewReason?: "hook" | "exit" }) {
		const sent: string[] = [];
		const observed: Array<Record<string, string | null>> = [];
		const stalledSummary: RuntimeTaskSessionSummary = {
			...summary(
				activity({
					hookEventName: "agent_end",
					toolName: over.toolName,
					finalMessage: over.finalMessage,
				}),
			),
			state: "awaiting_review",
			reviewReason: over.reviewReason ?? "hook",
		};
		const nudger = new DecompositionStallNudger({
			isExplicitDecompositionTask: () => true,
			getTaskSummary: () => stalledSummary,
			resolveProviderId: () => "lmstudio",
			resolveModelId: () => "gptoss120-m5",
			resolveWorkspacePath: () => null,
			recordObservation: (params) => {
				observed.push(params.metadata);
			},
			cancelTaskTurn: async () => null,
			sendTaskSessionInput: async (_taskId, text) => {
				sent.push(text);
				return null;
			},
		});
		return { nudger, sent, observed };
	}

	it("run31 regression: re-prompts a text-only decomposition final even though update_focus_chain ran (rejected)", async () => {
		const decompositionAsText = '{ "slug": "x", "tasks": [{"id":"t1"}], "minimumTaskCount": 10 }';
		const { nudger, sent, observed } = makeNudger({
			finalMessage: decompositionAsText,
			toolName: "update_focus_chain",
		});
		nudger.maybeContinueStalledDecomposition("t1");
		await new Promise((resolve) => setImmediate(resolve));
		expect(sent).toHaveLength(1);
		expect(sent[0]).toContain("exactly that JSON");
		expect(observed[0]?.finalLooksLikeDecompositionJson).toBe("true");
	});

	it("keeps the generic decompose re-prompt when the final text is not decomposition JSON", async () => {
		const { nudger, sent } = makeNudger({ finalMessage: "I believe the plan is solid.", toolName: null });
		nudger.maybeContinueStalledDecomposition("t1");
		await new Promise((resolve) => setImmediate(resolve));
		expect(sent).toHaveLength(1);
		expect(sent[0]).toContain("add_task");
		expect(sent[0]).toContain("Do NOT re-add those ids");
		expect(sent[0]).toContain("decompose_project` WITHOUT tasks");
		expect(sent[0]).not.toContain("exactly that JSON");
	});

	it("steers the LARGE-SPEC read stall to the incremental protocol, not a one-shot graph", async () => {
		// This branch fires only while paging through a long spec, so it addresses exactly the population most
		// likely to emit a malformed giant graph. It used to close with "call `decompose_project` with the full
		// task graph", contradicting the system prompt's incremental default and steering the worst case toward
		// the riskiest call (found reviewing the G6.8a campaign, 2026-07-30 — the campaign's binding constraint
		// was architect graph SHAPE, not tool-call mechanics).
		const { nudger, sent, observed } = makeNudger({
			finalMessage: "Let me continue reading the specification.",
			toolName: "read_large_file",
		});
		nudger.maybeContinueStalledDecomposition("t1");
		await new Promise((resolve) => setImmediate(resolve));
		expect(sent).toHaveLength(1);
		expect(observed[0]?.category).toBe("decomposition_read_workflow_stall");
		// Still the primary instruction: finish the read before decomposing at all.
		expect(sent[0]).toContain("nextCursor");
		expect(sent[0]).toContain("add_task");
		expect(sent[0]).toContain("add_dependency");
		expect(sent[0]).toContain("decompose_project` WITHOUT `tasks`");
		expect(sent[0], "must not steer a long spec back to a single giant call").not.toContain(
			"with the full task graph",
		);
	});

	it("claims an SDK exit for targeted recovery before the generic loop guard can park it", async () => {
		const { nudger, sent } = makeNudger({
			finalMessage: "The tool arguments were incomplete.",
			toolName: "decompose_project",
			reviewReason: "exit",
		});
		expect(nudger.maybeContinueStalledDecomposition("t1")).toBe(true);
		await new Promise((resolve) => setImmediate(resolve));
		expect(sent).toHaveLength(1);
		expect(sent[0]).toContain("add_task");
		expect(sent[0]).toContain("do not retry that nested payload");
	});
});

describe("maybeNudgeStalledRefinement (P18.4b refinement-promotion nudge wiring)", () => {
	function makeRefinementNudger(
		over: {
			refinable?: boolean;
			begun?: boolean;
			reviewReason?: RuntimeTaskSessionSummary["reviewReason"];
			finalMessage?: string | null;
		} = {},
	) {
		const sent: string[] = [];
		const observed: Array<Record<string, string | null>> = [];
		const stalledSummary: RuntimeTaskSessionSummary = {
			...summary(
				activity({
					hookEventName: "agent_end",
					finalMessage: over.finalMessage ?? "I've explored the workspace and read the relevant files.",
				}),
			),
			state: "awaiting_review",
			reviewReason: over.reviewReason ?? "hook",
		};
		const nudger = new DecompositionStallNudger({
			isExplicitDecompositionTask: () => false,
			getTaskSummary: () => stalledSummary,
			resolveProviderId: () => "lmstudio",
			resolveModelId: () => "qwen3.8-27b",
			resolveWorkspacePath: () => null,
			recordObservation: (params) => {
				observed.push(params.metadata);
			},
			cancelTaskTurn: async () => null,
			sendTaskSessionInput: async (_taskId, text) => {
				sent.push(text);
				return null;
			},
			isRefinableWorkCard: () => over.refinable ?? true,
			hasBegunImplementation: () => over.begun ?? false,
		});
		return { nudger, sent, observed };
	}

	it("re-prompts a stalled refinable card to call begin_implementation, one-shot", async () => {
		const { nudger, sent, observed } = makeRefinementNudger();
		expect(nudger.maybeNudgeStalledRefinement("t1")).toBe(true);
		await new Promise((resolve) => setImmediate(resolve));
		expect(sent).toHaveLength(1);
		expect(sent[0]).toContain("begin_implementation");
		expect(sent[0]).toContain("explored enough");
		expect(observed[0]?.category).toBe("refinement_promotion_stall");
		// One-shot: a second turn-end within the same card does not re-nudge.
		expect(nudger.maybeNudgeStalledRefinement("t1")).toBe(false);
	});

	it("stays silent for a non-refinable card and an already-promoted card", () => {
		expect(makeRefinementNudger({ refinable: false }).nudger.maybeNudgeStalledRefinement("t1")).toBe(false);
		expect(makeRefinementNudger({ begun: true }).nudger.maybeNudgeStalledRefinement("t1")).toBe(false);
	});

	it("does not re-drive an operator-parked card or one that ended on a clarifying question", () => {
		expect(makeRefinementNudger({ reviewReason: "attention" }).nudger.maybeNudgeStalledRefinement("t1")).toBe(false);
		expect(
			makeRefinementNudger({
				finalMessage: "Which config format should I support?",
			}).nudger.maybeNudgeStalledRefinement("t1"),
		).toBe(false);
	});
});

describe("maybeNudgeNarratedToolCall (Flash-Next dialect slip, live-found 2026-08-29)", () => {
	function makeNarratedNudger(
		finalMessage: string | null,
		state: RuntimeTaskSessionSummary["state"] = "awaiting_review",
	) {
		const sent: string[] = [];
		const observed: Array<Record<string, string | null>> = [];
		const stalled: RuntimeTaskSessionSummary = {
			...summary(activity({ hookEventName: "agent_end", finalMessage })),
			state,
			reviewReason: "hook",
		};
		const nudger = new DecompositionStallNudger({
			isExplicitDecompositionTask: () => false,
			getTaskSummary: () => stalled,
			resolveProviderId: () => "lmstudio",
			resolveModelId: () => "qwen3.8-flash-next",
			resolveWorkspacePath: () => null,
			recordObservation: (params) => {
				observed.push(params.metadata);
			},
			cancelTaskTurn: async () => null,
			sendTaskSessionInput: async (_taskId, text) => {
				sent.push(text);
				return null;
			},
		});
		return { nudger, sent, observed };
	}

	it("recovers the exact live slip — bracket header + XML tails + JSON body — one-shot", async () => {
		const slip =
			'[tool_call id=call01_Qw3 name=resolve_result] {"handle":"result://read_files/1","offset":0} </parameter> </function> </tool_call>';
		const { nudger, sent, observed } = makeNarratedNudger(slip);
		expect(nudger.maybeNudgeNarratedToolCall("t1")).toBe(true);
		await new Promise((resolve) => setImmediate(resolve));
		expect(sent).toHaveLength(1);
		expect(sent[0]).toContain("PLAIN TEXT");
		expect(sent[0]).toContain("resolve_result");
		expect(sent[0]).toContain("REAL tool call");
		expect(observed[0]?.category).toBe("narrated_tool_call_recovered");
		expect(nudger.maybeNudgeNarratedToolCall("t1")).toBe(false);
	});

	it("recovers an XML-tail slip without the bracket header", () => {
		const { nudger } = makeNarratedNudger('{"path":"spec.md"} </tool_call>');
		expect(nudger.maybeNudgeNarratedToolCall("t1")).toBe(true);
	});

	it("never fires on ordinary prose, running sessions, or empty finals", () => {
		expect(makeNarratedNudger("The plan is complete; handing over.").nudger.maybeNudgeNarratedToolCall("t1")).toBe(
			false,
		);
		expect(makeNarratedNudger(null).nudger.maybeNudgeNarratedToolCall("t1")).toBe(false);
		expect(makeNarratedNudger('[tool_call name=x] {"a":1}', "running").nudger.maybeNudgeNarratedToolCall("t1")).toBe(
			false,
		);
	});
});

describe("exploration-drift nudge (v21 architect, 2026-09-01)", () => {
	it("nudges a plan-mode session with no graph progress past the threshold, then re-arms", () => {
		process.env.NKLEIN_EXPLORATION_DRIFT_NUDGE_MS = "1000";
		const nowSpy = vi.spyOn(Date, "now");
		let fakeNow = 1_000_000;
		nowSpy.mockImplementation(() => fakeNow);
		try {
			const sent: string[] = [];
			const nudger = new DecompositionStallNudger({
				getTaskSummary: () => ({ taskId: "t1", state: "running" }) as never,
				sendTaskSessionInput: async (_taskId: string, text: string) => {
					sent.push(text);
					return null as never;
				},
				cancelTaskTurn: async () => null as never,
				resolveWorkspacePath: () => null,
				resolveProviderId: () => null,
				resolveModelId: () => null,
				recordObservation: () => {},
			} as never);
			// First sighting arms the window — no nudge.
			expect(nudger.maybeNudgeExplorationDrift("t1", [])).toBe(false);
			// Still inside the window — no nudge.
			fakeNow += 500;
			expect(nudger.maybeNudgeExplorationDrift("t1", [])).toBe(false);
			// Past the window with no progress — nudge fires and names held cards.
			fakeNow += 600;
			expect(nudger.maybeNudgeExplorationDrift("t1", ["s01", "s02"])).toBe(true);
			expect(sent[0]).toContain("PROTOCOL RESET");
			expect(sent[0]).toContain("s01");
			// Window re-armed: immediate re-check does not double-fire.
			expect(nudger.maybeNudgeExplorationDrift("t1", ["s01", "s02"])).toBe(false);
			// Progress resets the streak entirely.
			fakeNow += 1_100;
			nudger.noteConstructionProgress("t1");
			expect(nudger.maybeNudgeExplorationDrift("t1", ["s01"])).toBe(false);
		} finally {
			nowSpy.mockRestore();
			delete process.env.NKLEIN_EXPLORATION_DRIFT_NUDGE_MS;
		}
	});
});

/**
 * A budget reset by a condition that CO-OCCURS with the failure it bounds is not a budget.
 *
 * Live 2026-09-08, card `mutation-duration-schedule-kill-m3`: the model seat returned empty replies, every empty
 * terminal summary triggered a model failover, and the failover leg called `resetTask` — which clears every budget
 * this nudger owns, not just the decomposition-recovery one it was asking for. One 37-message session accumulated
 * THIRTY-SIX identical empty-final nudges against a documented limit of 8.
 */
describe("failover re-arms the decomposition ladder WITHOUT refunding other budgets", () => {
	function nudger(): DecompositionStallNudger {
		return new DecompositionStallNudger({
			isExplicitDecompositionTask: () => true,
			getTaskSummary: () => null,
			resolveProviderId: () => "lmstudio",
			resolveModelId: () => "m",
			resolveWorkspacePath: () => null,
			recordObservation: () => {},
			cancelTaskTurn: async () => null,
			sendTaskSessionInput: async () => null,
		});
	}

	it("clears the decomposition nudge count but leaves the empty-final count alone", () => {
		const n = nudger();
		// Spend both budgets.
		(n as unknown as { nudgeCountsByTaskId: Map<string, number> }).nudgeCountsByTaskId.set("t1", 3);
		(n as unknown as { emptyFinalNudgeCountsByTaskId: Map<string, number> }).emptyFinalNudgeCountsByTaskId.set(
			"t1",
			8,
		);

		n.resetDecompositionRecoveryBudget("t1");

		const decomposition = (n as unknown as { nudgeCountsByTaskId: Map<string, number> }).nudgeCountsByTaskId;
		const emptyFinal = (n as unknown as { emptyFinalNudgeCountsByTaskId: Map<string, number> })
			.emptyFinalNudgeCountsByTaskId;
		// Failover changes the MODEL, so the decomposition ladder is re-armed for the new one...
		expect(decomposition.has("t1")).toBe(false);
		// ...but it says nothing about whether this task already burned its empty-final allowance.
		expect(emptyFinal.get("t1")).toBe(8);
	});

	it("resetTask still clears everything — it is the session-start reset, not the failover one", () => {
		const n = nudger();
		(n as unknown as { emptyFinalNudgeCountsByTaskId: Map<string, number> }).emptyFinalNudgeCountsByTaskId.set(
			"t1",
			8,
		);
		n.resetTask("t1");
		expect(
			(n as unknown as { emptyFinalNudgeCountsByTaskId: Map<string, number> }).emptyFinalNudgeCountsByTaskId.has(
				"t1",
			),
		).toBe(false);
	});
});
