import { describe, expect, it, vi } from "vitest";
import { createLlmfitRunner, type LlmfitExec } from "../../../src/core/llmfit-runner";

describe("createLlmfitRunner", () => {
	it("defaults to `uvx llmfit` and forwards the args + returns stdout/exitCode 0", async () => {
		const exec = vi.fn(async () => ({ stdout: '{"models":[]}' })) as unknown as LlmfitExec;
		const run = createLlmfitRunner({}, exec);
		const result = await run(["--json", "recommend"]);
		expect(exec).toHaveBeenCalledWith(
			"uvx",
			["llmfit", "--json", "recommend"],
			expect.objectContaining({
				timeout: 60_000,
			}),
		);
		expect(result).toEqual({ stdout: '{"models":[]}', exitCode: 0 });
	});

	it("uses a resolved binary (no `llmfit` prefix) when configured", async () => {
		const exec = vi.fn(async () => ({ stdout: "ok" })) as unknown as LlmfitExec;
		const run = createLlmfitRunner({ command: { bin: "/usr/local/bin/llmfit" }, timeoutMs: 5000 }, exec);
		await run(["--json", "system"]);
		expect(exec).toHaveBeenCalledWith("/usr/local/bin/llmfit", ["--json", "system"], {
			timeout: 5000,
			maxBuffer: 16 * 1024 * 1024,
		});
	});

	it("maps a non-zero exit / spawn error to { stdout, exitCode } instead of throwing", async () => {
		const exec = (async () => {
			throw Object.assign(new Error("boom"), { code: 1, stdout: "partial error json" });
		}) as unknown as LlmfitExec;
		const run = createLlmfitRunner({}, exec);
		expect(await run(["--json", "recommend"])).toEqual({ stdout: "partial error json", exitCode: 1 });
	});

	it("falls back to exitCode 1 when the error has no numeric code", async () => {
		const exec = (async () => {
			throw new Error("ENOENT: uvx not found");
		}) as unknown as LlmfitExec;
		const run = createLlmfitRunner({}, exec);
		expect(await run(["--json", "system"])).toEqual({ stdout: "", exitCode: 1 });
	});
});
