import { describe, expect, it, vi } from "vitest";
import { type RuntimeBuildIdentityExec, resolveRuntimeBuildIdentity } from "../../../src/core/runtime-build-identity";
import { type RuntimeTrpcContext, runtimeAppRouter } from "../../../src/trpc/app-router";

describe("runtime build identity", () => {
	it("captures one clean pre-initialization commit and serves it through tRPC", async () => {
		const exec = vi.fn<RuntimeBuildIdentityExec>(async (_file, args) => ({
			stdout: args[0] === "rev-parse" ? `${"a".repeat(40)}\n` : "",
		}));
		const identity = await resolveRuntimeBuildIdentity({
			cwd: "/repo",
			now: () => new Date("2026-07-23T00:00:00.000Z"),
			exec,
		});
		expect(identity).toEqual({
			schemaVersion: 1,
			gitCommit: "a".repeat(40),
			gitDirty: false,
			capturedAt: "2026-07-23T00:00:00.000Z",
		});
		expect(exec).toHaveBeenCalledTimes(2);

		const caller = runtimeAppRouter.createCaller({
			buildIdentity: identity,
			requestedWorkspaceId: null,
			workspaceScope: null,
		} as unknown as RuntimeTrpcContext);
		await expect(caller.runtime.getBuildIdentity()).resolves.toEqual(identity);
	});

	it("reports unavailable identity instead of pretending a package install is clean", async () => {
		const identity = await resolveRuntimeBuildIdentity({
			now: () => new Date("2026-07-23T00:00:00.000Z"),
			exec: async () => {
				throw new Error("not a git checkout");
			},
		});
		expect(identity).toEqual({
			schemaVersion: 1,
			gitCommit: null,
			gitDirty: null,
			capturedAt: "2026-07-23T00:00:00.000Z",
		});
	});
});
