import { describe, expect, it } from "vitest";
import {
	classifySandboxContainer,
	planSandboxOrphanReaping,
	type SandboxContainerRecord,
	siblingWorkspaceVolumeName,
	verdictReaps,
} from "../../../src/core/sandbox-orphan-ownership";

/**
 * The leak the 2026-07-23 destructive-cleanup fix left behind.
 *
 * Namespace-exact reaping is safe and, for port-derived ephemeral pools, collects nothing — the namespace never
 * recurs, so the "future runtime that reclaims it" never boots. Measured on this host 2026-08-01: 22 containers
 * (6 running, oldest 6 days) and 83 leaked volumes, with no !Klein process alive to own any of them.
 *
 * Every test below fixes the direction of a wrong answer: reaping wrongly destroys a live agent's workspace,
 * keeping wrongly leaks. The uncertain cases must all land on KEEP.
 */

const SELF = { pid: 4242, nonce: "boot-a" };

function container(name: string, labels: Partial<SandboxContainerRecord> = {}): SandboxContainerRecord {
	return { name, ...labels };
}

/** The pre-ownership rule: this manager owns only `nklein-agent-sandbox-<digits>`. */
const ownsUnnamespaced = (name: string): boolean => /^nklein-agent-sandbox-\d+$/u.test(name);

const nothingAlive = (): boolean => false;
const everythingAlive = (): boolean => true;

