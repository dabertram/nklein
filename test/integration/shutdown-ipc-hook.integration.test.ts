import { type ChildProcess, spawn } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const HARNESS = resolve(process.cwd(), "test/integration/fixtures/shutdown-hook-harness.cjs");

function spawnHarness(env: Record<string, string> = {}): {
	child: ChildProcess;
	ready: Promise<void>;
	exited: Promise<number>;
} {
	const child = spawn(process.execPath, [HARNESS], {
		stdio: ["ignore", "pipe", "pipe", "ipc"],
		// A short fallback so the wedge case terminates quickly instead of the 5s production default.
		env: { ...process.env, KANBAN_SHUTDOWN_HARD_EXIT_MS: "300", ...env },
	});
	const ready = new Promise<void>((res) => {
		child.on("message", (message: { type?: string } | null) => {
			if (message?.type === "ready") {
				res();
			}
		});
	});
	const exited = new Promise<number>((res) => {
		child.on("exit", (code) => res(code ?? -1));
	});
	return { child, ready, exited };
}

describe("shutdown-ipc-hook self-termination (orphan prevention)", () => {
	it("shuts down gracefully on a kanban.shutdown message", async () => {
		const { child, ready, exited } = spawnHarness();
		await ready;
		child.send({ type: "kanban.shutdown" });
		expect(await exited).toBe(0);
	});

	it("self-terminates when the parent disconnects the IPC channel (the leak trigger)", async () => {
		const { child, ready, exited } = spawnHarness();
		await ready;
		// Simulate the parent dying / going away without sending a shutdown message.
		child.disconnect();
		expect(await exited).toBe(0);
	});

	it("hard-exits when the graceful shutdown wedges", async () => {
		const { child, ready, exited } = spawnHarness({ WEDGE: "1" });
		await ready;
		child.disconnect();
		// Graceful SIGINT is swallowed; the unref'd fallback timer forces a non-zero exit.
		expect(await exited).toBe(1);
	});
});
