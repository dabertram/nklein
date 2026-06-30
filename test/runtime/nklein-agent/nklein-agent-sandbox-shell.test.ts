import { describe, expect, it } from "vitest";
import {
	type AgentSandboxShellTarget,
	buildAgentSandboxInteractiveShellArgs,
	buildTaskShellSpawnSpec,
	DEFAULT_AGENT_SANDBOX_SHELL,
} from "../../../src/nklein-agent/nklein-agent-sandbox-shell";

const target: AgentSandboxShellTarget = { containerName: "c1", uid: 70123, workdir: "/workspaces/t1" };

describe("buildAgentSandboxInteractiveShellArgs", () => {
	it("builds an interactive docker exec argv with the task user, workdir, and default shell", () => {
		expect(buildAgentSandboxInteractiveShellArgs(target)).toEqual([
			"exec",
			"-it",
			"-u",
			"70123",
			"-w",
			"/workspaces/t1",
			"c1",
			...DEFAULT_AGENT_SANDBOX_SHELL,
		]);
	});

	it("uses a caller-provided shell when given", () => {
		expect(buildAgentSandboxInteractiveShellArgs(target, ["/bin/bash", "-i"])).toEqual([
			"exec",
			"-it",
			"-u",
			"70123",
			"-w",
			"/workspaces/t1",
			"c1",
			"/bin/bash",
			"-i",
		]);
	});
});

describe("buildTaskShellSpawnSpec", () => {
	it("docker-execs into the sandbox container when a shell target is present", () => {
		expect(buildTaskShellSpawnSpec(target, { binary: "/bin/zsh", args: ["-l"] })).toEqual({
			binary: "docker",
			args: buildAgentSandboxInteractiveShellArgs(target),
			usesSandbox: true,
		});
	});

	it("falls back to the host shell (copying its args) when there is no sandbox target", () => {
		expect(buildTaskShellSpawnSpec(null, { binary: "/bin/zsh", args: ["-l"] })).toEqual({
			binary: "/bin/zsh",
			args: ["-l"],
			usesSandbox: false,
		});
	});

	it("defaults host args to an empty array", () => {
		expect(buildTaskShellSpawnSpec(null, { binary: "/bin/sh" })).toEqual({
			binary: "/bin/sh",
			args: [],
			usesSandbox: false,
		});
	});
});
