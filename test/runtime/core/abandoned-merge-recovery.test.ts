import { describe, expect, it } from "vitest";
import {
	decideAbandonedMergeRecovery,
	type InFlightMergeMark,
	isUnmergedStatusLine,
} from "../../../src/core/abandoned-merge-recovery";

const MARK: InFlightMergeMark = {
	mergeHead: "1f88f4e1a9bd8d7a134834d1c7d42b915d74836a",
	taskId: "mutation-duration-schedule-kill-m1",
	startedAt: 1_788_884_669_000,
};

describe("abandoned merge recovery", () => {
	it("aborts only a merge !Klein can PROVE it started", () => {
		const decision = decideAbandonedMergeRecovery({ mergeHead: MARK.mergeHead, mark: MARK });
		expect(decision.action).toBe("abort");
		expect(decision.reason).toContain("mutation-duration-schedule-kill-m1");
		expect(decision.reason).toContain("1f88f4e1a9bd");
	});

	it("never touches a merge someone else started", () => {
		// The operator's own `git merge` in the base workspace: in progress, but unmarked.
		const unmarked = decideAbandonedMergeRecovery({ mergeHead: MARK.mergeHead, mark: null });
		expect(unmarked.action).toBe("leave");
		expect(unmarked.reason).toContain("never abort someone else's merge");

		// A stale mark from an EARLIER merge must not authorise aborting a different one.
		const stale = decideAbandonedMergeRecovery({
			mergeHead: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
			mark: MARK,
		});
		expect(stale.action).toBe("leave");
		expect(stale.reason).toContain("a different merge");
	});

	it("leaves an ordinary dirty tree alone — dirt without a merge is someone's work in progress", () => {
		const decision = decideAbandonedMergeRecovery({ mergeHead: null, mark: MARK });
		expect(decision.action).toBe("leave");
		expect(decision.reason).toContain("not abandoned merge debris");
	});

	it("recognises every porcelain unmerged code, and nothing else", () => {
		for (const line of ["UU tests/manifest.json", "AA a", "DD b", "AU c", "UA d", "UD e", "DU f"]) {
			expect(isUnmergedStatusLine(line)).toBe(true);
		}
		for (const line of [" M src/x.ts", "A  test/new.js", "?? junk", "MM both", ""]) {
			expect(isUnmergedStatusLine(line)).toBe(false);
		}
	});
});
