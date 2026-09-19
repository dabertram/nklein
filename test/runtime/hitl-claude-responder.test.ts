import { describe, expect, it } from "vitest";

// The responder is a script, not a module: importing it must not start its queue loop.
process.env.CLAUDE_RESPONDER_IMPORT_ONLY = "1";
process.env.HITL_ROOT = process.env.HITL_ROOT ?? "/tmp/hitl-claude-responder-test";
const responder = (await import(/* @vite-ignore */ "../../scripts/hitl-claude-responder.mjs" as string)) as unknown as {
	isQuotaRefusal: (error: unknown) => boolean;
	isTransientFailure: (error: unknown) => boolean;
};
const { isQuotaRefusal, isTransientFailure } = responder;

/** How `claude -p` failures reach the responder: exit code, then the tail of the CLI's JSON result. */
const cliFailure = (envelope: Record<string, unknown>) => new Error(`claude -p exited 1: ${JSON.stringify(envelope)}`);

describe("isQuotaRefusal", () => {
	it("does not read a session UUID as HTTP 429 (live 2026-09-18: a 16k output overrun paused 15 minutes)", () => {
		const overrun = cliFailure({
			modelUsage: { "claude-haiku-4-5-20251001": { outputTokens: 64000, costUSD: 0.49618360000000006 } },
			is_error: true,
			api_error_status: null,
			result:
				"API Error: Claude's response exceeded the 16000 output token maximum. To configure this behavior, set the CLAUDE_CODE_MAX_OUTPUT_TOKENS environment variable.",
			uuid: "06d54718-1f6d-429b-a87f-6cd9865268b3",
		});
		expect(isQuotaRefusal(overrun)).toBe(false);
	});

	it("still pauses on a real subscription limit (the dsh Fable rig, 24 times on 2026-09-19)", () => {
		const limit = cliFailure({
			is_error: true,
			api_error_status: 429,
			result: "You've reached your Fable limit. Switch to another model, or manage usage credits at claude.ai",
			uuid: "0f6e1c2a-8b3d-4e5f-9a7b-27167be4fb93",
		});
		expect(isQuotaRefusal(limit)).toBe(true);
	});

	it("trusts the result text when the status is absent, and plain messages still match as words", () => {
		expect(isQuotaRefusal(cliFailure({ result: "Claude usage limit reached. Your limit will reset at 5pm." }))).toBe(
			true,
		);
		expect(isQuotaRefusal(new Error("HTTP 429 Too Many Requests"))).toBe(true);
		expect(isQuotaRefusal(new Error("claude -p exited 1: segfault in request 04290"))).toBe(false);
	});
});

describe("isTransientFailure", () => {
	it("does not read token counts as a 503", () => {
		const failed = cliFailure({
			modelUsage: { m: { outputTokens: 5034 } },
			api_error_status: null,
			result: "API Error: something the model did",
		});
		expect(isTransientFailure(failed)).toBe(false);
	});

	it("still retries a real gateway failure, by status or by message", () => {
		expect(
			isTransientFailure(cliFailure({ api_error_status: 503, result: "API Error: 503 Service Unavailable" })),
		).toBe(true);
		expect(isTransientFailure(new Error("fetch failed: ECONNRESET"))).toBe(true);
		expect(isTransientFailure(new Error("upstream answered 502 Bad Gateway"))).toBe(true);
	});
});
