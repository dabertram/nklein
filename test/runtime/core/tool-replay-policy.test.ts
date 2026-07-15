import { describe, expect, it } from "vitest";
import {
	compareReconfirmResult,
	decideToolReplayAction,
	type RecordedToolExecution,
	resolveToolReplayPolicy,
} from "../../../src/core/tool-replay-policy";
import { hashToolResultContent } from "../../../src/core/tool-result-record";

function recorded(overrides: Partial<RecordedToolExecution> = {}): RecordedToolExecution {
	const content = overrides.content ?? { ok: true };
	return {
		toolName: "run_commands",
		inputFingerprint: "fp",
		occurrence: 1,
		content,
		resultHash: hashToolResultContent(content),
		isError: false,
		...overrides,
	};
}

describe("resolveToolReplayPolicy", () => {
	it("prefers explicit config, then the per-tool default, then reuse as fail-safe", () => {
		expect(resolveToolReplayPolicy("read_files", { read_files: "simulate" })).toBe("simulate"); // config wins
		expect(resolveToolReplayPolicy("read_files")).toBe("reconfirm"); // per-tool default
		expect(resolveToolReplayPolicy("write_file")).toBe("reuse"); // mutating default
		expect(resolveToolReplayPolicy("some_unknown_tool")).toBe("reuse"); // fail-safe
	});
});

describe("decideToolReplayAction", () => {
	it("executes live on the first time (no record) regardless of policy", () => {
		expect(decideToolReplayAction({ policy: "reuse", recorded: null })).toEqual({ action: "execute_first_time" });
		expect(decideToolReplayAction({ policy: "reconfirm", recorded: null })).toEqual({ action: "execute_first_time" });
	});

	it("maps each policy to its replay action when a record exists", () => {
		const rec = recorded();
		expect(decideToolReplayAction({ policy: "reuse", recorded: rec })).toEqual({ action: "reuse", recorded: rec });
		expect(decideToolReplayAction({ policy: "simulate", recorded: rec })).toEqual({ action: "simulate" });
		expect(decideToolReplayAction({ policy: "reconfirm", recorded: rec })).toEqual({
			action: "execute_and_compare",
			recorded: rec,
		});
	});

	it("emits a skip marker naming the tool and recorded outcome", () => {
		const decision = decideToolReplayAction({
			policy: "skip",
			recorded: recorded({ toolName: "notify", isError: true }),
		});
		expect(decision.action).toBe("skip");
		if (decision.action === "skip") {
			expect(decision.marker).toContain("notify");
			expect(decision.marker).toContain("error");
		}
	});
});

describe("compareReconfirmResult", () => {
	it("matches when the live content reproduces the recorded hash, and detects drift otherwise", () => {
		const rec = recorded({ content: { value: 42 } });
		expect(compareReconfirmResult(rec, { value: 42 })).toEqual({ matched: true, liveHash: rec.resultHash });
		expect(compareReconfirmResult(rec, { value: 43 }).matched).toBe(false);
	});
});
