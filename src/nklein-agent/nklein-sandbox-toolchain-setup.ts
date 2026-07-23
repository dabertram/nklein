/**
 * F12.84b effectful seam: construct a detected repository environment through an injected SANDBOX command runner.
 * No child-process import lives here, so callers cannot accidentally fall back to a host toolchain.
 */

import { type EnvironmentPlan, planEnvironmentSetup } from "../core/language-toolchain-detection";

export interface SandboxToolchainSetupExecution {
	readonly command: string;
	readonly timeoutMs: number;
}

export interface SandboxToolchainSetupStep {
	readonly kind: "runtime_probe" | "install";
	readonly command: string;
	readonly exitCode: number | null;
	readonly durationMs: number;
	readonly output: string;
}

export interface SandboxToolchainSetupReport {
	readonly status: "not_applicable" | "ready" | "failed";
	readonly plan: EnvironmentPlan;
	readonly steps: readonly SandboxToolchainSetupStep[];
	readonly durationMs: number;
	readonly failedCommand: string | null;
	readonly reason: string;
}

export interface RunSandboxToolchainSetupOptions {
	readonly rootFileNames: readonly string[];
	readonly timeoutMs: number;
	readonly runCommand: (execution: SandboxToolchainSetupExecution) => Promise<{
		exitCode: number | null;
		stdout?: string;
		stderr?: string;
	}>;
	readonly now?: () => number;
}

function joinOutput(stdout: string | undefined, stderr: string | undefined): string {
	return [stdout, stderr]
		.map((part) => part?.trim())
		.filter((part): part is string => Boolean(part))
		.join("\n");
}

async function executeStep(
	options: RunSandboxToolchainSetupOptions,
	kind: SandboxToolchainSetupStep["kind"],
	command: string,
): Promise<SandboxToolchainSetupStep> {
	const now = options.now ?? Date.now;
	const startedAt = now();
	const result = await options.runCommand({ command, timeoutMs: options.timeoutMs });
	return {
		kind,
		command,
		exitCode: result.exitCode,
		durationMs: Math.max(0, now() - startedAt),
		output: joinOutput(result.stdout, result.stderr),
	};
}

/**
 * Probe every selected runtime before installing anything, then execute install steps in stable toolchain order.
 * The first failure stops the setup: continuing would turn one clear environment defect into misleading test noise.
 */
export async function runSandboxToolchainSetup(
	options: RunSandboxToolchainSetupOptions,
): Promise<SandboxToolchainSetupReport> {
	const now = options.now ?? Date.now;
	const startedAt = now();
	const plan = planEnvironmentSetup(options.rootFileNames);
	if (plan.toolchains.length === 0) {
		return {
			status: "not_applicable",
			plan,
			steps: [],
			durationMs: Math.max(0, now() - startedAt),
			failedCommand: null,
			reason: plan.reason,
		};
	}

	const steps: SandboxToolchainSetupStep[] = [];
	for (const executable of plan.runtimeExecutables) {
		// Executables come from the closed Toolchain union, never user input.
		const command = `command -v ${executable}`;
		const step = await executeStep(options, "runtime_probe", command);
		steps.push(step);
		if (step.exitCode !== 0) {
			return {
				status: "failed",
				plan,
				steps,
				durationMs: Math.max(0, now() - startedAt),
				failedCommand: command,
				reason: `detected ${executable}, but the pinned sandbox image does not contain that runtime`,
			};
		}
	}

	for (const command of plan.installSteps) {
		const step = await executeStep(options, "install", command);
		steps.push(step);
		if (step.exitCode !== 0) {
			return {
				status: "failed",
				plan,
				steps,
				durationMs: Math.max(0, now() - startedAt),
				failedCommand: command,
				reason: `dependency installation failed inside the sandbox: ${command}`,
			};
		}
	}

	return {
		status: "ready",
		plan,
		steps,
		durationMs: Math.max(0, now() - startedAt),
		failedCommand: null,
		reason: `${plan.reason}; ${plan.installSteps.length} install step(s) completed inside Docker`,
	};
}
