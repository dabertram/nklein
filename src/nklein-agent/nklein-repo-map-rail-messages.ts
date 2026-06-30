// Repo-map "rail" message helpers (extracted from nklein-session-runtime.ts, §5.U). Before each model call the
// session runtime injects a synthetic user message carrying the personalized repo map; these helpers build that
// rail message and derive the personalization text from the conversation so far. Kept pure + focused so the
// content-shape text extraction (AgentMessage content can be a string or an array of typed parts) is testable.
import type { AgentMessage } from "./sdk-agent-types";

/** Metadata kind stamped on the injected repo-map rail message (and matched to detect/skip it). */
export const REPO_MAP_RAIL_MESSAGE_KIND = "kanban_repo_map_rail";

/** Cap the personalization text fed to the repo-map ranker so a long history can't blow the budget. */
const REPO_MAP_PERSONALIZATION_MAX_CHARS = 12_000;

export function createRepoMapRailMessage(text: string): AgentMessage {
	return {
		id: `kanban-repo-map-rail-${Date.now()}`,
		role: "user",
		content: [{ type: "text", text }],
		createdAt: Date.now(),
		metadata: {
			kind: REPO_MAP_RAIL_MESSAGE_KIND,
		},
	};
}

function readAgentMessageText(message: AgentMessage): string {
	const content = message.content;
	if (typeof content === "string") {
		return content;
	}
	if (!Array.isArray(content)) {
		return "";
	}
	return content
		.map((part) => {
			if (!part || typeof part !== "object" || !("text" in part)) {
				return "";
			}
			const text = part.text;
			return typeof text === "string" ? text : "";
		})
		.filter(Boolean)
		.join("\n");
}

export function collectRepoMapPersonalizationText(messages: readonly AgentMessage[]): string {
	const text = messages
		.filter((message) => message.metadata?.kind !== REPO_MAP_RAIL_MESSAGE_KIND)
		.map(readAgentMessageText)
		.filter(Boolean)
		.join("\n\n");
	return text.length > REPO_MAP_PERSONALIZATION_MAX_CHARS ? text.slice(-REPO_MAP_PERSONALIZATION_MAX_CHARS) : text;
}
