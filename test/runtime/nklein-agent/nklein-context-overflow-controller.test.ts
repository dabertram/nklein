import { beforeEach, describe, expect, it, vi } from "vitest";

const { isContextOverflowError, compactPersistedMessagesForContextOverflow, estimateNextPromptTokens, countTokens } =
	vi.hoisted(() => ({
		isContextOverflowError: vi.fn((_e: unknown) => false),
		compactPersistedMessagesForContextOverflow: vi.fn((_m: unknown) => [{ role: "user" }] as unknown[]),
		estimateNextPromptTokens: vi.fn((_p: string, _i?: unknown) => 0),
		countTokens: vi.fn((_m: unknown) => 0),
	}));

vi.mock("../../../src/nklein-agent/nklein-context-overflow-compaction", () => ({
	isContextOverflowError,
	compactPersistedMessagesForContextOverflow,
}));
vi.mock("../../../src/nklein-agent/nklein-context-budget-tokens", () => ({ estimateNextPromptTokens }));
vi.mock("../../../src/nklein-agent/nklein-context-focus-policy", () => ({
	countKanbanPersistedMessagesTokens: countTokens,
}));
vi.mock("../../../src/nklein-agent/nklein-context-budget-plan", () => ({ CONTEXT_BUDGET_SEND_RESERVE_TOKENS: 0 }));
vi.mock("../../../src/nklein-agent/nklein-session-state", () => ({
	updateSummary: (_e: unknown, patch: unknown) => patch,
}));
vi.mock("../../../src/nklein-agent/nklein-task-session-helpers", () => ({ toErrorMessage: (e: unknown) => String(e) }));

import {
	type ContextOverflowControllerDeps,
	createContextOverflowController,
} from "../../../src/nklein-agent/nklein-context-overflow-controller";

const snapshot = { messages: [{ role: "assistant" }], record: { cwd: "/wd" } };

function deps(over: Partial<ContextOverflowControllerDeps> = {}): ContextOverflowControllerDeps {
	return {
		recordObservationWithModel: vi.fn(),
		readPersistedTaskSession: vi.fn(async () => snapshot as never),
		resolvePersistedLaunchConfig: vi.fn(() => ({ providerId: "lmstudio", modelId: "m" }) as never),
		stopTaskSession: vi.fn(async () => {}),
		canRestartTaskSession: vi.fn(() => true),
		waitUntilTaskResumed: vi.fn(async () => {}),
		markStarted: vi.fn(),
		restartTaskSession: vi.fn(async () => ({ result: "restarted", warnings: ["w"] })),
		startRuntimeSession: vi.fn(async () => ({ result: "fresh-start" })),
		prepareMessagesForKnownContextWindow: vi.fn(() => [{ role: "user" }] as never),
		emitSummary: vi.fn(),
		...over,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	isContextOverflowError.mockReturnValue(false);
	compactPersistedMessagesForContextOverflow.mockReturnValue([{ role: "user" }]);
	estimateNextPromptTokens.mockReturnValue(0);
	countTokens.mockReturnValue(0);
});

const overflow = { taskId: "t1", prompt: "p", mode: "act" as const, error: new Error("ctx") };

describe("recoverAfterOverflow", () => {
	it("returns null and does nothing when the error is not a context-overflow", async () => {
		const d = deps();
		expect(await createContextOverflowController(d).recoverAfterOverflow(overflow)).toBeNull();
		expect(d.restartTaskSession).not.toHaveBeenCalled();
		expect(d.recordObservationWithModel).not.toHaveBeenCalled();
	});

	it("compacts and restarts the live session on an overflow error", async () => {
		isContextOverflowError.mockReturnValue(true);
		const d = deps();
		const out = await createContextOverflowController(d).recoverAfterOverflow(overflow);
		expect(out).toEqual({ result: "restarted", warnings: ["w"] });
		expect(d.recordObservationWithModel).toHaveBeenCalled();
		expect(d.markStarted).toHaveBeenCalledWith("t1");
		expect(d.startRuntimeSession).not.toHaveBeenCalled();
	});

	it("rebuilds a fresh session when no live session can be restarted", async () => {
		isContextOverflowError.mockReturnValue(true);
		const d = deps({ canRestartTaskSession: vi.fn(() => false) });
		const out = await createContextOverflowController(d).recoverAfterOverflow(overflow);
		expect(out).toEqual({ result: "fresh-start" });
		expect(d.restartTaskSession).not.toHaveBeenCalled();
	});

	it("returns null when the history cannot be compacted", async () => {
		isContextOverflowError.mockReturnValue(true);
		compactPersistedMessagesForContextOverflow.mockReturnValue(null as never);
		const d = deps();
		expect(await createContextOverflowController(d).recoverAfterOverflow(overflow)).toBeNull();
		expect(d.restartTaskSession).not.toHaveBeenCalled();
	});
});

