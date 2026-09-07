/**
 * Prime the WORKER sandbox's toolchain (dependency install) before the first model turn.
 *
 * Dschinn hand-drive 2026-09-07 (docs/journal/hitl-findings-2026-09-06.md #26): the acceptance sandbox already runs
 * `runSandboxToolchainSetup` with a 5-minute budget, but the worker sandbox did not — so every card's first
 * `npm install` ran through the model's `run_commands` tool, overran its 30 s cap on a cold per-task package cache,
 * left a truncated native binary behind (`vitest` → `Bus error`), and cost 3–4 model turns per card. A local model
 * loops on "vitest: not found" here. Priming at placement makes the tree the model sees already installed, using
 * the SAME plan + install commands the acceptance gate trusts (no host execution; the docker-exec seam only).
 *
 * Default-on; `NKLEIN_WORKER_TOOLCHAIN_PRIME=0` disables. Failure is non-fatal: the session still starts and one
 * observation names the failed step, so the operator (and the model, via its first failing command) can see why.
 */

import { isEnabledByDefaultEnv } from "../core/env-flag";
import { recordSelfObservation } from "../telemetry/self-observation-sink";
import type { AgentSandboxManager } from "./nklein-agent-sandbox";
import {
	isDiskFullInstallFailure,
	isOfflineInstallFailure,
	runSandboxToolchainSetup,
	type SandboxToolchainSetupReport,
} from "./nklein-sandbox-toolchain-setup";

export const WORKER_TOOLCHAIN_PRIME_ENV = "NKLEIN_WORKER_TOOLCHAIN_PRIME";
/** Bounded: a worker start must not hang on a slow registry; the acceptance gate re-runs the install anyway. */
export const DEFAULT_WORKER_TOOLCHAIN_PRIME_TIMEOUT_MS = 4 * 60 * 1000;
const OUTPUT_TAIL_CHARS = 400;

export interface PrimeSandboxToolchainInput {
	manager: Pick<AgentSandboxManager, "exec" | "listSandboxRootFileNames">;
	taskId: string;
	timeoutMs?: number;
	env?: NodeJS.ProcessEnv;
	recordObservation?: typeof recordSelfObservation;
	now?: () => number;
}

/** Explain a failed install in the operator's terms (mirrors the acceptance gate's failure taxonomy). */
export function describePrimeFailure(report: SandboxToolchainSetupReport): string {
	const failedStep = report.steps.find((step) => step.command === report.failedCommand) ?? report.steps.at(-1);
	const output = failedStep?.output ?? "";
	if (isOfflineInstallFailure(output)) {
		return "the sandbox could not reach the package registry (egress blocked or offline)";
	}
	if (isDiskFullInstallFailure(output)) {
		return "dependency installation ran out of disk inside the sandbox";
	}
	if (failedStep && failedStep.exitCode === null) {
		return `\`${failedStep.command}\` exceeded the ${Math.round((report.durationMs || 0) / 1000)} s priming budget`;
	}
	return report.reason || `\`${report.failedCommand ?? "install"}\` failed`;
}

/**
 * Run the toolchain plan for the task's prepared sandbox workspace. Returns the report, or `null` when priming is
 * disabled or the workspace has no recognised toolchain. Never throws.
 */
export async function primeSandboxToolchain(
	input: PrimeSandboxToolchainInput,
): Promise<SandboxToolchainSetupReport | null> {
	const env = input.env ?? process.env;
	if (!isEnabledByDefaultEnv(env[WORKER_TOOLCHAIN_PRIME_ENV])) {
		return null;
	}
	const record = input.recordObservation ?? recordSelfObservation;
	const timeoutMs = input.timeoutMs ?? DEFAULT_WORKER_TOOLCHAIN_PRIME_TIMEOUT_MS;
	let report: SandboxToolchainSetupReport;
	try {
		const rootFileNames = await input.manager.listSandboxRootFileNames(input.taskId);
		report = await runSandboxToolchainSetup({
			rootFileNames,
			timeoutMs,
			...(input.now ? { now: input.now } : {}),
			runCommand: async (execution) => {
				const envArgs = Object.entries(execution.env ?? {}).map(([name, value]) => `${name}=${value}`);
				const argv =
					envArgs.length > 0
						? ["/usr/bin/env", ...envArgs, "sh", "-c", execution.command]
						: ["sh", "-c", execution.command];
				try {
					return await input.manager.exec(input.taskId, argv, { timeoutMs: execution.timeoutMs });
				} catch (error) {
					// A timed-out or failed docker exec surfaces as a failed step, never as a thrown start.
					return { exitCode: null, stdout: "", stderr: error instanceof Error ? error.message : String(error) };
				}
			},
		});
	} catch (error) {
		record({
			signal: "custom",
			severity: "warning",
			message: `Sandbox toolchain priming for ${input.taskId} could not run: ${error instanceof Error ? error.message : String(error)}`,
			taskId: input.taskId,
			metadata: { category: "sandbox_toolchain_prime", status: "error" },
		});
		return null;
	}
	if (report.status === "not_applicable") {
		return report;
	}
	const failedStep = report.steps.find((step) => step.command === report.failedCommand);
	const outputTail = failedStep?.output.slice(-OUTPUT_TAIL_CHARS) ?? null;
	record({
		signal: report.status === "failed" ? "verification_failed" : "custom",
		severity: report.status === "failed" ? "warning" : "info",
		message:
			report.status === "failed"
				? `Sandbox toolchain priming for ${input.taskId} failed before the first model turn: ${describePrimeFailure(report)}. The model will see the uninstalled tree.`
				: `Sandbox toolchain primed for ${input.taskId} before the first model turn: ${report.status} in ${report.durationMs}ms (${report.plan.toolchains.map((toolchain) => toolchain.language).join(", ") || "no toolchain"}).`,
		taskId: input.taskId,
		metadata: {
			category: "sandbox_toolchain_prime",
			status: report.status,
			durationMs: report.durationMs,
			toolchains: report.plan.toolchains,
			failedCommand: report.failedCommand,
			...(outputTail ? { outputTail } : {}),
		},
	});
	return report;
}
