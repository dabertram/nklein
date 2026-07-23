import { describe, expect, it, vi } from "vitest";
import type { FrontendPreviewPlan } from "../../../src/core/frontend-preview-plan";
import { runOwnedPreviewCapture } from "../../../src/nklein-agent/agent-sandbox/visual-capture";

const plan: FrontendPreviewPlan = {
	argv: ["npm", "run", "dev"],
	env: {},
	route: "/card",
	framework: "generic",
};

describe("runOwnedPreviewCapture", () => {
	it("waits for the exact route, captures it, then always tears down the owned process tree", async () => {
		const process = { pid: 10, exitCode: null };
		const order: string[] = [];
		const terminate = vi.fn(async () => {
			order.push("terminate");
		});
		const result = await runOwnedPreviewCapture(
			{ plan, port: 23456, timeoutMs: 1000 },
			{
				spawn: () => {
					order.push("spawn");
					return process;
				},
				waitUntilReady: async (_process, url) => {
					order.push(`ready:${url}`);
				},
				capture: async (url) => {
					order.push(`capture:${url}`);
					return { rendered: true, consoleErrors: [], image: null, png: null };
				},
				terminate,
			},
		);
		expect(result.rendered).toBe(true);
		expect(order).toEqual([
			"spawn",
			"ready:http://127.0.0.1:23456/card",
			"capture:http://127.0.0.1:23456/card",
			"terminate",
		]);
		expect(terminate).toHaveBeenCalledWith(process);
	});

	it("kills the process tree when readiness or capture fails", async () => {
		const terminate = vi.fn(async () => {});
		await expect(
			runOwnedPreviewCapture(
				{ plan, port: 20000, timeoutMs: 1000 },
				{
					spawn: () => ({ pid: 11, exitCode: null }),
					waitUntilReady: async () => {
						throw new Error("readiness timeout");
					},
					capture: async () => ({ rendered: true, consoleErrors: [], image: null, png: null }),
					terminate,
				},
			),
		).rejects.toThrow("readiness timeout");
		expect(terminate).toHaveBeenCalledOnce();
	});
});
