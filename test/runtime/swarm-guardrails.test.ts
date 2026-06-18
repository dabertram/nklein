import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { clearSwarmStop, readSwarmStopSignal, requestSwarmStop } from "../../src/core/swarm-guardrails";

describe("swarm guardrails", () => {
	it("persists and clears the workspace stop signal", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), "kanban-swarm-stop-"));
		try {
			await expect(readSwarmStopSignal(workspacePath)).resolves.toBeNull();

			const signal = await requestSwarmStop({
				workspacePath,
				reason: "Pause overnight run.",
				now: 123,
			});

			expect(signal).toEqual({
				stopped: true,
				reason: "Pause overnight run.",
				createdAt: 123,
			});
			await expect(readSwarmStopSignal(workspacePath)).resolves.toEqual(signal);

			await clearSwarmStop(workspacePath);
			await expect(readSwarmStopSignal(workspacePath)).resolves.toBeNull();
		} finally {
			await rm(workspacePath, { recursive: true, force: true });
		}
	});
});
