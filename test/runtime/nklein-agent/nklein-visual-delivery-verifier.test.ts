import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentSandboxManager } from "../../../src/nklein-agent/nklein-agent-sandbox";
import { verifyCurrentBuildVisualInSandbox } from "../../../src/nklein-agent/nklein-visual-delivery-verifier";

const roots: string[] = [];
afterEach(async () => await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe("verifyCurrentBuildVisualInSandbox", () => {
	it("creates then compares a baseline from screenshot bytes produced inside the task sandbox", async () => {
		const baselineRootDir = await mkdtemp(join(tmpdir(), "nklein-visual-baseline-"));
		roots.push(baselineRootDir);
		const pngBase64 =
			"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAHnOcQAAAAABJRU5ErkJggg==";
		const disposeWorkspace = vi.fn(async () => {});
		const manager = {
			assertAvailable: vi.fn(async () => {}),
			prepareWorkspace: vi.fn(async () => ({ workdir: "/workspaces/task" })),
			listSandboxRootFileNames: vi.fn(async () => ["package.json", "package-lock.json"]),
			exec: vi.fn(async () => ({ exitCode: 0, stdout: "", stderr: "" })),
			runTool: vi.fn(async () =>
				JSON.stringify({
					rendered: true,
					consoleErrors: [],
					pngBase64,
					route: "/",
					framework: "vite",
				}),
			),
			disposeWorkspace,
		} as unknown as AgentSandboxManager;
		const input = {
			taskId: "task",
			projectRepoPath: "/project",
			baseRef: "base",
			resultCommit: "result",
			baselineRootDir,
			sandboxManager: manager,
		};

		const created = await verifyCurrentBuildVisualInSandbox(input);
		expect(created.decision?.verdict).toBe("baseline_created");
		const compared = await verifyCurrentBuildVisualInSandbox(input);
		expect(compared.decision?.verdict).toBe("pass");
		expect(disposeWorkspace).toHaveBeenCalledTimes(2);
	});

	it("reports no visual evidence when the sandbox project is not a JavaScript frontend", async () => {
		const disposeWorkspace = vi.fn(async () => {});
		const manager = {
			assertAvailable: vi.fn(async () => {}),
			prepareWorkspace: vi.fn(async () => ({ workdir: "/workspaces/task" })),
			listSandboxRootFileNames: vi.fn(async () => ["go.mod"]),
			exec: vi.fn(async () => ({ exitCode: 0, stdout: "", stderr: "" })),
			runTool: vi.fn(),
			disposeWorkspace,
		} as unknown as AgentSandboxManager;
		const result = await verifyCurrentBuildVisualInSandbox({
			taskId: "go-task",
			projectRepoPath: "/project",
			baseRef: "base",
			resultCommit: "result",
			sandboxManager: manager,
		});
		expect(result.applicability).toBe("not_applicable");
		expect(result.decision).toBeNull();
		expect(manager.runTool).not.toHaveBeenCalled();
		expect(disposeWorkspace).toHaveBeenCalledOnce();
	});

	it("fails closed on JavaScript dependency setup failure and never calls the browser tool", async () => {
		const disposeWorkspace = vi.fn(async () => {});
		const manager = {
			assertAvailable: vi.fn(async () => {}),
			prepareWorkspace: vi.fn(async () => ({ workdir: "/workspaces/task" })),
			listSandboxRootFileNames: vi.fn(async () => ["package.json", "package-lock.json"]),
			exec: vi.fn(async (taskId: string, argv: string[]) => ({
				exitCode: argv.at(-1)?.startsWith("command -v") ? 0 : 1,
				stdout: "",
				stderr: `offline install failed for ${taskId}`,
			})),
			runTool: vi.fn(),
			disposeWorkspace,
		} as unknown as AgentSandboxManager;
		const result = await verifyCurrentBuildVisualInSandbox({
			taskId: "ui-task",
			projectRepoPath: "/project",
			baseRef: "base",
			resultCommit: "result",
			sandboxManager: manager,
		});
		expect(result.applicability).toBe("applicable");
		expect(result.decision).toMatchObject({ verdict: "fail" });
		expect(manager.runTool).not.toHaveBeenCalled();
		expect(disposeWorkspace).toHaveBeenCalledOnce();
	});

	it("never substitutes the base tree when no delivered commit can be resolved", async () => {
		const manager = {
			assertAvailable: vi.fn(),
			prepareWorkspace: vi.fn(),
		} as unknown as AgentSandboxManager;
		await expect(
			verifyCurrentBuildVisualInSandbox({
				taskId: "missing-result",
				projectRepoPath: "/definitely/not/a/repository",
				baseRef: "base",
				sandboxManager: manager,
			}),
		).rejects.toThrow("exact delivered commit");
		expect(manager.prepareWorkspace).not.toHaveBeenCalled();
	});
});
