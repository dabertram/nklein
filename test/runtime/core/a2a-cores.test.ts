import { describe, expect, it } from "vitest";
import { buildA2aAgentCard } from "../../../src/core/a2a-agent-card";
import {
	buildA2aTaskView,
	buildSeedCardRequestFromA2a,
	projectA2aTaskState,
	selectA2aStatusNote,
} from "../../../src/core/a2a-task-mapping";
import {
	A2A_ERROR_CODES,
	A2A_METHODS,
	A2A_TASK_STATES,
	A2A_WELL_KNOWN_AGENT_CARD_PATH,
	a2aSendMessageParamsSchema,
	readTextFromParts,
} from "../../../src/core/a2a-wire-shapes";

/**
 * P17.8 — the A2A v1.0 pure cores. The wire-shape assertions here pin values READ FROM THE NORMATIVE SOURCES
 * (a2a.proto + docs/specification.md, 2026-08-03) — the rendered-site extraction produced an invented
 * `a2a.`-method-prefix and a wrong well-known path, and training-data recall produced v0.2 shapes. If one of
 * these assertions ever needs changing, that is a SPEC VERSION MIGRATION, not a refactor.
 */

describe("a2a wire shapes (normative-source pins)", () => {
	it("uses UNPREFIXED JSON-RPC method names (spec.md:2273)", () => {
		expect(A2A_METHODS.sendMessage).toBe("SendMessage");
		expect(A2A_METHODS.getTask).toBe("GetTask");
		expect(A2A_METHODS.cancelTask).toBe("CancelTask");
	});

	it("serves the card at /.well-known/agent-card.json (spec.md:1988 — NOT /.well-known/a2a/agent)", () => {
		expect(A2A_WELL_KNOWN_AGENT_CARD_PATH).toBe("/.well-known/agent-card.json");
	});

	it("pins the six A2A error codes (spec.md:1182-1187)", () => {
		expect(A2A_ERROR_CODES.taskNotFound).toBe(-32001);
		expect(A2A_ERROR_CODES.contentTypeNotSupported).toBe(-32005);
		expect(A2A_ERROR_CODES.invalidAgentResponse).toBe(-32006);
	});

	it("keeps TaskState as the nine PROTO-NAME strings (spec.md:1220)", () => {
		expect(A2A_TASK_STATES).toContain("TASK_STATE_INPUT_REQUIRED");
		expect(A2A_TASK_STATES).toContain("TASK_STATE_REJECTED");
		expect(A2A_TASK_STATES).toHaveLength(9);
	});

	it("accepts a canonical SendMessage params object (params IS the SendMessageRequest)", () => {
		const parsed = a2aSendMessageParamsSchema.safeParse({
			message: {
				messageId: "m-1",
				role: "ROLE_USER",
				parts: [{ text: "Fix the flaky date test in utils." }],
			},
			configuration: { blocking: false },
		});
		expect(parsed.success).toBe(true);
	});

	it("rejects a message with zero parts (proto: parts REQUIRED)", () => {
		expect(
			a2aSendMessageParamsSchema.safeParse({ message: { messageId: "m", role: "ROLE_USER", parts: [] } }).success,
		).toBe(false);
	});
});

describe("readTextFromParts (text-only intake)", () => {
	it("concatenates multiple text parts", () => {
		const result = readTextFromParts([{ text: "line one" }, { text: "line two" }]);
		expect(result).toEqual({ ok: true, text: "line one\nline two" });
	});

	it("refuses raw/url/data parts with the part kind named (→ -32005 at the wire)", () => {
		for (const part of [{ raw: "aGk=" }, { url: "https://x" }, { data: { a: 1 } }]) {
			const result = readTextFromParts([{ text: "ok" }, part]);
			expect(result.ok).toBe(false);
		}
	});

	it("enforces the oneof: a part with two content fields is refused, not guessed", () => {
		expect(readTextFromParts([{ text: "a", url: "https://x" }]).ok).toBe(false);
	});

	it("refuses effectively-empty text", () => {
		expect(readTextFromParts([{ text: "   " }]).ok).toBe(false);
	});
});

