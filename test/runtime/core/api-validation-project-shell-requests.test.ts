import { describe, expect, it } from "vitest";
import {
	parseNKleinEndpointModelDiscoveryRequest,
	parseProjectRemoveRequest,
	parseProtectedTestApprovalGrantRequest,
	parseShellSessionStartRequest,
	parseTaskContextImportRequest,
	parseWorkspaceChangesRequest,
} from "../../../src/core/api-validation";

// §5.V — project / shell / discovery / approval tRPC parsers. Characterizing their trim + emptiness + normalization
// (blank→throw, optional secrets→null, nested approval fields trimmed) so a dropped guard on untrusted input regresses loudly.

describe("parseProjectRemoveRequest (§5.V coverage)", () => {
	it("trims projectId and passes deleteGitRepository through", () => {
		expect(parseProjectRemoveRequest({ projectId: "  p1  ", deleteGitRepository: true })).toEqual({
			projectId: "p1",
			deleteGitRepository: true,
		});
	});

	it("rejects a blank projectId", () => {
		expect(() => parseProjectRemoveRequest({ projectId: "   " })).toThrow(/Project ID cannot be empty/);
	});
});

describe("parseTaskContextImportRequest (§5.V coverage)", () => {
	it("trims the target and passes the source enum through", () => {
		expect(parseTaskContextImportRequest({ source: "github_issue", target: "  t1  " })).toEqual({
			source: "github_issue",
			target: "t1",
		});
	});

	it("rejects a blank target and an invalid source", () => {
		expect(() => parseTaskContextImportRequest({ source: "github_pr_diff", target: "  " })).toThrow(
			/target cannot be empty/,
		);
		expect(() => parseTaskContextImportRequest({ source: "nope", target: "t" })).toThrow();
	});
});

describe("parseProtectedTestApprovalGrantRequest (§5.V coverage)", () => {
	it("trims taskId and every nested approval field", () => {
		expect(
			parseProtectedTestApprovalGrantRequest({
				taskId: "  t1  ",
				approval: { intent: "  i  ", diff: "  d  ", reason: "  r  ", expectedEffects: "  e  " },
			}),
		).toEqual({ taskId: "t1", approval: { intent: "i", diff: "d", reason: "r", expectedEffects: "e" } });
	});

	it("rejects a blank taskId", () => {
		expect(() =>
			parseProtectedTestApprovalGrantRequest({
				taskId: "  ",
				approval: { intent: "i", diff: "d", reason: "r", expectedEffects: "e" },
			}),
		).toThrow(/approval taskId cannot be empty/);
	});
});

describe("parseNKleinEndpointModelDiscoveryRequest (§5.V coverage)", () => {
	it("trims baseUrl and normalizes optional secrets/urls to null", () => {
		expect(parseNKleinEndpointModelDiscoveryRequest({ baseUrl: "  http://x  " })).toEqual({
			baseUrl: "http://x",
			apiKey: null,
			modelsSourceUrl: null,
			timeoutMs: null,
		});
		expect(
			parseNKleinEndpointModelDiscoveryRequest({
				baseUrl: "http://x",
				apiKey: "  sk  ",
				modelsSourceUrl: "  http://m  ",
				timeoutMs: 5000,
			}),
		).toEqual({ baseUrl: "http://x", apiKey: "sk", modelsSourceUrl: "http://m", timeoutMs: 5000 });
	});

	it("rejects a whitespace-only baseUrl (stricter than schema min(1))", () => {
		expect(() => parseNKleinEndpointModelDiscoveryRequest({ baseUrl: "   " })).toThrow(/Base URL cannot be empty/);
	});
});

describe("parseShellSessionStartRequest (§5.V coverage)", () => {
	it("trims taskId/baseRef, preserves cols/rows, leaves an omitted workspaceTaskId undefined", () => {
		expect(parseShellSessionStartRequest({ taskId: "  t1  ", baseRef: "  main  ", cols: 80, rows: 24 })).toEqual({
			taskId: "t1",
			baseRef: "main",
			cols: 80,
			rows: 24,
			workspaceTaskId: undefined,
		});
	});

	it("rejects blank taskId / baseRef, and a defined-but-blank workspaceTaskId", () => {
		expect(() => parseShellSessionStartRequest({ taskId: "  ", baseRef: "main" })).toThrow(
			/Shell session taskId cannot be empty/,
		);
		expect(() => parseShellSessionStartRequest({ taskId: "t", baseRef: "  " })).toThrow(
			/Shell session baseRef cannot be empty/,
		);
		expect(() => parseShellSessionStartRequest({ taskId: "t", baseRef: "main", workspaceTaskId: "  " })).toThrow(
			/Invalid shell session workspaceTaskId/,
		);
	});
});

describe("parseWorkspaceChangesRequest (§5.V coverage)", () => {
	it("reads + trims taskId and baseRef from the query and requires both", () => {
		expect(parseWorkspaceChangesRequest(new URLSearchParams("taskId=%20t1%20&baseRef=%20main%20"))).toEqual({
			taskId: "t1",
			baseRef: "main",
		});
		expect(() => parseWorkspaceChangesRequest(new URLSearchParams("taskId=t1"))).toThrow(/baseRef/);
		expect(() => parseWorkspaceChangesRequest(new URLSearchParams("baseRef=main"))).toThrow(/taskId/);
	});
});
