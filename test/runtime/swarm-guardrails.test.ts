import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	clearSwarmStop,
	getSwarmStopSignalPath,
	readSwarmStopSignal,
	requestSwarmStop,
} from "../../src/core/swarm-guardrails";

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
			expect(getSwarmStopSignalPath(workspacePath)).toBe(
				join(workspacePath, ".nklein", "nklein", "swarm-stop.json"),
			);
			await expect(readFile(join(workspacePath, ".nklein", "nklein", "swarm-stop.json"), "utf8")).resolves.toContain(
				"Pause overnight run.",
			);
			await expect(readSwarmStopSignal(workspacePath)).resolves.toEqual(signal);

			await clearSwarmStop(workspacePath);
			await expect(readSwarmStopSignal(workspacePath)).resolves.toBeNull();
		} finally {
			await rm(workspacePath, { recursive: true, force: true });
		}
	});

	it("reads and clears the legacy kanban stop signal during the rename transition", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), "kanban-swarm-stop-"));
		try {
			const legacyPath = join(workspacePath, ".nklein", "kanban", "swarm-stop.json");
			await mkdir(join(workspacePath, ".nklein", "kanban"), { recursive: true });
			await writeFile(
				legacyPath,
				`${JSON.stringify({ stopped: true, reason: "Legacy pause.", createdAt: 456 })}\n`,
				"utf8",
			);

			await expect(readSwarmStopSignal(workspacePath)).resolves.toEqual({
				stopped: true,
				reason: "Legacy pause.",
				createdAt: 456,
			});

			await clearSwarmStop(workspacePath);
			await expect(readSwarmStopSignal(workspacePath)).resolves.toBeNull();
			await expect(readFile(legacyPath, "utf8")).rejects.toThrow();
		} finally {
			await rm(workspacePath, { recursive: true, force: true });
		}
	});
});
