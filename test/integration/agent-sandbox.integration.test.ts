import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ToolExecutors } from "@cline/sdk";
import { describe, expect, it, vi } from "vitest";
import {
	createAgentSandboxChatWorkspaceProvider,
	createSandboxWorkspaceReadTools,
	createSandboxWorkspaceWriteTools,
	resolveSandboxWritablePathMounts,
} from "../../src/chat/chat-sandbox-workspace-tools";
import type { ChatSession } from "../../src/chat/chat-session-store";
import {
	AGENT_SANDBOX_CONTAINER_LABEL,
	AGENT_SANDBOX_VOLUME_PREFIX,
	AgentSandboxManager,
	createAgentSandboxContainerName,
	createAgentSandboxVolumeName,
	resolveAgentSandboxImageName,
} from "../../src/nklein-agent/nklein-agent-sandbox";
import { createGitTestEnv } from "../utilities/git-env";
import { createTempDir } from "../utilities/temp-dir";

type EditorInput = Parameters<NonNullable<ToolExecutors["editor"]>>[0];
type ApplyPatchInput = Parameters<NonNullable<ToolExecutors["applyPatch"]>>[0];

interface DockerGate {
	ready: boolean;
	reason: string;
	image: string;
}

function probeDockerGate(): DockerGate {
	const image = resolveAgentSandboxImageName();
	const version = spawnSync("docker", ["version"], { encoding: "utf8" });
	if (version.status !== 0) {
		return {
			ready: false,
			reason: `docker version failed: ${formatProcessFailure(version)}`,
			image,
		};
	}
	const inspect = spawnSync("docker", ["image", "inspect", image], { encoding: "utf8" });
	if (inspect.status !== 0) {
		return {
			ready: false,
			reason: `sandbox image ${image} is unavailable; run npm run sandbox:build`,
			image,
		};
	}
	return { ready: true, reason: "", image };
}

function formatProcessFailure(result: ReturnType<typeof spawnSync>): string {
	return [result.error?.message, result.stderr, result.stdout]
		.map((part) => (typeof part === "string" ? part.trim() : ""))
		.filter(Boolean)
		.join("\n");
}

function runGit(cwd: string, args: string[]): string {
	const result = spawnSync("git", args, {
		cwd,
		encoding: "utf8",
		env: createGitTestEnv(),
	});
	if (result.status !== 0) {
		throw new Error(
			[`git ${args.join(" ")} failed in ${cwd}`, result.stdout.trim(), result.stderr.trim()]
				.filter((part) => part.length > 0)
				.join("\n"),
		);
	}
	return result.stdout.trim();
}

function createCommittedRepo(sandboxRoot: string): string {
	const repoPath = join(sandboxRoot, "repo");
	mkdirSync(repoPath, { recursive: true });
	runGit(repoPath, ["init"]);
	runGit(repoPath, ["config", "user.name", "!Klein Test"]);
	runGit(repoPath, ["config", "user.email", "kanban-test@example.com"]);
	writeFileSync(join(repoPath, "README.md"), "hello\n", "utf8");
	runGit(repoPath, ["add", "README.md"]);
	runGit(repoPath, ["commit", "-m", "init"]);
	return repoPath;
}

function createChatSession(id: string): ChatSession {
	return {
		schemaVersion: 1,
		id,
		title: "Docker chat read test",
		scope: "chat_only",
		role: "planner_architect",
		goal: null,
		riskAcknowledged: false,
		browserEnabled: false,
		sandboxWritablePaths: [],
		feedbackMuted: false,
		ownedWorkspaceId: null,
		focus: null,
		outstandingAsks: [],
		selectedSkillIds: [],
		totalTokensUsed: 0,
		createdAt: 1,
		updatedAt: 1,
	};
}

function chatTool(tools: ReturnType<typeof createSandboxWorkspaceReadTools>["tools"], name: string) {
	const found = tools.find((candidate) => candidate.name === name);
	if (!found) {
		throw new Error(`chat tool ${name} not found`);
	}
	return found;
}

function dockerOutput(args: string[]): string {
	const result = spawnSync("docker", args, { encoding: "utf8" });
	if (result.status !== 0) {
		throw new Error(
			[`docker ${args.join(" ")} failed`, result.stdout.trim(), result.stderr.trim()]
				.filter((part) => part.length > 0)
				.join("\n"),
		);
	}
	return result.stdout;
}

