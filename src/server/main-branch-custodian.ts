/**
 * F2.35 — the MAIN-BRANCH CUSTODIAN (David directive 2026-09-04: "architect should always keep reviewing main
 * branch etc etc and merged work etc etc .. maybe not exactly architect .. but some role should do it").
 *
 * A standing role that reviews the INTEGRATED tree, not individual cards: whenever enough new commits have
 * landed on the workspace's integration branch since the last sweep, it runs one bracketed review session over
 * the merge range (reusing the second-opinion review machinery — same sandbox bracket, same verdict protocol)
 * on a capable model (flash-next by preference — its standing extra duty beside worker cards), records the
 * verdict as an observation, and when the custodian is NOT satisfied files a finding card in the backlog so the
 * normal factory loop fixes what integration broke. Observe-first: it never mutates the tree itself.
 *
 * Gated by NKLEIN_MAIN_CUSTODIAN=1 (rig opt-in first; default-flip is a P15.3-style evidence decision).
 */

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { NKleinReviewResult } from "../nklein-agent/nklein-review-tool";
import { recordSelfObservation } from "../telemetry/self-observation-sink";
import { runGit } from "../workspace/git-utils";

/** Sweep threshold: review only when at least this many new commits landed since the last sweep. */
const MIN_NEW_COMMITS = 3;
/** Cap the brief the custodian reads (log lines / diffstat lines) so the session prompt stays bounded. */
const MAX_BRIEF_LINES = 120;
export const MAIN_CUSTODIAN_TASK_ID = "main-branch-custodian";

const lastReviewedCommitByWorkspace = new Map<string, string>();
const inFlightWorkspaces = new Set<string>();

export function isMainCustodianEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
	// The literal `process.env.NKLEIN_MAIN_CUSTODIAN === "1"` shape keeps the flag visible to the F4.8b
	// registry scanner; the env parameter stays for tests.
	return (env === process.env ? process.env.NKLEIN_MAIN_CUSTODIAN : env.NKLEIN_MAIN_CUSTODIAN)?.trim() === "1";
}

export interface MainBranchCustodianDeps {
	workspacePath: string;
	runReviewSession: (input: {
		taskId: string;
		projectRepoPath: string;
		baseRef: string;
		seedPrompt: string;
		reviewer?: { providerId: string; modelId: string } | null;
		timeoutMs?: number;
	}) => Promise<NKleinReviewResult | null>;
	/** Preferred custodian model (e.g. flash-next); null lets the review runner's fallback chain pick. */
	pickCustodianModel: () => Promise<CustodianModel | null> | CustodianModel | null;
	/** File a finding card in the backlog; returns the new card id (null when filing failed). */
	fileFindingCard: (input: { title: string; prompt: string }) => Promise<string | null>;
	warn: (message: string) => void;
}

export interface CustodianModel {
	providerId: string;
	modelId: string;
}

/**
 * Audit 2026-09-04 #14: the custodian was the last chooser that handed a model to the review runner without
 * checking it is LOADED and routable (liveness ledger, cross-host identifier collision) — the same blind spot
 * that walked un-parked reviews into the collision. The preferred model is used only when it appears among the
 * routable loaded descriptors; otherwise null lets the runner's (filtered) fallback chain pick and the sweep
 * records the miss.
 */
export async function resolveCustodianModel(input: {
	preferred: string;
	loadRoutable: () => Promise<readonly { runtimeId: string; modelKey: string }[]>;
	warn: (message: string) => void;
}): Promise<CustodianModel | null> {
	const preferred = input.preferred.trim();
	if (!preferred) {
		return null;
	}
	const routable = await input.loadRoutable().catch(() => []);
	if (routable.some((descriptor) => descriptor.runtimeId === preferred || descriptor.modelKey === preferred)) {
		return { providerId: "lmstudio", modelId: preferred };
	}
	input.warn(
		`Main-branch custodian: preferred model ${preferred} is not loaded/routable — letting the review runner's fallback chain pick.`,
	);
	return null;
}

/** Build the custodian's seed prompt for one merge range. Exported for tests. */
export function buildCustodianSeedPrompt(input: { branch: string; rangeLog: string; diffstat: string }): string {
	return [
		`You are the MAIN-BRANCH CUSTODIAN. Your job is to review the INTEGRATED work on branch "${input.branch}" — not one card, but whether the merged pieces cohere.`,
		"",
		"New commits since the last custodian sweep:",
		input.rangeLog,
		"",
		"Cumulative diffstat for the range:",
		input.diffstat,
		"",
		"Inspect the CURRENT tree (you are checked out at the branch head). Judge: do the merged pieces fit together (interfaces, naming, duplicated logic, dead seams)? Did any merge regress or contradict earlier merged work? Are tests coherent across the merged features?",
		"Submit your verdict with submit_review: approve when integration is coherent; request_changes with a SPECIFIC, actionable summary when something needs a follow-up card (name files and the smallest fix).",
	].join("\n");
}

