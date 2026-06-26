import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	normalizeDecomposeProjectToolInput,
	recoverMissingDecomposeProjectTitle,
} from "../../../src/nklein-agent/decomposition/plan-task-input-parse";
import { createNKleinDecompositionTools } from "../../../src/nklein-agent/nklein-decomposition-tool";

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
		[
			// Live evidence (2026-06-22T13-07): the model typo'd `acceptanceCommand` as `acceptenceCommand`.
			// The unknown key is stripped and the task falls back to the top-level defaultAcceptanceCommand.
			"a typo'd acceptance-command key falling back to defaultAcceptanceCommand",
			basePayload({
				defaultAcceptanceCommand: "npm test",
				tasks: VALID_TASKS.map(({ acceptanceCommand: _dropped, ...rest }) => ({
					...rest,
					acceptenceCommand: "npm test",
				})),
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

/**
 * Live-bug regression (evidence 2026-06-22T12-09): a small model called decompose_project with
 * typo'd task fields, then degraded into empty `{}` calls. The SDK used to pre-reject these against a
 * strict inputSchema with a multi-KB Zod dump the model could not recover from. The boundary schema is
 * now permissive and this handler must answer with a SHORT, directive message naming what is missing —
 * never an empty-arg success and never a giant dump.
 */
describe("decompose_project malformed-call recovery", () => {
	async function expectShortRejection(payload: Record<string, unknown>, pattern: RegExp): Promise<void> {
		let thrown: unknown;
		try {
			await runDecompose(payload);
		} catch (error) {
			thrown = error;
		}
		expect(thrown, "decompose_project should reject malformed input").toBeInstanceOf(Error);
		const message = (thrown as Error).message;
		expect(message).toMatch(pattern);
		// Must stay short and directive — not the SDK's multi-KB raw validation dump.
		expect(message.length).toBeLessThan(600);
	}

	it("rejects an empty {} call by naming the required fields", async () => {
		await expectShortRejection({}, /no arguments[\s\S]*slug[\s\S]*tasks/i);
	});

	it("rejects a call missing the tasks field", async () => {
		const { tasks: _tasks, ...withoutTasks } = basePayload();
		await expectShortRejection(withoutTasks, /missing required fields[\s\S]*tasks/i);
	});

	it("rejects a task with a typo'd id field (tasks_id instead of id) with a compact message", async () => {
		await expectShortRejection(
			basePayload({
				tasks: [{ tasks_id: "storage", title: "Create storage", prompt: "Implement persistent storage." }],
			}),
			/id|failed validation/i,
		);
	});

	it("rejects blank-string required fields rather than treating them as present", async () => {
		await expectShortRejection(basePayload({ slug: "   " }), /missing required fields[\s\S]*slug/i);
	});

	it("tolerates a missing title by recovering it from the slug (small models routinely omit it)", async () => {
		const { title: _title, ...withoutTitle } = basePayload();
		const result = await runDecompose(withoutTitle);
		expect(result.ok).toBe(true);
		expect(result.taskCount).toBe(2);
	});

	it("recovers the title as the slug at the parse layer and leaves a real title untouched", () => {
		const { title: _title, ...withoutTitle } = basePayload({ slug: "habit-tracker" });
		const recovered = recoverMissingDecomposeProjectTitle(withoutTitle) as Record<string, unknown>;
		expect(recovered.title).toBe("habit-tracker");
		const normalized = normalizeDecomposeProjectToolInput(withoutTitle);
		expect(normalized.title).toBe("habit-tracker");
		expect(normalized.taskGraph.title).toBe("habit-tracker");
		// A present, usable title is left untouched.
		expect(recoverMissingDecomposeProjectTitle(basePayload({ title: "Real Title" }))).toMatchObject({
			title: "Real Title",
		});
	});
});

/**
 * The SDK validates the tool's inputSchema BEFORE our handler runs. If any node in that tree is a closed object
 * (`additionalProperties: false`) or has `required`, the SDK pre-rejects a slightly-malformed call with a raw
 * Zod dump that bypasses our recoverable in-handler errors. So the *wired* boundary schema must be permissive at
 * every depth — top-level, task items, and questions — while preserving the expansions map's value schema.
 */
describe("decompose_project SDK boundary schema is permissive at every depth", () => {
	// A generated JSON Schema tree is heterogeneous and deeply navigated below (`.properties.tasks.anyOf[0].items`,
	// …), so `any` is the pragmatic boundary type — the audit's sanctioned narrow exception for schema-probe tests.
	// biome-ignore lint/suspicious/noExplicitAny: walking an untyped, deeply-nested JSON Schema tree in a boundary probe.
	type JsonSchemaNode = Record<string, any>;

	function getInputSchema(): JsonSchemaNode {
		const tool = createNKleinDecompositionTools({ workspacePath: "/tmp/nklein-schema-probe" }).find(
			(candidate) => candidate.name === "decompose_project",
		);
		if (!tool) {
			throw new Error("Missing decompose_project tool");
		}
		return tool.inputSchema as JsonSchemaNode;
	}

	function expectOpenObject(node: JsonSchemaNode | undefined): void {
		expect(node).toBeDefined();
		expect(node?.type).toBe("object");
		expect(node?.required).toBeUndefined();
		expect(node?.additionalProperties).not.toBe(false);
	}

	it("leaves the top-level object open", () => {
		expectOpenObject(getInputSchema());
	});

	it("leaves nested task items open (so a typo'd or missing task field cannot pre-reject)", () => {
		const taskItems = getInputSchema().properties.tasks.anyOf[0].items;
		expectOpenObject(taskItems);
		// Descriptions are preserved so the model still gets guidance.
		expect(taskItems.properties.id).toBeDefined();
	});

	it("leaves nested questions items open", () => {
		expectOpenObject(getInputSchema().properties.questions.items);
	});

	it("preserves the expansions map's value schema rather than dropping it", () => {
		const expansions = getInputSchema().properties.expansions.anyOf[0];
		// `additionalProperties` here is the map's VALUE schema (a task array), not a closed-object flag.
		expect(typeof expansions.additionalProperties).toBe("object");
	});
});
