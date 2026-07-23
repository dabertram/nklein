import type { AgentSandboxExecResult } from "./nklein-agent-sandbox";
import { AGENT_SANDBOX_CONTAINER_PREFIX, AGENT_SANDBOX_VOLUME_PREFIX } from "./nklein-agent-sandbox-docker";

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
	// Matches BOTH shapes `createAgentSandboxVolumeName` produces: `<prefix>-<slot>` (no namespace) AND
	// `<prefix>-<namespace>-<slot>` (the live pool always namespaces). LIVE-FOUND 2026-07-08: the old digits-only
	// pattern never matched a namespaced volume, so the orphan reaper silently reaped ZERO volumes and stale
	// workspaces accumulated across runs (7 found) — the stale-state class behind the dschinn Docker errors.
	return new RegExp(`^${escapeRegExp(AGENT_SANDBOX_VOLUME_PREFIX)}-(?:[A-Za-z0-9_.-]+-)?\\d+$`).test(volumeName);
}

/**
 * True only for a container owned by the requested pool namespace. An omitted namespace deliberately matches only
 * the historical unnamespaced shape; it must never absorb a namespaced pool owned by another !Klein runtime.
 */
export function isAgentSandboxContainerNameForNamespace(containerName: string, namespace?: string): boolean {
	const normalizedNamespace = namespace?.trim();
	const namespacePart = normalizedNamespace ? `${escapeRegExp(normalizedNamespace)}-` : "";
	return new RegExp(`^${escapeRegExp(AGENT_SANDBOX_CONTAINER_PREFIX)}-${namespacePart}\\d+$`).test(containerName);
}

/** Namespace-exact counterpart of {@link isAgentSandboxWorkspaceVolumeName} for destructive orphan cleanup. */
export function isAgentSandboxWorkspaceVolumeNameForNamespace(volumeName: string, namespace?: string): boolean {
	const normalizedNamespace = namespace?.trim();
	const namespacePart = normalizedNamespace ? `${escapeRegExp(normalizedNamespace)}-` : "";
	return new RegExp(`^${escapeRegExp(AGENT_SANDBOX_VOLUME_PREFIX)}-${namespacePart}\\d+$`).test(volumeName);
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
