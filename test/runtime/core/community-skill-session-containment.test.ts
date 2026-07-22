import { describe, expect, it } from "vitest";
import { decideCommunitySkillSessionContainment } from "../../../src/core/community-skill-session-containment";
import type { SkillExecutionGateResult } from "../../../src/core/skill-execution-gate";
import type { ParsedSkillManifest } from "../../../src/core/skill-md-parse";
import type { ToolCapabilityManifest } from "../../../src/core/tool-capability-manifest";

const READ: ToolCapabilityManifest = {
	mutationLevel: "read",
	networkLevel: "none",
	fsScope: "workspace",
	approval: "auto",
	replayable: true,
};
const WRITE: ToolCapabilityManifest = {
	mutationLevel: "sandbox_write",
	networkLevel: "none",
	fsScope: "workspace",
	approval: "confirm",
	replayable: false,
};
const WEB: ToolCapabilityManifest = {
	mutationLevel: "read",
	networkLevel: "egress_read",
	fsScope: "workspace",
	approval: "confirm",
	replayable: true,
};
const HOST: ToolCapabilityManifest = {
	mutationLevel: "host_write",
	networkLevel: "none",
	fsScope: "host",
	approval: "typed_host",
	replayable: false,
};

function manifest(tools: string[]): ParsedSkillManifest {
	return { name: "fixture", description: "fixture", allowedTools: tools, extra: {} };
}

function gate(paths: string[] = []): SkillExecutionGateResult {
	const approvalRequired = paths.map((path) => ({
		rawPath: path,
		normalizedPath: path,
		disposition: "requires-approval" as const,
		reasons: ["under_scripts_root" as const],
	}));
	return {
		posture: paths.length > 0 ? "approval-required" : "clean",
		entries: [...approvalRequired],
		approvalRequired,
		blocked: [],
		reason: "fixture",
	};
}

function decide(overrides: Partial<Parameters<typeof decideCommunitySkillSessionContainment>[0]> = {}) {
	return decideCommunitySkillSessionContainment({
		manifest: manifest(["read_files", "write_file", "web_search", "host_shell"]),
		executionGate: gate(),
		executableFiles: [],
		availableTools: [
			{ name: "read_files", manifest: READ },
			{ name: "write_file", manifest: WRITE },
			{ name: "web_search", manifest: WEB },
			{ name: "host_shell", manifest: HOST },
		],
		requestedNetworkPolicy: "full",
		dockerSandbox: true,
		sensitiveAccess: false,
		taskScopedEgressIdentity: true,
		...overrides,
	});
}

describe("decideCommunitySkillSessionContainment", () => {
	it("narrows full egress, strips host tools, and satisfies the AC Rule-of-Two posture", () => {
		const result = decide();
		expect(result.decision).toBe("allow");
		expect(result.networkPolicy).toBe("allowlist");
		expect(result.credentialMode).toBe("task-scoped-egress-only");
		expect(result.effectiveTools).toEqual(["read_files", "web_search", "write_file"]);
		expect(result.deniedByContainment).toEqual([
			expect.objectContaining({ tool: "host_shell", reason: "host_scope_forbidden" }),
		]);
		expect(result.ruleOfTwo).toMatchObject({ configuration: "AC", propertyCount: 2, satisfied: true });
	});

	it("fails closed to no egress without an audience-bound per-session proxy identity", () => {
		const result = decide({ taskScopedEgressIdentity: false });
		expect(result.networkPolicy).toBe("none");
		expect(result.credentialMode).toBe("none");
		expect(result.effectiveTools).toEqual(["read_files", "write_file"]);
		expect(result.deniedByContainment).toContainEqual(
			expect.objectContaining({ tool: "web_search", reason: "network_unavailable" }),
		);
	});

	it("makes an untrusted + sensitive session read-only, preserving the AB Rule-of-Two posture", () => {
		const result = decide({ sensitiveAccess: true });
		expect(result.decision).toBe("allow");
		expect(result.effectiveTools).toEqual(["read_files"]);
		expect(result.deniedByContainment.map((item) => [item.tool, item.reason])).toEqual([
			["host_shell", "host_scope_forbidden"],
			["web_search", "rule_of_two_sensitive_session"],
			["write_file", "rule_of_two_sensitive_session"],
		]);
		expect(result.ruleOfTwo).toMatchObject({ configuration: "AB", propertyCount: 2, satisfied: true });
	});

	it("hard-denies Docker bypass and any ambient credential exposure", () => {
		expect(decide({ dockerSandbox: false }).decision).toBe("deny");
		const credentials = decide({ ambientCredentialNames: ["GITHUB_TOKEN", " AWS_SECRET_ACCESS_KEY "] });
		expect(credentials.decision).toBe("deny");
		expect(credentials.reason).toContain("AWS_SECRET_ACCESS_KEY, GITHUB_TOKEN");
	});

	it("keeps scripts disabled by default and approves only an exact requested path + file hash", () => {
		const sha256 = "a".repeat(64);
		const disabled = decide({
			executionGate: gate(["scripts/run.sh"]),
			executableFiles: [{ path: "scripts/run.sh", sha256 }],
		});
		expect(disabled.decision).toBe("allow");
		expect(disabled.approvedExecutableFiles).toEqual([]);
		expect(disabled.disabledExecutableFiles).toEqual([{ path: "scripts/run.sh", sha256 }]);

		const pending = decide({
			executionGate: gate(["scripts/run.sh"]),
			executableFiles: [{ path: "scripts/run.sh", sha256 }],
			requestedExecutablePaths: ["scripts/run.sh"],
		});
		expect(pending.decision).toBe("approval-required");

		const approved = decide({
			executionGate: gate(["scripts/run.sh"]),
			executableFiles: [{ path: "scripts/run.sh", sha256 }],
			requestedExecutablePaths: ["scripts/run.sh"],
			executableApprovals: [{ path: "scripts/run.sh", sha256, confirmation: true }],
		});
		expect(approved.decision).toBe("allow");
		expect(approved.approvedExecutableFiles).toEqual([{ path: "scripts/run.sh", sha256 }]);
	});

	it("rejects stale, duplicate, or off-manifest executable approvals", () => {
		const sha256 = "b".repeat(64);
		const base = {
			executionGate: gate(["scripts/run.sh"]),
			executableFiles: [{ path: "scripts/run.sh", sha256 }],
			requestedExecutablePaths: ["scripts/run.sh"],
		};
		expect(
			decide({
				...base,
				executableApprovals: [{ path: "scripts/run.sh", sha256: "c".repeat(64), confirmation: true }],
			}).decision,
		).toBe("deny");
		expect(
			decide({
				...base,
				executableApprovals: [
					{ path: "scripts/run.sh", sha256, confirmation: true },
					{ path: "scripts/run.sh", sha256, confirmation: true },
				],
			}).decision,
		).toBe("deny");
		expect(decide({ ...base, requestedExecutablePaths: ["scripts/other.sh"] }).decision).toBe("deny");
	});

	it("denies a reject-level bundle before considering tools", () => {
		const blocked: SkillExecutionGateResult = {
			posture: "blocked",
			entries: [],
			approvalRequired: [],
			blocked: [],
			reason: "blocked",
		};
		expect(decide({ executionGate: blocked }).decision).toBe("deny");
	});
});
