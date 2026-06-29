/**
 * The ONE effectful place llmfit is actually invoked (todo §5.AB) — a thin shell-out that produces an injectable
 * {@link LlmfitRunner} for the pure `llmfit-adapter` consumers. Kept separate so the adapter stays node-free + testable
 * anywhere; this module owns the subprocess (mirrors how `lms-model-runner` wraps the `lms` CLI).
 *
 * Default command is `uvx llmfit …` (runs ephemerally from the uv cache — no permanent install; confirmed in the spike),
 * overridable to a resolved `llmfit` binary (e.g. a brew/scoop install). The exec fn is injectable so the mapping
 * (resolve → stdout/exitCode, error → exitCode) is unit-testable without invoking a real binary.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { LlmfitRunner } from "./llmfit-adapter";

const execFileAsync = promisify(execFile);

/** Minimal shape of the exec call we depend on (matches `promisify(execFile)`); injectable for tests. */
export type LlmfitExec = (
	file: string,
	args: readonly string[],
	options: { timeout: number; maxBuffer: number },
) => Promise<{ stdout: string }>;

export interface CreateLlmfitRunnerOptions {
	/**
	 * How to invoke llmfit. Default `{ bin: "uvx", prefixArgs: ["llmfit"] }` (ephemeral). For a resolved binary use
	 * `{ bin: "/path/to/llmfit", prefixArgs: [] }` (or `{ bin: "llmfit" }`, which defaults prefixArgs to `[]`).
	 */
	command?: { bin: string; prefixArgs?: string[] };
	/** Per-invocation timeout (ms). Default 60s. */
	timeoutMs?: number;
}

/** Build an effectful {@link LlmfitRunner}; a non-zero exit / spawn error becomes `{ stdout, exitCode }` (never throws). */
export function createLlmfitRunner(
	options: CreateLlmfitRunnerOptions = {},
	exec: LlmfitExec = execFileAsync,
): LlmfitRunner {
	const bin = options.command?.bin ?? "uvx";
	const prefixArgs = options.command?.prefixArgs ?? (bin === "uvx" ? ["llmfit"] : []);
	const timeout = options.timeoutMs ?? 60_000;
	return async (args) => {
		try {
			const { stdout } = await exec(bin, [...prefixArgs, ...args], { timeout, maxBuffer: 16 * 1024 * 1024 });
			return { stdout, exitCode: 0 };
		} catch (error) {
			const e = error as { stdout?: unknown; code?: unknown };
			return {
				stdout: typeof e.stdout === "string" ? e.stdout : "",
				exitCode: typeof e.code === "number" ? e.code : 1,
			};
		}
	};
}
