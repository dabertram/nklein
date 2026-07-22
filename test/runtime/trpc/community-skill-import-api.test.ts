import { describe, expect, it, vi } from "vitest";
import { type RuntimeTrpcContext, runtimeAppRouter } from "../../../src/trpc/app-router";

describe("community-skill import tRPC routes", () => {
	it("exposes the inert inbox listing through the runtime router", async () => {
		const listCommunitySkillImports = vi.fn(async () => ({
			inboxPath: "/tmp/community-skills/inbox",
			truncated: false,
			candidates: [{ directory: "fixture", selectable: true, reason: null }],
		}));
		const caller = runtimeAppRouter.createCaller({
			requestedWorkspaceId: null,
			workspaceScope: null,
			runtimeApi: { listCommunitySkillImports },
		} as unknown as RuntimeTrpcContext);

		await expect(caller.runtime.listCommunitySkillImports()).resolves.toMatchObject({
			candidates: [{ directory: "fixture", selectable: true }],
		});
		expect(listCommunitySkillImports).toHaveBeenCalledOnce();
	});

	it("rejects approval without the exact SHA-256 and explicit confirmation before dispatch", async () => {
		const approveCommunitySkillImport = vi.fn();
		const caller = runtimeAppRouter.createCaller({
			requestedWorkspaceId: null,
			workspaceScope: null,
			runtimeApi: { approveCommunitySkillImport },
		} as unknown as RuntimeTrpcContext);

		await expect(
			caller.runtime.approveCommunitySkillImport({
				directory: "fixture",
				sourceUrl: "https://example.test/fixture",
				expectedContentHash: "not-a-hash",
				confirmation: true,
			}),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		expect(approveCommunitySkillImport).not.toHaveBeenCalled();
	});

	it("requires workspace scope before contained skill execution review", async () => {
		const reviewCommunitySkillExecution = vi.fn();
		const caller = runtimeAppRouter.createCaller({
			requestedWorkspaceId: null,
			workspaceScope: null,
			runtimeApi: { reviewCommunitySkillExecution },
		} as unknown as RuntimeTrpcContext);

		await expect(
			caller.runtime.reviewCommunitySkillExecution({
				snapshotId: `${"a".repeat(32)}/${"b".repeat(64)}`,
				sessionId: "task-1",
				role: "worker",
			}),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		expect(reviewCommunitySkillExecution).not.toHaveBeenCalled();
	});

	it("rejects caller-supplied containment environment fields", async () => {
		const reviewCommunitySkillExecution = vi.fn();
		const caller = runtimeAppRouter.createCaller({
			requestedWorkspaceId: "workspace-1",
			workspaceScope: { workspaceId: "workspace-1", workspacePath: "/tmp/workspace" },
			runtimeApi: { reviewCommunitySkillExecution },
		} as unknown as RuntimeTrpcContext);

		await expect(
			caller.runtime.reviewCommunitySkillExecution({
				snapshotId: `${"a".repeat(32)}/${"b".repeat(64)}`,
				sessionId: "task-1",
				role: "worker",
				environment: { requestedNetworkPolicy: "full" },
			} as never),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		expect(reviewCommunitySkillExecution).not.toHaveBeenCalled();
	});

	it("dispatches suggest-only ranking through workspace scope with quarantine flags intact", async () => {
		const snapshotId = `${"a".repeat(32)}/${"b".repeat(64)}`;
		const suggestCommunitySkills = vi.fn(async () => ({
			sessionId: "plan-1",
			role: "architect" as const,
			channel: "suggest-only" as const,
			suggestions: [
				{
					snapshotId,
					skillId: "review",
					name: "review",
					description: "Review repository changes",
					version: null,
					contentHash: "b".repeat(64),
					sourceUrl: "https://example.test/review",
					score: 6,
					matchedTerms: ["review"],
					quarantinedData: true as const,
					humanApprovalRequired: true as const,
					promptEligible: false as const,
					active: false as const,
				},
			],
		}));
		const workspaceScope = { workspaceId: "workspace-1", workspacePath: "/tmp/workspace" };
		const caller = runtimeAppRouter.createCaller({
			requestedWorkspaceId: "workspace-1",
			workspaceScope,
			runtimeApi: { suggestCommunitySkills },
		} as unknown as RuntimeTrpcContext);

		await expect(
			caller.runtime.suggestCommunitySkills({
				sessionId: "plan-1",
				role: "architect",
				taskText: "Review repository changes",
			}),
		).resolves.toMatchObject({
			channel: "suggest-only",
			suggestions: [{ quarantinedData: true, humanApprovalRequired: true, promptEligible: false, active: false }],
		});
		expect(suggestCommunitySkills).toHaveBeenCalledWith(workspaceScope, {
			sessionId: "plan-1",
			role: "architect",
			taskText: "Review repository changes",
		});
	});
});
