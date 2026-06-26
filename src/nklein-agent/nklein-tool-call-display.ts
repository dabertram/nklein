export interface NKleinToolCallDisplay {
	toolName: string;
	inputSummary: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatArraySummary(values: unknown[]): string | null {
	if (values.length === 0) {
		return null;
	}
	const first = String(values[0]).split("\n")[0]?.trim();
	if (!first) {
		return null;
	}
	return values.length > 1 ? `${first} (+${values.length - 1} more)` : first;
}

function formatArrayList(values: unknown[]): string | null {
	const items = values
		.map((value) => String(value).split("\n")[0]?.trim())
		.filter((value): value is string => Boolean(value));

	if (items.length === 0) {
		return null;
	}

	return items.join(", ");
}

function normalizeToolName(toolName: string): string {
	return toolName.toLowerCase().replace(/[^a-z]/g, "");
}

function normalizeDisplayToolName(toolName: string | null | undefined): string {
	if (typeof toolName !== "string") {
		return "unknown";
	}
	const trimmed = toolName.trim();
	return trimmed.length > 0 ? trimmed : "unknown";
}

function summarizeStringInput(input: string): string | null {
	const firstLine = input.split("\n").find((line) => line.trim().length > 0);
	return firstLine ? firstLine.trim().slice(0, 120) : null;
}

function appendReadFileSummary(summaries: string[], value: unknown): void {
	if (typeof value === "string") {
		const trimmed = value.trim();
		if (trimmed.length > 0) {
			summaries.push(trimmed);
		}
		return;
	}

	if (!isRecord(value)) {
		return;
	}

	const path =
		typeof value.path === "string"
			? value.path.trim()
			: typeof value.file_path === "string"
				? value.file_path.trim()
				: typeof value.filePath === "string"
					? value.filePath.trim()
					: "";
	if (path.length === 0) {
		return;
	}

	const startLine = Number.isInteger(value.start_line) ? Number(value.start_line) : null;
	const endLine = Number.isInteger(value.end_line) ? Number(value.end_line) : null;

	if (startLine === null && endLine === null) {
		summaries.push(path);
		return;
	}

	const start = startLine ?? 1;
	const end = endLine ?? "EOF";
	summaries.push(`${path}:${start}-${end}`);
}

function extractReadFileSummaries(input: unknown): string[] {
	const summaries: string[] = [];

	if (typeof input === "string") {
		appendReadFileSummary(summaries, input);
		return Array.from(new Set(summaries));
	}

	if (Array.isArray(input)) {
		for (const value of input) {
			appendReadFileSummary(summaries, value);
		}
		return Array.from(new Set(summaries));
	}

	if (!isRecord(input)) {
		return summaries;
	}

	appendReadFileSummary(summaries, input);

	const filePaths = input.file_paths;
	if (typeof filePaths === "string") {
		appendReadFileSummary(summaries, filePaths);
	} else if (Array.isArray(filePaths)) {
		for (const value of filePaths) {
			appendReadFileSummary(summaries, value);
		}
	}

	const files = input.files;
	if (Array.isArray(files)) {
		for (const value of files) {
			appendReadFileSummary(summaries, value);
		}
	} else if (files !== undefined) {
		appendReadFileSummary(summaries, files);
	}

	return Array.from(new Set(summaries));
}

function readNumber(value: unknown): number | null {
	return Number.isInteger(value) ? Number(value) : null;
}

function readPath(record: Record<string, unknown>): string {
	return typeof record.path === "string"
		? record.path.trim()
		: typeof record.file_path === "string"
			? record.file_path.trim()
			: typeof record.filePath === "string"
				? record.filePath.trim()
				: "";
}

function summarizeReadLargeFileInput(input: unknown, output: unknown): string | null {
	if (!isRecord(input)) {
		return typeof input === "string" ? summarizeStringInput(input) : null;
	}

	const path = readPath(input);
	if (!path) {
		return null;
	}

	// Include the workflow cursor (`start` → `read:<line>:<n>` → `stitch:<l>/<r>:<n>`) so each *progressing*
	// call has a distinct summary. The repeated-tool-call guard fingerprints on this summary; the guard samples
	// `tool_call_start`, where there is no `output` yet, so without the cursor every advancing call through one
	// file collapses to an identical `path`-only fingerprint and the task is falsely paused as "repeated
	// read_large_file with the same input". A genuinely stuck replay of the *same* cursor still collides and is
	// caught. (The large-file workflow itself rejects stale cursors, so the cursor here is the right discriminator.)
	const cursor = typeof input.cursor === "string" ? input.cursor.trim() : "";
	const cursorSuffix = cursor ? ` @${cursor}` : "";

	if (!isRecord(output)) {
		return `${path}${cursorSuffix}`;
	}

	const startLine = readNumber(output.startLine) ?? readNumber(output.start_line);
	const endLine = readNumber(output.endLine) ?? readNumber(output.end_line);
	return startLine !== null && endLine !== null ? `${path}:${startLine}-${endLine}` : `${path}${cursorSuffix}`;
}

function parseToolPayload(input: unknown): unknown {
	if (typeof input !== "string") {
		return input;
	}

	try {
		return JSON.parse(input) as unknown;
	} catch {
		return input;
	}
}

/**
 * Maps an `nklein task <subcommand>` to a human-friendly display label.
 */
const KANBAN_SUBCOMMAND_LABELS: Record<string, string> = {
	create: "Creating task",
	link: "Linking tasks",
	unlink: "Unlinking tasks",
	trash: "Moving task to done",
	done: "Moving task to done",
	delete: "Deleting task",
	start: "Starting task",
	update: "Updating task",
	list: "Listing tasks",
};

/**
 * Detects whether a command string is an nklein task CLI invocation and returns
 * a friendly display override. The command may be prefixed with a full node
 * binary path (e.g. `'/opt/homebrew/.../node' '/opt/.../cli.js' task create ...`)
 * or a simple `nklein task create ...`. Legacy `kanban` invocations are still
 * recognized during the rename transition.
 */
function resolveKanbanCommandDisplay(command: string): NKleinToolCallDisplay | null {
	if (!/(?:nklein|kanban)/i.test(command)) {
		return null;
	}
	const taskSubcommandMatch = command.match(/\btask\s+(create|link|unlink|trash|done|delete|start|update|list)\b/);
	if (!taskSubcommandMatch?.[1]) {
		return null;
	}

	const subcommand = taskSubcommandMatch[1];
	const label = KANBAN_SUBCOMMAND_LABELS[subcommand];
	if (!label) {
		return null;
	}

	let inputSummary: string | null = null;

	if (subcommand === "create") {
		const promptMatch = command.match(/--prompt\s+(?:"([^"]*)"|'([^']*)'|(\S+))/);
		const prompt = promptMatch?.[1] ?? promptMatch?.[2] ?? promptMatch?.[3] ?? null;
		if (prompt) {
			inputSummary = prompt.length > 80 ? `${prompt.slice(0, 80)}…` : prompt;
		}
	} else if (subcommand === "link") {
		const taskIdMatch = command.match(/--task-id\s+(?:"([^"]*)"|'([^']*)'|(\S+))/);
		const linkedIdMatch = command.match(/--linked-task-id\s+(?:"([^"]*)"|'([^']*)'|(\S+))/);
		const taskId = taskIdMatch?.[1] ?? taskIdMatch?.[2] ?? taskIdMatch?.[3] ?? null;
		const linkedId = linkedIdMatch?.[1] ?? linkedIdMatch?.[2] ?? linkedIdMatch?.[3] ?? null;
		if (taskId && linkedId) {
			inputSummary = `${shortId(taskId)} → ${shortId(linkedId)}`;
		}
	} else if (subcommand === "unlink") {
		const depIdMatch = command.match(/--dependency-id\s+(?:"([^"]*)"|'([^']*)'|(\S+))/);
		const depId = depIdMatch?.[1] ?? depIdMatch?.[2] ?? depIdMatch?.[3] ?? null;
		if (depId) {
			inputSummary = shortId(depId);
		}
	} else if (subcommand === "list") {
		const columnMatch = command.match(/--column\s+(?:"([^"]*)"|'([^']*)'|(\S+))/);
		const column = columnMatch?.[1] ?? columnMatch?.[2] ?? columnMatch?.[3] ?? null;
		if (column) {
			inputSummary = column;
		}
	} else {
		// trash, delete, start, update — show the task ID or column
		const taskIdMatch = command.match(/--task-id\s+(?:"([^"]*)"|'([^']*)'|(\S+))/);
		const taskId = taskIdMatch?.[1] ?? taskIdMatch?.[2] ?? taskIdMatch?.[3] ?? null;
		if (taskId) {
			inputSummary = shortId(taskId);
		} else {
			const columnMatch = command.match(/--column\s+(?:"([^"]*)"|'([^']*)'|(\S+))/);
			const column = columnMatch?.[1] ?? columnMatch?.[2] ?? columnMatch?.[3] ?? null;
			if (column) {
				inputSummary = column;
			}
		}
	}

	return { toolName: label, inputSummary };
}

/** Truncate a UUID-style ID to its first 6 characters for display. */
function shortId(id: string): string {
	const trimmed = id.trim();
	return trimmed.length > 6 ? trimmed.slice(0, 6) : trimmed;
}

/**
 * `decompose_project` is a stateful planning *workflow*, not a one-shot call: when it reports an open
 * clarifying question, the model re-calls it with that question resolved (assumption/answer), which often
 * surfaces the next one — legitimate progress, not a stuck loop. Summarizing by `slug` alone made every
 * iteration look identical, so the repeated-identical-tool-call guard falsely paused a decomposition that was
 * actually advancing (and even one that had just applied — the "paused yet completed" symptom). Encode the
 * task/question counts so each progress step gets a distinct summary (⇒ distinct guard fingerprint) while a
 * genuinely unchanged resubmission still trips the guard. Argument-less calls return `null` so the dedicated
 * empty-decompose diagnostic still applies.
 */
function summarizeDecomposeProjectInput(record: Record<string, unknown>): string | null {
	const slug = typeof record.slug === "string" ? record.slug.trim() : "";
	const tasks = Array.isArray(record.tasks) ? record.tasks.length : 0;
	const questions = Array.isArray(record.questions) ? record.questions : [];
	if (!slug && tasks === 0 && questions.length === 0) {
		return null;
	}
	const openQuestions = questions.filter(
		(question) =>
			isRecord(question) &&
			String(question.status ?? "open")
				.trim()
				.toLowerCase() === "open",
	).length;
	const parts = [slug || "(no slug)", `${tasks} task${tasks === 1 ? "" : "s"}`];
	if (questions.length > 0) {
		parts.push(
			`${questions.length} question${questions.length === 1 ? "" : "s"}${openQuestions > 0 ? `, ${openQuestions} open` : ""}`,
		);
	}
	return parts.join(" · ");
}

function summarizeParsedToolInput(toolName: string, input: unknown, output?: unknown): string | null {
	if (input === null || input === undefined) {
		return null;
	}

	const normalizedToolName = normalizeToolName(toolName);

	if (normalizedToolName === "readlargefile") {
		return summarizeReadLargeFileInput(input, output);
	}

	if (normalizedToolName === "readfiles") {
		const readFileSummaries = extractReadFileSummaries(input);
		return readFileSummaries.length > 0 ? formatArrayList(readFileSummaries) : null;
	}

	if (isRecord(input)) {
		const record = input;

		switch (normalizedToolName) {
			case "decomposeproject": {
				const decomposeSummary = summarizeDecomposeProjectInput(record);
				if (decomposeSummary !== null) {
					return decomposeSummary;
				}
				break;
			}
			case "runcommands": {
				if (Array.isArray(record.commands)) {
					return formatArraySummary(record.commands);
				}
				break;
			}
			case "searchcodebase": {
				if (Array.isArray(record.queries)) {
					return formatArraySummary(record.queries);
				}
				break;
			}
			case "editor": {
				const path = record.path;
				const command = record.command;
				if (typeof path === "string") {
					return typeof command === "string" ? `${command} ${path}` : path;
				}
				break;
			}
			case "fetchwebcontent": {
				if (Array.isArray(record.requests) && record.requests.length > 0) {
					const first = record.requests[0];
					if (typeof first === "object" && first !== null && "url" in first) {
						const url = String((first as Record<string, unknown>).url);
						return record.requests.length > 1 ? `${url} (+${record.requests.length - 1} more)` : url;
					}
				}
				break;
			}
			case "skills": {
				if (typeof record.skill === "string") {
					return record.skill;
				}
				break;
			}
			case "askquestion": {
				if (typeof record.question === "string") {
					return record.question.split("\n")[0] ?? null;
				}
				break;
			}
		}

		for (const value of Object.values(record)) {
			if (typeof value === "string" && value.trim().length > 0) {
				return value.trim().split("\n")[0]?.slice(0, 120) ?? null;
			}
			if (Array.isArray(value) && value.length > 0 && typeof value[0] === "string") {
				return formatArraySummary(value);
			}
		}
	}

	if (typeof input === "string") {
		return summarizeStringInput(input);
	}

	return null;
}

/**
 * Resolves an nklein-friendly display from run_commands input when the command
 * is an nklein task CLI invocation. Returns null for non-nklein commands.
 */
function resolveKanbanRunCommandDisplay(input: unknown): NKleinToolCallDisplay | null {
	if (!isRecord(input)) {
		return null;
	}
	const commands = input.commands;
	if (!Array.isArray(commands) || commands.length === 0) {
		return null;
	}
	for (const cmd of commands) {
		const display = resolveKanbanCommandDisplay(String(cmd));
		if (display) {
			return display;
		}
	}
	return null;
}

export function getNKleinToolCallDisplay(
	toolName: string | null | undefined,
	input: unknown,
	output?: unknown,
): NKleinToolCallDisplay {
	const normalizedToolName = normalizeDisplayToolName(toolName);
	const parsedInput = parseToolPayload(input);
	const parsedOutput = parseToolPayload(output);

	if (normalizeToolName(normalizedToolName) === "runcommands") {
		const kanbanDisplay = resolveKanbanRunCommandDisplay(parsedInput);
		if (kanbanDisplay) {
			return kanbanDisplay;
		}
	}

	return {
		toolName: normalizedToolName,
		inputSummary: summarizeParsedToolInput(normalizedToolName, parsedInput, parsedOutput),
	};
}

export function formatNKleinToolCallLabel(
	toolName: string | null | undefined,
	inputSummary: string | null | undefined,
): string {
	const normalizedToolName = normalizeDisplayToolName(toolName);
	const normalizedInputSummary = typeof inputSummary === "string" ? inputSummary.trim() : "";
	return normalizedInputSummary ? `${normalizedToolName}(${normalizedInputSummary})` : normalizedToolName;
}
