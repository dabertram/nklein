import { assertLocalModelBaseUrl } from "./local-model-base-url";

export const TERMINAL_BENCH_21_DATASET = "terminal-bench/terminal-bench-2-1";
export const PINNED_HARBOR_VERSION = "0.5.0";

export interface TerminalBenchHostPreflightInput {
	harborVersion: string | null;
	dockerReachable: boolean;
	dockerArchitecture: string | null;
	availableBytes: number;
	reclaimableDockerBytes: number;
	requiredFreeBytes: number;
}

export interface TerminalBenchHostPreflight {
	ready: boolean;
	blockers: readonly string[];
	warnings: readonly string[];
	availableBytes: number;
	reclaimableDockerBytes: number;
	requiredFreeBytes: number;
}

function bytes(value: number, field: string): number {
	if (!Number.isFinite(value) || value < 0) throw new Error(`${field} must be a non-negative finite byte count.`);
	return Math.trunc(value);
}

/**
 * Preflight the image-bearing Harbor smoke without pulling anything.
 *
 * `requiredFreeBytes` is deliberately operator/measured input, not a guessed universal constant: Terminal-Bench task
 * images vary widely, and reclaimable Docker cache is not free space until an explicit destructive cleanup occurs.
 */
export function assessTerminalBenchHost(input: TerminalBenchHostPreflightInput): TerminalBenchHostPreflight {
	const availableBytes = bytes(input.availableBytes, "availableBytes");
	const reclaimableDockerBytes = bytes(input.reclaimableDockerBytes, "reclaimableDockerBytes");
	const requiredFreeBytes = bytes(input.requiredFreeBytes, "requiredFreeBytes");
	if (requiredFreeBytes === 0) throw new Error("requiredFreeBytes must be an explicit positive pull-headroom budget.");
	const blockers: string[] = [];
	const warnings: string[] = [];
	if (input.harborVersion !== PINNED_HARBOR_VERSION) {
		blockers.push(
			input.harborVersion
				? `Harbor ${input.harborVersion} does not match pinned ${PINNED_HARBOR_VERSION}.`
				: `Harbor ${PINNED_HARBOR_VERSION} is not installed/probed.`,
		);
	}
	if (!input.dockerReachable) blockers.push("Docker is unavailable; Harbor cannot build or start task environments.");
	if (!input.dockerArchitecture) blockers.push("Docker architecture is unknown.");
	if (availableBytes < requiredFreeBytes) {
		blockers.push(
			`Only ${availableBytes} bytes are free; the selected task images require ${requiredFreeBytes} bytes of measured headroom.`,
		);
	}
	if (reclaimableDockerBytes > 0) {
		warnings.push(
			`${reclaimableDockerBytes} Docker bytes are reclaimable but are not counted as free; cleanup remains an explicit operator action.`,
		);
	}
	if (
		input.dockerArchitecture !== null &&
		input.dockerArchitecture !== "x86_64" &&
		input.dockerArchitecture !== "amd64"
	) {
		warnings.push(
			`Docker reports ${input.dockerArchitecture}; retain per-task architecture/taint evidence instead of assuming native x86_64.`,
		);
	}
	return {
		ready: blockers.length === 0,
		blockers,
		warnings,
		availableBytes,
		reclaimableDockerBytes,
		requiredFreeBytes,
	};
}

export interface TerminalBenchEnvironmentCapabilities {
	execInOwnedContainer: boolean;
	mutableRootFilesystem: boolean;
	boundedExecResults: boolean;
	preserveContainerAcrossTurns: boolean;
	harborOwnsVerification: boolean;
	probeError?: string;
}

/**
 * Terminal-Bench is not a repository patch lane. Prove the execution boundary exists before advertising a custom agent.
 */
export function assessTerminalBenchAgentBoundary(capabilities: TerminalBenchEnvironmentCapabilities): {
	ready: boolean;
	blockers: readonly string[];
} {
	const blockers: string[] = [];
	if (capabilities.probeError) blockers.push(`adapter protocol probe failed: ${capabilities.probeError}`);
	if (!capabilities.execInOwnedContainer) blockers.push("tool calls cannot execute in Harbor's task container");
	if (!capabilities.mutableRootFilesystem)
		blockers.push("the execution boundary exposes only a read-only/rootless repo mount");
	if (!capabilities.boundedExecResults)
		blockers.push("the adapter does not bound command results returned from Harbor");
	if (!capabilities.preserveContainerAcrossTurns)
		blockers.push("task-container state does not survive the multi-turn agent loop");
	if (!capabilities.harborOwnsVerification) blockers.push("verification authority is not retained by Harbor");
	return { ready: blockers.length === 0, blockers };
}

export function planTerminalBenchAgentSmoke(input: {
	outputDir: string;
	cwd: string;
	modelId: string;
	baseUrl: string;
	contextWindow: number;
	maxTokensPerTurn: number;
	limit?: number;
	harborPath?: string;
}): { command: string; args: readonly string[]; cwd: string; env: Readonly<Record<string, string>> } {
	const oracle = planTerminalBenchOracleSmoke(input);
	if (!input.cwd.startsWith("/") || input.cwd.includes("\0") || input.cwd.includes("\n")) {
		throw new Error("cwd must be a safe absolute path.");
	}
	const modelId = input.modelId.trim();
	const baseUrl = assertLocalModelBaseUrl(input.baseUrl);
	if (!modelId || modelId.includes("\0") || modelId.includes("\n")) throw new Error("modelId must be a safe value.");
	if (!Number.isInteger(input.contextWindow) || input.contextWindow < 32_768) {
		throw new Error("contextWindow must be at least 32768.");
	}
	if (
		!Number.isInteger(input.maxTokensPerTurn) ||
		input.maxTokensPerTurn < 1 ||
		input.maxTokensPerTurn >= input.contextWindow
	) {
		throw new Error("maxTokensPerTurn must be positive and smaller than contextWindow.");
	}
	return {
		command: oracle.command,
		args: [
			"run",
			"-d",
			TERMINAL_BENCH_21_DATASET,
			"--agent-import-path",
			"integrations.harbor.nklein_harbor_agent:NKleinHarborAgent",
			"-m",
			modelId,
			"-l",
			String(input.limit ?? 5),
			"-o",
			input.outputDir,
		],
		cwd: input.cwd,
		env: {
			NKLEIN_TERMINAL_MODEL_BASE_URL: baseUrl,
			NKLEIN_TERMINAL_MODEL_ID: modelId,
			NKLEIN_TERMINAL_CONTEXT_WINDOW: String(input.contextWindow),
			NKLEIN_TERMINAL_MAX_TOKENS: String(input.maxTokensPerTurn),
		},
	};
}

export function planTerminalBenchOracleSmoke(input: { outputDir: string; limit?: number; harborPath?: string }): {
	command: string;
	args: readonly string[];
} {
	if (!input.outputDir.startsWith("/") || input.outputDir.includes("\0") || input.outputDir.includes("\n")) {
		throw new Error("outputDir must be a safe absolute path.");
	}
	const limit = input.limit ?? 5;
	if (!Number.isInteger(limit) || limit < 1) throw new Error("limit must be a positive integer.");
	const command = input.harborPath?.trim() || "harbor";
	if (command.includes("\0") || command.includes("\n")) throw new Error("harborPath contains an unsafe character.");
	return {
		command,
		args: ["run", "-d", TERMINAL_BENCH_21_DATASET, "-a", "oracle", "-l", String(limit), "-o", input.outputDir],
	};
}
