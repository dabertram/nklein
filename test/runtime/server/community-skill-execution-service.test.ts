import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ToolCapabilityManifest } from "../../../src/core/tool-capability-manifest";
import { createCommunitySkillExecutionService } from "../../../src/server/community-skill-execution-service";
import { createCommunitySkillImportService } from "../../../src/server/community-skill-import-service";

const READ: ToolCapabilityManifest = {
	mutationLevel: "read",
	networkLevel: "none",
	fsScope: "workspace",
	approval: "auto",
	replayable: true,
};
const WRITE: ToolCapabilityManifest = {
	mutationLevel: "sandbox_write",
	networkLevel: "none",
	fsScope: "workspace",
	approval: "confirm",
	replayable: false,
};
const WEB: ToolCapabilityManifest = {
	mutationLevel: "read",
	networkLevel: "egress_read",
	fsScope: "workspace",
	approval: "confirm",
	replayable: true,
};
const HOST: ToolCapabilityManifest = {
	mutationLevel: "host_write",
	networkLevel: "none",
	fsScope: "host",
	approval: "typed_host",
	replayable: false,
};

const SOURCE = `---
name: contained-fixture
description: Exercise the community-skill containment boundary.
version: 1.0.0
allowed-tools:
  - read_files
  - write_file
  - web_search
  - host_shell
---
Inspect the supplied workspace and report the result.
`;

