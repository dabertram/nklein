/**
 * F12.31 MCP hardening — tool-SURFACE pinning + server allowlist. PURE core.
 *
 * The 2026 MCP consensus names two attacks the existing S7 pin does not yet cover:
 *  - TOOL POISONING: malicious instructions hidden in a tool's DESCRIPTION (the model reads descriptions as
 *    guidance, so a description is executable text in every way that matters), and
 *  - RUG-PULL: a clean tool swapped for a malicious one AFTER approval, often at the same version.
 *
 * The single control that actually stops both is to hash what the model will READ — names AND descriptions AND
 * input schemas — at first approval, then compare on every later resolution. That comparison already exists:
 * {@link ./skill-pin-drift.ts} `detectPinDrift` classifies (pinned, current) pairs and flags the same-version
 * content change as a rug-pull. This module supplies the missing half — a stable fingerprint of an MCP server's
 * tool surface — plus a name/version allowlist gate, and deliberately does NOT re-implement drift logic.
 *
 * Honesty stance: the fingerprint covers exactly what the model sees. A change the model cannot observe must not
 * raise a false alarm, and any change it CAN observe must not pass silently.
 */

import { canonicalJson, contentHash } from "./content-addressable-cache";

export interface McpToolDescriptor {
	readonly name: string;
	/** The description the MODEL reads — the tool-poisoning surface. */
	readonly description?: string | null;
	/** The input schema the model is shown; a widened/altered schema is also an observable change. */
	readonly inputSchema?: unknown;
}

/**
 * Fingerprint an MCP server's tool surface. Order-INSENSITIVE (servers may enumerate tools in any order, and a
 * reordering is not a change the model can act on) but sensitive to every name, description and schema — the
 * three things that actually reach the model's context.
 */
export function computeToolSurfaceHash(tools: readonly McpToolDescriptor[]): string {
	const normalized = tools
		.map((tool) => ({
			name: tool.name.trim(),
			description: (tool.description ?? "").trim(),
			inputSchema: tool.inputSchema ?? null,
		}))
		.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
	return contentHash(canonicalJson(normalized));
}

export interface McpAllowlistEntry {
	readonly serverName: string;
	/** Permitted version, or null to allow any version of this server. */
	readonly version?: string | null;
}

export type McpAllowlistVerdict = "allowed" | "denied_unlisted" | "denied_version";

export interface McpAllowlistResult {
	readonly verdict: McpAllowlistVerdict;
	readonly allowed: boolean;
	readonly reason: string;
}

/**
 * Gate a server against the operator's allowlist. FAIL-CLOSED by construction: an empty allowlist denies
 * everything rather than defaulting to permissive, because "no policy configured" must not read as "everything
 * is approved" on a supply-chain control.
 */
export function checkMcpAllowlist(input: {
	readonly serverName: string;
	readonly version?: string | null;
	readonly allowlist: readonly McpAllowlistEntry[];
}): McpAllowlistResult {
	const name = input.serverName.trim();
	const matches = input.allowlist.filter((entry) => entry.serverName.trim() === name);
	if (matches.length === 0) {
		return {
			verdict: "denied_unlisted",
			allowed: false,
			reason:
				input.allowlist.length === 0
					? `no MCP allowlist configured — "${name}" denied (an unset policy is not an approval)`
					: `"${name}" is not on the MCP allowlist`,
		};
	}
	// A null pinned version means "any version of this server".
	if (matches.some((entry) => (entry.version ?? null) === null)) {
		return { verdict: "allowed", allowed: true, reason: `"${name}" is allowlisted (any version)` };
	}
	const current = (input.version ?? "").trim();
	if (matches.some((entry) => (entry.version ?? "").trim() === current && current.length > 0)) {
		return { verdict: "allowed", allowed: true, reason: `"${name}" ${current} is allowlisted` };
	}
	return {
		verdict: "denied_version",
		allowed: false,
		reason: `"${name}" is allowlisted, but version ${current || "(unknown)"} is not — approve the new version explicitly`,
	};
}

export interface ToolSurfaceReviewInput {
	readonly serverName: string;
	readonly version?: string | null;
	readonly tools: readonly McpToolDescriptor[];
	readonly allowlist: readonly McpAllowlistEntry[];
	/** The surface hash captured at first approval, or null when this server was never approved. */
	readonly pinnedSurfaceHash: string | null;
}

export interface ToolSurfaceReview {
	readonly currentSurfaceHash: string;
	readonly allowlist: McpAllowlistResult;
	/** True when the surface the model reads changed since approval — descriptions included. */
	readonly surfaceChanged: boolean;
	/** True when this server has never been pinned (trust-on-first-use: review once, then pin). */
	readonly firstUse: boolean;
	/** The operator must act before these tools are offered. */
	readonly requiresApproval: boolean;
	readonly reason: string;
}

/**
 * Combine the allowlist gate with surface-change detection into one pre-offer verdict. Approval is required on
 * first use, on any surface change, and on any allowlist denial — the caller withholds the server's tools until
 * the operator confirms. Pair with `detectPinDrift` when a version is available to distinguish a rug-pull from
 * an ordinary upgrade.
 */
export function reviewToolSurface(input: ToolSurfaceReviewInput): ToolSurfaceReview {
	const currentSurfaceHash = computeToolSurfaceHash(input.tools);
	const allowlist = checkMcpAllowlist({
		serverName: input.serverName,
		version: input.version ?? null,
		allowlist: input.allowlist,
	});
	const firstUse = input.pinnedSurfaceHash === null;
	const surfaceChanged = !firstUse && input.pinnedSurfaceHash !== currentSurfaceHash;
	const requiresApproval = !allowlist.allowed || firstUse || surfaceChanged;
	const reason = !allowlist.allowed
		? allowlist.reason
		: firstUse
			? `first use of "${input.serverName}" — review its tool descriptions once, then pin`
			: surfaceChanged
				? `the tool surface of "${input.serverName}" CHANGED since approval (names/descriptions/schemas) — re-review before offering it again`
				: `"${input.serverName}" matches its pinned tool surface`;
	return { currentSurfaceHash, allowlist, surfaceChanged, firstUse, requiresApproval, reason };
}
