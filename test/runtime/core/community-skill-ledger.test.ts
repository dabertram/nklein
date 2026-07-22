import { describe, expect, it } from "vitest";
import {
	agentLedgerEventSchema,
	buildCommunitySkillEvent,
	buildCommunitySkillLedgerReport,
} from "../../../src/core/agent-attempt-ledger";

const base = {
	workflowId: "task-1",
	taskId: "task-1",
	workspacePathHash: "workspace-hash",
	skillId: "https://example.test#reviewer",
	snapshotId: `${"a".repeat(32)}/${"b".repeat(64)}`,
	activationId: "c".repeat(64),
	sessionId: "task-1",
	contentHash: "b".repeat(64),
	version: "1.0.0",
	source: "https://example.test/reviewer",
};

describe("community-skill ledger", () => {
	it("records exact body-free provenance, grants, approvals, and evidence basis", () => {
		const event = buildCommunitySkillEvent({
			...base,
			stage: "effectiveness",
			role: "reviewer",
			executionVerdict: "allow",
			grant: {
				grantedTools: ["read_files", "read_files"],
				effectiveTools: ["read_files"],
				deniedTools: ["host_shell"],
				networkPolicy: "none",
				credentialMode: "none",
			},
			approvals: [{ path: "scripts/check.sh", sha256: "d".repeat(64) }],
			effectivenessSignal: "helped",
			effectivenessBasis: "acceptance",
			evidenceRef: "acceptance:task-1:pass:10",
			recordedAt: 10,
		});

		expect(agentLedgerEventSchema.safeParse(event).success).toBe(true);
		expect(event.grant?.grantedTools).toEqual(["read_files"]);
		expect(event).not.toHaveProperty("sourceText");
		expect(event).not.toHaveProperty("contentBase64");
	});

	it("removes URL credentials, query tokens, and fragments from source provenance", () => {
		const event = buildCommunitySkillEvent({
			...base,
			stage: "scan",
			source: "https://user:secret@example.test/reviewer?token=hidden#fragment",
			scanVerdicts: { bundle: "safe", executable: "safe", injection: "safe" },
			importVerdict: "allow",
		});
		expect(event.source).toBe("https://example.test/reviewer");
	});

	it("rejects lifecycle records that omit their required verdicts or invent signals", () => {
		expect(() => buildCommunitySkillEvent({ ...base, stage: "scan" })).toThrow();
		expect(() =>
			buildCommunitySkillEvent({
				...base,
				stage: "admission",
				executionVerdict: "allow",
				grant: null,
			}),
		).toThrow();
		expect(() =>
			buildCommunitySkillEvent({
				...base,
				stage: "execution_review",
				executionVerdict: "deny",
				grant: {
					grantedTools: [],
					effectiveTools: [],
					deniedTools: [],
					networkPolicy: "none",
					credentialMode: "none",
				},
				effectivenessSignal: "hurt",
			}),
		).toThrow();
	});

	it("filters provenance and tallies helped/hurt signals over the full match, independent of the output limit", () => {
		const grant = {
			grantedTools: [],
			effectiveTools: [],
			deniedTools: [],
			networkPolicy: "none" as const,
			credentialMode: "none" as const,
		};
		const admission = buildCommunitySkillEvent({
			...base,
			stage: "admission",
			executionVerdict: "allow",
			grant,
			recordedAt: 1,
		});
		const helped = buildCommunitySkillEvent({
			...base,
			stage: "effectiveness",
			executionVerdict: "allow",
			grant,
			effectivenessSignal: "helped",
			effectivenessBasis: "acceptance",
			recordedAt: 2,
		});
		const hurt = buildCommunitySkillEvent({
			...base,
			stage: "effectiveness",
			executionVerdict: "allow",
			grant,
			effectivenessSignal: "hurt",
			effectivenessBasis: "acceptance",
			recordedAt: 3,
		});

		const report = buildCommunitySkillLedgerReport([admission, helped, hurt], {
			taskId: "task-1",
			limit: 2,
		});
		expect(report.events.map((event) => event.recordedAt)).toEqual([2, 3]);
		expect(report.summary).toEqual({ total: 3, helped: 1, hurt: 1, neutral: 0, unknown: 0 });
	});
});