describe("createCommunitySkillExecutionService", () => {
	const roots: string[] = [];

	afterEach(async () => {
		await Promise.all(roots.map(async (root) => rm(root, { recursive: true, force: true })));
		roots.length = 0;
	});

	async function fixture() {
		const root = await mkdtemp(join(tmpdir(), "nklein-skill-execution-"));
		roots.push(root);
		const communityRoot = join(root, "community");
		const pinRoot = join(root, "pins");
		const skillDir = join(communityRoot, "inbox", "fixture");
		await mkdir(join(skillDir, "scripts"), { recursive: true });
		await writeFile(join(skillDir, "SKILL.md"), SOURCE, "utf8");
		await writeFile(join(skillDir, "scripts", "run.sh"), "#!/bin/sh\nprintf contained\n", "utf8");
		await chmod(join(skillDir, "scripts", "run.sh"), 0o755);
		const importService = createCommunitySkillImportService({ rootDir: communityRoot, pinRootDir: pinRoot });
		const importRequest = { directory: "fixture", sourceUrl: "https://example.test/contained-fixture" };
		const importReview = await importService.review(importRequest);
		const imported = await importService.approve({
			...importRequest,
			expectedContentHash: importReview.contentHash,
			confirmation: true,
		});
		const executionService = createCommunitySkillExecutionService({
			rootDir: communityRoot,
			pinRootDir: pinRoot,
			now: () => 9876,
		});
		const environment = {
			availableTools: [
				{ name: "read_files", manifest: READ },
				{ name: "write_file", manifest: WRITE },
				{ name: "web_search", manifest: WEB },
				{ name: "host_shell", manifest: HOST },
			],
			requestedNetworkPolicy: "full" as const,
			dockerSandbox: true,
			sensitiveAccess: false,
			taskScopedEgressIdentity: true,
		};
		return { root, communityRoot, pinRoot, imported, executionService, environment };
	}

	it("re-verifies the pinned snapshot and writes a session-bound, policy-bound activation ticket", async () => {
		const { communityRoot, imported, executionService, environment } = await fixture();
		const review = await executionService.review({
			snapshotId: imported.snapshotId,
			sessionId: "task-42",
			role: "worker",
			environment,
		});
		expect(review).toMatchObject({
			contentHash: imported.contentHash,
			promptEligible: true,
			active: false,
			containment: {
				decision: "allow",
				networkPolicy: "allowlist",
				credentialMode: "task-scoped-egress-only",
				effectiveTools: ["read_files", "web_search", "write_file"],
				ruleOfTwo: { configuration: "AC", satisfied: true },
			},
		});
		expect(review.policyHash).toMatch(/^[a-f0-9]{64}$/u);
		const ticket = await executionService.approve({
			snapshotId: imported.snapshotId,
			sessionId: "task-42",
			role: "worker",
			environment,
			expectedContentHash: review.contentHash,
			expectedPolicyHash: review.policyHash,
			confirmation: true,
		});
		expect(ticket).toMatchObject({ active: true, approvedAt: 9876, policyHash: review.policyHash });
		const storedPath = join(communityRoot, "activations", hash(ticket.sessionId), `${ticket.activationId}.json`);
		const stored = JSON.parse(await readFile(storedPath, "utf8"));
		expect(stored).toMatchObject({ activationId: ticket.activationId, active: true });
		expect(
			await executionService.approve({
				snapshotId: imported.snapshotId,
				sessionId: "task-42",
				role: "worker",
				environment,
				expectedContentHash: review.contentHash,
				expectedPolicyHash: review.policyHash,
				confirmation: true,
			}),
		).toEqual(ticket);
		await chmod(storedPath, 0o600);
		await writeFile(storedPath, `${JSON.stringify({ ...ticket, credential: "injected" })}\n`, "utf8");
		await expect(
			executionService.approve({
				snapshotId: imported.snapshotId,
				sessionId: "task-42",
				role: "worker",
				environment,
				expectedContentHash: review.contentHash,
				expectedPolicyHash: review.policyHash,
				confirmation: true,
			}),
		).rejects.toMatchObject({ code: "policy_changed" });
	});

	it("requires exact per-file path + digest approval only when script execution is requested", async () => {
		const { imported, executionService, environment } = await fixture();
		const disabled = await executionService.review({
			snapshotId: imported.snapshotId,
			sessionId: "task-script",
			role: "worker",
			environment,
		});
		expect(disabled.containment).toMatchObject({ decision: "allow", approvedExecutableFiles: [] });
		const executable = disabled.containment.disabledExecutableFiles[0];
		if (!executable) throw new Error("Expected the fixture script to remain disabled.");
		const pending = await executionService.review({
			snapshotId: imported.snapshotId,
			sessionId: "task-script",
			role: "worker",
			environment,
			requestedExecutablePaths: [executable.path],
		});
		expect(pending.containment.decision).toBe("approval-required");
		const approved = await executionService.review({
			snapshotId: imported.snapshotId,
			sessionId: "task-script",
			role: "worker",
			environment,
			requestedExecutablePaths: [executable.path],
			executableApprovals: [{ ...executable, confirmation: true }],
		});
		expect(approved.containment).toMatchObject({
			decision: "allow",
			approvedExecutableFiles: [executable],
		});
	});

	it("rejects policy TOCTOU and ambient credential exposure", async () => {
		const { imported, executionService, environment } = await fixture();
		const review = await executionService.review({
			snapshotId: imported.snapshotId,
			sessionId: "task-policy",
			role: "worker",
			environment,
		});
		await expect(
			executionService.approve({
				snapshotId: imported.snapshotId,
				sessionId: "task-policy",
				role: "worker",
				environment: { ...environment, requestedNetworkPolicy: "none" },
				expectedContentHash: review.contentHash,
				expectedPolicyHash: review.policyHash,
				confirmation: true,
			}),
		).rejects.toMatchObject({ code: "policy_changed" });
		const credentials = await executionService.review({
			snapshotId: imported.snapshotId,
			sessionId: "task-credential",
			role: "worker",
			environment: { ...environment, ambientCredentialNames: ["GITHUB_TOKEN"] },
		});
		expect(credentials).toMatchObject({ promptEligible: false, containment: { decision: "deny" } });
	});

	it("rejects snapshot byte tampering before producing a containment decision", async () => {
		const { communityRoot, imported, executionService, environment } = await fixture();
		const script = join(communityRoot, "imported", ...imported.snapshotId.split("/"), "content", "scripts", "run.sh");
		await chmod(script, 0o600);
		await writeFile(script, "tampered\n", "utf8");
		await expect(
			executionService.review({
				snapshotId: imported.snapshotId,
				sessionId: "task-tamper",
				role: "worker",
				environment,
			}),
		).rejects.toMatchObject({ code: "snapshot_conflict" });
	});
});

function hash(value: string): string {
	// The production path is deliberately opaque. Reproduce its SHA-256 without coupling the assertion to an export.
	return createHash("sha256").update(value).digest("hex");
}