describe("classifySandboxContainer", () => {
	it("reaps a container whose owner process is GONE — the leak this exists to close", () => {
		const decision = classifySandboxContainer({
			record: container("nklein-agent-sandbox-simflow-58219-ephemeral-ws-abc-1", {
				ownerPid: "999",
				ownerNonce: "boot-dead",
			}),
			self: SELF,
			isPidAlive: nothingAlive,
			matchesOwnNamespace: ownsUnnamespaced,
		});
		expect(decision.verdict).toBe("reap_owner_dead");
		expect(decision.reap).toBe(true);
	});

	it("NEVER touches a container whose owner is still alive — the 2026-07-23 incident", () => {
		// A simulator runtime rm -f'd a live campaign container by querying kind-wide. Ownership is the boundary.
		const decision = classifySandboxContainer({
			record: container("nklein-agent-sandbox-aider-1b25b1e1-ws-abc-1", {
				ownerPid: "31337",
				ownerNonce: "boot-campaign",
			}),
			self: SELF,
			isPidAlive: everythingAlive,
			matchesOwnNamespace: ownsUnnamespaced,
		});
		expect(decision.verdict).toBe("keep_owner_alive");
		expect(decision.reap).toBe(false);
	});

	it("keeps our OWN pool — in-process disposal owns it, not the reaper", () => {
		const decision = classifySandboxContainer({
			record: container("nklein-agent-sandbox-ws-abc-1", { ownerPid: "4242", ownerNonce: "boot-a" }),
			self: SELF,
			isPidAlive: everythingAlive,
			matchesOwnNamespace: ownsUnnamespaced,
		});
		expect(decision.verdict).toBe("keep_own_pool");
		expect(decision.reap).toBe(false);
	});

	it("reaps OUR PID under a DIFFERENT nonce — positive proof the owner died and the OS recycled its pid", () => {
		// The case `pid` alone cannot decide: identical pid, opposite correct actions. Two live processes cannot
		// share a pid, so a foreign nonce on our own pid means the claimant is gone.
		const decision = classifySandboxContainer({
			record: container("nklein-agent-sandbox-ws-abc-1", { ownerPid: "4242", ownerNonce: "boot-PREVIOUS" }),
			self: SELF,
			isPidAlive: everythingAlive,
			matchesOwnNamespace: ownsUnnamespaced,
		});
		expect(decision.verdict).toBe("reap_owner_pid_reused");
		expect(decision.reap).toBe(true);
	});

	it("keeps a foreign LEGACY container — preserving the namespace boundary byte-for-byte", () => {
		const decision = classifySandboxContainer({
			record: container("nklein-agent-sandbox-simflow-58219-ephemeral-ws-abc-1"),
			self: SELF,
			isPidAlive: nothingAlive,
			matchesOwnNamespace: ownsUnnamespaced,
		});
		expect(decision.verdict).toBe("keep_legacy_foreign_namespace");
		expect(decision.reap).toBe(false);
	});

	it("still reaps the legacy shape this manager already owned — no regression in existing behaviour", () => {
		const decision = classifySandboxContainer({
			record: container("nklein-agent-sandbox-7"),
			self: SELF,
			isPidAlive: nothingAlive,
			matchesOwnNamespace: ownsUnnamespaced,
		});
		expect(decision.verdict).toBe("reap_legacy_namespace_match");
		expect(decision.reap).toBe(true);
	});

	it("treats a HALF-WRITTEN owner claim as legacy, not as half-proof of abandonment", () => {
		// Partial evidence of ownership is not evidence of death. Trusting a lone pid would reap on the strength of
		// a label that was never fully written.
		for (const labels of [{ ownerPid: "999" }, { ownerNonce: "boot-dead" }]) {
			const decision = classifySandboxContainer({
				record: container("nklein-agent-sandbox-other-ws-abc-1", labels),
				self: SELF,
				isPidAlive: nothingAlive,
				matchesOwnNamespace: ownsUnnamespaced,
			});
			expect(decision.verdict, JSON.stringify(labels)).toBe("keep_legacy_foreign_namespace");
		}
	});

	it("reads docker's EMPTY-STRING label as absent, not as a claim", () => {
		// `docker ps --format '{{.Label "x"}}'` prints "" for a missing label. Treating that as a present claim
		// would send every unlabeled container down the ownership path and reap on an unparseable pid.
		const decision = classifySandboxContainer({
			record: container("nklein-agent-sandbox-3", { ownerPid: "", ownerNonce: "  " }),
			self: SELF,
			isPidAlive: nothingAlive,
			matchesOwnNamespace: ownsUnnamespaced,
		});
		expect(decision.verdict).toBe("reap_legacy_namespace_match");
	});

	it("refuses to act on a MALFORMED pid rather than deleting on a guess", () => {
		for (const ownerPid of ["12abc", "-1", "0", "not-a-pid", "1e999", "3.7"]) {
			const decision = classifySandboxContainer({
				record: container("nklein-agent-sandbox-1", { ownerPid, ownerNonce: "boot-x" }),
				self: SELF,
				isPidAlive: nothingAlive,
				matchesOwnNamespace: ownsUnnamespaced,
			});
			expect(decision.verdict, ownerPid).toBe("keep_owner_unparseable");
			expect(decision.reap, ownerPid).toBe(false);
		}
	});

	it("does not let a malformed claim fall through to the legacy namespace reap", () => {
		// `nklein-agent-sandbox-1` DOES match our namespace. A claim we cannot parse must still stop the delete —
		// otherwise the unparseable branch is unreachable for exactly the names we are allowed to destroy.
		const decision = classifySandboxContainer({
			record: container("nklein-agent-sandbox-1", { ownerPid: "garbage", ownerNonce: "boot-x" }),
			self: SELF,
			isPidAlive: nothingAlive,
			matchesOwnNamespace: ownsUnnamespaced,
		});
		expect(decision.reap).toBe(false);
	});

	it("keeps a live foreign owner even when the name IS in our namespace", () => {
		// Ownership outranks naming: an explicit live claim must win over a name pattern we would otherwise sweep.
		const decision = classifySandboxContainer({
			record: container("nklein-agent-sandbox-1", { ownerPid: "31337", ownerNonce: "boot-other" }),
			self: SELF,
			isPidAlive: everythingAlive,
			matchesOwnNamespace: ownsUnnamespaced,
		});
		expect(decision.verdict).toBe("keep_owner_alive");
	});

	it("probes liveness with the CLAIMED pid, not ours", () => {
		const probed: number[] = [];
		classifySandboxContainer({
			record: container("nklein-agent-sandbox-x-1", { ownerPid: "606", ownerNonce: "boot-z" }),
			self: SELF,
			isPidAlive: (pid) => {
				probed.push(pid);
				return false;
			},
			matchesOwnNamespace: ownsUnnamespaced,
		});
		expect(probed).toEqual([606]);
	});
});

