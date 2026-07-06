import type { AgentSandboxExecResult } from "./nklein-agent-sandbox";
import { AGENT_SANDBOX_VOLUME_PREFIX } from "./nklein-agent-sandbox-docker";

/**
 * §5.U — the pure sandbox predicates/utilities extracted from `nklein-agent-sandbox`: recognizing a
 * container-missing docker error, matching a workspace-volume name, escaping a regex literal, and the structural
 * `AgentSandboxExecResult` type guard. No error classes / IO here (the error-building helpers stay with the service, which
 * imports these back). The `AgentSandboxExecResult` import is type-only, so this module has no runtime dependency on the
 * service file — no import cycle.
 */

/** True when docker output indicates the target container/object no longer exists. */
export function isContainerMissingError(output: string): boolean {
	const normalized = output.toLowerCase();
	return normalized.includes("no such container") || normalized.includes("no such object");
}

/** Escape a string so it can be embedded literally inside a `RegExp`. */
export function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** True when the volume name is one of !Klein's per-task agent workspace volumes (`<prefix>-<digits>`). */
export function isAgentSandboxWorkspaceVolumeName(volumeName: string): boolean {
	return new RegExp(`^${escapeRegExp(AGENT_SANDBOX_VOLUME_PREFIX)}-\\d+$`).test(volumeName);
}

/** Structural guard: the value looks like a docker exec result (has exitCode / stdout / stderr). */
export function isAgentSandboxExecResult(value: unknown): value is AgentSandboxExecResult {
	return (
		Boolean(value) &&
		value !== null &&
		typeof value === "object" &&
		"exitCode" in value &&
		"stdout" in value &&
		"stderr" in value
	);
}
