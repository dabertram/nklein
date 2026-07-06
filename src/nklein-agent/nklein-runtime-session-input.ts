import type { RuntimeTaskImage, RuntimeTaskSessionMode } from "../core/api-contract";
import type { createAgentSandboxToolExecutors } from "./nklein-agent-sandbox";
import type { createAgentSandboxExtraTools } from "./nklein-agent-sandbox-extra-tools";
import type { NKleinCodeEmbeddingProvider } from "./nklein-code-embeddings";
import type { NKleinTaskRestartLaunchConfig } from "./nklein-launch-config";
import type { NKleinMergeResolutionSubmittedHandler } from "./nklein-merge-resolution-tool";
import type { NKleinPlanCritiqueSubmittedHandler } from "./nklein-plan-critique-tool";
import type { NKleinReviewSubmittedHandler } from "./nklein-review-tool";
import type { NKleinSdkPersistedMessage } from "./sdk-runtime-boundary.js";

/**
 * The input to `InMemoryNKleinTaskSessionService.startRuntimeTaskSessionFromLaunchConfig`, named so the auxiliary
 * secondary-session runners (§5.U) can type it as an injected `startRuntimeSession` dependency without importing the
 * service (which would import them back). The service references this type on its private method.
 */
export interface StartRuntimeTaskSessionFromLaunchConfigInput {
	taskId: string;
	cwd: string;
	workspaceRoot?: string | null;
	prompt: string;
	initialMessages?: NKleinSdkPersistedMessage[];
	/** W1.1a: optional per-turn output budget (see StartNKleinTaskSessionInput.maxTokensPerTurn). */
	maxTokensPerTurn?: number | null;
	images?: RuntimeTaskImage[];
	mode?: RuntimeTaskSessionMode;
	launchConfig: NKleinTaskRestartLaunchConfig;
	systemPrompt?: string | null;
	contextScope?: "full" | "smart" | "minimal" | "custom";
	timeoutMode?: "normal" | "long" | "extended" | "unlimited";
	codeEmbeddingProvider?: NKleinCodeEmbeddingProvider;
	onReviewSubmitted?: NKleinReviewSubmittedHandler;
	onPlanCritiqueSubmitted?: NKleinPlanCritiqueSubmittedHandler;
	onMergeResolutionSubmitted?: NKleinMergeResolutionSubmittedHandler;
	toolExecutors?: ReturnType<typeof createAgentSandboxToolExecutors>;
	extraTools?: ReturnType<typeof createAgentSandboxExtraTools>;
}

/** The result of a runtime task-session start (the model turn's outcome + any warnings). */
export interface RuntimeTaskSessionStartResult {
	result: unknown;
	warnings?: string[];
}
