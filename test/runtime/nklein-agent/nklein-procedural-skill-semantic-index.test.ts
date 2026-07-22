import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProceduralSkill, type ProceduralSkill } from "../../../src/core/procedural-skill-record";
import type {
	NKleinCodeEmbeddingProvider,
	NKleinCodeEmbeddingVector,
} from "../../../src/nklein-agent/nklein-code-embeddings";
import { matchProceduralSkillsHybrid } from "../../../src/nklein-agent/nklein-procedural-skill-semantic-index";

function skill(
	id: string,
	input: { description: string; tags?: string[]; status?: ProceduralSkill["status"] },
): ProceduralSkill {
	return createProceduralSkill({
		id,
		title: `Procedure ${id}`,
		description: input.description,
		content: "Run the validated steps.",
		contentHash: `hash-${id}`,
		applicabilityTags: input.tags ?? [],
		provenance: { source: "learned", trust: "workspace", capturedAt: 1 },
		status: input.status ?? "active",
		now: 1,
	});
}

function dense(...values: number[]): NKleinCodeEmbeddingVector {
	return new Map(values.map((value, index) => [`dim:${index}`, value]));
}

describe("matchProceduralSkillsHybrid (F4.19b)", () => {
	let indexRootDir: string;

	beforeEach(async () => {
		indexRootDir = await mkdtemp(join(tmpdir(), "nklein-procedural-semantic-index-"));
	});

	afterEach(async () => {
		await rm(indexRootDir, { recursive: true, force: true });
	});

	it("retrieves a natural-language synonym that lexical applicability tags cannot match", async () => {
		const embed = vi.fn(async (text: string) =>
			text.includes("database changes") || text.includes("roll out a column") ? dense(1, 0) : dense(0, 1),
		);
		const provider: NKleinCodeEmbeddingProvider = {
			kind: "local_gguf",
			model: "test-embedder",
			cacheKey: "test-embedder:v1",
			embed,
		};
		const matches = await matchProceduralSkillsHybrid({
			skills: [
				skill("database", { description: "Deploy database changes without downtime", tags: ["migration"] }),
				skill("frontend", { description: "Tune responsive page layout", tags: ["frontend"] }),
			],
			contextTags: ["worker", "column"],
			taskText: "Safely roll out a column to production",
			role: "worker",
			embeddingProvider: provider,
			indexRootDir,
		});

		expect(matches.map((match) => [match.skill.id, match.source])).toEqual([["database", "semantic"]]);
	});

	it("preserves lexical ranking first, excludes inactive skills, and caches description vectors", async () => {
		const embed = vi.fn(async (text: string) => (text.includes("unrelated query") ? dense(1, 0) : dense(1, 0)));
		const provider: NKleinCodeEmbeddingProvider = {
			kind: "openai_compatible",
			model: "local-server-embedder",
			cacheKey: "local-server-embedder:v1",
			embed,
		};
		const skills = [
			skill("lexical", { description: "Exact migration procedure", tags: ["migration"] }),
			skill("semantic", { description: "Semantically relevant procedure" }),
			skill("candidate", { description: "Must stay hidden", status: "candidate" }),
		];
		const input = {
			skills,
			contextTags: ["migration"],
			taskText: "an unrelated query",
			embeddingProvider: provider,
			indexRootDir,
			limit: 2,
		};
		const first = await matchProceduralSkillsHybrid(input);
		const callsAfterFirst = embed.mock.calls.length;
		const second = await matchProceduralSkillsHybrid(input);

		expect(first.map((match) => [match.skill.id, match.source])).toEqual([
			["lexical", "lexical"],
			["semantic", "semantic"],
		]);
		expect(second.map((match) => match.skill.id)).toEqual(["lexical", "semantic"]);
		expect(embed.mock.calls.length - callsAfterFirst).toBe(1); // query only; descriptions came from the index
	});

	it("returns the lexical baseline unchanged when the embedder throws or degrades to lexical vectors", async () => {
		const exact = skill("exact", { description: "Migration", tags: ["migration"] });
		const unavailable: NKleinCodeEmbeddingProvider = {
			kind: "openai_compatible",
			model: "offline",
			cacheKey: "offline",
			embed: async () => {
				throw new Error("offline");
			},
		};
		const degraded: NKleinCodeEmbeddingProvider = {
			kind: "local_gguf",
			model: "degraded",
			cacheKey: "degraded",
			embed: async () => new Map([["migration", 1]]),
		};
		for (const embeddingProvider of [unavailable, degraded]) {
			const matches = await matchProceduralSkillsHybrid({
				skills: [exact],
				contextTags: ["migration"],
				taskText: "run migration",
				embeddingProvider,
				indexRootDir,
			});
			expect(matches.map((match) => [match.skill.id, match.source])).toEqual([["exact", "lexical"]]);
		}
	});
});
