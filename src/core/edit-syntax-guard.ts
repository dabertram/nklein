/**
 * F12.63 post-edit syntax guard — PURE core.
 *
 * Edit application is the #1 weak-model bottleneck, and the worst failure is the SILENT one: a fuzzy-applied edit
 * that leaves the file syntactically broken (unclosed brace/string) lands, and the breakage surfaces two tool calls
 * later as a confusing compile error. SWE-agent's ACI showed the fix: a cheap syntax sanity check that REJECTS the
 * broken edit immediately, while the model still has the context to repair it. This guard is deliberately
 * CONSERVATIVE — JSON gets a real parse; code files get a string/comment-aware bracket-balance scan (only NET
 * imbalance flags, so exotic-but-valid code never false-positives into a rejected edit); everything else passes.
 */

export interface EditSyntaxVerdict {
	readonly ok: boolean;
	/** Human/model-facing issue when not ok ("unclosed { opened at line 12"). */
	readonly issue: string | null;
}

const CODE_EXTENSIONS = /\.(ts|tsx|js|jsx|mjs|cjs|json|css|scss|go|rs|java|c|h|cpp|hpp|py)$/i;

/** Scan code with a tiny state machine (strings/comments skipped) and report NET bracket imbalance. */
function scanBracketBalance(content: string, path: string): EditSyntaxVerdict {
	const python = /\.py$/i.test(path);
	const stack: { char: string; line: number }[] = [];
	const pairs: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
	let line = 1;
	let state: "code" | "line_comment" | "block_comment" | "single" | "double" | "template" = "code";
	for (let index = 0; index < content.length; index += 1) {
		const char = content[index] as string;
		const next = content[index + 1] ?? "";
		if (char === "\n") {
			line += 1;
			if (state === "line_comment") {
				state = "code";
			} else if ((state === "single" || state === "double") && !python) {
				// Review-found: a raw newline inside a JS-family single/double-quoted string is ALWAYS a syntax
				// error (a `\`-continuation was already consumed by the escape branch) — the old code silently
				// "recovered" to code state and passed broken files. Templates legitimately span lines.
				return {
					ok: false,
					issue: `Unterminated string literal at line ${line - 1} — the edit likely broke the file.`,
				};
			}
			continue;
		}
		if (state === "line_comment") {
			continue;
		}
		if (state === "block_comment") {
			if (char === "*" && next === "/") {
				state = "code";
				index += 1;
			}
			continue;
		}
		if (state === "single" || state === "double" || state === "template") {
			if (char === "\\") {
				index += 1;
			} else if (
				(state === "single" && char === "'") ||
				(state === "double" && char === '"') ||
				(state === "template" && char === "`")
			) {
				state = "code";
			}
			continue;
		}
		// state === "code"
		if (char === "/" && next === "/" && !python) {
			state = "line_comment";
			index += 1;
		} else if (char === "#" && python) {
			state = "line_comment";
		} else if (char === "/" && next === "*" && !python) {
			state = "block_comment";
			index += 1;
		} else if (char === "'") {
			state = "single";
		} else if (char === '"') {
			state = "double";
		} else if (char === "`" && !python) {
			state = "template";
		} else if (char === "(" || char === "[" || char === "{") {
			stack.push({ char, line });
		} else if (char === ")" || char === "]" || char === "}") {
			const open = stack.at(-1);
			if (open && open.char === pairs[char]) {
				stack.pop();
			} else {
				return { ok: false, issue: `Unmatched \`${char}\` at line ${line} — the edit likely broke the file.` };
			}
		}
	}
	const dangling = stack.at(-1);
	if (dangling) {
		return {
			ok: false,
			issue: `Unclosed \`${dangling.char}\` opened at line ${dangling.line} — the edit likely broke the file.`,
		};
	}
	if (state === "template") {
		return { ok: false, issue: "Unclosed template literal (`) — the edit likely broke the file." };
	}
	// Review-found: EOF inside a single/double-quoted string was silently accepted (only templates were checked).
	if (state === "single" || state === "double") {
		return { ok: false, issue: "Unterminated string literal at end of file — the edit likely broke the file." };
	}
	return { ok: true, issue: null };
}

/** Check post-edit content for gross syntax breakage. Non-code extensions always pass (never over-guard). */
export function checkEditSyntax(path: string, content: string): EditSyntaxVerdict {
	if (/\.json$/i.test(path)) {
		try {
			JSON.parse(content);
			return { ok: true, issue: null };
		} catch (error) {
			return {
				ok: false,
				issue: `JSON no longer parses: ${error instanceof Error ? error.message : String(error)}`,
			};
		}
	}
	if (!CODE_EXTENSIONS.test(path)) {
		return { ok: true, issue: null };
	}
	return scanBracketBalance(content, path);
}
