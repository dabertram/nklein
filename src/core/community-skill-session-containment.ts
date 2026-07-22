/**
 * F4.23 — the complete, pure containment decision for ONE community-skill session.
 *
 * Community skill text is untrusted instructions by construction. Detection cannot make it trusted, so this gate
 * constrains the session around it: Docker is mandatory, ambient credentials never enter, full egress is narrowed to
 * the authenticated allowlist path, the declared tool set is intersected with the runtime's actually-available tools,
 * host/secret/network-incompatible tools are stripped, and executable files remain unavailable unless the operator
 * approved the exact path + SHA-256 for this activation. The resulting session must satisfy Meta's Agents Rule of Two:
 * no more than two of untrusted input, sensitive access, and external/state-changing effects.
 *
 * This module decides only. The effectful snapshot reload, TOCTOU re-check, session binding, and durable activation
 * ticket live in `community-skill-execution-service.ts`.
 */

import type { SandboxNetworkPolicy } from "./agent-rulesets";
import { reconcileSkillCapabilityGrant, type SkillCapabilityGrant } from "./skill-capability-grant-reconcile";
import type { SkillExecutionGateResult } from "./skill-execution-gate";
import type { ParsedSkillManifest } from "./skill-md-parse";
import type { ToolCapabilityManifest } from "./tool-capability-manifest";

export interface CommunitySkillAvailableTool {
	name: string;
	manifest: ToolCapabilityManifest;
}

export interface CommunitySkillExecutableFile {
	path: string;
	sha256: string;
}

export interface CommunitySkillExecutableApproval {
	path: string;
	sha256: string;
	confirmation: true;
}

export type CommunitySkillToolDenialReason =
	| "host_scope_forbidden"
	| "secret_access_forbidden"
	| "network_unavailable"
	| "rule_of_two_sensitive_session";

export interface CommunitySkillToolDenial {
	tool: string;
	reason: CommunitySkillToolDenialReason;
	detail: string;
}

export interface CommunitySkillRuleOfTwoVerdict {
	untrustedInput: true;
	sensitiveAccess: boolean;
	externalOrStatefulEffects: boolean;
	propertyCount: number;
	satisfied: boolean;
	configuration: "A" | "AB" | "AC";
	reason: string;
}

export type CommunitySkillContainmentDecision = "allow" | "approval-required" | "deny";

export interface CommunitySkillSessionContainmentInput {
	manifest: ParsedSkillManifest;
	executionGate: SkillExecutionGateResult;
	executableFiles: readonly CommunitySkillExecutableFile[];
	requestedExecutablePaths?: readonly string[];
	executableApprovals?: readonly CommunitySkillExecutableApproval[];
	availableTools: readonly CommunitySkillAvailableTool[];
	requestedNetworkPolicy: SandboxNetworkPolicy;
	dockerSandbox: boolean;
	/** True only when the session can read private data/systems. Ambient credentials are a separate, harder denial. */
	sensitiveAccess: boolean;
	/** Names only. Values must never cross this boundary or enter an audit record. Any entry is a hard denial. */
	ambientCredentialNames?: readonly string[];
	/** Required for allowlisted egress: the sandbox gets only an audience-bound, per-session proxy identity. */
	taskScopedEgressIdentity: boolean;
}

export interface CommunitySkillSessionContainmentResult {
	decision: CommunitySkillContainmentDecision;
	reason: string;
	capabilityGrant: SkillCapabilityGrant;
	effectiveTools: string[];
	deniedByContainment: CommunitySkillToolDenial[];
	networkPolicy: Exclude<SandboxNetworkPolicy, "full">;
	credentialMode: "none" | "task-scoped-egress-only";
	approvedExecutableFiles: CommunitySkillExecutableFile[];
	disabledExecutableFiles: CommunitySkillExecutableFile[];
	pendingExecutableApprovals: CommunitySkillExecutableFile[];
	ruleOfTwo: CommunitySkillRuleOfTwoVerdict;
	reasons: string[];
}

