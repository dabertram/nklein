import { describe, expect, it } from "vitest";
import { describeChatExecutionPosture } from "../../../src/chat/chat-execution-posture";

/**
 * F2.8 — the explicit execution posture: every (scope, risk-ack) combination maps to exactly one of the four
 * named postures, derived from the SAME controls the gates enforce (derivation-only, no enforcement change).
 */

describe("describeChatExecutionPosture", () => {
	it("chat-only and klein_self scopes are the isolated read-only floor (risk ack is irrelevant there)", () => {
		for (const scope of ["chat_only", "klein_self"] as const) {
			const posture = describeChatExecutionPosture({ scope, riskAcknowledged: true, browserEnabled: false });
			expect(posture.posture).toBe("isolated_read_only");
			expect(posture.boundaries.join(" ")).toContain("No host commands");
			expect(posture.escalation).toContain("scope");
		}
	});

	it("project scopes are sandboxed-confirming (host actions are per-action escapes)", () => {
		for (const scope of ["project_sandboxed", "all_projects"] as const) {
			const posture = describeChatExecutionPosture({ scope, riskAcknowledged: false, browserEnabled: true });
			expect(posture.posture).toBe("sandboxed_confirming");
			expect(posture.boundaries.join(" ")).toContain("ask first");
			expect(posture.boundaries.join(" ")).toContain("browsing is on");
		}
	});

	it("host scope splits on the risk ack: confirming vs full-risk (named plainly)", () => {
		const confirming = describeChatExecutionPosture({
			scope: "host_access",
			riskAcknowledged: false,
			browserEnabled: false,
		});
		expect(confirming.posture).toBe("host_confirming");
		expect(confirming.escalation).toContain("full-risk");

		const fullRisk = describeChatExecutionPosture({
			scope: "host_access",
			riskAcknowledged: true,
			browserEnabled: false,
		});
		expect(fullRisk.posture).toBe("full_risk");
		expect(fullRisk.summary).toContain("UNSAFE commands auto-approve");
		expect(fullRisk.escalation).toContain("per-action confirmation");
	});
});
