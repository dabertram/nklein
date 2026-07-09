// !Klein §5.BD tool-NAME aliasing (2026-07-03). Small models frequently call a tool by a near-miss name — the
// evidenced case (run42) is `read_file` for `read_files`, but singular/plural, camelCase, and common synonyms all
// recur. Without help these surface as an AI-SDK `NoSuchToolError` "unavailable tool" pre-rejection that the model
// then loops on until the mistake guard abandons the session. This pure resolver maps a requested name to a REAL
// tool — but ONLY ever returns a name that is actually in the available set, so it can never invent a tool or
// mis-route to one that doesn't exist. Fed by the provider's `experimental_repairToolCall` hook (see ai-sdk.ts).

/** Normalize a tool name for fuzzy matching: lowercase, strip everything but [a-z0-9] (so read_files == readFiles == "Read Files"). */
function normalizeToolName(name: string): string {
	return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * LM Studio can occasionally leak Mistral/Devstral transcript text into the parsed tool name itself, e.g.
 * `<prior tool result>[TOOL_CALLS]read_files` with a correct input object. Recover only the explicit marker suffix and
 * only when that suffix resolves to an actually offered tool.
 */
function extractMarkedToolNameSuffix(name: string): string | null {
	const match = name.match(/\[(?:TOOL_CALLS?|FUNCTION_CALL|TOOL_REQUEST)\]\s*([A-Za-z_][A-Za-z0-9_.-]*)\s*$/i);
	return match?.[1] ?? null;
}

/**
 * Conservative synonym map (normalized keys → canonical tool name). Every target is gated by the available set
 * below, so an entry is inert unless that tool is actually offered — a wrong entry can only ever redirect a call
 * that would OTHERWISE have been rejected, never break a working one. Kept to high-confidence, unambiguous
 * mistakes; the plural/normalization rules cover the rest.
 */
const SYNONYM_TO_CANONICAL: Readonly<Record<string, string>> = {
	// file reads
	readfile: "read_files",
	read: "read_files",
	catfile: "read_files",
	cat: "read_files",
	openfile: "read_files",
	viewfile: "read_files",
	// file listing
	listdir: "list_files",
	listdirectory: "list_files",
	listfile: "list_files",
	ls: "list_files",
	dir: "list_files",
	// search
	searchfiles: "search_codebase",
	searchcode: "search_codebase",
	search: "search_codebase",
	grep: "search_codebase",
	ripgrep: "search_codebase",
	// shell
	runcommand: "run_commands",
	bash: "run_commands",
	shell: "run_commands",
	sh: "run_commands",
	executecommand: "run_commands",
	runterminalcmd: "run_commands",
	terminal: "run_commands",
	// web fetch
	fetchurl: "fetch_web_content",
	fetch: "fetch_web_content",
	browseurl: "fetch_web_content",
	webfetch: "fetch_web_content",
	openurl: "fetch_web_content",
	// patch
	applydiff: "apply_patch",
	patch: "apply_patch",
	// file edits
	editfiles: "edit_file",
	writetofile: "write_file",
};

/**
 * Resolve a requested (unavailable) tool name to a REAL available one, or null when there's no confident match.
 * Order: exact-normalized match (case/underscore/camelCase variants) → curated synonym → singular↔plural. Never
 * returns a name outside `availableNames`.
 */
export function resolveToolNameAlias(requested: string, availableNames: readonly string[]): string | null {
	const trimmed = requested.trim();
	if (trimmed.length === 0 || availableNames.length === 0) {
		return null;
	}
	// If it's already an exact available name, there's nothing to alias (defensive — repair fires only on failure).
	if (availableNames.includes(trimmed)) {
		return null;
	}

	const normalizedToCanonical = new Map<string, string>();
	for (const name of availableNames) {
		// First writer wins so the map is deterministic if two available names normalize identically (unlikely).
		const key = normalizeToolName(name);
		if (!normalizedToCanonical.has(key)) {
			normalizedToCanonical.set(key, name);
		}
	}

	const markedSuffix = extractMarkedToolNameSuffix(trimmed);
	if (markedSuffix) {
		const suffixMatch = normalizedToCanonical.get(normalizeToolName(markedSuffix));
		if (suffixMatch) {
			return suffixMatch;
		}
	}

	const requestedKey = normalizeToolName(trimmed);
	if (requestedKey.length === 0) {
		return null;
	}

	// 1) A pure formatting variant of a real tool (readFiles / Read_Files / "read files" → read_files).
	const exact = normalizedToCanonical.get(requestedKey);
	if (exact) {
		return exact;
	}

	// 2) A curated synonym, gated on the canonical tool actually being available.
	const synonym = SYNONYM_TO_CANONICAL[requestedKey];
	if (synonym && availableNames.includes(synonym)) {
		return synonym;
	}

	// 3) Singular↔plural (read_file↔read_files, run_command↔run_commands) — the dominant evidenced class.
	const plural = normalizedToCanonical.get(`${requestedKey}s`);
	if (plural) {
		return plural;
	}
	if (requestedKey.endsWith("s")) {
		const singular = normalizedToCanonical.get(requestedKey.slice(0, -1));
		if (singular) {
			return singular;
		}
	}

	return null;
}
