import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Simulate } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	CommunitySkillImportPanel,
	type CommunitySkillImportPanelApi,
} from "@/components/community-skill-import-panel";
import type {
	RuntimeCommunitySkillExecutionReviewResponse,
	RuntimeCommunitySkillImportReviewResponse,
} from "@/runtime/types";

const HASH = "a".repeat(64);
const SNAPSHOT_ID = `${"b".repeat(32)}/${HASH}`;
const REVIEW: RuntimeCommunitySkillImportReviewResponse = {
	inboxPath: "/tmp/community-skills/inbox",
	directory: "fixture",
	sourceUrl: "https://example.test/fixture",
	sourcePath: "fixture/SKILL.md",
	skillId: "example.test#fixture",
	contentHash: HASH,
	version: "1.0.0",
	trust: { trust: "untrusted", origin: "example.test", reason: "unrecognized / discovery-only source" },
	manifest: { name: "fixture", description: "Fixture skill", version: "1.0.0", allowedTools: [], extra: {} },
	sourceText: "---\nname: fixture\n---\nExact source",
	files: [
		{ path: "SKILL.md", sizeBytes: 38, mode: 0o644, contentBase64: "", textContent: "exact" },
		{ path: "references/guide.txt", sizeBytes: 5, mode: 0o644, contentBase64: "aGVsbG8=", textContent: "hello" },
	],
	bundledManifest: { verdict: "safe", entries: [], findings: [], reason: "safe" },
	executableScreen: { verdict: "safe", files: [] },
	executionGate: {
		posture: "clean",
		entries: [],
		approvalRequired: [],
		blocked: [],
		reason: "clean",
	},
	injectionScreen: { verdict: "safe", findings: [], reason: "safe" },
	capabilityGrant: {
		granted: [],
		denied: [],
		effectiveTools: [],
		posture: "empty_declaration",
		reason: "none",
	},
	disposition: "candidate",
	priorPin: null,
	drift: { kind: "unpinned", drifted: false, rugPull: false, reason: "first review" },
	decision: {
		decision: "review",
		friction: "full-review",
		pinState: "new",
		requiresReconfirm: true,
		reasons: ["untrusted_source"],
		reason: "review/full-review: untrusted source",
	},
	channel: "user-review-only",
	promptEligible: false,
	active: false,
};

const EXECUTION_REVIEW: RuntimeCommunitySkillExecutionReviewResponse = {
	snapshotId: SNAPSHOT_ID,
	skillId: REVIEW.skillId,
	contentHash: HASH,
	version: "1.0.0",
	sessionId: "task-42",
	role: "worker",
	policyHash: "c".repeat(64),
	containment: {
		decision: "allow",
		reason: "allow",
		capabilityGrant: {
			granted: ["read_files"],
			denied: [],
			effectiveTools: ["read_files"],
			posture: "fully_granted",
			reason: "granted",
		},
		effectiveTools: ["read_files"],
		deniedByContainment: [],
		networkPolicy: "none",
		credentialMode: "none",
		approvedExecutableFiles: [],
		disabledExecutableFiles: [],
		pendingExecutableApprovals: [],
		ruleOfTwo: {
			untrustedInput: true,
			sensitiveAccess: false,
			externalOrStatefulEffects: false,
			propertyCount: 1,
			satisfied: true,
			configuration: "A",
			reason: "satisfied",
		},
		reasons: ["satisfied"],
	},
	promptEligible: true,
	active: false,
};

