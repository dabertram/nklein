import { parseRuntimePort } from "./core/runtime-endpoint";

/**
 * Pure CLI-invocation parsing helpers extracted from cli.ts. No process/network/fs side effects, so
 * they are behavior-preserving relative to their inline definitions and trivially unit-testable.
 */

/**
 * Parse a `--port` value into either a fixed port or auto-selection. `"auto"` (any case) selects a
 * free port; otherwise the value is parsed as a runtime port (1-65535). Throws on a missing/blank
 * value or an out-of-range/non-integer port.
 */
export function parseCliPortValue(rawValue: string): { mode: "fixed"; value: number } | { mode: "auto" } {
	const normalized = rawValue.trim().toLowerCase();
	if (!normalized) {
		throw new Error("Missing value for --port.");
	}
	if (normalized === "auto") {
		return { mode: "auto" };
	}
	try {
		return { mode: "fixed", value: parseRuntimePort(normalized) };
	} catch {
		throw new Error(`Invalid port value: ${rawValue}. Expected an integer from 1-65535 or "auto".`);
	}
}

/**
 * Decide whether a bare `kanban` invocation should auto-open a browser tab: true only when every
 * argument is a known launch flag or a launch option (with its value), i.e. there is no subcommand
 * or positional. The first non-launch token (a subcommand, a positional, or an unknown option, or a
 * value-taking option missing its value) returns false.
 */
export function shouldAutoOpenBrowserTabForInvocation(argv: string[]): boolean {
	const launchFlags = new Set([
		"--open",
		"--no-open",
		"--skip-shutdown-cleanup",
		"--https",
		"--no-passcode",
		"--insecure-remote-http",
		"--dangerously-disable-remote-auth",
	]);
	const launchOptionsWithValues = new Set(["--host", "--port", "--agent", "--cert", "--key"]);

	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (!arg) {
			continue;
		}
		if (!arg.startsWith("-")) {
			return false;
		}
		if (launchFlags.has(arg)) {
			continue;
		}
		const optionName = arg.split("=", 1)[0] ?? arg;
		if (!launchOptionsWithValues.has(optionName)) {
			return false;
		}
		if (arg.includes("=")) {
			continue;
		}
		const optionValue = argv[index + 1];
		if (!optionValue) {
			return false;
		}
		index += 1;
	}

	return true;
}