describe("verdictReaps", () => {
	it("authorises deletion for exactly three verdicts", () => {
		// One source of destructive truth: a verdict added later is non-destructive until listed deliberately.
		const all = [
			"reap_owner_dead",
			"reap_owner_pid_reused",
			"reap_legacy_namespace_match",
			"keep_own_pool",
			"keep_owner_alive",
			"keep_legacy_foreign_namespace",
			"keep_owner_unparseable",
		] as const;
		expect(all.filter((verdict) => verdictReaps(verdict))).toEqual([
			"reap_owner_dead",
			"reap_owner_pid_reused",
			"reap_legacy_namespace_match",
		]);
	});

	it("never reaps a verdict whose name says keep", () => {
		for (const verdict of ["keep_own_pool", "keep_owner_alive", "keep_legacy_foreign_namespace"] as const) {
			expect(verdictReaps(verdict)).toBe(false);
		}
	});
});

describe("planSandboxOrphanReaping", () => {
	it("separates a dead owner's containers from a live owner's in one pass", () => {
		const plan = planSandboxOrphanReaping({
			records: [
				container("nklein-agent-sandbox-dead-ws-a-1", { ownerPid: "999", ownerNonce: "boot-dead" }),
				container("nklein-agent-sandbox-live-ws-b-1", { ownerPid: "31337", ownerNonce: "boot-live" }),
				container("nklein-agent-sandbox-ws-c-1", { ownerPid: "4242", ownerNonce: "boot-a" }),
			],
			self: SELF,
			isPidAlive: (pid) => pid === 31337,
			matchesOwnNamespace: ownsUnnamespaced,
		});
		expect(plan.reapNames).toEqual(["nklein-agent-sandbox-dead-ws-a-1"]);
	});

	it("reports WHY, so a destructive cleanup is never silent about what it deleted", () => {
		const plan = planSandboxOrphanReaping({
			records: [container("nklein-agent-sandbox-dead-ws-a-1", { ownerPid: "999", ownerNonce: "boot-dead" })],
			self: SELF,
			isPidAlive: nothingAlive,
			matchesOwnNamespace: ownsUnnamespaced,
		});
		expect(plan.summary).toMatch(/reaping 1 \(reap_owner_dead=1\)/u);
	});

	it("says plainly when there was nothing to look at", () => {
		const plan = planSandboxOrphanReaping({
			records: [],
			self: SELF,
			isPidAlive: nothingAlive,
			matchesOwnNamespace: ownsUnnamespaced,
		});
		expect(plan.summary).toMatch(/no sandbox containers listed/u);
		expect(plan.reapNames).toEqual([]);
	});

	it("reaps nothing at all when every owner is alive", () => {
		const plan = planSandboxOrphanReaping({
			records: [
				container("nklein-agent-sandbox-a-1", { ownerPid: "1", ownerNonce: "x" }),
				container("nklein-agent-sandbox-b-1", { ownerPid: "2", ownerNonce: "y" }),
			],
			self: SELF,
			isPidAlive: everythingAlive,
			matchesOwnNamespace: ownsUnnamespaced,
		});
		expect(plan.reapNames).toEqual([]);
	});
});

describe("siblingWorkspaceVolumeName", () => {
	const prefixes = { containerPrefix: "nklein-agent-sandbox", volumePrefix: "nklein-agent-ws" };

	it("derives the volume from the container, since an implicit volume carries no labels of its own", () => {
		expect(
			siblingWorkspaceVolumeName({
				containerName: "nklein-agent-sandbox-simflow-58219-ephemeral-ws-abc-1",
				...prefixes,
			}),
		).toBe("nklein-agent-ws-simflow-58219-ephemeral-ws-abc-1");
	});

	it("handles the unnamespaced shape too", () => {
		expect(siblingWorkspaceVolumeName({ containerName: "nklein-agent-sandbox-7", ...prefixes })).toBe(
			"nklein-agent-ws-7",
		);
	});

	it("returns NULL for a name it does not understand, rather than inventing a volume to delete", () => {
		for (const containerName of ["postgres", "nklein-agent-sandbox", "nklein-agent-sandbox-", "sandbox-1"]) {
			expect(siblingWorkspaceVolumeName({ containerName, ...prefixes }), containerName).toBeNull();
		}
	});

	it("does not match a prefix that merely starts the same way", () => {
		// `nklein-agent-sandboxes-1` is a different family; the trailing `-` in the marker is what keeps them apart.
		// Matching on the bare prefix would map it to `nklein-agent-ws-es-1` and delete an unrelated volume.
		expect(siblingWorkspaceVolumeName({ containerName: "nklein-agent-sandboxes-1", ...prefixes })).toBeNull();
	});
});