describe("projectA2aTaskState", () => {
	const base = { cardId: "c1", columnId: "in_progress" };

	it("collapses the client's one question correctly across the lifecycle", () => {
		expect(projectA2aTaskState({ cardId: "c", columnId: "backlog" })).toBe("TASK_STATE_SUBMITTED");
		expect(projectA2aTaskState({ ...base, summaryState: "running" })).toBe("TASK_STATE_WORKING");
		expect(projectA2aTaskState({ cardId: "c", columnId: "completed" })).toBe("TASK_STATE_COMPLETED");
		expect(projectA2aTaskState({ cardId: "c", columnId: "trash" })).toBe("TASK_STATE_CANCELED");
		expect(projectA2aTaskState({ ...base, summaryState: "failed" })).toBe("TASK_STATE_FAILED");
		expect(projectA2aTaskState({ ...base, summaryState: "interrupted" })).toBe("TASK_STATE_CANCELED");
	});

	it("review lane with the AUTO pipeline driving is WORKING, not INPUT_REQUIRED", () => {
		// A client told INPUT_REQUIRED waits for a question that is not coming — the second-opinion pipeline
		// is the agent's own machinery.
		expect(projectA2aTaskState({ cardId: "c", columnId: "review", summaryState: "awaiting_review" })).toBe(
			"TASK_STATE_WORKING",
		);
	});

	it("an attention-park IS INPUT_REQUIRED — the operator is the client's side of the fence", () => {
		expect(
			projectA2aTaskState({
				cardId: "c",
				columnId: "review",
				summaryState: "awaiting_review",
				reviewReason: "attention",
			}),
		).toBe("TASK_STATE_INPUT_REQUIRED");
	});

	it("a review-PARKED card is INPUT_REQUIRED — live-found projecting WORKING forever (P17.1 probe)", () => {
		// The board knew (`review.status: "parked"`, guard message "Parking for a human") and the A2A surface
		// was the one place it never reached — N23's disease shape on the card's own review field. No session
		// summary needed: the park is board truth and outlives the session that produced it.
		expect(projectA2aTaskState({ cardId: "c", columnId: "review", reviewStatus: "parked" })).toBe(
			"TASK_STATE_INPUT_REQUIRED",
		);
		// Non-parked review statuses keep the pipeline-driving default.
		expect(projectA2aTaskState({ cardId: "c", columnId: "review", reviewStatus: "in_review" })).toBe(
			"TASK_STATE_WORKING",
		);
		// A terminal summary still outranks the park refinement.
		expect(
			projectA2aTaskState({ cardId: "c", columnId: "review", reviewStatus: "parked", summaryState: "failed" }),
		).toBe("TASK_STATE_FAILED");
		// And a parked card OUTSIDE the review lane (operator moved it) does not claim INPUT_REQUIRED off stale review state.
		expect(projectA2aTaskState({ cardId: "c", columnId: "completed", reviewStatus: "parked" })).toBe(
			"TASK_STATE_COMPLETED",
		);
	});

	it("the LANE outranks a stale live-looking summary (N21's lesson at the wire)", () => {
		expect(projectA2aTaskState({ cardId: "c", columnId: "completed", summaryState: "running" })).toBe(
			"TASK_STATE_COMPLETED",
		);
	});
});

describe("buildA2aTaskView", () => {
	it("emits proto-name enums and ISO timestamp fields", () => {
		const task = buildA2aTaskView({
			cardId: "card-9",
			columnId: "in_progress",
			summaryState: "running",
			timestamp: "2026-08-03T00:00:00Z",
			statusText: "implementing step 2/5",
		});
		expect(task.id).toBe("card-9");
		expect(task.status.state).toBe("TASK_STATE_WORKING");
		expect(task.status.timestamp).toBe("2026-08-03T00:00:00Z");
		expect(task.status.message?.role).toBe("ROLE_AGENT");
		expect(task.status.message?.parts[0]?.text).toBe("implementing step 2/5");
	});

	it("omits artifacts/message when there are none (no empty-array noise on the wire)", () => {
		const task = buildA2aTaskView({ cardId: "c", columnId: "backlog" });
		expect(task.artifacts).toBeUndefined();
		expect(task.status.message).toBeUndefined();
	});
});

describe("buildSeedCardRequestFromA2a", () => {
	it("derives the title from the first non-empty line and keeps the full text as prompt", () => {
		const seed = buildSeedCardRequestFromA2a({ text: "\nFix the login bug\ndetails follow", messageId: "m-7" });
		expect(seed.title).toBe("Fix the login bug");
		expect(seed.prompt).toBe("\nFix the login bug\ndetails follow");
		expect(seed.sourceMessageId).toBe("m-7");
	});

	it("hard-caps a peer-supplied title (layout injection before it is prompt injection)", () => {
		const seed = buildSeedCardRequestFromA2a({ text: "x".repeat(300), messageId: "m" });
		expect(seed.title.length).toBeLessThanOrEqual(81);
		expect(seed.title.endsWith("…")).toBe(true);
	});
});

describe("buildA2aAgentCard", () => {
	it("advertises exactly one JSONRPC/1.0 interface and NO false capabilities", () => {
		const card = buildA2aAgentCard({ rpcUrl: "http://127.0.0.1:3484/a2a/v1", productVersion: "0.9.0" });
		expect(card.supportedInterfaces).toHaveLength(1);
		expect(card.supportedInterfaces[0]).toEqual({
			url: "http://127.0.0.1:3484/a2a/v1",
			protocolBinding: "JSONRPC",
			protocolVersion: "1.0",
		});
		// §4A applied to a discovery document: a capability advertised is a promise a client will exercise.
		expect(card.capabilities).toEqual({ streaming: false, pushNotifications: false, extendedAgentCard: false });
		expect(card.skills.length).toBeGreaterThan(0);
		expect(card.version).toBe("0.9.0");
	});
});

describe("selectA2aStatusNote (N23 residue: actionable notes reach the delegating client)", () => {
	const note = (category: string, message: string, createdAt: number) => ({ category, message, createdAt });

	it("returns the NEWEST actionable note — remedies supersede stale failures", () => {
		const picked = selectA2aStatusNote([
			note("auto_start_failed", "No native !Klein provider is configured.", 100),
			note("context_floor_unmet", "Model loaded below the 32k floor — reload at >=32k.", 200),
		]);
		expect(picked).toBe("Model loaded below the 32k floor — reload at >=32k.");
	});

	it("ignores non-allowlisted categories — internal telemetry vocabulary is not a client API", () => {
		expect(
			selectA2aStatusNote([
				note("board_liveness_watchdog_tick", "tick 47", 500),
				note("card_lane_change", "moved", 400),
			]),
		).toBeNull();
	});

	it("returns null for empty or unusable input", () => {
		expect(selectA2aStatusNote([])).toBeNull();
		expect(selectA2aStatusNote([{ category: "auto_start_failed", message: "  ", createdAt: 1 }])).toBeNull();
	});
});
