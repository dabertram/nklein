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
	if (requiredFreeBytes === 0) throw new Error("requiredFreeBytes must come from the selected task-image manifest.");
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
	copyFilesToAndFromContainer: boolean;
	preserveContainerAcrossTurns: boolean;
	harborOwnsVerification: boolean;
}

/**
 * Terminal-Bench is not a repository patch lane. Prove the execution boundary exists before advertising a custom agent.
 */
export function assessTerminalBenchAgentBoundary(capabilities: TerminalBenchEnvironmentCapabilities): {
	ready: boolean;
	blockers: readonly string[];
} {
	const blockers: string[] = [];
	if (!capabilities.execInOwnedContainer) blockers.push("tool calls cannot execute in Harbor's task container");
	if (!capabilities.mutableRootFilesystem)
		blockers.push("the execution boundary exposes only a read-only/rootless repo mount");
	if (!capabilities.copyFilesToAndFromContainer)
		blockers.push("the adapter cannot exchange bounded artifacts with Harbor");
	if (!capabilities.preserveContainerAcrossTurns)
		blockers.push("task-container state does not survive the multi-turn agent loop");
	if (!capabilities.harborOwnsVerification) blockers.push("verification authority is not retained by Harbor");
	return { ready: blockers.length === 0, blockers };
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
