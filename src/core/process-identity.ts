/**
 * WHO this process is, and whether some other process still exists.
 *
 * ── WHY THIS IS SHARED ──
 * Two unrelated subsystems independently need "is the thing that claimed this resource still alive?":
 *   · the agent sandbox, deciding whether a leftover container may be reaped (`sandbox-orphan-ownership`)
 *   · the durable scheduler, deciding whether a crashed owner's ledger claim may be broken
 *     (`state/durable-scheduler-claim`)
 * Both were about to answer it with a TIMEOUT, and a timeout is only ever a proxy for liveness. One identity and one
 * probe keeps the two answers consistent, and keeps the nonce meaning the same thing in both places.
 *
 * ── THE NONCE ──
 * `pid` alone cannot separate "this is still us" from "the OS recycled a dead owner's pid onto us", and those two
 * demand opposite actions. Two live processes cannot share a pid, so the same pid under a DIFFERENT nonce is positive
 * proof the original claimant is gone. The nonce is fixed once at module load and never persisted across restarts —
 * that is exactly what makes it a witness of process identity.
 *
 * `host` is recorded so a claim written on another machine is never judged by a pid that means nothing here. !Klein is
 * local-only, but a ledger root can sit on a synced directory, and a pid comparison across hosts is meaningless rather
 * than merely wrong.
 */

import { randomUUID } from "node:crypto";
import { hostname } from "node:os";

export interface ProcessIdentity {
	readonly pid: number;
	readonly nonce: string;
	readonly host: string;
}

/** This process, fixed at module load. */
export const CURRENT_PROCESS_IDENTITY: ProcessIdentity = {
	pid: process.pid,
	nonce: randomUUID(),
	host: hostname(),
};

/**
 * Does a process with this pid exist?
 *
 * Signal 0 performs the existence/permission check without delivering anything. EPERM means it EXISTS but belongs to
 * another user — alive, and (for every caller here) the answer that declines to touch someone else's resource.
 *
 * A recycled pid reads as ALIVE, so the mistake this can make is "leave an abandoned resource alone", never "destroy a
 * live one". Callers depend on that direction.
 */
export function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}

/** A persisted "I own this" record. Written by the owner, read by whoever finds the resource still claimed. */
export interface OwnerClaimRecord {
	readonly pid: number;
	readonly nonce: string;
	readonly host: string;
	readonly claimedAt: number;
}

export type OwnerClaimVerdict =
	/** No record, or one we cannot trust. Uncertainty never authorises taking someone else's resource. */
	| "keep_no_record"
	| "keep_unparseable"
	/** Written on a different machine; its pid says nothing about this host. */
	| "keep_foreign_host"
	/** Our own live claim. */
	| "keep_own_claim"
	/** Someone else's process is still running. */
	| "keep_owner_alive"
	/** The owner's pid no longer exists. */
	| "abandoned_owner_dead"
	/** Our pid under another nonce — the owner died and the OS recycled its pid onto us. */
	| "abandoned_pid_reused";

const ABANDONED: ReadonlySet<OwnerClaimVerdict> = new Set<OwnerClaimVerdict>([
	"abandoned_owner_dead",
	"abandoned_pid_reused",
]);

/** True when this verdict says the resource may be taken. One source, so a new verdict is never silently destructive. */
export function verdictIsAbandoned(verdict: OwnerClaimVerdict): boolean {
	return ABANDONED.has(verdict);
}

/** Parse a persisted claim, returning null for anything not a COMPLETE, well-formed record. */
export function parseOwnerClaimRecord(raw: string): OwnerClaimRecord | null {
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch {
		return null;
	}
	if (!value || typeof value !== "object") {
		return null;
	}
	const { pid, nonce, host, claimedAt } = value as Record<string, unknown>;
	if (!Number.isSafeInteger(pid) || (pid as number) <= 0) {
		return null;
	}
	if (typeof nonce !== "string" || nonce.length === 0 || typeof host !== "string" || host.length === 0) {
		return null;
	}
	return {
		pid: pid as number,
		nonce,
		host,
		claimedAt: typeof claimedAt === "number" && Number.isFinite(claimedAt) ? claimedAt : 0,
	};
}

/**
 * Is a claimed resource abandoned? PURE — the liveness probe is injected.
 *
 * Ordering matters: the pid-reuse check must come BEFORE the liveness probe, because our own pid is alive by
 * definition and would otherwise mask the one case where liveness proves the opposite of what it appears to.
 */
export function judgeOwnerClaim(input: {
	readonly claim: OwnerClaimRecord | null;
	readonly self: ProcessIdentity;
	readonly isPidAlive: (pid: number) => boolean;
}): OwnerClaimVerdict {
	const { claim, self } = input;
	if (claim === null) {
		return "keep_no_record";
	}
	if (claim.host !== self.host) {
		return "keep_foreign_host";
	}
	if (claim.pid === self.pid) {
		return claim.nonce === self.nonce ? "keep_own_claim" : "abandoned_pid_reused";
	}
	return input.isPidAlive(claim.pid) ? "keep_owner_alive" : "abandoned_owner_dead";
}
