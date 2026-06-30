import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RuntimeTrpcWorkspaceScope } from "../../../../src/trpc/app-router";

const state = vi.hoisted(() => ({ board: { columns: [], dependencies: [] } as unknown }));

vi.mock("../../../../src/state/workspace-state", () => ({
	loadWorkspaceState: vi.fn(async () => ({ board: state.board })),
}));

import { handleVerifyTaskAcceptance } from "../../../../src/trpc/runtime-api/verify-task-acceptance";

const boardWith = (cards: unknown[]) => ({
	columns: [{ id: "review", title: "Review", cards }],
	dependencies: [],
});

const scope = { workspacePath: "/w" } as RuntimeTrpcWorkspaceScope;

const acceptanceResult = { present: true, passed: true, command: "npm test", exitCode: 0 };
const deps = {
	getScopedNKleinTaskSessionService: vi.fn(async () => ({
		verifyTaskAcceptanceInSandbox: vi.fn(async () => acceptanceResult),
		// biome-ignore lint/suspicious/noExplicitAny: minimal service stub for the handler under test
	})) as any,
};

beforeEach(() => {
	state.board = boardWith([]);
});

describe("handleVerifyTaskAcceptance", () => {
	it("throws NOT_FOUND when the task is not on the board", async () => {
		await expect(handleVerifyTaskAcceptance(scope, { taskId: "missing" } as never, deps)).rejects.toThrow(
			/was not found/,
		);
	});

	it("verifies the found task and shapes an ok result with a passed message", async () => {
		state.board = boardWith([{ id: "t1", baseRef: "main", prompt: "do x" }]);
		const result = await handleVerifyTaskAcceptance(scope, { taskId: "t1" } as never, deps);
		expect(result.ok).toBe(true);
		expect(result.taskId).toBe("t1");
		expect(result.acceptance).toEqual(acceptanceResult);
		expect(result.message).toContain("passed");
	});
});
