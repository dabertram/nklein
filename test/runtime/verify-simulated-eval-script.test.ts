import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

describe("verify-simulated-eval", () => {
	it("serves every corpus family through the real repeated-eval path", async () => {
		const { stdout } = await execFileAsync("npx", ["tsx", "scripts/verify-simulated-eval.mts"], {
			cwd: process.cwd(),
			timeout: 30_000,
		});

		expect(stdout).toContain("PASS ✓ repeated-run loop verified");
	});
});
