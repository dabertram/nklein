import { describe, expect, it, vi } from "vitest";
import { runSetupAcquireCommand } from "../../../src/commands/setup-acquire-command";
import type { LmStudioModelAcquisitionClient } from "../../../src/core/lmstudio-model-acquisition";

/**
 * P25.3 phase 3 — the setup-time acquisition surface. Two-step consent: the preview NEVER constructs a
 * client (no network), and --approve binds the operator's declared catalogue facts into the fenced client.
 */

function fakeClient(result: Awaited<ReturnType<LmStudioModelAcquisitionClient["downloadModel"]>>) {
	const downloadModel = vi.fn(async () => result);
	const createClient = vi.fn((input: { consent: LmStudioModelAcquisitionClient["consent"] }) => ({
		consent: input.consent,
		downloadModel,
	}));
	return { createClient, downloadModel };
}

describe("setup acquire", () => {
	it("previews without --approve and performs NO download — not even a client construction", async () => {
		const lines: string[] = [];
		const { createClient, downloadModel } = fakeClient({ ok: true, value: { model: "qwen/qwen3.5-9b" } });
		const code = await runSetupAcquireCommand(
			"qwen/qwen3.5-9b",
			{ format: "mlx", sizeGb: "5.2", publisher: "lmstudio-community" },
			{ write: (text) => lines.push(text), createClient },
		);
		expect(code).toBe(0);
		expect(createClient).not.toHaveBeenCalled();
		expect(downloadModel).not.toHaveBeenCalled();
		const output = lines.join("\n");
		expect(output).toContain("qwen/qwen3.5-9b");
		expect(output).toContain("mlx (allow-listed weight format)");
		expect(output).toContain("No download performed");
		expect(output).toContain("--approve");
		// The key states 9B, so the fit verdict runs without extra declarations.
		expect(output).toMatch(/fit: (fits|tight|exceeds)/);
	});

	it("refuses --approve without a declared format — the format rule is a hard gate", async () => {
		const { createClient } = fakeClient({ ok: true, value: { model: "m" } });
		const code = await runSetupAcquireCommand("some/model", { approve: true }, { write: () => {}, createClient });
		expect(code).toBe(65);
		expect(createClient).not.toHaveBeenCalled();
	});

	it("rejects an unknown format string before anything else", async () => {
		const code = await runSetupAcquireCommand("some/model", { format: "zip" }, { write: () => {} });
		expect(code).toBe(64);
	});

	it("binds the declared facts into the consent and reports a refusal verbatim", async () => {
		const lines: string[] = [];
		const { createClient, downloadModel } = fakeClient({
			ok: false,
			error: { type: "unsafe_format_refused", message: "pickle is not a weights-only format" },
		});
		const code = await runSetupAcquireCommand(
			"evil/model",
			{ format: "pickle", approve: true, publisher: "someone", allowPublisher: ["lmstudio-community"] },
			{ write: (text) => lines.push(text), createClient },
		);
		expect(code).toBe(1);
		expect(downloadModel).toHaveBeenCalledWith({ model: "evil/model" });
		const consent = createClient.mock.calls[0]?.[0].consent;
		expect(consent).toMatchObject({ modelKey: "evil/model", artifactFormat: "pickle", publisher: "someone" });
		expect(lines.join("\n")).toContain("unsafe_format_refused");
	});

	it("downloads on --approve with a safe format and says so plainly", async () => {
		const lines: string[] = [];
		const { createClient } = fakeClient({ ok: true, value: { model: "qwen/qwen3.5-9b" } });
		const code = await runSetupAcquireCommand(
			"qwen/qwen3.5-9b",
			{ format: "mlx", approve: true },
			{ write: (text) => lines.push(text), createClient },
		);
		expect(code).toBe(0);
		expect(lines.join("\n")).toContain("✓ downloaded qwen/qwen3.5-9b");
	});
});
