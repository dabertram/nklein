/**
 * F12.107 — the UI runner's server half: list a workspace's ADW definitions and execute runs in-process with
 * live per-step status the UI polls. The pure orchestrator stays `runAdwWorkflow` (src/core/adw-workflow.ts);
 * this module wires SERVER executors — deterministic steps host-side via `sh -c` with evidence files, agent
 * steps seeded through the injected card seeder (the normal board path; the autonomous ready-sweep starts them)
 * and polled to a terminal lane.
 *
 * Runs live in a bounded in-process registry (a restart forgets run STATUS; the evidence directory and any
 * seeded cards persist — honest, and the same posture as the CLI runner).
 */

import { execFile } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	type AdwAgentStep,
	type AdwDeterministicStep,
	type AdwWorkflow,
	adwWorkflowSchema,
	isSafeAdwName,
	runAdwWorkflow,
} from "../core/adw-workflow";
import { loadWorkspaceBoardById } from "../state/workspace-state";

export interface AdwWorkflowFileSummary {
	name: string;
	description: string | null;
	stepCount: number;
	agentStepCount: number;
	/** Parse/validation error when the file is unusable (the UI shows it instead of a run button). */
	invalid: string | null;
}

export interface AdwRunStepStatus {
	id: string;
	kind: "deterministic" | "agent";
	status: "pending" | "running" | "ok" | "fail" | "skipped";
	detail: string | null;
	cardId: string | null;
}

export interface AdwRunSnapshot {
	runId: string;
	name: string;
	input: string;
	startedAt: number;
	finishedAt: number | null;
	verdict: "running" | "pass" | "fail";
	steps: AdwRunStepStatus[];
	evidenceDir: string | null;
	error: string | null;
}

const MAX_TRACKED_RUNS = 50;
const AGENT_CARD_POLL_INTERVAL_MS = 5_000;
const TERMINAL_LANES = new Set(["completed", "trash"]);

const runsById = new Map<string, AdwRunSnapshot>();

function trackRun(snapshot: AdwRunSnapshot): void {
	runsById.set(snapshot.runId, snapshot);
	if (runsById.size > MAX_TRACKED_RUNS) {
		// FIFO-evict the oldest FINISHED run; never evict a live one.
		for (const [runId, run] of runsById) {
			if (run.finishedAt !== null) {
				runsById.delete(runId);
				break;
			}
		}
	}
}

export function getAdwRunSnapshot(runId: string): AdwRunSnapshot | null {
	const run = runsById.get(runId);
	return run ? { ...run, steps: run.steps.map((step) => ({ ...step })) } : null;
}

/** Test seam. */
export function resetAdwRuns(): void {
	runsById.clear();
}

export async function listAdwWorkflowFiles(workspacePath: string): Promise<AdwWorkflowFileSummary[]> {
	const dir = join(workspacePath, ".nklein", "workflows");
	let entries: string[] = [];
	try {
		entries = (await readdir(dir)).filter((entry) => entry.endsWith(".json"));
	} catch {
		return [];
	}
	const summaries: AdwWorkflowFileSummary[] = [];
	for (const entry of entries.sort()) {
		const name = entry.replace(/\.json$/, "");
		if (!isSafeAdwName(name)) {
			continue;
		}
		try {
			const workflow = adwWorkflowSchema.parse(JSON.parse(await readFile(join(dir, entry), "utf8")));
			summaries.push({
				name,
				description: workflow.description ?? null,
				stepCount: workflow.steps.length,
				agentStepCount: workflow.steps.filter((step) => step.kind === "agent").length,
				invalid: null,
			});
		} catch (error) {
			summaries.push({
				name,
				description: null,
				stepCount: 0,
				agentStepCount: 0,
				invalid: error instanceof Error ? error.message.slice(0, 300) : String(error),
			});
		}
	}
	return summaries;
}

function runShellCommand(
	command: string,
	options: { cwd: string; timeoutMs: number },
): Promise<{ exitCode: number | null; output: string; timedOut: boolean }> {
	return new Promise((resolve) => {
		const child = execFile(
			"/bin/sh",
			["-c", command],
			{ cwd: options.cwd, timeout: options.timeoutMs, maxBuffer: 16 * 1024 * 1024 },
			(error, stdout, stderr) => {
				const output = `${stdout ?? ""}${stderr ? `\n${stderr}` : ""}`;
				const timedOut = Boolean(error && "killed" in error && error.killed === true);
				const exitCode =
					error && typeof (error as { code?: unknown }).code === "number"
						? ((error as { code: number }).code as number)
						: error
							? (child.exitCode ?? null)
							: 0;
				resolve({ exitCode: error ? exitCode : 0, output, timedOut });
			},
		);
	});
}

