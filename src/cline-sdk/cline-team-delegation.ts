import { sanitizeTeamName } from "@clinebot/core";
import type { RuntimeTaskSessionMode } from "../core/api-contract";

export interface ClineTeamDelegationPolicyInput {
	taskId: string;
	mode: RuntimeTaskSessionMode;
	env?: NodeJS.ProcessEnv;
}

export interface ClineTeamDelegationPolicy {
	enabled: boolean;
	teamName?: string;
	reason: string;
}

function isTruthyEnv(value: string | undefined): boolean {
	return value === "1" || value?.toLowerCase() === "true";
}

export function resolveClineTeamDelegationPolicy(input: ClineTeamDelegationPolicyInput): ClineTeamDelegationPolicy {
	const env = input.env ?? process.env;
	if (!isTruthyEnv(env.KANBAN_ENABLE_CLINE_TEAMS)) {
		return {
			enabled: false,
			reason: "SDK team delegation disabled; set KANBAN_ENABLE_CLINE_TEAMS=1 to expose native team tools.",
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