function sortedUnique(values: Iterable<string>): string[] {
	return [...new Set(values)].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

function normalisePathList(values: readonly string[] | undefined): string[] {
	return sortedUnique((values ?? []).map((value) => value.trim()).filter(Boolean));
}

function validSha256(value: string): boolean {
	return /^[a-f0-9]{64}$/u.test(value);
}

function isExternalOrStateful(manifest: ToolCapabilityManifest): boolean {
	return manifest.mutationLevel !== "read" || manifest.networkLevel !== "none";
}

function ruleOfTwoVerdict(
	sensitiveAccess: boolean,
	externalOrStatefulEffects: boolean,
): CommunitySkillRuleOfTwoVerdict {
	const propertyCount = 1 + Number(sensitiveAccess) + Number(externalOrStatefulEffects);
	const satisfied = propertyCount <= 2;
	const configuration = sensitiveAccess ? "AB" : externalOrStatefulEffects ? "AC" : "A";
	return {
		untrustedInput: true,
		sensitiveAccess,
		externalOrStatefulEffects,
		propertyCount,
		satisfied,
		configuration,
		reason: satisfied
			? `Rule of Two satisfied (${configuration}): ${propertyCount} of 3 session properties are present.`
			: "Rule of Two violated: untrusted skill input, sensitive access, and external/state-changing effects cannot coexist autonomously in one session.",
	};
}

function resultWithDenial(
	input: CommunitySkillSessionContainmentInput,
	capabilityGrant: SkillCapabilityGrant,
	reasons: string[],
): CommunitySkillSessionContainmentResult {
	const ruleOfTwo = ruleOfTwoVerdict(input.sensitiveAccess, false);
	return {
		decision: "deny",
		reason: `deny: ${reasons.join(" ")}`,
		capabilityGrant,
		effectiveTools: [],
		deniedByContainment: [],
		networkPolicy: "none",
		credentialMode: "none",
		approvedExecutableFiles: [],
		disabledExecutableFiles: [...input.executableFiles],
		pendingExecutableApprovals: [],
		ruleOfTwo,
		reasons,
	};
}

/**
 * Build the effective containment envelope for one activation. Inputs must come from trusted runtime state and a
 * freshly verified imported snapshot; caller-provided tool names or digest labels are not authorities.
 */
export function decideCommunitySkillSessionContainment(
	input: CommunitySkillSessionContainmentInput,
): CommunitySkillSessionContainmentResult {
	const availableByName = new Map<string, ToolCapabilityManifest>();
	for (const tool of input.availableTools) {
		const name = tool.name.trim();
		if (name && !availableByName.has(name)) availableByName.set(name, tool.manifest);
	}
	const capabilityGrant = reconcileSkillCapabilityGrant(input.manifest, [...availableByName.keys()]);
	const hardReasons: string[] = [];
	if (!input.dockerSandbox) hardReasons.push("A community skill may run only inside the Docker sandbox.");
	if (input.executionGate.posture === "blocked") {
		hardReasons.push("The bundle contains a reject-level file-containment violation.");
	}
	const ambientCredentialNames = normalisePathList(input.ambientCredentialNames);
	if (ambientCredentialNames.length > 0) {
		hardReasons.push(`Ambient credentials are forbidden (${ambientCredentialNames.join(", ")}).`);
	}
	if (hardReasons.length > 0) return resultWithDenial(input, capabilityGrant, hardReasons);

	const reasons: string[] = [];
	let networkPolicy: "none" | "allowlist" = input.requestedNetworkPolicy === "none" ? "none" : "allowlist";
	if (input.requestedNetworkPolicy === "full") {
		reasons.push("Full network access was narrowed to the authenticated domain allowlist.");
	}
	if (networkPolicy === "allowlist" && !input.taskScopedEgressIdentity) {
		networkPolicy = "none";
		reasons.push("Allowlisted egress was disabled because no per-session proxy identity is available.");
	}
	const credentialMode = networkPolicy === "allowlist" ? "task-scoped-egress-only" : "none";

	const deniedByContainment: CommunitySkillToolDenial[] = [];
	const effectiveTools: string[] = [];
	for (const toolName of capabilityGrant.effectiveTools) {
		const tool = availableByName.get(toolName);
		if (!tool) continue;
		if (tool.fsScope === "host" || tool.mutationLevel === "host_write") {
			deniedByContainment.push({
				tool: toolName,
				reason: "host_scope_forbidden",
				detail: "Community skills never receive host filesystem or host-command capability.",
			});
			continue;
		}
		if (tool.taintSinks?.includes("secrets")) {
			deniedByContainment.push({
				tool: toolName,
				reason: "secret_access_forbidden",
				detail: "Community skills never receive tools that expose secrets or ambient credentials.",
			});
			continue;
		}
		if (tool.networkLevel !== "none" && networkPolicy === "none") {
			deniedByContainment.push({
				tool: toolName,
				reason: "network_unavailable",
				detail: "The contained session has no authenticated egress route.",
			});
			continue;
		}
		if (input.sensitiveAccess && isExternalOrStateful(tool)) {
			deniedByContainment.push({
				tool: toolName,
				reason: "rule_of_two_sensitive_session",
				detail:
					"A session combining untrusted skill input with sensitive access is read-only and cannot communicate outward.",
			});
			continue;
		}
		effectiveTools.push(toolName);
	}
	effectiveTools.sort();

	const executableByPath = new Map<string, CommunitySkillExecutableFile>();
	for (const file of input.executableFiles) {
		if (file.path && validSha256(file.sha256) && !executableByPath.has(file.path))
			executableByPath.set(file.path, file);
	}
	const gatePaths = new Set(
		input.executionGate.approvalRequired.map((entry) => entry.normalizedPath ?? entry.rawPath).filter(Boolean),
	);
	for (const path of gatePaths) {
		if (!executableByPath.has(path)) {
			hardReasons.push(`Executable '${path}' has no verified file digest.`);
		}
	}

	const requestedPaths = normalisePathList(input.requestedExecutablePaths);
	for (const path of requestedPaths) {
		if (!gatePaths.has(path)) hardReasons.push(`Executable request '${path}' is not an approval-gated bundle file.`);
	}
	const approvalByPath = new Map<string, CommunitySkillExecutableApproval>();
	for (const approval of input.executableApprovals ?? []) {
		if (approvalByPath.has(approval.path)) {
			hardReasons.push(`Executable approval '${approval.path}' is duplicated.`);
			continue;
		}
		approvalByPath.set(approval.path, approval);
		const file = executableByPath.get(approval.path);
		if (!file || !gatePaths.has(approval.path)) {
			hardReasons.push(`Executable approval '${approval.path}' does not name an approval-gated file.`);
		} else if (approval.sha256 !== file.sha256) {
			hardReasons.push(`Executable approval '${approval.path}' does not match the verified file SHA-256.`);
		}
	}
	if (hardReasons.length > 0) return resultWithDenial(input, capabilityGrant, hardReasons);

	const approvedExecutableFiles = requestedPaths.flatMap((path) => {
		const file = executableByPath.get(path);
		const approval = approvalByPath.get(path);
		return file && approval?.confirmation === true && approval.sha256 === file.sha256 ? [file] : [];
	});
	const approvedPaths = new Set(approvedExecutableFiles.map((file) => file.path));
	const pendingExecutableApprovals = requestedPaths
		.filter((path) => !approvedPaths.has(path))
		.flatMap((path) => {
			const file = executableByPath.get(path);
			return file ? [file] : [];
		});
	const disabledExecutableFiles = [...executableByPath.values()].filter((file) => !approvedPaths.has(file.path));

	const effectiveExternalOrStateful =
		effectiveTools.some((name) => {
			const tool = availableByName.get(name);
			return tool ? isExternalOrStateful(tool) : false;
		}) || approvedExecutableFiles.length > 0;
	const ruleOfTwo = ruleOfTwoVerdict(input.sensitiveAccess, effectiveExternalOrStateful);
	if (!ruleOfTwo.satisfied) {
		return resultWithDenial(input, capabilityGrant, [ruleOfTwo.reason]);
	}

	const decision: CommunitySkillContainmentDecision =
		pendingExecutableApprovals.length > 0 ? "approval-required" : "allow";
	if (deniedByContainment.length > 0) {
		reasons.push(`${deniedByContainment.length} declared tool(s) were stripped by containment.`);
	}
	if (disabledExecutableFiles.length > 0) {
		reasons.push(`${disabledExecutableFiles.length} executable file(s) remain disabled.`);
	}
	if (pendingExecutableApprovals.length > 0) {
		reasons.push(
			`${pendingExecutableApprovals.length} requested executable file(s) still require exact per-file approval.`,
		);
	}
	reasons.push(ruleOfTwo.reason);
	return {
		decision,
		reason: `${decision}: ${reasons.join(" ")}`,
		capabilityGrant,
		effectiveTools,
		deniedByContainment,
		networkPolicy,
		credentialMode,
		approvedExecutableFiles,
		disabledExecutableFiles,
		pendingExecutableApprovals,
		ruleOfTwo,
		reasons,
	};
}
