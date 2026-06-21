import { sanitizeTeamName } from "@nklein/core";
import type { RuntimeTaskSessionMode } from "../core/api-contract";
import { CLOUD_ENABLED } from "./nklein-local-only-policy";

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

function isTruthyEnv(value: string | undefined): boolean {
	return value === "1" || value?.toLowerCase() === "true";
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
