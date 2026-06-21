import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createNKleinDecompositionTools } from "../../../src/nklein-sdk/nklein-decomposition-tool";

/**
 * follow-up-6 §2.4: a "near-valid tool payload" fuzz suite for the highest-value orchestration tool. Small
 * local models routinely emit decompositions that are almost-but-not-quite schema-valid — stringified nested
 * arrays, `null` for omitted optional fields, harmless extra keys, an extra trailing brace. These must be
 * tolerated (recovered and validated), while genuinely broken graphs must fail with a clear instruction.
 */

type DecomposeResult = { ok: boolean; taskCount: number; graphQualityWarnings?: string[] };

async function runDecompose(payload: Record<string, unknown>): Promise<DecomposeResult> {
	const workspacePath = await mkdtemp(join(tmpdir(), "nklein-decompose-fuzz-"));
	const tool = createNKleinDecompositionTools({ workspacePath }).find(
		(candidate) => candidate.name === "decompose_project",
	);
	if (!tool) {
		throw new Error("Missing decompose_project tool");
	}
	return (await tool.execute(payload, undefined as never)) as DecomposeResult;
}

const VALID_TASKS = [
	{
		id: "storage",
		title: "Create storage",
		prompt: "Implement persistent storage.",
		dependsOn: [],
		complexity: 30,
		filesLikelyTouched: ["src/storage.ts"],
		acceptanceCommand: "npm test",
	},
	{
		id: "ui",
		title: "Create the habit list view",
		prompt: "Implement the habit list view.",
		dependsOn: ["storage"],
		complexity: 45,
		filesLikelyTouched: ["src/App.tsx"],
		acceptanceCommand: "npm test",
	},
];

function basePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		slug: "Habit Tracker",
		title: "Habit Tracker",
		spec: "Track habits.",
		plan: "Build storage before the view.",
		tasks: VALID_TASKS,
		...overrides,
	};
}

describe("decompose_project near-valid payload tolerance", () => {
	const tolerated: Array<[string, Record<string, unknown>]> = [
		["plain array of tasks", basePayload()],
		["JSON-stringified task array", basePayload({ tasks: JSON.stringify(VALID_TASKS) })],
		["stringified task array with a stray trailing brace", basePayload({ tasks: `${JSON.stringify(VALID_TASKS)}}` })],
		[
			"null for omitted optional fields",
			basePayload({
				summary: null,
				defaultAcceptanceCommand: null,
				tasks: VALID_TASKS.map((task) => ({
					...task,
					suggestedRole: null,
					acceptanceTestPrompt: null,
					knowledgeDebt: null,
				})),
			}),
		],
		[
			"knowledgeDebt populated on a card",
			basePayload({
				tasks: VALID_TASKS.map((task) => ({ ...task, knowledgeDebt: "phase alignment unverified" })),
			}),
		],
		[
			"harmless extra keys on task entries",
			basePayload({
				tasks: VALID_TASKS.map((task) => ({ ...task, startLine: 1, endLine: 9, note: "from read tool" })),
			}),
		],
	];

	for (const [name, payload] of tolerated) {
		it(`tolerates ${name}`, async () => {
			const result = await runDecompose(payload);
			expect(result.ok).toBe(true);
			expect(result.taskCount).toBe(2);
		});
	}

	it("rejects an incoherent graph (test card not depending on implementation) with a clear instruction", async () => {
		await expect(
			runDecompose(
				basePayload({
					tasks: [
						...VALID_TASKS,
						{
							id: "tests",
							title: "Add acceptance tests",
							prompt: "Write the acceptance tests.",
							dependsOn: [],
							complexity: 20,
							filesLikelyTouched: ["test/app.test.ts"],
							acceptanceCommand: "npm test",
						},
					],
				}),
			),
		).rejects.toThrow(/dependency-coherence|implementation card/i);
	});

	it("rejects a task missing a machine-checkable acceptance command", async () => {
		await expect(
			runDecompose(
				basePayload({
					defaultAcceptanceCommand: null,
					tasks: [{ id: "lonely", title: "Do a thing", prompt: "Do it." }],
				}),
			),
		).rejects.toThrow(/acceptanceCommand/);
	});
});
