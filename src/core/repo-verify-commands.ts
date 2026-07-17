/**
 * F11.2g repo-own verify commands — PURE derivation.
 *
 * Matching the project's REAL lint/type rules IS "fitting the codebase", and models self-heal reliably against
 * explicit lint output (factory.ai linters). This core derives the repo's own non-mutating verify commands from
 * its package.json scripts so the acceptance gate can run them on the delivered tree after the card's declared
 * acceptance command passes. Selection is conservative and honest: only well-known NON-MUTATING script names, a
 * mutating command (`--write`/`--fix`) is skipped with its reason, anything already covered by the acceptance
 * command is skipped as duplicate, and the list is capped — skips are reported, never silent.
 */

export interface RepoVerifyCommand {
	readonly script: string;
	readonly command: string;
}

export interface RepoVerifyDerivation {
	readonly commands: RepoVerifyCommand[];
	readonly skippedScripts: Array<{ readonly script: string; readonly reason: string }>;
}

/** Non-mutating verification scripts, in the order they should run (cheap/structural first). */
const VERIFY_SCRIPT_PRIORITY = ["lint", "typecheck", "check", "lint:ci", "type-check"] as const;
const MUTATING_MARKERS = /--write|--fix|\bformat\b(?!:check)/;
const DEFAULT_MAX_COMMANDS = 2;

export function deriveRepoVerifyCommands(input: {
	packageJsonContent: string | null;
	/** The card's declared acceptance command — scripts it already runs are skipped as duplicates. */
	acceptanceCommand: string | null;
	maxCommands?: number;
}): RepoVerifyDerivation {
	const maxCommands = Math.max(1, Math.min(4, input.maxCommands ?? DEFAULT_MAX_COMMANDS));
	const skippedScripts: Array<{ script: string; reason: string }> = [];
	if (!input.packageJsonContent?.trim()) {
		return { commands: [], skippedScripts };
	}
	let scripts: Record<string, unknown>;
	try {
		const parsed: unknown = JSON.parse(input.packageJsonContent);
		const record = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
		scripts = record.scripts && typeof record.scripts === "object" ? (record.scripts as Record<string, unknown>) : {};
	} catch {
		return { commands: [], skippedScripts: [{ script: "*", reason: "package.json did not parse" }] };
	}
	const acceptance = input.acceptanceCommand ?? "";
	const commands: RepoVerifyCommand[] = [];
	for (const script of VERIFY_SCRIPT_PRIORITY) {
		if (commands.length >= maxCommands) {
			break;
		}
		const body = scripts[script];
		if (typeof body !== "string" || !body.trim()) {
			continue;
		}
		if (MUTATING_MARKERS.test(body)) {
			skippedScripts.push({ script, reason: "mutating (would rewrite the tree, not verify it)" });
			continue;
		}
		// Already covered when the acceptance command runs this script by name (`npm run lint`) or runs the
		// same underlying command text.
		if (acceptance.includes(`run ${script}`) || (body.trim().length > 0 && acceptance.includes(body.trim()))) {
			skippedScripts.push({ script, reason: "already covered by the acceptance command" });
			continue;
		}
		commands.push({ script, command: `npm run ${script}` });
	}
	return { commands, skippedScripts };
}
