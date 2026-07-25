import { describe, expect, it } from "vitest";
import {
	resolveToolRunnerRawInput,
	TOOL_RUNNER_STDIN_INPUT_ARG,
	TOOL_RUNNER_STDIN_THRESHOLD_BYTES,
} from "../../../src/nklein-agent/agent-sandbox/tool-runner-protocol";

async function* streamOf(chunks: ReadonlyArray<Buffer | string>): AsyncGenerator<Buffer | string> {
	for (const chunk of chunks) {
		yield chunk;
	}
}

describe("tool-runner stdin protocol (N10.e2big)", () => {
	it("passes non-sentinel argv input through and never touches stdin", async () => {
		const json = JSON.stringify({ command: "replace" });
		// biome-ignore lint/correctness/useYield: reading this stream at all is the failure being asserted.
		async function* mustNotRead(): AsyncGenerator<Buffer> {
			throw new Error("stdin must not be read for argv inputs");
		}
		await expect(resolveToolRunnerRawInput(json, mustNotRead())).resolves.toBe(json);
	});

	it("reassembles a ≥1MB chunked stdin payload when the argv slot carries the sentinel", async () => {
		const payload = JSON.stringify({
			toolName: "write_files",
			input: { files: [{ path: "docs/generated.md", content: "x".repeat(1_100_000) }] },
			sessionId: "session-1",
		});
		expect(Buffer.byteLength(payload, "utf8")).toBeGreaterThan(1_000_000);
		const bytes = Buffer.from(payload, "utf8");
		const chunks: Buffer[] = [];
		for (let offset = 0; offset < bytes.length; offset += 64 * 1024) {
			chunks.push(bytes.subarray(offset, offset + 64 * 1024));
		}
		expect(chunks.length).toBeGreaterThan(1);
		await expect(resolveToolRunnerRawInput(TOOL_RUNNER_STDIN_INPUT_ARG, streamOf(chunks))).resolves.toBe(payload);
	});

	it("keeps the argv/stdin threshold safely under Linux's 128 KiB per-argument wall", () => {
		expect(TOOL_RUNNER_STDIN_THRESHOLD_BYTES).toBeLessThanOrEqual(64 * 1024);
	});
});
