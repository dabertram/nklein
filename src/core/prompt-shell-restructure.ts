/**
 * §5.AQ strategy (e) — BYTE-STABLE PROMPT SHELL restructure: string surgery on the SDK-built base system prompt that
 * moves everything task/day-volatile to the very END, so the remainder is byte-stable per model+workspace and local
 * prefix caches (llama.cpp / LM Studio / MLX — all exact-contiguous-token-prefix) can reuse it across session starts.
 *
 * THE PROBLEM this solves: the vendored SDK base prompt places an `<env>` block ~1700 bytes in containing the DATE
 * (daily-volatile) and the WORKING DIRECTORY (task-volatile — sandbox cwd is `/workspaces/<taskId>`), followed by
 * ~2000+ MORE bytes of static rules. One divergent byte re-prefills everything after it, so consecutive same-model
 * session starts measured only ~8% byte-prefix reuse (see docs/dev/prompt-cache-research-2026-07-02.md). The env
 * block's position is informational only — tools execute against the agent-core `config.cwd`, a separate field — so
 * the same information can safely live at the end instead.
 *
 * WHY STRING SURGERY (not a vendored-template edit): the runtime consumes the SDK from its prebuilt `dist` bundles,
 * so editing `vendor/cline-sdk/.../src/prompt/system.ts` would be dead code without a vendor rebuild. The vendor
 * builder also substitutes the date internally (`new Date().toLocaleDateString()` — no parameter), so a sentinel
 * date cannot be injected; surgery on the BUILT string is the only seam that sees the actual bytes. The `<env>`
 * block's line shape (`N. Date: …` / `N. Working Directory: …` between `<env>`/`</env>` lines) is stable across
 * both vendor templates (default + yolo), and the no-env fallback below keeps the function safe if it ever changes.
 *
 * WHAT IT DOES: (a) locate the first `<env>`…`</env>` block; (b) remove the Date and Working Directory LINES from it
 * (Platform/IDE stay — they are static), renumbering the surviving `N.` lines; (c) emit the removed facts as a
 * trailing `<session>` block meant to be appended at the VERY END of the assembled prompt. The `<session>` tag (not a
 * second `<env>`) keeps the two blocks distinguishable: `<env>` = static machine facts, `<session>` = per-task/per-day
 * facts. The extracted VALUES are preferred over the caller-provided fallbacks so the exact vendor-written bytes are
 * preserved (no date-format drift, no midnight race); the fallbacks only serve the no-env-block case. Models still
 * see cwd + date — just at the end.
 *
 * Pure + deterministic: no I/O, no clock (the fallback date is INJECTED). Single-application contract: apply once to
 * a freshly built base prompt — re-applying to the composed `text` would append a second trailer.
 */

/** The session facts destined for the trailing `<session>` block (fallbacks when no `<env>` line carries them). */
export interface PromptShellSessionFacts {
	/** The agent-perceived working directory (sandbox workdir for tasks, host cwd for home/chat sessions). */
	cwd: string;
	/** The date string as the base-prompt builder would render it (vendor uses `toLocaleDateString()`). */
	date: string;
}

export interface RestructuredPromptShell {
	/**
	 * The base prompt with the volatile env lines removed — byte-stable per model+workspace, safe to head-pin as the
	 * shared cache prefix.
	 */
	staticText: string;
	/** The extracted volatile trailer (`<session>` block) — task/daily-volatile, append LAST in the assembly. */
	sessionEnvText: string;
	/** `staticText` + the trailer — the full prompt for callers that do not run the fragment assembler. */
	text: string;
	/** True when an `<env>` Date/Working Directory line was actually found and moved. */
	envBlockEdited: boolean;
}

const ENV_OPEN_TAG = "<env>";
const ENV_CLOSE_TAG = "</env>";
const DATE_LINE_PATTERN = /^\s*(?:\d+\.\s*)?Date:\s*(.*?)\s*$/;
const CWD_LINE_PATTERN = /^\s*(?:\d+\.\s*)?Working Directory:\s*(.*?)\s*$/;
const NUMBERED_LINE_PATTERN = /^(\s*)\d+\.\s(.*)$/;

/**
 * Move the task/day-volatile Date + Working Directory lines out of the base prompt's `<env>` block into a trailing
 * `<session>` block, returning both halves so an assembler can keep the static shell first and the trailer LAST.
 * A prompt without a well-formed `<env>` block is left byte-untouched and simply gains the trailer (built from the
 * provided fallback facts) — nothing is lost either way.
 */
export function restructureSystemPromptForPrefixStability(
	basePrompt: string,
	session: PromptShellSessionFacts,
): RestructuredPromptShell {
	const lines = basePrompt.split("\n");
	const openIndex = lines.findIndex((line) => line.trim() === ENV_OPEN_TAG);
	const closeIndex =
		openIndex === -1 ? -1 : lines.findIndex((line, index) => index > openIndex && line.trim() === ENV_CLOSE_TAG);

	let staticText = basePrompt;
	let extractedDate: string | null = null;
	let extractedCwd: string | null = null;

	if (openIndex !== -1 && closeIndex !== -1) {
		const kept: string[] = [];
		for (const line of lines.slice(openIndex + 1, closeIndex)) {
			const dateMatch = line.match(DATE_LINE_PATTERN);
			if (dateMatch && extractedDate === null) {
				extractedDate = dateMatch[1] ?? "";
				continue;
			}
			const cwdMatch = line.match(CWD_LINE_PATTERN);
			if (cwdMatch && extractedCwd === null) {
				extractedCwd = cwdMatch[1] ?? "";
				continue;
			}
			kept.push(line);
		}
		if (extractedDate !== null || extractedCwd !== null) {
			// Renumber the surviving `N.` lines so the static env block reads cleanly (1., 2., … with no gaps).
			let nextNumber = 0;
			const renumbered = kept.map((line) => {
				const numbered = line.match(NUMBERED_LINE_PATTERN);
				if (!numbered) {
					return line;
				}
				nextNumber += 1;
				return `${numbered[1]}${nextNumber}. ${numbered[2]}`;
			});
			staticText = [...lines.slice(0, openIndex + 1), ...renumbered, ...lines.slice(closeIndex)].join("\n");
		}
	}

	const sessionEnvText = [
		"<session>",
		`Working Directory: ${extractedCwd ?? session.cwd}`,
		`Date: ${extractedDate ?? session.date}`,
		"</session>",
	].join("\n");

	return {
		staticText,
		sessionEnvText,
		text: staticText.trim().length > 0 ? `${staticText}\n\n${sessionEnvText}` : sessionEnvText,
		envBlockEdited: extractedDate !== null || extractedCwd !== null,
	};
}
