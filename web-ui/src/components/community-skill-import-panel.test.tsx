import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Simulate } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	CommunitySkillImportPanel,
	type CommunitySkillImportPanelApi,
} from "@/components/community-skill-import-panel";
import type { RuntimeCommunitySkillImportReviewResponse } from "@/runtime/types";

const HASH = "a".repeat(64);
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
				snapshotId: `identity/${HASH}`,
				importedAt: 1,
				active: false as const,
				quarantined: true as const,
				decision: REVIEW.decision,
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
	});
});
