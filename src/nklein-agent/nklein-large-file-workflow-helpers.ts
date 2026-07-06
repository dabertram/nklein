import type { AgentMessage, AgentToolDefinition } from "./sdk-agent-types";

/**
 * §5.U — the pure, stateless helpers of the large-file read workflow, extracted from `nklein-large-file-workflow`:
 * a filesystem-safe session-dir segment, a tool allow-list filter, the "did the model actually synthesize text (not just
 * call a tool)?" predicate, the model-facing output header, and the rail message builder. No IO / no workflow state — so
 * the read-workflow's message + gating rules are independently testable.
 */

/** Make a value safe as a path segment (non `[A-Za-z0-9._-]` → `_`); empty ⇒ `"session"`. */
export function sanitizePathSegment(value: string): string {
	const normalized = value.replace(/[^a-zA-Z0-9._-]/g, "_");
	return normalized || "session";
}

/** Keep only the tools whose name is in the allow-list. */
export function filterToolsByName(
	tools: readonly AgentToolDefinition[],
	allowedToolNames: ReadonlySet<string>,
): readonly AgentToolDefinition[] {
	return tools.filter((tool) => allowedToolNames.has(tool.name));
}

/** True when the message has real synthesized text and NO tool-call part (a tool-call short-circuits to false). */
export function hasSynthesisText(message: AgentMessage): boolean {
	let hasText = false;
	for (const part of message.content) {
		if (part.type === "tool-call") {
			return false;
		}
		if (part.type === "text" && part.text.trim().length > 0) {
			hasText = true;
		}
	}
	return hasText;
}

/** The model-facing section header for a read output (`### <kind> <path>:<start>-<end>`). */
export function formatOutputHeader(output: {
	kind: "primary" | "stitch";
	sourcePath: string;
	startLine: number;
	endLine: number;
}): string {
	return `### ${output.kind} ${output.sourcePath}:${output.startLine}-${output.endLine}`;
}

/** Build the synthetic "rail" user message that carries a large-file workflow step's text to the model. */
export function createRailMessage(text: string): AgentMessage {
	return {
		id: `kanban-large-file-rail-${Date.now()}`,
		role: "user",
		content: [{ type: "text", text }],
		createdAt: Date.now(),
		metadata: {
			kind: "kanban_large_file_rail",
		},
	};
}
