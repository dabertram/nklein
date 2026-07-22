import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildCommunitySkillEvent } from "../../../src/core/agent-attempt-ledger";
import { recordCommunitySkillEffectivenessForTask } from "../../../src/nklein-agent/community-skill-effectiveness-recorder";
import { hashWorkspacePathForLedger } from "../../../src/nklein-agent/nklein-ledger-attempt";
import { appendAgentLedgerEvent, readAgentLedger } from "../../../src/state/agent-attempt-ledger-store";

describe("recordCommunitySkillEffectivenessForTask", () => {
	const roots: string[] = [];
	afterEach(async () => {
		await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
		roots.length = 0;
	});

	it("turns the latest admitted activation into acceptance-based helped/hurt evidence", async () => {
		const rootDir = await mkdtemp(join(tmpdir(), "nklein-community-effectiveness-"));
		roots.push(rootDir);
		const workspacePath = "/workspace/project";
		const workspacePathHash = hashWorkspacePathForLedger(workspacePath);
		const admission = buildCommunitySkillEvent({
			workflowId: "task-1",
			taskId: "task-1",
			workspacePathHash,
			role: "worker",
			stage: "admission",
			skillId: "https://example.test#fixture",
			snapshotId: `${"a".repeat(32)}/${"b".repeat(64)}`,
			activationId: "c".repeat(64),
			sessionId: "task-1",
			contentHash: "b".repeat(64),
			version: "1.0.0",
			source: "https://example.test/fixture",
			executionVerdict: "allow",
			grant: {
				grantedTools: ["read_files"],
				effectiveTools: ["read_files"],
				deniedTools: [],
				networkPolicy: "none",
				credentialMode: "none",
			},
			recordedAt: 1,
		});
		await appendAgentLedgerEvent(admission, { rootDir });

		await recordCommunitySkillEffectivenessForTask({
			taskId: "task-1",
			workspacePath,
			passed: false,
			recordedAt: 2,
			rootDir,
		});

		const events = await readAgentLedger({ workspacePathHash, rootDir });
		expect(events).toHaveLength(2);
		expect(events[1]).toMatchObject({
			kind: "community_skill",
			stage: "effectiveness",
			effectivenessSignal: "hurt",
			effectivenessBasis: "acceptance",
			evidenceRef: "acceptance:task-1:fail:2",
			activationId: admission.activationId,
		});
	});

	it("does nothing when the task admitted no community skill", async () => {
		const rootDir = await mkdtemp(join(tmpdir(), "nklein-community-effectiveness-empty-"));
		roots.push(rootDir);
		await recordCommunitySkillEffectivenessForTask({
			taskId: "task-none",
			workspacePath: "/workspace/project",
			passed: true,
			rootDir,
		});
		expect(
			await readAgentLedger({
				workspacePathHash: hashWorkspacePathForLedger("/workspace/project"),
				rootDir,
			}),
		).toEqual([]);
	});
});
