const PROTECTED_AUTO_MERGE_PATH_PREFIXES = [
	"src/core/agent-write-guard.ts",
	"src/core/runtime-endpoint.ts",
	"src/security/",
	"src/server/shutdown-coordinator.ts",
	"src/workspace/path-sandbox.ts",
	"src/workspace/task-worktree.ts",
	"src/workspace/task-worktree-path.ts",
	"src/workspace/task-worktree-sync.ts",
	"src/telemetry/self-observation-sink.ts",
	"src/cline-sdk/cline-dogfood-engine.ts",
	"src/cline-sdk/cline-trusted-auto-merge.ts",
	"src/trpc/runtime-api.ts",
];

export interface TrustedAutoMergeInput {
	requested: boolean;
	evalPassed: boolean;
	testsPassed: boolean;
	changedFiles: string[];
	regressionDelta: number | null;
	env?: NodeJS.ProcessEnv;
}

export interface TrustedAutoMergeDecision {
	allowed: boolean;
	reason: string;
	protectedPaths: string[];
}

function normalizedPath(path: string): string {
	return path.replace(/\\/g, "/").replace(/^\.?\//, "");
}

export function isTrustedAutoMergeProtectedPath(path: string): boolean {
	const normalized = normalizedPath(path);
	return PROTECTED_AUTO_MERGE_PATH_PREFIXES.some((prefix) => normalized === prefix || normalized.startsWith(prefix));
}

function isTruthyEnv(value: string | undefined): boolean {
	return value === "1" || value?.toLowerCase() === "true";
}

export function evaluateTrustedAutoMerge(input: TrustedAutoMergeInput): TrustedAutoMergeDecision {
	const protectedPaths = input.changedFiles.map(normalizedPath).filter(isTrustedAutoMergeProtectedPath).sort();
	if (!input.requested) {
		return {
			allowed: false,
			reason: "trusted auto-merge was not requested; self-improvements remain propose-only.",
			protectedPaths,
		};
	}
	if (!isTruthyEnv((input.env ?? process.env).KANBAN_ENABLE_TRUSTED_AUTO_MERGE)) {
		return {
			allowed: false,
			reason:
				"trusted auto-merge is disabled; set KANBAN_ENABLE_TRUSTED_AUTO_MERGE=1 only after the eval harness has earned trust.",
			protectedPaths,
		};
	}
	if (protectedPaths.length > 0) {
		return {
			allowed: false,
			reason: "trusted auto-merge is blocked because protected safety paths changed.",
			protectedPaths,
		};
	}
	if (!input.evalPassed || !input.testsPassed) {
		return {
			allowed: false,
			reason: "trusted auto-merge requires green eval and test gates.",
			protectedPaths,
		};
	}
	if (input.regressionDelta === null) {
		return {
			allowed: false,
			reason: "trusted auto-merge blocked because the regression delta is unknown.",
			protectedPaths,
		};
	}
	if (input.regressionDelta < 0) {
		return {
			allowed: false,
			reason: "trusted auto-merge blocked by negative regression delta.",
			protectedPaths,
		};
	}
	return {
		allowed: true,
		reason: "trusted auto-merge gates passed.",
		protectedPaths,
	};
}