function dockerOutputLines(args: string[]): string[] {
	return dockerOutput(args)
		.split(/\r?\n/g)
		.map((line) => line.trim())
		.filter(Boolean);
}

function sandboxContainerExists(): boolean {
	return (
		dockerOutputLines([
			"ps",
			"-aq",
			"--filter",
			`label=${AGENT_SANDBOX_CONTAINER_LABEL}`,
			"--filter",
			`name=${createAgentSandboxContainerName(1)}`,
		]).length > 0
	);
}

function sandboxVolumeExists(): boolean {
	return dockerOutputLines(["volume", "ls", "-q", "--filter", `name=${AGENT_SANDBOX_VOLUME_PREFIX}`]).includes(
		createAgentSandboxVolumeName(1),
	);
}

async function withTemporaryHome<T>(run: (homePath: string) => Promise<T>): Promise<T> {
	const { path: tempHome, cleanup } = createTempDir("kanban-home-agent-sandbox-");
	const previousHome = process.env.HOME;
	const previousUserProfile = process.env.USERPROFILE;
	process.env.HOME = tempHome;
	process.env.USERPROFILE = tempHome;
	try {
		return await run(tempHome);
	} finally {
		if (previousHome === undefined) {
			delete process.env.HOME;
		} else {
			process.env.HOME = previousHome;
		}
		if (previousUserProfile === undefined) {
			delete process.env.USERPROFILE;
		} else {
			process.env.USERPROFILE = previousUserProfile;
		}
		cleanup();
	}
}

async function delay(ms: number): Promise<void> {
	await new Promise<void>((resolve) => {
		setTimeout(resolve, ms);
	});
}

const dockerGate = probeDockerGate();

