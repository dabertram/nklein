import { describe, expect, it } from "vitest";
import {
	CURRENT_PROCESS_IDENTITY,
	isProcessAlive,
	judgeOwnerClaim,
	type OwnerClaimRecord,
	parseOwnerClaimRecord,
	verdictIsAbandoned,
} from "../../../src/core/process-identity";

/**
 * Liveness, not elapsed time.
 *
 * Found live 2026-08-01 by the nightly crash-recovery matrix: the durable-scheduler ledger claim used a 60s staleness
 * window as its only test for a dead owner. SIGKILL the runtime and restart it a second later — the textbook crash
 * case — and the dead owner's lock is ~1s old, so the restart refuses to start its own scheduler. For up to a minute
 * after any crash there is no durable scheduler at all: no lease reclamation, no completion recording.
 */

const SELF = { pid: 4242, nonce: "boot-a", host: "mac-1" };

function claim(overrides: Partial<OwnerClaimRecord> = {}): OwnerClaimRecord {
	return { pid: 99, nonce: "boot-other", host: "mac-1", claimedAt: 1_000, ...overrides };
}

const nothingAlive = (): boolean => false;
const everythingAlive = (): boolean => true;

describe("judgeOwnerClaim", () => {
	it("calls a claim ABANDONED when its owner process is gone — the crash-restart case", () => {
		expect(judgeOwnerClaim({ claim: claim(), self: SELF, isPidAlive: nothingAlive })).toBe("abandoned_owner_dead");
	});

	it("keeps a claim whose owner is still running — the dual-scheduler defect this fence exists to prevent", () => {
		expect(judgeOwnerClaim({ claim: claim(), self: SELF, isPidAlive: everythingAlive })).toBe("keep_owner_alive");
	});

	it("keeps our OWN claim", () => {
		const own = claim({ pid: SELF.pid, nonce: SELF.nonce });
		expect(judgeOwnerClaim({ claim: own, self: SELF, isPidAlive: everythingAlive })).toBe("keep_own_claim");
	});

	it("calls OUR pid under another nonce abandoned — the OS recycled a dead owner's pid onto us", () => {
		// Checked BEFORE the liveness probe on purpose: our own pid is alive by definition, so probing first would
		// mask the one case where liveness proves the opposite of what it appears to.
		const recycled = claim({ pid: SELF.pid, nonce: "boot-PREVIOUS" });
		expect(judgeOwnerClaim({ claim: recycled, self: SELF, isPidAlive: everythingAlive })).toBe(
			"abandoned_pid_reused",
		);
	});

	it("never judges a claim written on ANOTHER HOST by a local pid", () => {
		// A pid from a different machine is meaningless here, not merely wrong — and the ledger root can be synced.
		const foreign = claim({ host: "other-mac" });
		expect(judgeOwnerClaim({ claim: foreign, self: SELF, isPidAlive: nothingAlive })).toBe("keep_foreign_host");
	});

	it("keeps when there is no record at all, rather than assuming the lock is free", () => {
		expect(judgeOwnerClaim({ claim: null, self: SELF, isPidAlive: nothingAlive })).toBe("keep_no_record");
	});

	it("probes the CLAIMED pid, not ours", () => {
		const probed: number[] = [];
		judgeOwnerClaim({
			claim: claim({ pid: 777 }),
			self: SELF,
			isPidAlive: (pid) => {
				probed.push(pid);
				return false;
			},
		});
		expect(probed).toEqual([777]);
	});
});

describe("verdictIsAbandoned", () => {
	it("authorises taking the resource for exactly the two proof-of-death verdicts", () => {
		const all = [
			"keep_no_record",
			"keep_unparseable",
			"keep_foreign_host",
			"keep_own_claim",
			"keep_owner_alive",
			"abandoned_owner_dead",
			"abandoned_pid_reused",
		] as const;
		expect(all.filter((verdict) => verdictIsAbandoned(verdict))).toEqual([
			"abandoned_owner_dead",
			"abandoned_pid_reused",
		]);
	});
});

describe("parseOwnerClaimRecord", () => {
	it("reads a well-formed record", () => {
		const parsed = parseOwnerClaimRecord(JSON.stringify({ pid: 12, nonce: "n", host: "h", claimedAt: 5 }));
		expect(parsed).toEqual({ pid: 12, nonce: "n", host: "h", claimedAt: 5 });
	});

	it("returns NULL for anything incomplete or malformed, so a torn write cannot authorise a break", () => {
		// The record is written just after the lock is taken; a crash in that window leaves a partial file. Reading it
		// as a claim we can judge would let a half-written record decide whether to destroy someone's lock.
		for (const raw of [
			"{ not json",
			"null",
			"[]",
			'"a string"',
			JSON.stringify({ nonce: "n", host: "h" }),
			JSON.stringify({ pid: 0, nonce: "n", host: "h" }),
			JSON.stringify({ pid: -3, nonce: "n", host: "h" }),
			JSON.stringify({ pid: 1.5, nonce: "n", host: "h" }),
			JSON.stringify({ pid: 12, nonce: "", host: "h" }),
			JSON.stringify({ pid: 12, nonce: "n", host: "" }),
			JSON.stringify({ pid: 12, host: "h" }),
		]) {
			expect(parseOwnerClaimRecord(raw), raw).toBeNull();
		}
	});

	it("tolerates a missing claimedAt rather than rejecting the whole record", () => {
		// claimedAt is diagnostic; the decision never reads it, so its absence must not turn a usable record into a
		// refusal that reinstates the 60s blind window.
		expect(parseOwnerClaimRecord(JSON.stringify({ pid: 12, nonce: "n", host: "h" }))?.claimedAt).toBe(0);
	});
});

describe("isProcessAlive", () => {
	it("reports THIS process as alive", () => {
		expect(isProcessAlive(process.pid)).toBe(true);
	});

	it("reports an impossible pid as dead", () => {
		expect(isProcessAlive(999_999_999)).toBe(false);
	});

	it("reports pid 1 as alive, proving EPERM is read as existence and not as absence", () => {
		// A process owned by another user throws EPERM. Reading that as "dead" would authorise breaking the claim of
		// a live process — the exact failure the fence exists to prevent.
		expect(isProcessAlive(1)).toBe(true);
	});
});

describe("CURRENT_PROCESS_IDENTITY", () => {
	it("carries this process's pid and a non-empty nonce and host", () => {
		expect(CURRENT_PROCESS_IDENTITY.pid).toBe(process.pid);
		expect(CURRENT_PROCESS_IDENTITY.nonce.length).toBeGreaterThan(0);
		expect(CURRENT_PROCESS_IDENTITY.host.length).toBeGreaterThan(0);
	});

	it("is stable within the process — a nonce that changed per read would prove nothing", () => {
		expect(CURRENT_PROCESS_IDENTITY.nonce).toBe(CURRENT_PROCESS_IDENTITY.nonce);
	});
});
