import { describe, expect, it } from "vitest";
import { buildWorkspaceScopeHeaders, WORKSPACE_ID_HEADER } from "../../../src/core/workspace-scope";

describe("buildWorkspaceScopeHeaders", () => {
	it("emits the workspace-id header for a non-empty id", () => {
		expect(buildWorkspaceScopeHeaders("ws-1")).toEqual({ [WORKSPACE_ID_HEADER]: "ws-1" });
	});

	it("emits no headers for a null/empty id (unscoped request)", () => {
		expect(buildWorkspaceScopeHeaders(null)).toEqual({});
		expect(buildWorkspaceScopeHeaders("")).toEqual({});
	});
});
