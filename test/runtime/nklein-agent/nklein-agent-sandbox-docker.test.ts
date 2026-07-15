import { describe, expect, it } from "vitest";
import {
	buildAgentSandboxDockerRunArgs,
	createAgentSandboxContainerName,
	createAgentSandboxProjectKey,
	createAgentSandboxTaskUid,
	createAgentSandboxVolumeName,
	resolveAgentSandboxNetworkArgs,
} from "../../../src/nklein-agent/nklein-agent-sandbox-docker";

/** Assert `flag` appears immediately followed by `value` in an args array. */
function hasAdjacent(args: string[], flag: string, value: string): boolean {
	const i = args.indexOf(flag);
	return i >= 0 && args[i + 1] === value;
}

describe("resolveAgentSandboxNetworkArgs (fail-closed egress)", () => {
	it("maps full→bridge and none→none", () => {
		expect(resolveAgentSandboxNetworkArgs("full")).toEqual(["--network", "bridge"]);
		expect(resolveAgentSandboxNetworkArgs("none")).toEqual(["--network", "none"]);
	});

	it("uses the egress network for allowlist ONLY when the proxy is available AND a network name is supplied", () => {
		expect(
			resolveAgentSandboxNetworkArgs("allowlist", {
				egressProxyAvailable: true,
				egressNetworkName: "nklein-egress",
			}),
		).toEqual(["--network", "nklein-egress"]);
	});

	it("FAILS CLOSED to none for allowlist without wiring, without a network name, or with the proxy unavailable", () => {
		expect(resolveAgentSandboxNetworkArgs("allowlist")).toEqual(["--network", "none"]);
		expect(resolveAgentSandboxNetworkArgs("allowlist", { egressProxyAvailable: true })).toEqual([
			"--network",
			"none",
		]);
		expect(
			resolveAgentSandboxNetworkArgs("allowlist", {
				egressProxyAvailable: false,
				egressNetworkName: "nklein-egress",
			}),
		).toEqual(["--network", "none"]);
	});
});

describe("sandbox container/volume naming", () => {
	it("is deterministic and namespaces the name when a namespace is given (trimmed)", () => {
		expect(createAgentSandboxContainerName(3)).toBe(createAgentSandboxContainerName(3));
		expect(createAgentSandboxContainerName(3, "  test  ")).toContain("-test-3");
		expect(createAgentSandboxVolumeName(3, "test")).toContain("-test-3");
		// Different slots → different names (no collision).
		expect(createAgentSandboxContainerName(1)).not.toBe(createAgentSandboxContainerName(2));
	});
});

describe("createAgentSandboxProjectKey / TaskUid", () => {
	it("project key is a stable 12-hex-char digest and never throws on a non-existent path", () => {
		const key = createAgentSandboxProjectKey("/nonexistent/repo/path");
		expect(key).toMatch(/^[0-9a-f]{12}$/);
		expect(createAgentSandboxProjectKey("/nonexistent/repo/path")).toBe(key); // deterministic
	});

	it("task uid is deterministic per taskId", () => {
		expect(createAgentSandboxTaskUid("task-1")).toBe(createAgentSandboxTaskUid("task-1"));
		expect(Number.isInteger(createAgentSandboxTaskUid("task-1"))).toBe(true);
	});
});

describe("buildAgentSandboxDockerRunArgs (isolation invariants)", () => {
	const options = {
		slot: 4,
		config: { namespace: undefined, agentsPerContainer: 2, memoryPerContainerMb: 2048, cpusPerContainer: 2 },
		networkPolicy: "none" as const,
		projectMounts: [{ projectRepoPath: "/host/repo", projectKey: "deadbeef" }],
		image: "nklein-sandbox:latest",
	};

	it("always applies the unconditional isolation flags", () => {
		const args = buildAgentSandboxDockerRunArgs(options as never);
		expect(hasAdjacent(args, "--cap-drop", "ALL")).toBe(true);
		expect(hasAdjacent(args, "--security-opt", "no-new-privileges")).toBe(true);
		expect(args).toContain("--read-only");
		expect(hasAdjacent(args, "--tmpfs", "/tmp:noexec,nosuid,size=512m")).toBe(true);
		expect(hasAdjacent(args, "--network", "none")).toBe(true); // default fail-closed network
	});

	it("mounts project repos read-only", () => {
		const args = buildAgentSandboxDockerRunArgs(options as never);
		expect(args.some((a) => a.includes("type=bind,src=/host/repo,dst=/repos/deadbeef,readonly"))).toBe(true);
	});
});
