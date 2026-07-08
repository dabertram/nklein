import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NKLEIN_DEV_TEST_PROJECT_MARKER_PATH } from "../../../src/nklein-agent/nklein-dev-test-project";

const childProcessMocks = vi.hoisted(() => ({
	execFile: vi.fn(),
}));

vi.mock("node:child_process", () => ({
	execFile: childProcessMocks.execFile,
}));

async function writeDevTestMarker(workspacePath: string): Promise<void> {
	const markerPath = join(workspacePath, NKLEIN_DEV_TEST_PROJECT_MARKER_PATH);
	await mkdir(dirname(markerPath), { recursive: true });
	await writeFile(markerPath, JSON.stringify({ createdBy: "nklein-dev-test" }), "utf8");
}

function installExecFileMock(): void {
	childProcessMocks.execFile.mockImplementation((command: string, args: readonly string[], callback: unknown) => {
		if (typeof callback !== "function") {
			throw new Error("Expected callback-form execFile.");
		}
		if (command === "du") {
			callback(null, { stdout: `4\t${args[1] ?? ""}\n`, stderr: "" });
			return;
		}
		if (command === "docker") {
			callback(null, { stdout: "nklein-agent-ws-old\nunrelated-volume\n", stderr: "" });
			return;
		}
		callback(new Error(`Unexpected command: ${command}`), { stdout: "", stderr: "" });
	});
}

describe("runDevCleanupReportCommand", () => {
	afterEach(() => {
		childProcessMocks.execFile.mockReset();
	});

	it("reports marked dev-test workspaces and retains the active workspace in JSON mode", async () => {
		installExecFileMock();
		const { runDevCleanupReportCommand } = await import("../../../src/commands/dev-cleanup-commands");
		const scanDir = await mkdtemp(join(tmpdir(), "nklein-dev-cleanup-command-"));
		const activeWorkspace = join(scanDir, "active");
		const oldWorkspace = join(scanDir, "old");
		const ignoredWorkspace = join(scanDir, "ordinary");
		await mkdir(ignoredWorkspace, { recursive: true });
		await writeDevTestMarker(activeWorkspace);
		await writeDevTestMarker(oldWorkspace);
		let output = "";

		try {
			await runDevCleanupReportCommand({
				scanDir,
				activeWorkspacePath: activeWorkspace,
				json: true,
				write: (text) => {
					output += text;
				},
			});
		} finally {
			await rm(scanDir, { recursive: true, force: true });
		}

		const parsed = JSON.parse(output) as {
			retained: Array<{ path: string; kind: string }>;
			reclaimable: Array<{ path: string; kind: string }>;
			totalReclaimableBytes: number;
		};
		expect(parsed.retained).toEqual([
			{ path: activeWorkspace, kind: "dev_test_workspace", sizeBytes: 4096, isActive: true },
		]);
		expect(parsed.reclaimable).toEqual([
			{ path: oldWorkspace, kind: "dev_test_workspace", sizeBytes: 4096, isActive: false },
			{ path: "nklein-agent-ws-old", kind: "sandbox_volume", sizeBytes: 0, isActive: false },
		]);
		expect(parsed.totalReclaimableBytes).toBe(4096);
		expect(childProcessMocks.execFile).toHaveBeenCalledWith(
			"docker",
			["volume", "ls", "--format", "{{.Name}}"],
			expect.any(Function),
		);
		expect(childProcessMocks.execFile).toHaveBeenCalledWith("du", ["-sk", activeWorkspace], expect.any(Function));
		expect(childProcessMocks.execFile).toHaveBeenCalledWith("du", ["-sk", oldWorkspace], expect.any(Function));
	});
});
