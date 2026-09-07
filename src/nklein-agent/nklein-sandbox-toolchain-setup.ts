/**
 * F12.84b effectful seam: construct a detected repository environment through an injected SANDBOX command runner.
 * No child-process import lives here, so callers cannot accidentally fall back to a host toolchain.
 */

import { type EnvironmentPlan, planEnvironmentSetup } from "../core/language-toolchain-detection";

export interface SandboxToolchainSetupExecution {
	readonly command: string;
	readonly timeoutMs: number;
	/** Invocation-scoped environment additions (the sandbox adapter forwards them through `/usr/bin/env`). */
	readonly env?: Readonly<Record<string, string>>;
}

/**
 * P1.ACCEPT-ORPHAN (2): an egress-off sandbox must learn it is offline in SECONDS. npm's defaults retry each
 * registry fetch with a 5-minute timeout, so every `npm install` in the strict-isolation sandbox burned ~280s
 * before printing the ENOTFOUND that `isOfflineInstallFailure` classifies (telemetry 2026-09-02: 280464ms,
 * 280446ms, 280570ms per card). The same knobs make a warm per-task cache usable offline (`prefer-offline`).
 * pnpm honours the npm_config_* names; yarn classic reads YARN_NETWORK_TIMEOUT.
 */
export const INSTALL_FAIL_FAST_ENV: Readonly<Record<string, string>> = {
	npm_config_fetch_retries: "0",
	npm_config_fetch_timeout: "15000",
	npm_config_fetch_retry_mintimeout: "1000",
	npm_config_fetch_retry_maxtimeout: "2000",
	npm_config_prefer_offline: "true",
	npm_config_audit: "false",
	npm_config_fund: "false",
	npm_config_update_notifier: "false",
	YARN_NETWORK_TIMEOUT: "15000",
};

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
	/** Pause before the single retry of a transiently failed install step (tests pass 0). */
	readonly transientRetryDelayMs?: number;
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
	env?: Readonly<Record<string, string>>,
): Promise<SandboxToolchainSetupStep> {
	const now = options.now ?? Date.now;
	const startedAt = now();
	const result = await options.runCommand({ command, timeoutMs: options.timeoutMs, ...(env ? { env } : {}) });
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

/**
 * Disk-exhaustion signatures (live 2026-09-06: four concurrent acceptance installs filled the sandbox's 512 MB tmpfs
 * HOME — `ENOSPC` while writing tarballs, `TAR_ENTRY_ERROR ENOENT` while extracting into a full fs). Not a manifest
 * or network verdict: the environment ran out of room, and the fix is capacity, not the card.
 */
const DISK_FULL_INSTALL_SIGNATURES = ["ENOSPC", "no space left on device", "TAR_ENTRY_ERROR"];

/** Registry/proxy hiccups that a second attempt usually clears (never offline signatures). */
const TRANSIENT_INSTALL_SIGNATURES = [
	"E502",
	"502 Bad Gateway",
	"E503",
	"503 Service Unavailable",
	"E504",
	"504 Gateway",
	"ECONNRESET",
	"socket hang up",
	"EPIPE",
];
const TRANSIENT_RETRY_DELAY_MS = 2_000;

export function isTransientInstallFailure(output: string): boolean {
	return TRANSIENT_INSTALL_SIGNATURES.some((signature) => output.includes(signature));
}

export function isDiskFullInstallFailure(output: string): boolean {
	return DISK_FULL_INSTALL_SIGNATURES.some((signature) => output.includes(signature));
}

/**
 * P1.NPMSEED leftover (journal #52): the prime and acceptance observations carried a 400/500-char slice of the
 * install output, and npm's tail is its EventEmitter warning ("MaxListenersExceededWarning … Use
 * events.setMaxListeners()") plus the "A complete log of this run can be found in" pointer — the `npm error code
 * EAI_AGAIN` / `E502` / `ENOSPC` line that names the failure sat above the cut. This picks the lines that carry a
 * verdict across package managers and compilers (npm ≥10 `npm error …`, npm ≤9 `npm ERR! …`, tsc `error TS…`,
 * cargo/pip/yarn `error…`, thrown `Error:`), drops npm's log pointer, bare prefixes and stack frames, redacts URL
 * credentials, and dedupes + caps the result so an observation stays small. Pure: no I/O, no classification.
 */
export const INSTALL_ERROR_LINES_MAX = 12;
export const INSTALL_ERROR_CHARS_MAX = 1_200;
const INSTALL_ERROR_LINE_MAX_CHARS = 300;
/** ESC `[` … letter (tsc `--pretty` colours); built from the code point so no control byte sits in the source. */
const ANSI_ESCAPE_PATTERN = new RegExp(`${String.fromCharCode(0x1b)}\\[[0-9;]*[A-Za-z]`, "g");
/** `://user:secret@proxy` → `://***@proxy` (the same redaction the acceptance gate applies to its output slice). */
const URL_CREDENTIAL_PATTERN = /:\/\/[^/@\s]+@/g;
const INSTALL_ERROR_LINE_PATTERNS: readonly RegExp[] = [
	// npm ≥10 `npm error code E502`; npm ≤9 `npm ERR! code ENOTFOUND`. One space then a word: bare `npm error`
	// separators and indented `npm error     at …` stack frames stay out.
	/^npm (?:error|ERR!) \S/,
	// tsc diagnostics: `src/x.ts(3,21): error TS2307: Cannot find module 'zod'`.
	/\berror TS\d+:/,
	// cargo `error[E0433]: …`, pip `ERROR: …`, yarn `error An unexpected error occurred: …`, generic `error: …`.
	/^(?:error|ERROR)(?:\[[A-Za-z0-9_]+\])?(?::|\s\S)/,
	// thrown errors: `Error: Cannot find module …`, `TypeError: …`, `FetchError: …`.
	/\b(?:[A-Z][A-Za-z]*)?Error:/,
];
/** Matches a pattern above but carries no verdict (the debug log is inside a disposed sandbox anyway). */
const INSTALL_ERROR_NOISE_PATTERNS: readonly RegExp[] = [
	/^npm (?:error|ERR!) A complete log of this run can be found in/,
];

export function extractInstallErrorLines(output: string): string[] {
	const lines: string[] = [];
	const seen = new Set<string>();
	let chars = 0;
	for (const raw of output.replace(ANSI_ESCAPE_PATTERN, "").split(/\r\n|\r|\n/)) {
		const line = raw.trim().replace(URL_CREDENTIAL_PATTERN, "://***@");
		if (!INSTALL_ERROR_LINE_PATTERNS.some((pattern) => pattern.test(line))) continue;
		if (INSTALL_ERROR_NOISE_PATTERNS.some((pattern) => pattern.test(line))) continue;
		const bounded =
			line.length > INSTALL_ERROR_LINE_MAX_CHARS ? `${line.slice(0, INSTALL_ERROR_LINE_MAX_CHARS - 1)}…` : line;
		if (seen.has(bounded)) continue;
		if (lines.length >= INSTALL_ERROR_LINES_MAX || chars + bounded.length > INSTALL_ERROR_CHARS_MAX) break;
		seen.add(bounded);
		lines.push(bounded);
		chars += bounded.length;
	}
	return lines;
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
		let step = await executeStep(options, "install", command, INSTALL_FAIL_FAST_ENV);
		steps.push(step);
		// Transient registry/proxy failure (dschinn drive 2026-09-07: `npm ci` → `E502 Bad Gateway` on a tarball GET
		// while four sandboxes installed at once; fetch-retries is 0 by design): retry the step ONCE after a short
		// pause instead of filing a false acceptance failure. Offline signatures are NOT transient (handled below).
		if (step.exitCode !== 0 && isTransientInstallFailure(step.output) && !isOfflineInstallFailure(step.output)) {
			await new Promise<void>((resolve) =>
				setTimeout(resolve, options.transientRetryDelayMs ?? TRANSIENT_RETRY_DELAY_MS),
			);
			step = await executeStep(options, "install", command, INSTALL_FAIL_FAST_ENV);
			steps.push(step);
		}
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
			if (isDiskFullInstallFailure(step.output)) {
				return {
					status: "failed",
					plan,
					steps,
					durationMs: Math.max(0, now() - startedAt),
					failedCommand: command,
					reason: `dependency installation ran out of disk inside the sandbox (${command}): the task cache or tmpfs is full — a capacity problem of the sandbox, not of the card`,
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
