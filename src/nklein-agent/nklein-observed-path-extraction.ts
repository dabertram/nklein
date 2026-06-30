// Pure file-path extraction from conversation text (extracted from nklein-context-focus-policy.ts, §5.U). The
// focus policy mines an agent's transcript for the files it has actually observed (to keep them in context) and
// the files it reported as missing (ENOENT and friends). These helpers do the text-level work: strip the
// injected focus-brief block, then regex out path-looking tokens, de-duplicating and dropping globs.

// The injected "[!Klein context focus brief] … [/!Klein context focus brief]" block, removed before path mining
// so the brief's own example paths aren't mistaken for observed files.
const FOCUS_BRIEF_PATTERN = /\[!Klein context focus brief\][\s\S]*?\[\/!Klein context focus brief\]\n*/g;

/** Push `value` (trimmed) onto `values` if it is non-empty and not already present. */
export function addUniqueValue(values: string[], value: string): void {
	const normalized = value.trim();
	if (!normalized || values.includes(normalized)) {
		return;
	}
	values.push(normalized);
}

/** Remove the injected context-focus-brief block from text (and the leading whitespace it left behind). */
export function stripFocusBrief(text: string): string {
	return text.replace(FOCUS_BRIEF_PATTERN, "").trimStart();
}

/** Extract distinct file-looking paths (known source/text extensions, absolute or ~-rooted, non-glob) from text. */
export function extractObservedPathsFromText(text: string): string[] {
	const paths: string[] = [];
	const textWithoutFocusBrief = stripFocusBrief(text);
	const pathPattern = /(?:~|\/)[^\s"'`<>]+\.(?:txt|md|json|jsonl|yaml|yml|csv|ts|tsx|js|jsx|py|sh|log)/g;
	for (const match of textWithoutFocusBrief.matchAll(pathPattern)) {
		const path = match[0]?.replace(/[),.;:]+$/, "") ?? "";
		if (path.includes("*")) {
			continue;
		}
		addUniqueValue(paths, path);
	}
	return paths;
}

/** Extract paths from text only when it carries a missing-file signal (ENOENT / "no such file" / "not found"). */
export function extractMissingFilePathsFromText(text: string): string[] {
	if (!/\bENOENT\b|no such file or directory|cannot find|not found/i.test(text)) {
		return [];
	}
	return extractObservedPathsFromText(text);
}
