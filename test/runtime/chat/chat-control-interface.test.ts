import { describe, expect, it } from "vitest";
import {
	buildNKleinControlRegistry,
	createNKleinControlTools,
	type NKleinControlDeps,
	renderNKleinControlDescription,
} from "../../../src/chat/chat-control-interface";
import type { RuntimeBoardData } from "../../../src/core/api-contract";

function fakeBoard(): RuntimeBoardData {
	return {
		columns: [
			{ id: "backlog", title: "Backlog", cards: [{ id: "card-1", title: "First card", prompt: "Do it." }] },
			{ id: "in_progress", title: "In Progress", cards: [] },
		],
	} as unknown as RuntimeBoardData;
}

function fakeDeps(overrides: Partial<NKleinControlDeps> = {}): NKleinControlDeps & { calls: string[] } {
	const calls: string[] = [];
	return {
		calls,
		loadBoard: async () => fakeBoard(),
		moveCard: async (taskId, column) => {
			calls.push(`move:${taskId}:${column}`);
			return taskId === "card-1" ? { title: "First card" } : null;
		},
		startCard: async (taskId, options) => {
			calls.push(`start:${taskId}:${options.planMode === true}`);
			return taskId === "card-1" ? { ok: true } : { ok: false, error: "unknown card" };
		},
		stopCard: async (taskId) => {
			calls.push(`stop:${taskId}`);
			return taskId === "card-1";
		},
		pauseCard: async (taskId) => {
			calls.push(`pause:${taskId}`);
			return true;
		},
		resumeCard: async (taskId) => {
			calls.push(`resume:${taskId}`);
			return true;
		},
		listSessions: async () => [{ taskId: "card-1", state: "running", modelId: "test-model" }],
		setMaxConcurrentTasks: async (value) => {
			calls.push(`cap:${value}`);
			return true;
		},
		...overrides,
	};
}

async function runTool(deps: NKleinControlDeps, action: string, params?: Record<string, unknown>): Promise<string> {
	const { tools } = createNKleinControlTools(deps);
	const tool = tools[0];
	if (!tool) {
		throw new Error("nklein_control tool missing");
	}
	return await tool.run({ action, ...(params ? { params } : {}) });
}

describe("nklein_control (F2.30 chat-as-control-plane)", () => {
	it("the generated description enumerates every registry action (the full-interface contract)", () => {
		const registry = buildNKleinControlRegistry();
		const description = renderNKleinControlDescription(registry);
		expect(registry.length).toBeGreaterThanOrEqual(7);
		for (const action of registry) {
			expect(description).toContain(action.name);
		}
		// The definition's enum must match the registry exactly — the model discovers the interface from it.
		const { definitions } = createNKleinControlTools(fakeDeps());
		const parameters = definitions[0]?.parameters as {
			properties: { action: { enum: string[] } };
		};
		expect(parameters.properties.action.enum).toEqual(registry.map((action) => action.name));
	});

	it("runtime_status renders lanes with card ids and the live sessions", async () => {
		const result = await runTool(fakeDeps(), "runtime_status");
		expect(result).toContain("backlog: 1 [card-1]");
		expect(result).toContain("in_progress: 0");
		expect(result).toContain("card-1: running (test-model)");
	});

	it("start_card drives the injected start path and honors planMode", async () => {
		const deps = fakeDeps();
		expect(await runTool(deps, "start_card", { taskId: "card-1", planMode: true })).toContain(
			"Started card [card-1] in plan mode",
		);
		expect(deps.calls).toContain("start:card-1:true");
		expect(await runTool(deps, "start_card", { taskId: "nope" })).toContain("unknown card");
	});

	it("stop/pause/resume route to their executors and report honestly", async () => {
		const deps = fakeDeps();
		expect(await runTool(deps, "stop_card", { taskId: "card-1" })).toContain("Stopped");
		expect(await runTool(deps, "stop_card", { taskId: "ghost" })).toContain("No stoppable session");
		expect(await runTool(deps, "pause_card", { taskId: "card-1" })).toContain("Paused [card-1]");
		expect(await runTool(deps, "resume_card", { taskId: "card-1" })).toContain("Resumed [card-1]");
		expect(deps.calls).toEqual(
			expect.arrayContaining(["stop:card-1", "stop:ghost", "pause:card-1", "resume:card-1"]),
		);
	});

	it("move_card validates the column and reports a missing card", async () => {
		const deps = fakeDeps();
		expect(await runTool(deps, "move_card", { taskId: "card-1", column: "trash" })).toContain(
			'Moved [card-1] "First card" to trash',
		);
		expect(await runTool(deps, "move_card", { taskId: "ghost", column: "review" })).toContain("was not found");
		expect(await runTool(deps, "move_card", { taskId: "card-1", column: "attic" })).toContain("Unknown column");
	});

	it("set_max_concurrent_tasks bounds its input", async () => {
		const deps = fakeDeps();
		expect(await runTool(deps, "set_max_concurrent_tasks", { value: 4 })).toContain("set to 4");
		expect(await runTool(deps, "set_max_concurrent_tasks", { value: 0 })).toContain("between 1 and 16");
		expect(await runTool(deps, "set_max_concurrent_tasks", { value: "many" })).toContain("between 1 and 16");
	});

	it("an unknown action names the valid interface instead of failing silently", async () => {
		const result = await runTool(fakeDeps(), "reboot_the_moon");
		expect(result).toContain('Unknown action "reboot_the_moon"');
		expect(result).toContain("start_card");
		expect(result).toContain("move_card");
	});

	it("an executor throw is caught and reported per-action (a control error never kills the turn)", async () => {
		const deps = fakeDeps({
			stopCard: async () => {
				throw new Error("service exploded");
			},
		});
		expect(await runTool(deps, "stop_card", { taskId: "card-1" })).toContain("stop_card failed: service exploded");
	});
});
