import type { RepositoryBenchmarkSource, SwebenchInstance } from "./swebench-benchmark";

export type FreshBenchmarkLeakageKind = "known_memorization" | "path_recall" | "public_solution_match";

export interface FreshBenchmarkLeakageHit {
	instanceId: string;
	kind: FreshBenchmarkLeakageKind;
	evidence: string;
}

export interface FreshBenchmarkExclusion {
	instanceId: string;
	reason: "missing_created_at" | "pre_cutoff" | "leakage_hit" | "selection_limit";
	detail: string;
}

export interface FreshBenchmarkTrack {
	schemaVersion: 1;
	cutoff: string;
	modelCutoffs: Readonly<Record<string, string>>;
	sources: readonly Extract<RepositoryBenchmarkSource, "swebench_live" | "swe_rebench">[];
	instanceIds: readonly string[];
	exclusions: readonly FreshBenchmarkExclusion[];
	leakageHits: readonly FreshBenchmarkLeakageHit[];
}

const FRESH_SOURCES = new Set<RepositoryBenchmarkSource>(["swebench_live", "swe_rebench"]);
const LEAKAGE_KINDS = new Set<FreshBenchmarkLeakageKind>([
	"known_memorization",
	"path_recall",
	"public_solution_match",
]);

function parseDate(value: string, label: string): number {
	const parsed = Date.parse(value);
	if (!Number.isFinite(parsed)) throw new Error(`${label} must be an ISO-compatible date.`);
	return parsed;
}

function normalizeCutoffs(cutoffs: Readonly<Record<string, string>>): {
	values: Readonly<Record<string, string>>;
	latest: number | null;
} {
	const entries = Object.entries(cutoffs)
		.map(([modelId, cutoff]) => {
			const id = modelId.trim();
			if (!id) throw new Error("Model cutoff ids must be non-empty.");
			return [id, new Date(parseDate(cutoff, `Cutoff for ${id}`)).toISOString()] as const;
		})
		.sort(([left], [right]) => left.localeCompare(right));
	return {
		values: Object.fromEntries(entries),
		latest: entries.length === 0 ? null : Math.max(...entries.map(([, cutoff]) => Date.parse(cutoff))),
	};
}

function normalizeLeakageHits(
	hits: readonly FreshBenchmarkLeakageHit[],
	knownIds: ReadonlySet<string>,
): readonly FreshBenchmarkLeakageHit[] {
	const seen = new Set<string>();
	return [...hits]
		.map((hit) => {
			const instanceId = hit.instanceId.trim();
			const evidence = hit.evidence.trim();
			if (!knownIds.has(instanceId)) throw new Error(`Leakage hit references unknown instance ${instanceId}.`);
			if (!LEAKAGE_KINDS.has(hit.kind))
				throw new Error(`Leakage hit for ${instanceId} has invalid kind ${hit.kind}.`);
			if (!evidence) throw new Error(`Leakage hit for ${instanceId} requires concrete evidence.`);
			const key = `${instanceId}\u0000${hit.kind}`;
			if (seen.has(key)) throw new Error(`Duplicate leakage hit for ${instanceId} (${hit.kind}).`);
			seen.add(key);
			return { instanceId, kind: hit.kind, evidence };
		})
		.sort((left, right) => left.instanceId.localeCompare(right.instanceId) || left.kind.localeCompare(right.kind));
}

export function buildFreshBenchmarkTrack(input: {
	instances: readonly SwebenchInstance[];
	freshAfter?: string;
	modelCutoffs?: Readonly<Record<string, string>>;
	leakageHits?: readonly FreshBenchmarkLeakageHit[];
	limit?: number;
}): FreshBenchmarkTrack {
	if (input.limit !== undefined && (!Number.isInteger(input.limit) || input.limit <= 0)) {
		throw new Error("Fresh benchmark limit must be a positive integer.");
	}
	const instances = [...input.instances].sort((left, right) => left.instanceId.localeCompare(right.instanceId));
	const knownIds = new Set(instances.map((instance) => instance.instanceId));
	if (knownIds.size !== instances.length) throw new Error("Fresh benchmark instances must have unique ids.");
	for (const instance of instances) {
		if (!FRESH_SOURCES.has(instance.source)) {
			throw new Error(`Fresh benchmark track cannot claim source ${instance.source} for ${instance.instanceId}.`);
		}
	}

	const explicitCutoff = input.freshAfter ? parseDate(input.freshAfter, "freshAfter") : null;
	const modelCutoffs = normalizeCutoffs(input.modelCutoffs ?? {});
	const cutoffMs = Math.max(
		explicitCutoff ?? Number.NEGATIVE_INFINITY,
		modelCutoffs.latest ?? Number.NEGATIVE_INFINITY,
	);
	if (!Number.isFinite(cutoffMs)) {
		throw new Error("Fresh benchmark track requires --fresh-after or at least one model cutoff.");
	}
	const cutoff = new Date(cutoffMs).toISOString();
	const leakageHits = normalizeLeakageHits(input.leakageHits ?? [], knownIds);
	const leakedIds = new Set(leakageHits.map((hit) => hit.instanceId));
	const exclusions: FreshBenchmarkExclusion[] = [];
	const candidates: SwebenchInstance[] = [];

	for (const instance of instances) {
		if (instance.createdAt === null) {
			exclusions.push({
				instanceId: instance.instanceId,
				reason: "missing_created_at",
				detail: "No creation date; freshness cannot be established.",
			});
			continue;
		}
		const createdAt = parseDate(instance.createdAt, `created_at for ${instance.instanceId}`);
		if (createdAt < cutoffMs) {
			exclusions.push({ instanceId: instance.instanceId, reason: "pre_cutoff", detail: instance.createdAt });
			continue;
		}
		if (leakedIds.has(instance.instanceId)) {
			exclusions.push({
				instanceId: instance.instanceId,
				reason: "leakage_hit",
				detail: "Explicit leakage evidence excludes this instance from the reasons-vs-recalls lane.",
			});
			continue;
		}
		candidates.push(instance);
	}

	const selected = candidates.slice(0, input.limit ?? candidates.length);
	const selectedIds = new Set(selected.map((instance) => instance.instanceId));
	for (const instance of candidates) {
		if (!selectedIds.has(instance.instanceId)) {
			exclusions.push({
				instanceId: instance.instanceId,
				reason: "selection_limit",
				detail: "Outside deterministic selection limit (not scored).",
			});
		}
	}
	const sources = [...new Set(selected.map((instance) => instance.source))].sort() as FreshBenchmarkTrack["sources"];
	return {
		schemaVersion: 1,
		cutoff,
		modelCutoffs: modelCutoffs.values,
		sources,
		instanceIds: selected.map((instance) => instance.instanceId),
		exclusions: exclusions.sort((left, right) => left.instanceId.localeCompare(right.instanceId)),
		leakageHits,
	};
}
