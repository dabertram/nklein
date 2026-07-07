import type { RawValidationGates } from "./repair-kernel";

/**
 * §5.B repair-kernel VALIDATOR — run a candidate patch's gates and produce the {@link RawValidationGates} the ranker
 * aggregates: the reproduction test (fail-before / pass-after), the regression suite, and typecheck + lint. The command
 * EXECUTION is injected (`deps.exec`, the sandbox-proxied runner) so this orchestration + the output→count parsing is
 * fully deterministic + unit-testable; the runtime supplies a real `exec` that runs inside the candidate's sandbox.
 *
 * Failure counts are derived from BOTH the exit code AND a best-effort parse of the tool output: a clean exit ⇒ zero,
 * a non-zero exit ⇒ the parsed count (or 1 when the output can't be parsed but the tool clearly failed) — so a broken
 * candidate never scores as clean just because its output shape was unexpected.
 */

export interface GateCommandResult {
	exitCode: number;
	stdout: string;
	stderr: string;
}

export interface RunValidationGatesDeps {
	/** Execute a shell command inside the candidate's sandbox; resolves the exit code + captured output. */
	exec: (command: string) => Promise<GateCommandResult>;
}

export interface RunValidationGatesInput {
	candidateId: string;
	/** Lines changed by the candidate (from the diff) — carried straight through to the ranker. */
	diffSize: number;
	/** The reproduction test command (fails before the fix, passes after). Omit to skip (treated as not-yet-passing). */
	reproCommand?: string;
	/** The regression-suite command. Omit to skip (0 failures). */
	regressionCommand?: string;
	/** The typecheck command (e.g. `tsc --noEmit`). Omit to skip (0 failures). */
	typecheckCommand?: string;
	/** The lint command (e.g. `biome lint`). Omit to skip (0 failures). */
	lintCommand?: string;
}

/** Combine the output streams for parsing (tools print to either). */
function combined(result: GateCommandResult): string {
	return `${result.stdout}\n${result.stderr}`;
}

/**
 * Parse a test-runner's failure count. A clean exit ⇒ 0. Otherwise prefer an explicit "N failed" (vitest/jest/mocha),
 * else fall back to 1 (the run failed but the count is unreadable — never report 0 for a failed run).
 */
export function parseTestFailureCount(result: GateCommandResult): number {
	if (result.exitCode === 0) {
		return 0;
	}
	const match = combined(result).match(/(\d+)\s+failed/i);
	return match ? Math.max(1, Number.parseInt(match[1] ?? "1", 10)) : 1;
}

/** Parse a `tsc` failure count from `error TS####:` lines; clean exit ⇒ 0, non-zero-but-unparseable ⇒ 1. */
export function parseTypecheckFailureCount(result: GateCommandResult): number {
	if (result.exitCode === 0) {
		return 0;
	}
	const matches = combined(result).match(/error TS\d+/gi);
	return matches ? matches.length : 1;
}

/** Parse a lint (biome/eslint) failure count from "Found N error(s)"; clean exit ⇒ 0, non-zero-but-unparseable ⇒ 1. */
export function parseLintFailureCount(result: GateCommandResult): number {
	if (result.exitCode === 0) {
		return 0;
	}
	const match = combined(result).match(/found\s+(\d+)\s+error/i);
	return match ? Math.max(1, Number.parseInt(match[1] ?? "1", 10)) : 1;
}

export async function runValidationGates(
	input: RunValidationGatesInput,
	deps: RunValidationGatesDeps,
): Promise<RawValidationGates> {
	// Reproduction test: a passing exit AFTER applying the candidate means the bug is fixed. No command ⇒ not proven.
	const reproPassAfter = input.reproCommand ? (await deps.exec(input.reproCommand)).exitCode === 0 : false;

	const regressionFailures = input.regressionCommand
		? parseTestFailureCount(await deps.exec(input.regressionCommand))
		: 0;
	const typecheckFailures = input.typecheckCommand
		? parseTypecheckFailureCount(await deps.exec(input.typecheckCommand))
		: 0;
	const lintFailures = input.lintCommand ? parseLintFailureCount(await deps.exec(input.lintCommand)) : 0;

	return {
		candidateId: input.candidateId,
		reproPassAfter,
		regressionFailures,
		typecheckFailures,
		lintFailures,
		diffSize: Math.max(0, input.diffSize),
	};
}
