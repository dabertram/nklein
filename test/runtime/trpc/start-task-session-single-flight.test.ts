import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { handleStartTaskSession, type StartTaskSessionDeps } from "../../../src/trpc/runtime-api/start-task-session";

/**
 * Audit 2026-09-04 #3 (live: two watchdog legs started the same card 8ms apart and the second start landed on the
 * ghost model): `handleStartTaskSession` is single-flight per (workspace, task). The inner start is held on its first
 * awaited dependency; a concurrent start for the same task is refused with `start_in_flight` WITHOUT touching the
 * runtime, another task is not affected, and once the flight settles the key is free again.
 */
describe("handleStartTaskSession single-flight guard", () => {
	function deferred<T>() {
		let resolve!: (value: T) => void;
		const promise = new Promise<T>((r) => {
			resolve = r;
		});
		return { promise, resolve };
	}

	it("refuses a concurrent start for the same task and frees the key once the first flight settles", async () => {
		const workspacePath = mkdtempSync(join(tmpdir(), "nklein-single-flight-"));
		const scope = { workspaceId: "ws-1", workspacePath } as never;
		const gate = deferred<never>();
		let configLoads = 0;
		const deps = {
			loadScopedRuntimeConfig: async () => {
				configLoads += 1;
				return await gate.promise;
			},
		} as unknown as StartTaskSessionDeps;

		const first = handleStartTaskSession(scope, { taskId: "task-1", baseRef: "main", prompt: "go" }, deps).catch(
			(error: unknown) => ({
				rejected: error,
			}),
		);
		// Let the first flight reach its awaited dependency — poll instead of a fixed sleep (a 20ms sleep lost the
		// race under the loaded pre-commit run, N12 intermittent, 2026-09-05).
		for (let attempt = 0; attempt < 200 && configLoads < 1; attempt += 1) {
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
		expect(configLoads).toBe(1);

		const duplicate = await handleStartTaskSession(
			scope,
			{ taskId: "task-1", baseRef: "main", prompt: "go again" },
			deps,
		);
		expect(duplicate).toMatchObject({ ok: false, errorCode: "start_in_flight" });
		expect(configLoads).toBe(1); // the duplicate never entered the inner start

		// A DIFFERENT task is not held by task-1's flight.
		const other = handleStartTaskSession(scope, { taskId: "task-2", baseRef: "main", prompt: "other" }, deps).catch(
			(error: unknown) => ({ rejected: error }),
		);
		// Same poll as above: a fixed 20ms sleep lost this race under the loaded pre-commit run (2026-09-06).
		for (let attempt = 0; attempt < 200 && configLoads < 2; attempt += 1) {
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
		expect(configLoads).toBe(2);

		// Settle both flights (the minimal deps make the inner start fail later — the guard must still release).
		gate.resolve(undefined as never);
		await first;
		await other;

		const again = handleStartTaskSession(scope, { taskId: "task-1", baseRef: "main", prompt: "third" }, deps).catch(
			(error: unknown) => ({ rejected: error }),
		);
		for (let attempt = 0; attempt < 200 && configLoads < 3; attempt += 1) {
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
		expect(configLoads).toBe(3); // the key was released: the third start entered the inner start
		const third = await again;
		expect((third as { errorCode?: string }).errorCode).not.toBe("start_in_flight");
	});
});
