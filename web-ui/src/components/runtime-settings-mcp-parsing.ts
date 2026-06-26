import type { RuntimeNKleinMcpServer } from "@/runtime/types";

/**
 * MCP-suggestion parsing for the Settings dialog's NKlein advisor (the "Find MCP plugins" action), extracted from
 * the oversized `runtime-settings-dialog.tsx` (§5.X #2 / anti-patterns #2). Pure, self-contained: it parses a model's
 * suggested-MCP-servers JSON into validated, https-only, de-duplicated addable server suggestions. No React/state.
 */

export interface ParsedMcpSuggestion {
	server: RuntimeNKleinMcpServer;
	label: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function stringField(record: Record<string, unknown>, key: string): string {
	const value = record[key];
	return typeof value === "string" ? value.trim() : "";
}

function parseAddableMcpServer(value: unknown): ParsedMcpSuggestion | null {
	const record = asRecord(value);
	if (!record) {
		return null;
	}
	const name = stringField(record, "name");
	const type = stringField(record, "type") || "streamableHttp";
	const url = stringField(record, "url");
	if (!name || !url || (type !== "streamableHttp" && type !== "sse")) {
		return null;
	}
	let parsedUrl: URL;
	try {
		parsedUrl = new URL(url);
	} catch {
		return null;
	}
	if (parsedUrl.protocol !== "https:") {
		return null;
	}
	return {
		label: stringField(record, "title") || stringField(record, "label") || name,
		server: {
			name,
			disabled: false,
			type,
			url: parsedUrl.toString(),
		},
	};
}

export function parseMcpSuggestionText(text: string): ParsedMcpSuggestion[] {
	const trimmed = text.trim();
	if (!trimmed) {
		return [];
	}
	const parsed: unknown = JSON.parse(trimmed);
	const record = asRecord(parsed);
	const candidates = Array.isArray(parsed)
		? parsed
		: Array.isArray(record?.mcpServers)
			? record.mcpServers
			: Array.isArray(record?.servers)
				? record.servers
				: [parsed];
	const suggestions = candidates
		.map((candidate) => parseAddableMcpServer(candidate))
		.filter((candidate): candidate is ParsedMcpSuggestion => candidate !== null);
	const seen = new Set<string>();
	return suggestions.filter((suggestion) => {
		const key = suggestion.server.name.trim().toLowerCase();
		if (seen.has(key)) {
			return false;
		}
		seen.add(key);
		return true;
	});
}
