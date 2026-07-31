/**
 * P21.5b — EXCLUSIVE ownership of a workspace's durable ledger, so a second scheduler cannot replay it.
 *
 * ── THE DEFECT ──
 * The board/claim path is properly fenced (one state file, a real cross-process lock, the precondition evaluated
 * inside it, OCC on top). The durable scheduler is a different surface: it is a PURE in-process brain whose leases
 * live in the append-only ledger. **Two orchestrators replaying one ledger each build their own job graph, and
 * both can lease the same job.** Runs are isolated today by `HOME` + `NKLEIN_AGENT_LEDGER_ROOT` — that is how the
 * nightly runs 28 cells — but that is a CONVENTION of how runs are launched, not a fence. This makes it one.
 *
 * ── SCOPED TO THE SCHEDULER, NOT THE PROCESS ──
 * The item's own caveat, and it decides the design: the desktop app plus a CLI `dev` command on one workspace is a
 * real usage pattern, and a process-wide guard would refuse it. The claim is taken when a durable run is created,
 * so a command that never starts a scheduler is never affected.
 *
 * ── AND SCOPED TO THE LEDGER, NOT THE ROOT ──
 * The backlog phrases this as "an already-claimed ledger root", but the root holds ONE FILE PER WORKSPACE
 * (`<root>/<workspacePathHash>.jsonl`). Two servers driving DIFFERENT workspaces under a shared root cannot
 * corrupt each other's job graph — only two schedulers replaying the SAME workspace's ledger can. Locking the root
 * would therefore refuse a legitimate arrangement while adding no safety, so the fence is per-ledger. The path
 * comes from {@link agentLedgerLogPath} rather than being re-derived here, because a lock on a path nothing writes
 * to would be acquired happily and protect nothing.
 *
 * ── WHY IT REFUSES INSTEAD OF WAITING ──
 * `proper-lockfile` is used with NO retries. A second server that queued would sit silently at startup and then
 * begin scheduling whenever the first released — turning a clear "someone else owns this" into a delayed surprise.
 * Declining immediately is the honest outcome, and the caller can say so.
 *
 * ── THE STALE WINDOW IS DELIBERATELY GENEROUS ──
 * A crashed owner must not wedge the ledger forever, so the lock ages out. But this host thermally throttles under
 * sustained model load, and a live-but-slow server losing its claim to an impatient second one is strictly worse
 * than a crashed one being reclaimed a little late: the first failure mode is two schedulers on one ledger — the
 * exact defect — while the second is a board that resumes after a minute. Hence 60s stale with a 20s refresh,
 * rather than the library's 10s default.
 */

import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import * as lockfile from "proper-lockfile";
import { agentLedgerLogPath } from "./agent-attempt-ledger-store";

/** A crashed owner's claim expires after this long. Generous on purpose — see the header. */
export const SCHEDULER_CLAIM_STALE_MS = 60_000;
/** How often a live owner refreshes its claim. Must be comfortably below the stale window. */
export const SCHEDULER_CLAIM_UPDATE_MS = 20_000;

export interface DurableSchedulerClaim {
	readonly ledgerPath: string;
	/** Idempotent: releasing twice is not an error, so a disposal path may be defensive. */
	release(): Promise<void>;
}

export type DurableSchedulerClaimResult =
	| { readonly ok: true; readonly claim: DurableSchedulerClaim }
	| {
			readonly ok: false;
			/** `already_claimed` — another scheduler owns this ledger. `unavailable` — the claim could not be attempted. */
			readonly reason: "already_claimed" | "unavailable";
			readonly ledgerPath: string;
			readonly message: string;
	  };

/** Injected in tests so no real lock is taken; defaults to the real cross-process lock. */
export type LockAcquirer = (path: string, options: lockfile.LockOptions) => Promise<() => Promise<void>>;

/**
 * Claim exclusive scheduler ownership of one workspace's ledger.
 *
 * Never throws: a refusal and an infrastructure failure are both ordinary results, because the caller's response
 * to either is the same — do not start a second scheduler — and an exception at this seam would take down a
 * runtime server that is otherwise healthy.
 */
export async function claimDurableSchedulerLedger(input: {
	readonly workspacePathHash: string;
	readonly rootDir?: string;
	/** Called if the lock is lost while the run is still going — a serious condition the run should surface. */
	readonly onCompromised?: (error: Error) => void;
	readonly lockImpl?: LockAcquirer;
}): Promise<DurableSchedulerClaimResult> {
	const ledgerPath = agentLedgerLogPath(input.workspacePathHash, input.rootDir);
	try {
		// The ledger file itself may not exist yet (a fresh run writes it on first append), and `realpath: false`
		// lets the lock be taken on a not-yet-created path. Its DIRECTORY must exist, so ensure it here rather than
		// depending on whichever write happens to land first.
		await mkdir(dirname(ledgerPath), { recursive: true });
		const acquire = input.lockImpl ?? lockfile.lock;
		const release = await acquire(ledgerPath, {
			realpath: false,
			stale: SCHEDULER_CLAIM_STALE_MS,
			update: SCHEDULER_CLAIM_UPDATE_MS,
			...(input.onCompromised ? { onCompromised: input.onCompromised } : {}),
		});
		let released = false;
		return {
			ok: true,
			claim: {
				ledgerPath,
				async release() {
					if (released) {
						return;
					}
					released = true;
					// A compromised lock throws on release; the claim is gone either way, so swallowing keeps a
					// disposal path from failing over a lock that is already not held.
					await release().catch(() => undefined);
				},
			},
		};
	} catch (error) {
		const code = (error as { code?: string }).code;
		if (code === "ELOCKED") {
			return {
				ok: false,
				reason: "already_claimed",
				ledgerPath,
				message: `another durable scheduler already owns ${ledgerPath}. Two schedulers replaying one ledger each build their own job graph and can both lease the same job, so this one will NOT start. If that owner is gone, its claim expires after ${SCHEDULER_CLAIM_STALE_MS / 1000}s`,
			};
		}
		return {
			ok: false,
			reason: "unavailable",
			ledgerPath,
			message: `could not claim ${ledgerPath}: ${String((error as Error).message ?? error)}. Refusing to start a durable scheduler without exclusive ownership`,
		};
	}
}
