import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	buildNKleinDogfoodBacklog,
	readNKleinDogfoodTelemetry,
	writeNKleinDogfoodBacklog,
} from "../../../src/nklein-agent/nklein-dogfood-engine";
import type { SelfObservationEventRecord } from "../../../src/telemetry/self-observation-sink";

function createEvent(input: Partial<SelfObservationEventRecord> = {}): SelfObservationEventRecord {
	return {
		schemaVersion: 1,
		signal: input.signal ?? "runtime_error",
		severity: input.severity ?? "error",
		message: input.message ?? "Runtime crashed",
		taskId: input.taskId ?? null,
		runId: input.runId ?? null,
		providerId: input.providerId ?? null,
		modelId: input.modelId ?? null,
		workspacePath: input.workspacePath ?? "/repo",
		metadata: input.metadata,
		createdAt: input.createdAt ?? Date.UTC(2026, 0, 2),
	};
}

describe("nklein dogfood engine", () => {
	it("reads valid self-observation JSONL records and skips invalid lines", async () => {
		const rootDir = await mkdtemp(join(tmpdir(), "kanban-dogfood-telemetry-"));
		await writeFile(
			join(rootDir, "2026-01-02.jsonl"),
			[
				JSON.stringify(createEvent({ message: "First", createdAt: 10 })),
				"not-json",
				JSON.stringify({ schemaVersion: 1, signal: "unknown", severity: "error", message: "bad" }),
				JSON.stringify(createEvent({ message: "Second", createdAt: 20 })),
			].join("\n"),
			"utf8",
		);

		const events = await readNKleinDogfoodTelemetry(rootDir);

		expect(events.map((event) => event.message)).toEqual(["Second", "First"]);
	});

	it("clusters observations into ranked task-graph candidates", () => {
		const backlog = buildNKleinDogfoodBacklog({
			slug: "dogfood-test",
			now: () => Date.UTC(2026, 0, 2),
			events: [
				createEvent({
					signal: "context_overflow",
					severity: "warning",
					message: "Context overflow at 12000 tokens",
					metadata: { filesLikelyTouched: ["src/nklein-agent/nklein-context-focus-policy.ts"] },
				}),
				createEvent({
					signal: "context_overflow",
					severity: "warning",
					message: "Context overflow at 14000 tokens",
					metadata: { filesLikelyTouched: ["src/nklein-agent/nklein-context-focus-policy.ts"] },
				}),
				createEvent({
					signal: "tool_error",
					severity: "error",
					message: "Tool failed once",
				}),
			],
		});

		expect(backlog.taskGraph.slug).toBe("dogfood-test");
		expect(backlog.candidates).toHaveLength(2);
		expect(backlog.candidates[0]?.signals).toEqual(["context_overflow"]);
		expect(backlog.taskGraph.tasks[0]).toMatchObject({
			acceptanceCommand: "npm run typecheck && npm run test:fast",
			suggestedRole: "worker",
		});
	});

	it("marks protected path clusters for human approval", () => {
		const backlog = buildNKleinDogfoodBacklog({
			events: [
				createEvent({
					metadata: {
						filesLikelyTouched: ["src/security/passcode-manager.ts", "src/components/app.tsx"],
					},
				}),
			],
		});

		expect(backlog.candidates[0]).toMatchObject({
			requiresHumanApproval: true,
			protectedPaths: ["src/security/passcode-manager.ts"],
			trustedAutoMerge: expect.objectContaining({
				allowed: false,
			}),
		});
		expect(backlog.taskGraph.tasks[0]).toMatchObject({
			complexity: 40,
			suggestedRole: "architect",
		});
	});

	it("caps generated task graphs to the decomposition sizing contract", () => {
		const backlog = buildNKleinDogfoodBacklog({
			events: [
				createEvent({
					severity: "error",
					metadata: {
						filesLikelyTouched: ["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts"],
					},
				}),
			],
		});

		expect(backlog.taskGraph.tasks[0]?.complexity).toBeLessThanOrEqual(75);
		expect(backlog.taskGraph.tasks[0]?.filesLikelyTouched).toHaveLength(3);
	});

	it("turns user suggestions into dogfood task candidates", () => {
		const backlog = buildNKleinDogfoodBacklog({
			events: [],
			userSuggestions: ["Make stalled task diagnostics easier to understand."],
		});

		expect(backlog.candidates).toHaveLength(1);
		expect(backlog.candidates[0]).toMatchObject({
			id: "suggestion-1",
			title: "Dogfood: user suggested improvement",
			signals: ["custom"],
			severity: "warning",
		});
		expect(backlog.taskGraph.tasks[0]).toMatchObject({
			id: "suggestion-1",
			suggestedRole: "worker",
			acceptanceCommand: "npm run typecheck && npm run test:fast",
		});
		expect(backlog.taskGraph.tasks[0]?.prompt).toContain("Make stalled task diagnostics easier to understand.");
	});

	it("writes dogfood plan artifacts that existing decomposition can consume", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), "kanban-dogfood-workspace-"));
		const telemetryRootDir = await mkdtemp(join(tmpdir(), "kanban-dogfood-telemetry-"));
		await writeFile(
			join(telemetryRootDir, "2026-01-02.jsonl"),
			`${JSON.stringify(createEvent({ signal: "verification_failed", message: "Acceptance failed" }))}\n`,
			"utf8",
		);

		const artifacts = await writeNKleinDogfoodBacklog({
			workspacePath,
			telemetryRootDir,
			slug: "dogfood-output",
			now: () => Date.UTC(2026, 0, 2),
		});

		expect(artifacts.taskGraph.tasks).toHaveLength(1);
		await expect(
			readFile(join(workspacePath, ".nklein/nklein/plans/dogfood-output/plan.md"), "utf8"),
		).resolves.toContain("Trusted auto-merge: blocked");
		await expect(
			readFile(join(workspacePath, ".nklein/nklein/plans/dogfood-output/tasks.json"), "utf8"),
		).resolves.toContain("verification_failed");
	});
});
