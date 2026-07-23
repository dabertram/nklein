import { computeMutationScore, decideMutationAdequacy, type MutationGateDecision } from "../core/mutation-adequacy";
import type { MutationAdequacyPlan, PlannedMutation } from "../core/mutation-adequacy-plan";
import {
	extractNKleinAcceptanceCommand,
	resolveShellExecution,
	rewriteSandboxAcceptanceCommand,
} from "./nklein-acceptance-gate";
import type { AgentSandboxManager } from "./nklein-agent-sandbox";

const DEFAULT_MUTATION_TIMEOUT_MS = 5 * 60_000;
const MUTATION_SLOT_QUEUE_WAIT_MS = 120_000;
const MAX_EVIDENCE_OUTPUT_CHARS = 2_000;

type MutationSandboxManager = Pick<
	AgentSandboxManager,
	"assertAvailable" | "prepareWorkspace" | "exec" | "disposeWorkspace"
>;

export type MutationExecutionOutcome = "killed" | "survived" | "error";

export interface MutationExecutionEvidence extends PlannedMutation {
	outcome: MutationExecutionOutcome;
	exitCode: number | null;
	output: string;
}

export interface MutationAdequacyRunResult {
	status: "not_applicable" | "unmeasured" | "measured";
	command: string | null;
	reason: string;
	verdict: MutationGateDecision["verdict"];
	score: number | null;
	plannedMutants: number;
	truncatedCandidates: number;
	runMutants: number;
	killedMutants: number;
	survivedMutants: number;
	errorMutants: number;
	infrastructureFailure: string | null;
	durationMs: number;
	evidence: MutationExecutionEvidence[];
}

// Direct argv + base64 payloads avoid shell interpolation. The script preserves every original line terminator and
// refuses a stale/mismatched target, so a planner bug cannot silently mutate the wrong delivered source line.
const APPLY_LINE_MUTATION_SCRIPT = String.raw`
const fs = require("node:fs");
const path = require("node:path");
const [rootArg, relativeArg, lineArg, original64, mutated64] = process.argv.slice(1);
const root = path.resolve(rootArg);
const target = path.resolve(root, relativeArg);
if (!target.startsWith(root + path.sep)) throw new Error("mutation path escaped workspace");
const line = Number.parseInt(lineArg, 10);
if (!Number.isSafeInteger(line) || line < 1) throw new Error("invalid mutation line");
const original = Buffer.from(original64, "base64").toString("utf8");
const mutated = Buffer.from(mutated64, "base64").toString("utf8");
const text = fs.readFileSync(target, "utf8");
const parts = text.split(/(\r\n|\n|\r)/u);
const bodyIndex = (line - 1) * 2;
if (bodyIndex >= parts.length || parts[bodyIndex] !== original) throw new Error("mutation source line mismatch");
parts[bodyIndex] = mutated;
fs.writeFileSync(target, parts.join(""), "utf8");
`;

let mutationRunSequence = 0;

function outputPreview(stdout: string, stderr: string): string {
	return [stdout.trim(), stderr.trim()].filter(Boolean).join("\n").slice(0, MAX_EVIDENCE_OUTPUT_CHARS);
}

function baseResult(input: {
	status: MutationAdequacyRunResult["status"];
	command: string | null;
	reason: string;
	verdict?: MutationGateDecision["verdict"];
	plan: MutationAdequacyPlan;
	durationMs: number;
	infrastructureFailure?: string | null;
	evidence?: MutationExecutionEvidence[];
}): MutationAdequacyRunResult {
	const evidence = input.evidence ?? [];
	const killedMutants = evidence.filter((row) => row.outcome === "killed").length;
	const survivedMutants = evidence.filter((row) => row.outcome === "survived").length;
	const errorMutants = evidence.filter((row) => row.outcome === "error").length;
	const adequacy = computeMutationScore(killedMutants, killedMutants + survivedMutants);
	return {
		status: input.status,
		command: input.command,
		reason: input.reason,
		verdict: input.verdict ?? "unmeasured",
		score: adequacy.score,
		plannedMutants: input.plan.candidates.length,
		truncatedCandidates: input.plan.truncatedCandidates,
		runMutants: adequacy.totalMutants,
		killedMutants,
		survivedMutants,
		errorMutants,
		infrastructureFailure: input.infrastructureFailure ?? null,
		durationMs: input.durationMs,
		evidence,
	};
}

/**
 * Execute the observe-only mutation sample. Every mutant gets a fresh clone of the exact result commit so test
 * artifacts and a surviving mutation cannot contaminate a later observation. A transport/preparation failure stops
 * the sample and makes the whole result unmeasured; infrastructure is never counted as a killed mutant.
 */
