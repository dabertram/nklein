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
});
