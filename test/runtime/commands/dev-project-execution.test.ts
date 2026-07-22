import { describe, expect, it } from "vitest";
import { countPendingAutoReviews } from "../../../src/commands/dev-project-execution";

describe("countPendingAutoReviews", () => {
	it("keeps an unattended run active until its synthetic reviewer records a result", () => {
		expect(
			countPendingAutoReviews({
				columns: [
					{
						id: "review",
						cards: [
							{ autoReviewEnabled: true },
							{ autoReviewEnabled: true, review: { rounds: [] } },
							{ autoReviewEnabled: false },
						],
					},
				],
			}),
		).toBe(1);
	});
});