if (dockerGate.ready) {
	describe.sequential("agent sandbox Docker integration", () => {
		it("isolates sibling workspaces, runs tools, captures patches, and tears down idle resources", async () => {
			await withTemporaryHome(async (homePath) => {
				const { path: sandboxRoot, cleanup } = createTempDir("kanban-agent-sandbox-");
				const manager = new AgentSandboxManager({
					image: dockerGate.image,
					poolConfig: {
						maxContainers: 1,
						agentsPerContainer: 0,
						idleTimeoutMs: 100,
					},
				});
				try {
					const repoPath = createCommittedRepo(sandboxRoot);
					const clonePath = join(sandboxRoot, "patch-target");

					await expect(manager.checkAvailability()).resolves.toMatchObject({
						state: "ready",
						dockerAvailable: true,
						imageAvailable: true,
					});

					const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
					const taskA = `sandbox-a-${suffix}`;
					const taskB = `sandbox-b-${suffix}`;
					const workspaceA = await manager.prepareWorkspace({
						taskId: taskA,
						projectRepoPath: repoPath,
						baseRef: "HEAD",
					});
					const workspaceB = await manager.prepareWorkspace({
						taskId: taskB,
						projectRepoPath: repoPath,
						baseRef: "HEAD",
					});

					expect(workspaceA.workdir).toBe(`/workspaces/${taskA}`);
					expect(workspaceB.workdir).toBe(`/workspaces/${taskB}`);
					expect(workspaceA.uid).not.toBe(workspaceB.uid);
					expect(sandboxContainerExists()).toBe(true);

					const hostnameA = await manager.exec(taskA, ["hostname"]);
					const hostnameB = await manager.exec(taskB, ["hostname"]);
					expect(hostnameA.exitCode).toBe(0);
					expect(hostnameB.exitCode).toBe(0);
					expect(hostnameA.stdout.trim()).toBe(hostnameB.stdout.trim());

					const workspaceBMode = await manager.exec(taskB, ["stat", "-c", "%a", workspaceB.workdir]);
					expect(workspaceBMode.exitCode).toBe(0);
					expect(workspaceBMode.stdout.trim()).toBe("700");

					const siblingRead = await manager.exec(taskA, ["cat", `${workspaceB.workdir}/README.md`]);
					expect(siblingRead.exitCode).not.toBe(0);
					const siblingWrite = await manager.exec(taskA, [
						"sh",
						"-lc",
						`echo pwned > ${workspaceB.workdir}/pwned.txt`,
					]);
					expect(siblingWrite.exitCode).not.toBe(0);
					const siblingWriteAbsent = await manager.exec(taskB, [
						"test",
						"!",
						"-e",
						`${workspaceB.workdir}/pwned.txt`,
					]);
					expect(siblingWriteAbsent.exitCode).toBe(0);

					await expect(manager.runTool(taskA, "bash", "pwd")).resolves.toContain(workspaceA.workdir);
					await expect(manager.runTool(taskA, "readFile", { path: "README.md" })).resolves.toContain("hello");

					const editorInput: EditorInput = {
						path: "README.md",
						old_text: "hello\n",
						new_text: "hello from editor\n",
					};
					await expect(manager.runTool(taskA, "editor", editorInput)).resolves.toContain("README.md");

					const applyPatchInput: ApplyPatchInput = {
						input: ["*** Begin Patch", "*** Add File: patched.txt", "+patched", "*** End Patch", ""].join("\n"),
					};
					await expect(manager.runTool(taskA, "applyPatch", applyPatchInput)).resolves.toContain("patched.txt");

					const patch = await manager.captureWorkspacePatch(taskA, { baseRef: "HEAD" });
					expect(patch).toContain("diff --git a/README.md b/README.md");
					expect(patch).toContain("diff --git a/patched.txt b/patched.txt");

					runGit(sandboxRoot, ["clone", "-q", repoPath, clonePath]);
					writeFileSync(join(sandboxRoot, "workspace.patch"), patch, "utf8");
					runGit(clonePath, ["apply", "--check", join(sandboxRoot, "workspace.patch")]);
					runGit(clonePath, ["apply", join(sandboxRoot, "workspace.patch")]);

					expect(existsSync(join(homePath, ".nklein", "nklein"))).toBe(false);
					expect(existsSync(join(homePath, ".nklein", "worktrees"))).toBe(false);

					await manager.disposeWorkspace(taskA);
					const removedWorkspace = await manager.exec(taskB, ["test", "!", "-e", workspaceA.workdir]);
					expect(removedWorkspace.exitCode).toBe(0);
					await manager.disposeWorkspace(taskB);

					await vi.waitFor(
						() => {
							expect(sandboxContainerExists()).toBe(false);
							expect(sandboxVolumeExists()).toBe(false);
						},
						{ timeout: 10_000, interval: 100 },
					);
				} finally {
					await manager.stopNow();
					cleanup();
				}
			});
		}, 60_000);

		it("queues the third task when one real container allows two agents", async () => {
			const { path: sandboxRoot, cleanup } = createTempDir("kanban-agent-sandbox-queue-");
			const manager = new AgentSandboxManager({
				image: dockerGate.image,
				poolConfig: {
					maxContainers: 1,
					agentsPerContainer: 2,
					idleTimeoutMs: 0,
				},
			});
			try {
				const repoPath = createCommittedRepo(sandboxRoot);
				const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
				const taskA = `queue-a-${suffix}`;
				const taskB = `queue-b-${suffix}`;
				const taskC = `queue-c-${suffix}`;
				const workspaceA = await manager.prepareWorkspace({
					taskId: taskA,
					projectRepoPath: repoPath,
					baseRef: "HEAD",
				});
				const workspaceB = await manager.prepareWorkspace({
					taskId: taskB,
					projectRepoPath: repoPath,
					baseRef: "HEAD",
				});

				expect(workspaceA.uid).not.toBe(workspaceB.uid);
				const siblingRead = await manager.exec(taskA, ["cat", `${workspaceB.workdir}/README.md`]);
				expect(siblingRead.exitCode).not.toBe(0);
				const siblingWrite = await manager.exec(taskA, [
					"sh",
					"-lc",
					`echo pwned > ${workspaceB.workdir}/pwned.txt`,
				]);
				expect(siblingWrite.exitCode).not.toBe(0);
				const siblingWriteAbsent = await manager.exec(taskB, [
					"test",
					"!",
					"-e",
					`${workspaceB.workdir}/pwned.txt`,
				]);
				expect(siblingWriteAbsent.exitCode).toBe(0);

				let queued = false;
				const thirdWorkspacePromise = manager.prepareWorkspace({
					taskId: taskC,
					projectRepoPath: repoPath,
					baseRef: "HEAD",
					onQueued: () => {
						queued = true;
					},
				});
				await vi.waitFor(() => {
					expect(queued).toBe(true);
				});
				let thirdResolved = false;
				void thirdWorkspacePromise.then(() => {
					thirdResolved = true;
				});
				await delay(100);
				expect(thirdResolved).toBe(false);
				expect(sandboxContainerExists()).toBe(true);

				await manager.disposeWorkspace(taskA);
				const workspaceC = await thirdWorkspacePromise;

				expect(workspaceC.workdir).toBe(`/workspaces/${taskC}`);
				expect(workspaceC.uid).not.toBe(workspaceB.uid);
				await manager.disposeWorkspace(taskB);
				await manager.disposeWorkspace(taskC);
			} finally {
				await manager.stopNow();
				cleanup();
			}
		}, 60_000);

		it("backs chat workspace read tools with a Docker sandbox workspace", async () => {
			await withTemporaryHome(async () => {
				const { path: sandboxRoot, cleanup } = createTempDir("kanban-chat-sandbox-read-");
				const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
				const manager = new AgentSandboxManager({
					image: dockerGate.image,
					poolConfig: {
						maxContainers: 1,
						agentsPerContainer: 1,
						idleTimeoutMs: 100,
						namespace: `chatread-${suffix}`,
					},
					networkPolicy: "none",
				});
				try {
					const repoPath = createCommittedRepo(sandboxRoot);
					const toolSet = createSandboxWorkspaceReadTools({
						session: createChatSession(`docker-read-${suffix}`),
						workspacePath: repoPath,
						provider: createAgentSandboxChatWorkspaceProvider(manager),
						maxBytes: 3,
					});

					const read = await chatTool(toolSet.tools, "read_file").run({ path: "README.md" });
					expect(read).toContain("hel");
					expect(read).toContain("truncated: README.md");
					expect(read).not.toContain(repoPath);

					const list = await chatTool(toolSet.tools, "list_dir").run({});
					expect(list).toContain("README.md");
					expect(list).not.toContain(repoPath);

					const absolute = await chatTool(toolSet.tools, "read_file").run({ path: "/etc/passwd" });
					expect(absolute).toContain("workspace-relative");
				} finally {
					await manager.stopNow();
					cleanup();
				}
			});
		}, 60_000);

		it("writes chat workspace files only through approved Docker writable mounts", async () => {
			await withTemporaryHome(async () => {
				const { path: sandboxRoot, cleanup } = createTempDir("kanban-chat-sandbox-write-");
				const repoPath = createCommittedRepo(sandboxRoot);
				const writableMounts = resolveSandboxWritablePathMounts(repoPath, ["src"]);
				const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
				const manager = new AgentSandboxManager({
					image: dockerGate.image,
					poolConfig: {
						maxContainers: 1,
						agentsPerContainer: 1,
						idleTimeoutMs: 100,
						namespace: `chatwrite-${suffix}`,
					},
					networkPolicy: "none",
					writableMounts,
				});
				try {
					const toolSet = createSandboxWorkspaceWriteTools({
						session: { ...createChatSession(`docker-write-${suffix}`), sandboxWritablePaths: ["src"] },
						workspacePath: repoPath,
						provider: createAgentSandboxChatWorkspaceProvider(manager),
						writableMounts,
					});
					const writeFile = chatTool(toolSet.tools, "write_file");

					const denied = await writeFile.run({ path: "README.md", content: "changed\n" });
					expect(denied).toContain("not under an approved writable path");

					const content = "hello from approved chat mount\n";
					const written = await writeFile.run({ path: "src/generated.txt", content });

					expect(written).toContain("Wrote");
					expect(readFileSync(join(repoPath, "src", "generated.txt"), "utf8")).toBe(content);
					expect(readFileSync(join(repoPath, "README.md"), "utf8")).toBe("hello\n");
				} finally {
					await manager.stopNow();
					cleanup();
				}
			});
		}, 60_000);
	});
} else {
	describe.skip(`agent sandbox Docker integration (${dockerGate.reason})`, () => {
		it("requires Docker and the sandbox image", () => {});
	});
}
