/**
 * Acceptance-command sanitizer (dschinn drive 2026-09-07).
 *
 * A card's acceptance line is a SHELL command. But the runtime inlines the project spec into every card prompt, and
 * a spec can carry a PROSE line under the same label — specification.md line 6 is
 * `Acceptance command: npm test — **BUT SEE "npm test" IS NOT AN INDEPENDENT ORACLE BELOW ...**`. The extractors
 * (`ACCEPTANCE_CHECK_PATTERN` in acceptance-gate / agent-turn-loop / plan-integration-gate) take the FIRST
 * `^Acceptance (check|command): ...$` match, so on such a prompt they capture that whole prose sentence and the
 * acceptance gate executes it: `/bin/sh: 1: Syntax error: Unterminated quoted string`, exit 2 — every card in the
 * plan fails acceptance for a reason the worker cannot fix. Root cause: a command line is being read WITH its prose.
 *
 * This trims the captured value back to the command: cut at the first em/en-dash clause or markdown-emphasis marker
 * (` — `, ` – `, ` ** `, ` `` `) that a real acceptance command never contains, while leaving shell syntax intact —
 * notably `--` flag separators (`npm test -- --run`), pipes, and `&&`, which are NOT cut. `npm test — **BUT …` ⇒
 * `npm test`; `vitest run test/x` and `pytest -q` pass through unchanged.
 */

/** Markers that begin an explanatory prose tail on an inlined spec's acceptance line (never part of a command). */
const ACCEPTANCE_PROSE_TAIL = /\s(?:—|–|\*\*|`)/u;

/** Trim a captured acceptance value to the command, dropping any inlined-spec prose tail. Empty ⇒ "". */
export function sanitizeAcceptanceCommand(raw: string): string {
	const trimmed = raw.trim();
	const tail = trimmed.search(ACCEPTANCE_PROSE_TAIL);
	return (tail >= 0 ? trimmed.slice(0, tail) : trimmed).trim();
}

/** As {@link sanitizeAcceptanceCommand}, but returns null for an absent/blank/all-prose value. */
export function sanitizeAcceptanceCommandOrNull(raw: string | null | undefined): string | null {
	if (!raw) {
		return null;
	}
	const command = sanitizeAcceptanceCommand(raw);
	return command.length > 0 ? command : null;
}