describe("compactBeforeOverflow", () => {
	const base = {
		taskId: "t1",
		entry: { summary: {} } as never,
		prompt: "p",
		mode: "act" as const,
		contextWindow: 32_000,
	};

	it("returns null (no restart) when usage is low and compaction is a no-op", async () => {
		// prepareMessages returns the SAME array instance as the snapshot history → no compaction happened.
		const d = deps({ prepareMessagesForKnownContextWindow: vi.fn(() => snapshot.messages as never) });
		expect(await createContextOverflowController(d).compactBeforeOverflow(base)).toBeNull();
		expect(d.restartTaskSession).not.toHaveBeenCalled();
		expect(d.emitSummary).not.toHaveBeenCalled();
	});

	it("warns and restarts when the projected budget is over the compact ratio", async () => {
		countTokens.mockReturnValue(31_000); // ratio ~0.97 > compact ratio 0.92
		const d = deps();
		const out = await createContextOverflowController(d).compactBeforeOverflow(base);
		expect(d.emitSummary).toHaveBeenCalled(); // high-budget warning
		expect(out).toEqual({ result: "restarted", warnings: ["w"] });
	});
});

/**
 * Live 2026-09-08, project 38: card `mutation-duration-schedule-kill-m3` reached `completed` with a model turn
 * still queued behind the shared endpoint. The turn came up, this controller compacted (which RESTARTS the
 * session), the board-liveness watchdog stopped the session of a completed card, the abort retried the delivery,
 * and the pair looped every 30 seconds — sixteen junk requests on the endpoint in seven minutes, zero progress.
 * Retirement is what makes the watchdog's stop stick, and this is the half that reads it.
 */
describe("retired sessions are never revived by compaction", () => {
	const retired = {
		taskId: "t1",
		reason: "terminal_lane_card" as const,
		detail: "card sits in completed",
		at: 1,
	};

	it("refuses the reactive overflow restart and says why", async () => {
		isContextOverflowError.mockReturnValue(true);
		const d = deps({ findRetiredSession: vi.fn(() => retired) });
		await expect(createContextOverflowController(d).recoverAfterOverflow(overflow)).rejects.toThrow(
			/Refusing to restart the session for t1/u,
		);
		expect(d.restartTaskSession).not.toHaveBeenCalled();
		expect(d.startRuntimeSession).not.toHaveBeenCalled();
		expect(d.recordObservationWithModel).toHaveBeenCalledWith(
			expect.objectContaining({
				metadata: expect.objectContaining({ category: "retired_session_revival_refused" }),
			}),
		);
	});

	it("restarts as before when the task is NOT retired", async () => {
		isContextOverflowError.mockReturnValue(true);
		const d = deps({ findRetiredSession: vi.fn(() => null) });
		const out = await createContextOverflowController(d).recoverAfterOverflow(overflow);
		expect(out).toEqual({ result: "restarted", warnings: ["w"] });
		expect(d.restartTaskSession).toHaveBeenCalledTimes(1);
	});

	it("is inert when the dep is absent — an implementation with no ledger behaves exactly as before", async () => {
		isContextOverflowError.mockReturnValue(true);
		const d = deps();
		expect(await createContextOverflowController(d).recoverAfterOverflow(overflow)).toEqual({
			result: "restarted",
			warnings: ["w"],
		});
	});
});
