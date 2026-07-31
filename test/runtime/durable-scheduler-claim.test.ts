import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { agentLedgerLogPath } from "../../src/state/agent-attempt-ledger-store";
import {
	claimDurableSchedulerLedger,
	SCHEDULER_CLAIM_STALE_MS,
	SCHEDULER_CLAIM_UPDATE_MS,
} from "../../src/state/durable-scheduler-claim";

/**
 * P21.5b — the durable-scheduler ledger fence.
 *
 * These take REAL locks in a temp directory rather than stubbing the lock library. The property under test is
 * "a second scheduler cannot claim this ledger", and a stubbed lock would be testing the stub — `proper-lockfile`
 * refuses a second acquisition of the same path even within one process (verified: `ELOCKED`), which is exactly
 * the behaviour being relied on.
 */

const directories: string[] = [];

async function ledgerRoot(): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), "nklein-claim-"));
	directories.push(directory);
	return directory;
}

afterEach(async () => {
	for (const directory of directories.splice(0)) {
		await rm(directory, { recursive: true, force: true });
	}
});

describe("claimDurableSchedulerLedger", () => {
	it("grants the first claim, on a ledger file that does not exist yet", async () => {
		// A fresh run writes the ledger on its first append, so the claim must not require the file to be there —
		// otherwise the fence only starts working after the run it was supposed to fence has already begun.
		const rootDir = await ledgerRoot();
		const result = await claimDurableSchedulerLedger({ workspacePathHash: "abc123", rootDir });
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.claim.ledgerPath).toBe(agentLedgerLogPath("abc123", rootDir));
			await result.claim.release();
		}
	});

	it("REFUSES a second scheduler on the same ledger", async () => {
		const rootDir = await ledgerRoot();
		const first = await claimDurableSchedulerLedger({ workspacePathHash: "abc123", rootDir });
		const second = await claimDurableSchedulerLedger({ workspacePathHash: "abc123", rootDir });
		expect(second.ok).toBe(false);
		if (!second.ok) {
			expect(second.reason).toBe("already_claimed");
			expect(second.message).toMatch(/both lease the same job/u);
		}
		if (first.ok) {
			await first.claim.release();
		}
	});

	it("ALLOWS two schedulers on different workspaces under one root", async () => {
		// The reason the fence is per-ledger rather than per-root. Locking the root would refuse this, adding no
		// safety: two workspaces have two job graphs in two files and cannot corrupt each other.
		const rootDir = await ledgerRoot();
		const first = await claimDurableSchedulerLedger({ workspacePathHash: "workspace-a", rootDir });
		const second = await claimDurableSchedulerLedger({ workspacePathHash: "workspace-b", rootDir });
		expect(first.ok && second.ok).toBe(true);
		if (first.ok) {
			await first.claim.release();
		}
		if (second.ok) {
			await second.claim.release();
		}
	});

	it("frees the ledger on release, so a restart can take it over", async () => {
		const rootDir = await ledgerRoot();
		const first = await claimDurableSchedulerLedger({ workspacePathHash: "abc123", rootDir });
		expect(first.ok).toBe(true);
		if (first.ok) {
			await first.claim.release();
		}
		const second = await claimDurableSchedulerLedger({ workspacePathHash: "abc123", rootDir });
		expect(second.ok, "a released ledger must be claimable, or a restart never recovers").toBe(true);
		if (second.ok) {
			await second.claim.release();
		}
	});

	it("tolerates a double release, so a defensive disposal path cannot fail", async () => {
		const rootDir = await ledgerRoot();
		const result = await claimDurableSchedulerLedger({ workspacePathHash: "abc123", rootDir });
		expect(result.ok).toBe(true);
		if (result.ok) {
			await result.claim.release();
			await expect(result.claim.release()).resolves.toBeUndefined();
		}
	});

	it("creates the ledger directory rather than depending on whoever writes first", async () => {
		const rootDir = join(await ledgerRoot(), "not", "yet", "created");
		const result = await claimDurableSchedulerLedger({ workspacePathHash: "abc123", rootDir });
		expect(result.ok).toBe(true);
		expect((await stat(rootDir)).isDirectory()).toBe(true);
		if (result.ok) {
			await result.claim.release();
		}
	});

	it("NEVER throws — an infrastructure failure is an ordinary refusal", async () => {
		// The caller's response to "someone else owns it" and "the lock could not be attempted" is identical: do
		// not start a second scheduler. An exception here would take down an otherwise-healthy runtime server.
		const result = await claimDurableSchedulerLedger({
			workspacePathHash: "abc123",
			rootDir: await ledgerRoot(),
			lockImpl: async () => {
				throw new Error("disk on fire");
			},
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe("unavailable");
			expect(result.message).toMatch(/Refusing to start a durable scheduler/u);
		}
	});

	it("locks the path the LEDGER STORE actually uses, not a re-derived one", async () => {
		// A lock computed independently would still be acquired if the layout changed — just on a path nothing
		// writes to. Every server would then claim successfully and the fence would protect nothing.
		const rootDir = await ledgerRoot();
		let lockedPath = "";
		const result = await claimDurableSchedulerLedger({
			workspacePathHash: "abc123",
			rootDir,
			lockImpl: async (path) => {
				lockedPath = path;
				return async () => undefined;
			},
		});
		expect(result.ok).toBe(true);
		expect(lockedPath).toBe(agentLedgerLogPath("abc123", rootDir));
	});

	it("refreshes well inside the stale window", () => {
		// If refresh were slower than expiry, a LIVE owner's claim would age out and a second scheduler could take
		// a ledger still being driven — the exact defect, arrived at by timer instead of by launch.
		expect(SCHEDULER_CLAIM_UPDATE_MS).toBeLessThan(SCHEDULER_CLAIM_STALE_MS / 2);
	});
});