/** One sweep: review the new merge range when it is big enough. Best-effort; never throws. */
export async function maybeRunMainBranchCustodian(deps: MainBranchCustodianDeps): Promise<void> {
	if (!isMainCustodianEnabled()) {
		return;
	}
	const workspacePath = deps.workspacePath;
	if (inFlightWorkspaces.has(workspacePath)) {
		return;
	}
	inFlightWorkspaces.add(workspacePath);
	try {
		const branch = (await runGit(workspacePath, ["rev-parse", "--abbrev-ref", "HEAD"])).stdout.trim() || "main";
		const head = (await runGit(workspacePath, ["rev-parse", "HEAD"])).stdout.trim();
		if (!head) {
			return;
		}
		const last = lastReviewedCommitByWorkspace.get(workspacePath) ?? (await readPersistedMark(workspacePath));
		if (!last) {
			// First sight of this workspace: baseline silently — the custodian reviews NEW integration, not history.
			lastReviewedCommitByWorkspace.set(workspacePath, head);
			await persistMark(workspacePath, head);
			return;
		}
		lastReviewedCommitByWorkspace.set(workspacePath, last);
		if (last === head) {
			return;
		}
		const range = `${last}..${head}`;
		const commitCount = Number((await runGit(workspacePath, ["rev-list", "--count", range])).stdout.trim() || "0");
		if (!Number.isFinite(commitCount) || commitCount < MIN_NEW_COMMITS) {
			return;
		}
		const rangeLog = (await runGit(workspacePath, ["log", "--oneline", range])).stdout
			.split("\n")
			.slice(0, MAX_BRIEF_LINES)
			.join("\n");
		const diffstat = (await runGit(workspacePath, ["diff", "--stat", range])).stdout
			.split("\n")
			.slice(0, MAX_BRIEF_LINES)
			.join("\n");
		deps.warn(`Main-branch custodian: reviewing ${commitCount} new commit(s) on ${branch} (${range.slice(0, 20)}…).`);
		const result = await deps
			.runReviewSession({
				taskId: MAIN_CUSTODIAN_TASK_ID,
				projectRepoPath: workspacePath,
				baseRef: branch,
				seedPrompt: buildCustodianSeedPrompt({ branch, rangeLog, diffstat }),
				reviewer: await deps.pickCustodianModel(),
				timeoutMs: 20 * 60_000,
			})
			.catch(() => null);
		// Advance the mark WHATEVER happened: a failed sweep must not re-review the same range forever — the
		// next merges produce the next sweep (the observation records the miss).
		lastReviewedCommitByWorkspace.set(workspacePath, head);
		await persistMark(workspacePath, head);
		const verdict = result?.verdict ?? null;
		recordSelfObservation({
			signal: "custom",
			severity: verdict === "approve" || verdict === null ? "info" : "warning",
			message:
				verdict === null
					? `Main-branch custodian sweep over ${commitCount} commit(s) produced no verdict (session skipped/failed).`
					: `Main-branch custodian ${verdict} for ${commitCount} commit(s) on ${branch}: ${(result?.summary ?? "").slice(0, 300)}`,
			taskId: MAIN_CUSTODIAN_TASK_ID,
			workspacePath,
			metadata: {
				category: "main_custodian_review",
				verdict,
				commitCount,
				range,
			},
		});
		if (result && result.verdict !== "approve") {
			const cardId = await deps
				.fileFindingCard({
					title: `Custodian: integration follow-up (${new Date().toISOString().slice(0, 10)})`,
					prompt:
						`The main-branch custodian reviewed merge range ${range} on ${branch} and requested changes.\n\n` +
						`Custodian findings:\n${result.summary ?? "(no summary)"}\n\n` +
						"Address the findings above with the smallest coherent change; keep every existing test green.",
				})
				.catch(() => null);
			if (cardId) {
				deps.warn(`Main-branch custodian filed finding card ${cardId}.`);
			}
		}
	} catch (error) {
		deps.warn(`Main-branch custodian sweep failed: ${error instanceof Error ? error.message : String(error)}`);
	} finally {
		inFlightWorkspaces.delete(workspacePath);
	}
}

/** Test seam: reset the per-process custodian memory. */
/**
 * Audit 2026-09-04 #16: the mark lived only in memory, so every server restart re-baselined silently and the
 * merges that landed across the restart were never reviewed. Persisted per workspace under its `.nklein/` state
 * dir; best-effort on both sides (an unreadable file means "first sight", an unwritable one keeps the in-memory
 * mark for this process).
 */
function persistedMarkPath(workspacePath: string): string {
	// Under `.nklein/nklein/` — the workspace STATE dir the delivery merge's clean-base check excludes
	// (`git status --porcelain -- . ':(exclude).nklein/nklein'`). Live 2026-09-05 04:07: the first cut wrote
	// `.nklein/custodian-mark.json`, one level up, and that single untracked file blocked EVERY delivery merge
	// ("Base workspace has uncommitted changes") until it was removed.
	return join(workspacePath, ".nklein", "nklein", "custodian-mark.json");
}

async function readPersistedMark(workspacePath: string): Promise<string | null> {
	try {
		const parsed = JSON.parse(await readFile(persistedMarkPath(workspacePath), "utf8")) as {
			lastReviewedCommit?: unknown;
		};
		return typeof parsed?.lastReviewedCommit === "string" && parsed.lastReviewedCommit.trim()
			? parsed.lastReviewedCommit.trim()
			: null;
	} catch {
		return null;
	}
}

async function persistMark(workspacePath: string, head: string): Promise<void> {
	try {
		await mkdir(join(workspacePath, ".nklein", "nklein"), { recursive: true });
		await writeFile(
			persistedMarkPath(workspacePath),
			`${JSON.stringify({ lastReviewedCommit: head, updatedAt: new Date().toISOString() }, null, 2)}\n`,
			"utf8",
		);
	} catch {
		// best-effort: the in-memory mark still guards this process
	}
}

/** Clears the in-memory mark and, when a workspace is given, its persisted mark file. */
export async function resetMainBranchCustodianForTests(workspacePath?: string): Promise<void> {
	if (workspacePath) {
		await rm(persistedMarkPath(workspacePath), { force: true });
	}
	lastReviewedCommitByWorkspace.clear();
	inFlightWorkspaces.clear();
}

/** Deterministic id helper exported for the card-filing wiring (title collisions are fine; ids must not be). */
export function custodianFindingTaskId(): string {
	return `custodian-${randomUUID().slice(0, 8)}`;
}
