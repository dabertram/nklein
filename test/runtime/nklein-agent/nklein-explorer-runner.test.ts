import { describe, expect, it, vi } from "vitest";

vi.mock("../../../src/telemetry/self-observation-sink", () => ({ recordSelfObservation: vi.fn() }));
vi.mock("../../../src/nklein-agent/nklein-agent-sandbox", () => ({
	createAgentSandboxToolExecutors: vi.fn(() => ({})),
}));
vi.mock("../../../src/nklein-agent/nklein-agent-sandbox-extra-tools", () => ({
	createAgentSandboxExtraTools: vi.fn(() => ({})),
}));
vi.mock("../../../src/nklein-agent/nklein-session-state", () => ({ createSessionId: (id: string) => id }));

import { createExplorerRunner, type ExplorerRunnerDeps } from "../../../src/nklein-agent/nklein-explorer-runner";

const FINDINGS = {
	answer: "The validator owns the rule.",
	citations: [{ path: "src/validator.ts", line: 12, note: "dependency check" }],
};

function deps(over: Partial<ExplorerRunnerDeps> = {}): ExplorerRunnerDeps {
	return {
		getAgentSandboxManager: () => ({}) as never,
		getLaunchConfig: () => ({ providerId: "lmstudio", modelId: "worker-m" }) as never,
		getPauseController: () => ({}) as never,
		getHarness: () =>
			({
				runBracketed: vi.fn(async (_config: unknown, drive: (ctx: unknown) => Promise<unknown>) =>
					drive({
						workspace: { workdir: "/wd" },
						deadlineMs: Date.now() + 8_000,
						runBoundedTurn: async (turn: Promise<unknown>) => await turn,
					}),
				),
			}) as never,
		getBaseRef: () => "HEAD",
		startRuntimeSession: vi.fn(async (launch) => {
			launch.onExplorerCitationsSubmitted?.(FINDINGS);
			return { result: {} };
		}),
		sendTaskSessionInput: vi.fn(async () => {}),
		defaultTimeoutMs: 600_000,
		maxNudges: 2,
		runBudget: 6,
		...over,
	};
}

describe("createExplorerRunner", () => {
	it("marks the initial explorer turn as an awaited child of the worker turn", async () => {
		const d = deps();
		const result = await createExplorerRunner(d).buildExploreHandler("t1", "/repo")?.("Where is the rule?");

		expect(result).toEqual(FINDINGS);
		expect(d.startRuntimeSession).toHaveBeenCalledWith(
			expect.objectContaining({ taskId: "t1::explore", admissionParentTaskId: "t1" }),
		);
	});

	it("keeps the parent handoff on explorer nudges", async () => {
		let submit: ((result: typeof FINDINGS) => void) | undefined;
		const d = deps({
			startRuntimeSession: vi.fn(async (launch) => {
				submit = launch.onExplorerCitationsSubmitted as typeof submit;
				return { result: {} };
			}),
			sendTaskSessionInput: vi.fn(async () => {
				submit?.(FINDINGS);
			}),
		});
		await createExplorerRunner(d).buildExploreHandler("t1", "/repo")?.("Where is the rule?");

		expect(d.sendTaskSessionInput).toHaveBeenCalledWith(
			"t1::explore",
			expect.stringContaining("Submit your findings"),
			"t1",
		);
	});
});
