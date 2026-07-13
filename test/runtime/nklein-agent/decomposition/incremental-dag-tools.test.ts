import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
	assembleIncrementalTasks,
	createIncrementalDagSessionState,
	createIncrementalDagTools,
	injectIncrementalTasksIntoDecomposeInput,
	resetIncrementalDagSessionState,
} from "../../../../src/nklein-agent/decomposition/incremental-dag-tools";
import { createNKleinDecompositionTools } from "../../../../src/nklein-agent/nklein-decomposition-tool";

vi.mock("../../../../src/telemetry/self-observation-sink.js", () => ({
	recordSelfObservation: vi.fn(),
}));

/**
 * F1.7 (§5.AV live wiring) — add_task/add_dependency run the pure applyDagOp state machine, so the accumulated
 * graph is valid-by-construction and every rejection carries the precise reason. decompose_project WITHOUT tasks
 * consumes the construction (the completion route); an explicit tasks array stays one-shot mode.
 */

function getTools(state = createIncrementalDagSessionState()) {
	const [addTask, addDependency] = createIncrementalDagTools(state);
	if (!addTask || !addDependency) {
		throw new Error("incremental tools missing");
	}
	return { state, addTask, addDependency };
}

const ctx = undefined as never;

describe("add_task", () => {
	it("accepts a valid task, tracks progress, and rejects a duplicate id with the reason", async () => {
		const { state, addTask } = getTools();
		const result = (await addTask.execute({ id: "setup-db", title: "Set up DB", prompt: "Create schema." }, ctx)) as {
			ok: boolean;
			instruction: string;
		};
		expect(result.ok).toBe(true);
		expect(result.instruction).toContain("1 task(s), 0 dependency(ies)");
		expect(state.tasksById.get("setup-db")?.title).toBe("Set up DB");

		await expect(addTask.execute({ id: "setup-db", title: "Again", prompt: "Duplicate." }, ctx)).rejects.toThrow(
			/duplicate_node.*already declared/,
		);
		expect(state.construction.nodes).toHaveLength(1);
	});

	it("reports a missing required field compactly instead of dumping a schema", async () => {
		const { addTask } = getTools();
		await expect(addTask.execute({ id: "x", title: "No prompt" }, ctx)).rejects.toThrow(
			/add_task needs id, title, and prompt/,
		);
	});

	it("validates inline dependsOn per edge: accepted ones recorded, unknown ones reported without blocking the task", async () => {
		const { state, addTask } = getTools();
		await addTask.execute({ id: "a", title: "A", prompt: "Do a." }, ctx);
		const result = (await addTask.execute(
			{ id: "b", title: "B", prompt: "Do b.", dependsOn: ["a", "ghost"] },
			ctx,
		)) as {
			ok: boolean;
			acceptedDependencyCount: number;
			rejectedDependencies: Array<{ dependsOn: string; reason: string }>;
			instruction: string;
		};
		expect(result.ok).toBe(true);
		expect(result.acceptedDependencyCount).toBe(1);
		expect(result.rejectedDependencies).toEqual([
			expect.objectContaining({ dependsOn: "ghost", reason: "unknown_from" }),
		]);
		expect(result.instruction).toContain('"ghost"');
		expect(state.construction.edges).toEqual([{ from: "a", to: "b" }]);
		expect(state.rejectedOpCount).toBe(1);
	});
});

describe("add_dependency", () => {
	it("accepts a valid edge and rejects unknown endpoints with add_dependency vocabulary", async () => {
		const { state, addTask, addDependency } = getTools();
		await addTask.execute({ id: "a", title: "A", prompt: "Do a." }, ctx);
		await addTask.execute({ id: "b", title: "B", prompt: "Do b." }, ctx);
		const accepted = (await addDependency.execute({ taskId: "b", dependsOn: "a" }, ctx)) as { ok: boolean };
		expect(accepted.ok).toBe(true);
		expect(state.construction.edges).toEqual([{ from: "a", to: "b" }]);

		await expect(addDependency.execute({ taskId: "b", dependsOn: "ghost" }, ctx)).rejects.toThrow(
			/unknown_from.*dependsOn task is not declared/,
		);
		await expect(addDependency.execute({ taskId: "ghost", dependsOn: "a" }, ctx)).rejects.toThrow(
			/unknown_to.*taskId task is not declared/,
		);
	});

	it("rejects duplicates, self-loops, and cycle-closing edges with the precise core reason", async () => {
		const { addTask, addDependency } = getTools();
		await addTask.execute({ id: "a", title: "A", prompt: "Do a." }, ctx);
		await addTask.execute({ id: "b", title: "B", prompt: "Do b." }, ctx);
		await addTask.execute({ id: "c", title: "C", prompt: "Do c." }, ctx);
		await addDependency.execute({ taskId: "b", dependsOn: "a" }, ctx);
		await addDependency.execute({ taskId: "c", dependsOn: "b" }, ctx);

		await expect(addDependency.execute({ taskId: "b", dependsOn: "a" }, ctx)).rejects.toThrow(/duplicate_edge/);
		await expect(addDependency.execute({ taskId: "a", dependsOn: "a" }, ctx)).rejects.toThrow(/self_loop/);
		// a → b → c already; c before a would close the loop.
		await expect(addDependency.execute({ taskId: "a", dependsOn: "c" }, ctx)).rejects.toThrow(
			/would_create_cycle.*stays acyclic/,
		);
	});
});