describe("CommunitySkillImportPanel", () => {
	let container: HTMLDivElement;
	let root: Root;
	let previousActEnvironment: boolean | undefined;

	beforeEach(() => {
		previousActEnvironment = (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
			.IS_REACT_ACT_ENVIRONMENT;
		(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => root.unmount());
		container.remove();
		(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
			previousActEnvironment;
	});

	it("shows exact review evidence and approves only the reviewed hash after explicit confirmation", async () => {
		const api: CommunitySkillImportPanelApi = {
			list: vi.fn(async () => ({
				inboxPath: "/tmp/community-skills/inbox",
				truncated: false,
				candidates: [{ directory: "fixture", selectable: true, reason: null }],
			})),
			discover: vi.fn(async () => ({
				query: "review",
				includedUntrusted: false,
				channel: "user-review-only" as const,
				results: [],
				failures: [],
			})),
			review: vi.fn(async () => REVIEW),
			approve: vi.fn(async () => ({
				skillId: REVIEW.skillId,
				contentHash: HASH,
				snapshotId: SNAPSHOT_ID,
				importedAt: 1,
				active: false as const,
				quarantined: true as const,
				decision: REVIEW.decision,
			})),
			suggest: vi.fn(async () => ({
				sessionId: "task-42",
				role: "worker" as const,
				channel: "suggest-only" as const,
				suggestions: [
					{
						snapshotId: SNAPSHOT_ID,
						skillId: REVIEW.skillId,
						name: "fixture",
						description: "Repository review skill",
						version: "1.0.0",
						contentHash: HASH,
						sourceUrl: REVIEW.sourceUrl,
						score: 6,
						matchedTerms: ["review"],
						quarantinedData: true as const,
						humanApprovalRequired: true as const,
						promptEligible: false as const,
						active: false as const,
					},
				],
			})),
			reviewExecution: vi.fn(async () => EXECUTION_REVIEW),
			approveExecution: vi.fn(async () => ({
				...EXECUTION_REVIEW,
				activationId: "d".repeat(64),
				approvedAt: 1,
				active: true as const,
			})),
		};

		await act(async () => {
			root.render(<CommunitySkillImportPanel workspaceId={null} open api={api} />);
			await Promise.resolve();
			await Promise.resolve();
		});
		const sourceInput = container.querySelector<HTMLInputElement>("#community-skill-source-url");
		expect(sourceInput).not.toBeNull();
		await act(async () => {
			sourceInput!.value = REVIEW.sourceUrl;
			Simulate.change(sourceInput!);
		});
		const reviewButton = [...container.querySelectorAll("button")].find((button) =>
			button.textContent?.includes("Review exact bundle"),
		);
		await act(async () => {
			reviewButton?.click();
			await Promise.resolve();
			await Promise.resolve();
		});
		expect(container.textContent).toContain("Exact source");
		expect(container.textContent).toContain("references/guide.txt");
		expect(container.textContent).toContain("untrusted");
		expect(container.textContent).toContain(HASH);
		expect(container.textContent).toContain("Prompt-injection findings");

		const checkbox = [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].at(-1);
		await act(async () => checkbox?.click());
		const approveButton = [...container.querySelectorAll("button")].find((button) =>
			button.textContent?.includes("Import and pin exact bytes"),
		);
		await act(async () => {
			approveButton?.click();
			await Promise.resolve();
			await Promise.resolve();
		});
		expect(api.approve).toHaveBeenCalledWith(null, {
			directory: "fixture",
			sourceUrl: REVIEW.sourceUrl,
			expectedContentHash: HASH,
			confirmation: true,
		});
		expect(container.textContent).toContain("inactive quarantine snapshot");

		const sessionInput = container.querySelector<HTMLInputElement>("#community-skill-session-id");
		const taskInput = container.querySelector<HTMLTextAreaElement>("#community-skill-task-text");
		await act(async () => {
			sessionInput!.value = "task-42";
			Simulate.change(sessionInput!);
			taskInput!.value = "Review this repository";
			Simulate.change(taskInput!);
		});
		const suggestButton = [...container.querySelectorAll("button")].find((button) =>
			button.textContent?.includes("Suggest pinned skills"),
		);
		await act(async () => {
			suggestButton?.click();
			await Promise.resolve();
		});
		expect(container.textContent).toContain("quarantined · human approval required");
		const suggestionButton = [...container.querySelectorAll("button")].find((button) =>
			button.textContent?.includes("Repository review skill"),
		);
		await act(async () => suggestionButton?.click());
		const executionReviewButton = [...container.querySelectorAll("button")].find((button) =>
			button.textContent?.includes("Review contained activation"),
		);
		await act(async () => {
			executionReviewButton?.click();
			await Promise.resolve();
		});
		expect(container.textContent).toContain("Effective session containment");
		const activationCheckbox = [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].at(-1);
		await act(async () => activationCheckbox?.click());
		const executionApproveButton = [...container.querySelectorAll("button")].find((button) =>
			button.textContent?.includes("Approve for this session"),
		);
		await act(async () => {
			executionApproveButton?.click();
			await Promise.resolve();
		});
		expect(api.approveExecution).toHaveBeenCalledWith(null, {
			snapshotId: SNAPSHOT_ID,
			sessionId: "task-42",
			role: "worker",
			expectedContentHash: HASH,
			expectedPolicyHash: "c".repeat(64),
			confirmation: true,
		});
		expect(container.textContent).toContain("is bound to task-42");
	});
});
