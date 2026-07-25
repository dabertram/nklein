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
	readonly status: "not_applicable" | "ready" | "failed" | "skipped_offline";
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
	/** Caller's cached run-level verdict that the sandbox network is offline — skips install steps up front. */
	readonly assumeOffline?: boolean;
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
/** Network-unreachable signatures across package managers (DNS blocked, egress-fenced, no route). */
const OFFLINE_INSTALL_SIGNATURES = [
	"EAI_AGAIN",
	"ENOTFOUND",
	"ECONNREFUSED",
	"ETIMEDOUT",
	"ENETUNREACH",
	"EHOSTUNREACH",
	"Could not resolve host",
	"Temporary failure in name resolution",
	"network is unreachable",
	"proxy CONNECT",
	"403 (blocked by egress policy)",
];

export function isOfflineInstallFailure(output: string): boolean {
	return OFFLINE_INSTALL_SIGNATURES.some((signature) => output.includes(signature));
}

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

	if (options.assumeOffline) {
		// F1.34c drain forensics 2026-07-25: a run whose FIRST setup proved the sandbox network offline paid the
		// same ~70s discovery (DNS timeouts per install step) again on EVERY subsequent card — 41 cards × 2 setups
		// turned a minutes-long drain into hours. Offline is a run-level property of the sandbox posture, not a
		// per-card one; the caller passes its cached verdict and the installs are skipped up front with the same
		// audible skipped_offline outcome (probes above still ran — runtime presence is per-image truth).
		return {
			status: "skipped_offline",
			plan,
			steps,
			durationMs: Math.max(0, now() - startedAt),
			failedCommand: null,
			reason:
				"sandbox network already classified offline earlier in this run — installs skipped; proceeding to the acceptance command without installed dependencies",
		};
	}

	for (const command of plan.installSteps) {
		const step = await executeStep(options, "install", command);
		steps.push(step);
		if (step.exitCode !== 0) {
			// N10 forensics 2026-07-25: an install failing because the sandbox has NO NETWORK (the deliberate
			// offline/egress-fenced posture — EAI_AGAIN/ENOTFOUND/proxy-refused) is not a setup verdict, and it
			// must never veto acceptance: the acceptance command itself may not need the install at all, and if
			// it does, IT fails with its own honest error. Setup is best-effort preparation, not a gate. This
			// exact coupling made `node -e "process.exit(0)"` "fail" on every tree in hermetic cells for weeks,
			// silently absorbed by the baseline waiver.
			if (isOfflineInstallFailure(step.output)) {
				return {
					status: "skipped_offline",
					plan,
					steps,
					durationMs: Math.max(0, now() - startedAt),
					failedCommand: command,
					reason: `dependency installation unreachable from the offline sandbox (${command}); proceeding to the acceptance command without installed dependencies`,
				};
			}
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
