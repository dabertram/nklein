import type {
	RuntimeDecompositionKnowledgeSignal,
	RuntimeDecompositionKnowledgeUsageAggregate,
	RuntimeKnowledgeToolCategory,
	RuntimeKnowledgeToolUsageObservation,
	RuntimeModelPerformanceRole,
} from "../core/api-contract";

/**
 * §5.B decomposition-quality signal: did a planning session actually consult knowledge tools — codebase
 * retrieval / code index / architecture knowledge — *before* it decomposed the project, rather than just
 * counting tool calls (the existing usage stats already do counts).
 *
 * We reuse the knowledge-tool-usage observation log: observations sharing one `taskId` are one planning
 * session, and the `decomposition_applied` hook marks the point a decomposition actually landed. A
 * decomposition "used knowledge tools" iff at least one knowledge-category observation in that session
 * occurred before the decomposition boundary. Anchoring on the *applied* event (which comes last) — rather
 * than the first `decompose_project` call — means a rejected-then-retried decomposition still credits the
 * knowledge work the architect did in between. Pure: it takes already-loaded observations and returns the
 * signal, so it is unit-tested without any IO.
 */

/** The tool categories that count as "consulting knowledge" for this signal (retrieval / index / architecture). */
export const DEFAULT_KNOWLEDGE_DECOMPOSITION_CATEGORIES: ReadonlySet<RuntimeKnowledgeToolCategory> = new Set([
	"codebase_retrieval",
	"code_index",
	"architecture_knowledge",
]);

// The wire shapes live in api-contract (zod source of truth, §5.B); these aliases keep the short local names.
export type DecompositionKnowledgeSignal = RuntimeDecompositionKnowledgeSignal;
export type DecompositionKnowledgeScope = RuntimeDecompositionKnowledgeUsageAggregate["scope"];
export type DecompositionKnowledgeUsageAggregate = RuntimeDecompositionKnowledgeUsageAggregate;

function normalizeToolName(toolName: string): string {
	return toolName
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "");
}

function isDecomposeProjectCall(observation: RuntimeKnowledgeToolUsageObservation): boolean {
	return normalizeToolName(observation.toolName) === "decompose_project";
}

export interface CorrelateDecompositionKnowledgeOptions {
	/** Override which tool categories count as knowledge consultation. Defaults to retrieval/index/architecture. */
	knowledgeCategories?: ReadonlySet<RuntimeKnowledgeToolCategory>;
}

/** One signal per `taskId` that contains a decomposition, newest first. */
export function correlateDecompositionKnowledgeSignals(
	observations: readonly RuntimeKnowledgeToolUsageObservation[],
	options: CorrelateDecompositionKnowledgeOptions = {},
): DecompositionKnowledgeSignal[] {
	const knowledgeCategories = options.knowledgeCategories ?? DEFAULT_KNOWLEDGE_DECOMPOSITION_CATEGORIES;
	const byTask = new Map<string, RuntimeKnowledgeToolUsageObservation[]>();
	for (const observation of observations) {
		const list = byTask.get(observation.taskId);
		if (list) {
			list.push(observation);
		} else {
			byTask.set(observation.taskId, [observation]);
		}
	}
	const signals: DecompositionKnowledgeSignal[] = [];
	for (const [taskId, taskObservations] of byTask) {
		const appliedMarkers = taskObservations.filter((entry) => entry.hookEventName === "decomposition_applied");
		const markers = appliedMarkers.length > 0 ? appliedMarkers : taskObservations.filter(isDecomposeProjectCall);
		if (markers.length === 0) {
			continue;
		}
		const boundary = markers.reduce((latest, entry) => (entry.recordedAt > latest.recordedAt ? entry : latest));
		const categoriesBefore = new Set<RuntimeKnowledgeToolCategory>();
		for (const entry of taskObservations) {
			if (entry.recordedAt < boundary.recordedAt && knowledgeCategories.has(entry.toolCategory)) {
				categoriesBefore.add(entry.toolCategory);
			}
		}
		const knowledgeCategoriesBefore = [...categoriesBefore].sort();
		signals.push({
			taskId,
			appVersion: boundary.appVersion,
			workspacePathHash: boundary.workspacePathHash,
			projectName: boundary.projectName,
			providerId: boundary.providerId,
			modelId: boundary.modelId,
			role: boundary.role,
			decomposedAt: boundary.recordedAt,
			applied: appliedMarkers.length > 0,
			usedKnowledgeTools: knowledgeCategoriesBefore.length > 0,
			knowledgeCategoriesBefore,
		});
	}
	return signals.sort((left, right) => right.decomposedAt - left.decomposedAt);
}

interface AggregateBucket {
	scope: DecompositionKnowledgeScope;
	appVersion: string | null;
	workspacePathHash: string | null;
	projectName: string | null;
	role: RuntimeModelPerformanceRole;
	providerId: string | null;
	modelId: string | null;
	signals: DecompositionKnowledgeSignal[];
}

/** Roll the per-decomposition signals up by scope (overall/version/project) × role × provider × model. */
export function aggregateDecompositionKnowledgeSignals(
	signals: readonly DecompositionKnowledgeSignal[],
): DecompositionKnowledgeUsageAggregate[] {
	const buckets = new Map<string, AggregateBucket>();
	const add = (
		scope: DecompositionKnowledgeScope,
		signal: DecompositionKnowledgeSignal,
		appVersion: string | null,
		workspacePathHash: string | null,
		projectName: string | null,
	): void => {
		const key = [
			scope,
			appVersion ?? "all_versions",
			workspacePathHash ?? "all_projects",
			signal.role,
			signal.providerId ?? "unknown_provider",
			signal.modelId ?? "unknown_model",
		].join("\0");
		const existing = buckets.get(key) ?? {
			scope,
			appVersion,
			workspacePathHash,
			projectName,
			role: signal.role,
			providerId: signal.providerId,
			modelId: signal.modelId,
			signals: [],
		};
		existing.signals.push(signal);
		buckets.set(key, existing);
	};
	for (const signal of signals) {
		add("overall", signal, null, null, null);
		add("version", signal, signal.appVersion, null, null);
		add("project", signal, signal.appVersion, signal.workspacePathHash, signal.projectName);
	}
	return [...buckets.entries()]
		.map(([key, bucket]) => {
			const withKnowledgeTools = bucket.signals.filter((signal) => signal.usedKnowledgeTools).length;
			const decompositions = bucket.signals.length;
			return {
				key,
				scope: bucket.scope,
				appVersion: bucket.appVersion,
				workspacePathHash: bucket.workspacePathHash,
				projectName: bucket.projectName,
				role: bucket.role,
				providerId: bucket.providerId,
				modelId: bucket.modelId,
				decompositions,
				withKnowledgeTools,
				withoutKnowledgeTools: decompositions - withKnowledgeTools,
				knowledgeUsageRate: decompositions > 0 ? withKnowledgeTools / decompositions : 0,
				lastDecomposedAt: Math.max(...bucket.signals.map((signal) => signal.decomposedAt)),
			} satisfies DecompositionKnowledgeUsageAggregate;
		})
		.sort(
			(left, right) => right.decompositions - left.decompositions || right.lastDecomposedAt - left.lastDecomposedAt,
		);
}