export interface StartAdwRunInput {
	workspacePath: string;
	workspaceId: string;
	name: string;
	runInput: string;
	/** Seed the agent step's card onto the board (normal card path); resolves the created card id. */
	seedAgentCard: (card: { title: string; prompt: string }) => Promise<string>;
	/** Optional: arm the board machinery (watchdog warm-up) so seeded cards are swept on headless boards. */
	warmWorkspace?: () => Promise<void>;
	now?: () => number;
}

export async function startAdwRun(
	input: StartAdwRunInput,
): Promise<{ ok: true; runId: string } | { ok: false; error: string }> {
	if (!isSafeAdwName(input.name)) {
		return { ok: false, error: "Invalid workflow name." };
	}
	const path = join(input.workspacePath, ".nklein", "workflows", `${input.name}.json`);
	let workflow: AdwWorkflow;
	try {
		workflow = adwWorkflowSchema.parse(JSON.parse(await readFile(path, "utf8")));
	} catch (error) {
		return {
			ok: false,
			error: `Workflow ${input.name} is missing or invalid: ${error instanceof Error ? error.message.slice(0, 300) : String(error)}`,
		};
	}
	const now = input.now ?? (() => Date.now());
	const startedAt = now();
	const runId = `adw-${input.name}-${startedAt}`;
	const evidenceDir = join(input.workspacePath, ".nklein", "nklein", "adw-runs", `${input.name}-${startedAt}`);
	const snapshot: AdwRunSnapshot = {
		runId,
		name: input.name,
		input: input.runInput,
		startedAt,
		finishedAt: null,
		verdict: "running",
		steps: workflow.steps.map((step) => ({
			id: step.id,
			kind: step.kind,
			status: "pending",
			detail: null,
			cardId: null,
		})),
		evidenceDir,
		error: null,
	};
	trackRun(snapshot);
	const stepById = new Map(snapshot.steps.map((step) => [step.id, step]));

	void (async () => {
		try {
			await mkdir(evidenceDir, { recursive: true });
			await input.warmWorkspace?.().catch(() => undefined);
			const report = await runAdwWorkflow(
				workflow,
				{ workflowName: input.name, input: input.runInput },
				{
					now,
					onStepStart: (step) => {
						const status = stepById.get(step.id);
						if (status) {
							status.status = "running";
						}
					},
					runCommand: async (step: AdwDeterministicStep, renderedCommand: string) =>
						runShellCommand(renderedCommand, { cwd: input.workspacePath, timeoutMs: step.timeoutMs }),
					runAgentCard: async (step: AdwAgentStep, card) => {
						const cardId = await input.seedAgentCard(card);
						const status = stepById.get(step.id);
						if (status) {
							status.cardId = cardId;
						}
						const deadline = now() + step.awaitTimeoutMs;
						let lastLane: string | null = null;
						while (now() < deadline) {
							const board = await loadWorkspaceBoardById(input.workspaceId).catch(() => null);
							if (board) {
								for (const column of board.columns) {
									if (column.cards.some((candidate) => candidate.id === cardId)) {
										lastLane = column.id;
										break;
									}
								}
								if (lastLane !== null && TERMINAL_LANES.has(lastLane)) {
									return { cardId, lane: lastLane, timedOut: false };
								}
							}
							await new Promise((resolve) => setTimeout(resolve, AGENT_CARD_POLL_INTERVAL_MS));
						}
						return { cardId, lane: lastLane, timedOut: true };
					},
					writeEvidence: async (stepId, content) => {
						await writeFile(join(evidenceDir, `${stepId}.log`), content, "utf8");
					},
				},
			);
			for (const step of report.steps) {
				const status = stepById.get(step.id);
				if (!status) {
					continue;
				}
				status.status = step.skipped ? "skipped" : step.ok ? "ok" : "fail";
				status.detail = step.detail;
				status.cardId = step.cardId ?? status.cardId;
			}
			snapshot.verdict = report.verdict === "pass" ? "pass" : "fail";
		} catch (error) {
			snapshot.verdict = "fail";
			snapshot.error = error instanceof Error ? error.message.slice(0, 500) : String(error);
		} finally {
			snapshot.finishedAt = now();
		}
	})();

	return { ok: true, runId };
}
