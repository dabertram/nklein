import { describe, expect, it, vi } from "vitest";
import {
	CHURN_7D_MS,
	CHURN_24H_MS,
	type ChurnWindowGitPort,
	collectWindowedChurn,
	planChurnWindows,
} from "../../../src/core/churn-window-collector";

const files = [{ path: "src/a.ts", authoredLines: 100 }];

function git(refs: Record<number, string | null>, survival: Record<string, number>): ChurnWindowGitPort {
	return {
		resolveContainingRefAtOrBefore: vi.fn(async ({ dueAt }) => refs[dueAt] ?? null),
		countSurvivingLines: vi.fn(async ({ ref }) => survival[ref] ?? null),
	};
}

describe("churn window collector", () => {
	it("plans exact 24h/7d deadlines without estimating pending windows", () => {
		expect(planChurnWindows(1_000, 1_000 + CHURN_24H_MS - 1)).toEqual([
			{ id: "24h", dueAt: 1_000 + CHURN_24H_MS, state: "pending" },
			{ id: "7d", dueAt: 1_000 + CHURN_7D_MS, state: "pending" },
		]);
	});

	it("collects the due 24h snapshot but refuses to manufacture a 7d assessment", async () => {
		const acceptedAt = 1_000;
		const port = git({ [acceptedAt + CHURN_24H_MS]: "ref24" }, { ref24: 90 });
		const result = await collectWindowedChurn({
			cardId: "c1",
			commit: "abc1234",
			acceptedAt,
			now: acceptedAt + CHURN_24H_MS,
			laterRef: "HEAD",
			files,
			git: port,
		});
		expect(result).toMatchObject({ status: "pending", ref24h: "ref24", ref7d: null, assessment: null });
		expect(port.resolveContainingRefAtOrBefore).toHaveBeenCalledTimes(1);
	});

	it("feeds two real snapshots into the 24h/7d judge", async () => {
		const acceptedAt = 10_000;
		const port = git(
			{ [acceptedAt + CHURN_24H_MS]: "ref24", [acceptedAt + CHURN_7D_MS]: "ref7" },
			{ ref24: 90, ref7: 70 },
		);
		const result = await collectWindowedChurn({
			cardId: "c1",
			commit: "abc1234",
			acceptedAt,
			now: acceptedAt + CHURN_7D_MS,
			laterRef: "HEAD",
			files,
			git: port,
		});
		expect(result).toMatchObject({
			status: "complete",
			ref24h: "ref24",
			ref7d: "ref7",
			assessment: { verdict: "healthy", rate24h: 0.1, rate7d: 0.3 },
		});
		expect(result.assessment?.iterationGap).toBeCloseTo(0.2);
	});

	it("fails explicitly when an elapsed deadline has no containing historical ref", async () => {
		const result = await collectWindowedChurn({
			cardId: "c1",
			commit: "abc1234",
			acceptedAt: 0,
			now: CHURN_7D_MS,
			laterRef: "HEAD",
			files,
			git: git({}, {}),
		});
		expect(result).toMatchObject({ status: "unresolvable", assessment: null });
	});
});