export async function runNKleinMutationAdequacy(input: {
	taskId: string;
	projectRepoPath: string;
	resultCommit: string;
	taskPrompt: string;
	plan: MutationAdequacyPlan;
	sandboxManager: MutationSandboxManager;
	timeoutMs?: number;
	now?: () => number;
}): Promise<MutationAdequacyRunResult> {
	const now = input.now ?? Date.now;
	const startedAt = now();
	if (!input.plan.applicable) {
		return baseResult({
			status: "not_applicable",
			command: null,
			reason: input.plan.reason,
			plan: input.plan,
			durationMs: Math.max(0, now() - startedAt),
		});
	}
	const command = extractNKleinAcceptanceCommand(input.taskPrompt);
	if (!command) {
		return baseResult({
			status: "unmeasured",
			command: null,
			reason: "tests changed, but the card has no persisted acceptance command to rerun",
			plan: input.plan,
			durationMs: Math.max(0, now() - startedAt),
		});
	}
	if (input.plan.candidates.length === 0) {
		return baseResult({
			status: "unmeasured",
			command,
			reason: input.plan.reason,
			plan: input.plan,
			durationMs: Math.max(0, now() - startedAt),
		});
	}
	try {
		await input.sandboxManager.assertAvailable();
	} catch (error) {
		const infrastructureFailure = error instanceof Error ? error.message : String(error);
		return baseResult({
			status: "unmeasured",
			command,
			reason: `mutation adequacy infrastructure unavailable: ${infrastructureFailure}`,
			plan: input.plan,
			infrastructureFailure,
			durationMs: Math.max(0, now() - startedAt),
		});
	}

	mutationRunSequence += 1;
	const runSequence = mutationRunSequence;
	const timeoutMs = input.timeoutMs ?? DEFAULT_MUTATION_TIMEOUT_MS;
	const evidence: MutationExecutionEvidence[] = [];
	let infrastructureFailure: string | null = null;
	for (let index = 0; index < input.plan.candidates.length; index += 1) {
		const candidate = input.plan.candidates[index];
		const sandboxTaskId = `${input.taskId}::mutation-${runSequence}-${index + 1}`;
		let prepared = false;
		try {
			const workspace = await input.sandboxManager.prepareWorkspace({
				taskId: sandboxTaskId,
				projectRepoPath: input.projectRepoPath,
				baseRef: input.resultCommit,
				maxQueueWaitMs: MUTATION_SLOT_QUEUE_WAIT_MS,
			});
			prepared = true;
			const applied = await input.sandboxManager.exec(
				sandboxTaskId,
				[
					"node",
					"-e",
					APPLY_LINE_MUTATION_SCRIPT,
					workspace.workdir,
					candidate.path,
					String(candidate.line),
					Buffer.from(candidate.original, "utf8").toString("base64"),
					Buffer.from(candidate.mutated, "utf8").toString("base64"),
				],
				{ timeoutMs },
			);
			if (applied.exitCode === null) {
				infrastructureFailure = outputPreview(applied.stdout, applied.stderr) || "mutation apply transport failed";
				break;
			}
			if (applied.exitCode !== 0) {
				evidence.push({
					...candidate,
					outcome: "error",
					exitCode: applied.exitCode,
					output: outputPreview(applied.stdout, applied.stderr),
				});
				continue;
			}
			const rewritten = rewriteSandboxAcceptanceCommand(command, workspace.workdir);
			const shell = resolveShellExecution(rewritten);
			const testRun = await input.sandboxManager.exec(sandboxTaskId, [shell.binary, ...shell.args], { timeoutMs });
			if (testRun.exitCode === null) {
				infrastructureFailure = outputPreview(testRun.stdout, testRun.stderr) || "mutation test transport failed";
				break;
			}
			evidence.push({
				...candidate,
				outcome: testRun.exitCode === 0 ? "survived" : "killed",
				exitCode: testRun.exitCode,
				output: outputPreview(testRun.stdout, testRun.stderr),
			});
		} catch (error) {
			infrastructureFailure = error instanceof Error ? error.message : String(error);
			break;
		} finally {
			if (prepared) {
				await input.sandboxManager.disposeWorkspace(sandboxTaskId).catch(() => null);
			}
		}
	}

	if (infrastructureFailure) {
		return baseResult({
			status: "unmeasured",
			command,
			reason: `mutation sample stopped on infrastructure failure: ${infrastructureFailure}`,
			plan: input.plan,
			infrastructureFailure,
			evidence,
			durationMs: Math.max(0, now() - startedAt),
		});
	}
	const killed = evidence.filter((row) => row.outcome === "killed").length;
	const survived = evidence.filter((row) => row.outcome === "survived").length;
	const decision = decideMutationAdequacy(computeMutationScore(killed, killed + survived));
	return baseResult({
		status: decision.verdict === "unmeasured" ? "unmeasured" : "measured",
		command,
		reason: decision.reason,
		verdict: decision.verdict,
		plan: input.plan,
		evidence,
		durationMs: Math.max(0, now() - startedAt),
	});
}
