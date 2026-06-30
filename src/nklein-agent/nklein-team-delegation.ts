import type { RuntimeTaskSessionMode } from "../core/api-contract";
import { isTruthyEnv } from "../core/env-flag";
import { CLOUD_ENABLED } from "./nklein-local-only-policy";

/**
 * Slugify a team name. Ported from the Cline SDK's `sanitizeTeamName` (0.0.54 no longer re-exports
 * it from the public entry); kept byte-identical so delegated team names match SDK-internal naming.
 */
function sanitizeTeamName(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

export interface NKleinTeamDelegationPolicyInput {
	taskId: string;
	mode: RuntimeTaskSessionMode;
	env?: NodeJS.ProcessEnv;
}

export interface NKleinTeamDelegationPolicy {
	enabled: boolean;
	teamName?: string;
	reason: string;
}

export function resolveNKleinTeamDelegationPolicy(input: NKleinTeamDelegationPolicyInput): NKleinTeamDelegationPolicy {
	const env = input.env ?? process.env;
	if (!CLOUD_ENABLED) {
		return {
			enabled: false,
			reason: "SDK team delegation is parked while !Klein is in local-only mode.",
		};
	}
	if (!isTruthyEnv(env.KANBAN_ENABLE_NKLEIN_TEAMS)) {
		return {
			enabled: false,
			reason: "SDK team delegation disabled; set KANBAN_ENABLE_NKLEIN_TEAMS=1 to expose native team tools.",
		};
	}
	if (input.mode === "plan") {
		return {
			enabled: false,
			reason: "SDK team delegation disabled for read-only planning sessions.",
		};
	}
	const teamName = sanitizeTeamName(`kanban-${input.taskId}`);
	return {
		enabled: true,
		teamName,
		reason: "SDK team delegation enabled for this implementation session.",
	};
}
