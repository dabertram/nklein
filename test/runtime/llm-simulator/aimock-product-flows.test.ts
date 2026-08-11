import { mkdir, mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createSimulatorServer, type ScenarioScript } from "../../../packages/llm-simulator/src/index";
import {
	assessProjectInitializerBrief,
	buildProjectInitializerSeedPrompt,
	type ProjectInitializerBriefInput,
} from "../../../src/core/project-initializer";
import {
	createHierarchicalRepoSummaryTool,
	defaultHierarchicalRepoSummaryCachePath,
	type RepoSummaryRequest,
	refreshHierarchicalRepoSummary,
} from "../../../src/nklein-agent/nklein-hierarchical-repo-summary";
import { LocalLlmClient } from "../../../src/nklein-agent/nklein-local-llm-client";
import { createLocalRepoSummaryModelCaller } from "../../../src/nklein-agent/nklein-repo-summary-model-caller";

const completeBrief = (): ProjectInitializerBriefInput => ({
	mode: "beginner",
	projectKind: "greenfield",
	outcome: "Ship a local-first maintenance planner.",
	audience: "Small repair teams working offline.",
	stackRuntime: "Node.js 22, TypeScript, React, npm.",
	acceptanceCommands: "npm test && npm run build",
	successCriteria: "allow a technician to create and complete a maintenance job.",
	inScope: "Job entry, assignment, completion, and local export.",
	outOfScope: "Accounts, payments, and cloud sync.",
	domainConcepts: "A Job has Tasks; a Technician completes Tasks.",
	constraints: "Local-only storage. No hosted services.",
	uncertainties: "none known",
	effort: "medium",
	autonomy: "checkpoints",
	batchBrief: "",
	references: [],
});

interface ChatResponse {
	choices: Array<{
		message: { tool_calls: Array<{ function: { name: string; arguments: string } }> };
	}>;
}

async function postChat(baseUrl: string, body: unknown): Promise<ChatResponse> {
	const response = await fetch(`${baseUrl}/chat/completions`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
	expect(response.status).toBe(200);
	return (await response.json()) as ChatResponse;
}

describe("aimock coverage for product onboarding flows (F11.4b)", () => {
	it("takes the real initializer Q&A from blocking gaps to an aimock-served decomposition", async () => {
		const incomplete = completeBrief();
		incomplete.acceptanceCommands = "";
		expect(assessProjectInitializerBrief(incomplete)).toMatchObject({ ready: false });

		const brief = completeBrief();
		expect(assessProjectInitializerBrief(brief)).toMatchObject({ ready: true, blockingGaps: [] });
		const seed = buildProjectInitializerSeedPrompt("Aimock Atlas", brief);
		const scenario: ScenarioScript = {
			name: "initializer-q-and-a",
			seed: 11,
			tracks: [
				{
					id: "perfect-initializer-decompose",
					requestClass: "any",
					userMessageIncludes: "Aimock Atlas",
					turns: [
						{
							behavior: {
								kind: "tool_calls",
								calls: [
									{
										name: "decompose_project",
										arguments: {
											slug: "aimock-atlas",
											spec: "Local-first maintenance planner",
											plan: "Start with the job lifecycle.",
											tasks: [
												{
													id: "job-lifecycle",
													title: "Job lifecycle",
													prompt: "Implement the job lifecycle.",
												},
											],
										},
									},
								],
							},
						},
					],
				},
			],
		};
		const simulator = createSimulatorServer(scenario);
		await simulator.start();
		try {
			const completion = await postChat(simulator.url(), {
				model: "sim/onboarding",
				messages: [
					{ role: "system", content: "You are NKlein." },
					{ role: "user", content: [{ type: "text", text: seed }] },
				],
				tools: [{ type: "function", function: { name: "decompose_project", parameters: { type: "object" } } }],
			});
			const call = completion.choices[0].message.tool_calls[0];
			expect(call.function.name).toBe("decompose_project");
			expect(JSON.parse(call.function.arguments).tasks[0].id).toBe("job-lifecycle");
			expect(simulator.mock.getRequests()).toHaveLength(1);
		} finally {
			await simulator.stop();
		}
	});

	it("drives the real repo_summary tool and structured local-model caller entirely through aimock", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), "nklein-aimock-repo-summary-"));
		await mkdir(join(workspacePath, "src"), { recursive: true });
		await writeFile(
			join(workspacePath, "src", "math.ts"),
			"export function add(left: number, right: number): number { return left + right; }\n",
			"utf8",
		);
		const batches: RepoSummaryRequest[][] = [];
		await refreshHierarchicalRepoSummary({
			workspacePath,
			summarize: async (requests) => {
				batches.push([...requests]);
				return new Map(requests.map((request) => [request.id, `discovery summary for ${request.name}`]));
			},
		});
		await unlink(defaultHierarchicalRepoSummaryCachePath(workspacePath));

		const scenario: ScenarioScript = {
			name: "existing-codebase-repo-summary",
			seed: 17,
			tracks: batches.map((batch, index) => ({
				id: `perfect-repo-summary-batch-${index}`,
				requestClass: "chat" as const,
				userMessageIncludes: `<node id=${JSON.stringify(batch[0]?.id)}`,
				turns: [
					{
						behavior: {
							kind: "tool_calls" as const,
							calls: [
								{
									name: "repo_node_summaries",
									arguments: {
										summaries: batch.map((request) => ({
											id: request.id,
											summary: `Aimock summary for ${request.kind} ${request.name}.`,
										})),
									},
								},
							],
						},
					},
				],
			})),
		};
		const simulator = createSimulatorServer(scenario);
		await simulator.start();
		try {
			const client = new LocalLlmClient({
				providerId: "lmstudio",
				modelId: "sim/repo-indexer",
				baseUrl: simulator.url(),
			});
			const tool = createHierarchicalRepoSummaryTool({
				workspacePath,
				summarize: createLocalRepoSummaryModelCaller(client),
			});
			const output = (await tool.execute({ tokenBudget: 1_000 }, { agentId: "aimock", iteration: 1 })) as Record<
				string,
				unknown
			>;

			expect(output.cacheHit).toBe(false);
			expect(output.modelNodesSummarized).toBeGreaterThan(0);
			expect(output.map).toContain("Aimock summary");
			expect(simulator.mock.getRequests()).toHaveLength(batches.length);
			for (const entry of simulator.mock.getRequests()) {
				const body = (entry as { body?: Record<string, unknown> }).body;
				expect(body?.tool_choice).toBe("required");
				expect(JSON.stringify(body?.tools)).toContain("repo_node_summaries");
			}
		} finally {
			await simulator.stop();
			await rm(workspacePath, { recursive: true, force: true });
		}
	});
});
