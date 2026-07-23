import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runSandboxPropertyCheck } from "../../../src/nklein-agent/agent-sandbox/property-check";

const roots: string[] = [];
afterEach(async () => await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe("runSandboxPropertyCheck", () => {
	it("does not execute or persist an unbound scaffold", async () => {
		const root = await mkdtemp(join(tmpdir(), "nklein-property-check-"));
		roots.push(root);
		await writeFile(join(root, "sentinel"), "unchanged");
		const result = await runSandboxPropertyCheck(
			{
				testCode:
					'import fc from "fast-check"; // nklein-invariant:1\nfc.assert(fc.property(fc.integer(), () => { expect(false).toBe(true); }), { numRuns: 100 });',
				invariants: [{ kind: "bounds", statement: "bounded", sourceLine: "must be at most 2" }],
			},
			root,
		);
		expect(result.status).toBe("not_run");
		expect(result.reason).toContain("placeholder");
		expect(await readFile(join(root, "sentinel"), "utf8")).toBe("unchanged");
	});
});
