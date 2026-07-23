/** A host-side MCP server candidate that can be selected before any client connection is created. */
export interface McpServerRelevanceCandidate {
	id: string;
	name: string;
	/** Trusted host configuration describing when the server is useful. Blank legacy metadata fails open. */
	description?: string | null;
}

export interface McpServerRelevanceResult<T extends McpServerRelevanceCandidate> {
	selected: T[];
	withheld: T[];
	/** True means the task text could not justify a relevance decision, so every server was retained. */
	arbitrary: boolean;
	reason: string;
}

const STOP_WORDS = new Set([
	"a",
	"an",
	"and",
	"are",
	"as",
	"at",
	"be",
	"by",
	"for",
	"from",
	"in",
	"is",
	"it",
	"of",
	"on",
	"or",
	"that",
	"the",
	"this",
	"to",
	"with",
]);

function tokenize(value: string): Set<string> {
	return new Set(
		value
			.toLowerCase()
			.split(/[^a-z0-9]+/u)
			.map((token) => token.trim())
			.filter((token) => token.length >= 2 && !STOP_WORDS.has(token)),
	);
}

function intersects(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
	for (const token of left) {
		if (right.has(token)) return true;
	}
	return false;
}

/**
 * Select MCP servers before registration. Only servers with explicit trusted relevance metadata may be withheld.
 * Legacy/user configurations without that metadata remain selected: incomplete metadata is not permission to remove a
 * capability. If no described server matches the task, the whole decision abstains instead of dropping by ordering.
 */
export function preselectMcpServers<T extends McpServerRelevanceCandidate>(input: {
	servers: readonly T[];
	taskText?: string | null;
}): McpServerRelevanceResult<T> {
	const taskTokens = tokenize(input.taskText ?? "");
	if (input.servers.length === 0) {
		return { selected: [], withheld: [], arbitrary: false, reason: "no MCP servers were eligible before relevance" };
	}
	if (taskTokens.size === 0) {
		return {
			selected: [...input.servers],
			withheld: [],
			arbitrary: true,
			reason: "task text had no discriminating vocabulary; retained every MCP server",
		};
	}

	const unknown: T[] = [];
	const matching: T[] = [];
	const nonmatching: T[] = [];
	for (const server of input.servers) {
		const description = server.description?.trim() ?? "";
		if (!description) {
			unknown.push(server);
			continue;
		}
		const serverTokens = tokenize(`${server.name} ${description}`);
		if (intersects(taskTokens, serverTokens)) matching.push(server);
		else nonmatching.push(server);
	}

	if (matching.length === 0) {
		return {
			selected: [...input.servers],
			withheld: [],
			arbitrary: true,
			reason: "no described MCP server matched the task vocabulary; retained every server",
		};
	}

	const selectedIds = new Set([...unknown, ...matching].map((server) => server.id));
	return {
		selected: input.servers.filter((server) => selectedIds.has(server.id)),
		withheld: input.servers.filter((server) => !selectedIds.has(server.id)),
		arbitrary: false,
		reason: `preselected ${unknown.length + matching.length}/${input.servers.length} MCP server(s) before registration (${unknown.length} legacy metadata fail-open)`,
	};
}
