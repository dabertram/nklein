import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { resolveNkleinRuntimeHomePath } from "../config/runtime-paths";
import type { ProceduralSkill } from "../core/procedural-skill-record";
import { proceduralSkillHelpedRate } from "../core/procedural-skill-record";
import { isRetrievableProceduralSkill, matchProceduralSkills } from "../core/procedural-skill-retrieval";
import { lockedFileSystem } from "../fs/locked-file-system";
import type { NKleinCodeEmbeddingProvider, NKleinCodeEmbeddingVector } from "./nklein-code-embeddings";
import { cosineSimilarity, entriesToVector, vectorToEntries } from "./nklein-sparse-vector";

const PROCEDURAL_SKILL_SEMANTIC_INDEX_VERSION = 1;
const DEFAULT_LIMIT = 3;
const DEFAULT_MIN_SIMILARITY = 0.2;

const semanticIndexEntrySchema = z.object({
	descriptionHash: z.string(),
	vector: z.array(z.tuple([z.string(), z.number()])),
});
const semanticIndexSchema = z.object({
	version: z.literal(PROCEDURAL_SKILL_SEMANTIC_INDEX_VERSION),
	providerCacheKey: z.string(),
	providerKind: z.string(),
	providerModel: z.string(),
	entries: z.record(z.string(), semanticIndexEntrySchema),
});

type SemanticIndexSnapshot = z.infer<typeof semanticIndexSchema>;

export interface ProceduralSkillHybridMatch {
	readonly skill: ProceduralSkill;
	readonly source: "lexical" | "semantic";
	readonly lexicalOverlap: number;
	readonly semanticSimilarity: number | null;
}

export interface MatchProceduralSkillsHybridInput {
	readonly skills: readonly ProceduralSkill[];
	readonly contextTags: readonly string[];
	readonly taskText: string;
	readonly role?: string | null;
	readonly embeddingProvider?: NKleinCodeEmbeddingProvider;
	/** Same directory as `procedural-skill-store`; injectable so tests never touch the real runtime home. */
	readonly indexRootDir?: string;
	readonly limit?: number;
	readonly minSimilarity?: number;
}

const indexBuildsInFlight = new Map<string, Promise<Map<string, NKleinCodeEmbeddingVector>>>();

function hashText(text: string): string {
	return createHash("sha256").update(text).digest("hex");
}

/** Only dense vectors are semantic evidence. A provider's lexical degradation must fall back to lexical retrieval. */
function isDenseVector(vector: NKleinCodeEmbeddingVector): boolean {
	return vector.size > 0 && [...vector.keys()].every((key) => key.startsWith("dim:"));
}

function renderSkillDescription(skill: ProceduralSkill): string {
	return skill.description?.trim() || skill.title.trim();
}

function resolveIndexPath(rootDir?: string): string {
	const root = rootDir ?? join(resolveNkleinRuntimeHomePath(homedir()), "procedural-skills");
	return join(root, "semantic-index-v1.json");
}

async function readIndex(indexPath: string): Promise<SemanticIndexSnapshot | null> {
	try {
		const parsed = semanticIndexSchema.safeParse(JSON.parse(await readFile(indexPath, "utf8")));
		return parsed.success ? parsed.data : null;
	} catch {
		return null;
	}
}

function skillSetFingerprint(skills: readonly ProceduralSkill[]): string {
	return hashText(
		skills
			.map((skill) => `${skill.id}:${hashText(renderSkillDescription(skill))}`)
			.sort()
			.join("\n"),
	);
}