describe("assembly + injection", () => {
	it("derives dependsOn from ACCEPTED edges only and injects into a tasks-less decompose input", async () => {
		const { state, addTask, addDependency } = getTools();
		await addTask.execute({ id: "a", title: "A", prompt: "Do a." }, ctx);
		await addTask.execute({ id: "b", title: "B", prompt: "Do b.", dependsOn: ["a", "ghost"] }, ctx);
		await addTask.execute({ id: "c", title: "C", prompt: "Do c." }, ctx);
		await addDependency.execute({ taskId: "c", dependsOn: "b" }, ctx);

		const tasks = assembleIncrementalTasks(state);
		expect(tasks?.map((task) => ({ id: task.id, dependsOn: task.dependsOn }))).toEqual([
			{ id: "a", dependsOn: [] },
			{ id: "b", dependsOn: ["a"] }, // "ghost" was rejected at add_task time and never sneaks back in
			{ id: "c", dependsOn: ["b"] },
		]);

		const injected = injectIncrementalTasksIntoDecomposeInput({ slug: "s", spec: "sp", plan: "pl" }, state) as {
			tasks?: unknown[];
		};
		expect(injected.tasks).toHaveLength(3);

		// An explicit tasks array is one-shot mode — the construction must NOT override it.
		const oneShot = { slug: "s", spec: "sp", plan: "pl", tasks: [{ id: "z", title: "Z", prompt: "Do z." }] };
		expect(injectIncrementalTasksIntoDecomposeInput(oneShot, state)).toBe(oneShot);

		resetIncrementalDagSessionState(state);
		expect(assembleIncrementalTasks(state)).toBeNull();
		expect(injectIncrementalTasksIntoDecomposeInput({ slug: "s" }, state)).toEqual({ slug: "s" });
	});
});

describe("decompose_project completion route (shared session state)", () => {
	it("a tasks-less decompose_project submits the incremental construction, then the state resets", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), "kanban-incremental-dag-"));
		const tools = createNKleinDecompositionTools({ workspacePath });
		const byName = new Map(tools.map((tool) => [tool.name, tool]));
		const addTask = byName.get("add_task");
		const addDependency = byName.get("add_dependency");
		const decompose = byName.get("decompose_project");
		if (!addTask || !addDependency || !decompose) {
			throw new Error("expected add_task, add_dependency, and decompose_project in the toolset");
		}

		await addTask.execute({ id: "schema", title: "Schema", prompt: "Design the schema." }, ctx);
		await addTask.execute({ id: "api", title: "API", prompt: "Build the API.", dependsOn: ["schema"] }, ctx);
		await addTask.execute({ id: "ui", title: "UI", prompt: "Build the UI." }, ctx);
		await addDependency.execute({ taskId: "ui", dependsOn: "api" }, ctx);

		const result = (await decompose.execute(
			{
				slug: "incremental-demo",
				title: "Incremental demo",
				spec: "Three-step build.",
				plan: "Schema, API, UI.",
				defaultAcceptanceCommand: "npm test",
			},
			ctx,
		)) as { ok: boolean; taskCount: number; dependencyCount: number };
		expect(result.ok).toBe(true);
		expect(result.taskCount).toBe(3);
		expect(result.dependencyCount).toBe(2);

		// Consumed: a repeat tasks-less call has nothing to submit and gets the standard missing-fields guidance.
		await expect(
			decompose.execute({ slug: "incremental-demo", spec: "Three-step build.", plan: "Again." }, ctx),
		).rejects.toThrow(/missing required fields: tasks/);
	});
});