async function buildSemanticIndex(input: {
	skills: readonly ProceduralSkill[];
	provider: NKleinCodeEmbeddingProvider;
	indexPath: string;
}): Promise<Map<string, NKleinCodeEmbeddingVector>> {
	const existing = await readIndex(input.indexPath);
	const compatible = existing?.providerCacheKey === input.provider.cacheKey ? existing : null;
	const vectors = new Map<string, NKleinCodeEmbeddingVector>();
	const persistedEntries: SemanticIndexSnapshot["entries"] = {};
	let changed = !compatible || Object.keys(compatible.entries).length !== input.skills.length;
	for (const skill of input.skills) {
		const description = renderSkillDescription(skill);
		const descriptionHash = hashText(description);
		const cached = compatible?.entries[skill.id];
		const cachedVector = cached?.descriptionHash === descriptionHash ? entriesToVector(cached.vector) : null;
		const vector =
			cachedVector && isDenseVector(cachedVector) ? cachedVector : await input.provider.embed(description);
		// The local GGUF provider deliberately degrades each failed call to a lexical vector while retaining its dense
		// cache key. Never persist that degraded vector as a semantic index entry or it could poison future healthy calls.
		if (!isDenseVector(vector)) {
			throw new Error(`Semantic embedding unavailable while indexing procedural skill ${skill.id}.`);
		}
		changed ||= vector !== cachedVector;
		vectors.set(skill.id, vector);
		persistedEntries[skill.id] = { descriptionHash, vector: vectorToEntries(vector) };
	}
	if (changed) {
		await lockedFileSystem.writeJsonFileAtomic(input.indexPath, {
			version: PROCEDURAL_SKILL_SEMANTIC_INDEX_VERSION,
			providerCacheKey: input.provider.cacheKey,
			providerKind: input.provider.kind,
			providerModel: input.provider.model,
			entries: persistedEntries,
		});
	}
	return vectors;
}

async function ensureSemanticIndex(input: {
	skills: readonly ProceduralSkill[];
	provider: NKleinCodeEmbeddingProvider;
	indexPath: string;
}): Promise<Map<string, NKleinCodeEmbeddingVector>> {
	const buildKey = `${input.indexPath}:${input.provider.cacheKey}:${skillSetFingerprint(input.skills)}`;
	const inFlight = indexBuildsInFlight.get(buildKey);
	if (inFlight) {
		return await inFlight;
	}
	const build = buildSemanticIndex(input).finally(() => {
		if (indexBuildsInFlight.get(buildKey) === build) {
			indexBuildsInFlight.delete(buildKey);
		}
	});
	indexBuildsInFlight.set(buildKey, build);
	return await build;
}

/**
 * Hybrid procedural retrieval that can only add to the proven lexical baseline. Exact applicability-tag matches retain
 * their existing order; semantic-only matches fill remaining slots. Any absent/unavailable/degraded embedder returns
 * the lexical result unchanged, so a local inference outage cannot hide a procedure that was previously retrievable.
 */
export async function matchProceduralSkillsHybrid(
	input: MatchProceduralSkillsHybridInput,
): Promise<ProceduralSkillHybridMatch[]> {
	const limit = input.limit ?? DEFAULT_LIMIT;
	const lexical = matchProceduralSkills(input.skills, input.contextTags, { limit: 0 }).map((match) => ({
		skill: match.skill,
		source: "lexical" as const,
		lexicalOverlap: match.overlap,
		semanticSimilarity: null,
	}));
	const cappedLexical = limit > 0 ? lexical.slice(0, limit) : lexical;
	const provider = input.embeddingProvider;
	if (!provider || provider.kind === "local_lexical" || (limit > 0 && cappedLexical.length >= limit)) {
		return cappedLexical;
	}
	const eligible = input.skills.filter(isRetrievableProceduralSkill);
	if (eligible.length === 0 || input.taskText.trim().length === 0) {
		return cappedLexical;
	}
	try {
		const queryText = [input.role?.trim(), input.taskText.trim()].filter(Boolean).join("\n");
		const queryVector = await provider.embed(queryText);
		if (!isDenseVector(queryVector)) {
			return cappedLexical;
		}
		const vectors = await ensureSemanticIndex({
			skills: eligible,
			provider,
			indexPath: resolveIndexPath(input.indexRootDir),
		});
		const alreadySelected = new Set(lexical.map((match) => match.skill.id));
		const semantic = eligible
			.filter((skill) => !alreadySelected.has(skill.id))
			.map((skill) => ({
				skill,
				source: "semantic" as const,
				lexicalOverlap: 0,
				semanticSimilarity: cosineSimilarity(queryVector, vectors.get(skill.id) ?? new Map()),
			}))
			.filter((match) => match.semanticSimilarity >= (input.minSimilarity ?? DEFAULT_MIN_SIMILARITY))
			.sort(
				(left, right) =>
					right.semanticSimilarity - left.semanticSimilarity ||
					proceduralSkillHelpedRate(right.skill) - proceduralSkillHelpedRate(left.skill) ||
					left.skill.title.localeCompare(right.skill.title),
			);
		const combined = [...lexical, ...semantic];
		return limit > 0 ? combined.slice(0, limit) : combined;
	} catch {
		return cappedLexical;
	}
}
