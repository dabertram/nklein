import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { generateNoOpStub, NO_OP_STUB_MARKER } from "../../../src/core/no-op-stub-generation";

/**
 * P20.3b — the no-op stub.
 *
 * The last block IMPORTS AND CALLS a generated stub rather than asserting on its text. That distinction has
 * already cost this codebase once: the implement-sandbox harness had a unit test asserting the generated script
 * CONTAINED the candidate, which passed throughout while block-scoping made every class-based candidate score 0.
 * A stub that reads correctly and does not throw is the same failure — and here it produces a false accusation.
 */

const directories: string[] = [];

afterEach(async () => {
	for (const directory of directories.splice(0)) {
		await rm(directory, { recursive: true, force: true });
	}
});

function stub(source: string) {
	return generateNoOpStub({ source, originalSpecifier: "./original" });
}

describe("generateNoOpStub — refusals", () => {
	it("REFUSES `export *`, which it cannot enumerate", () => {
		// The dangerous case: names it cannot see stay REAL, tests exercising them keep passing, and the ablation
		// reports `decorative` for an artifact it never removed.
		const result = stub('export * from "./other";\nexport function f() {}\n');
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe("unrecognised_export");
			expect(result.detail).toMatch(/line 1/u);
		}
	});

	it("REFUSES a re-export from another module", () => {
		expect(stub('export { a } from "./other";\n').ok).toBe(false);
	});

	it("REFUSES a default export, which has no name to stub", () => {
		expect(stub("export default function () {}\n").ok).toBe(false);
	});

	it("REFUSES an export form it does not recognise, rather than leaving it real", () => {
		const result = stub("export enum Colour { Red }\n");
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.detail).toMatch(/refusing to emit a stub that might leave it real/u);
		}
	});

	it("REFUSES a module with nothing an ablation could measure", () => {
		const result = stub("export type Only = string;\n");
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe("no_exports");
			expect(result.detail).toMatch(/erased at runtime/u);
		}
	});

	it("does NOT refuse because a DOC COMMENT mentions `export *`", () => {
		// This codebase's headers are full of code examples. Aborting on one would refuse a perfectly stubbable
		// module, and the operator would have no idea why.
		const result = stub('/**\n * Do not use `export * from "./x"` here.\n */\nexport function f() {}\n');
		expect(result.ok).toBe(true);
	});
});

describe("generateNoOpStub — what it emits", () => {
	it("stubs functions, classes and values, and classifies each", () => {
		const result = stub("export function doThing() {}\nexport class Engine {}\nexport const LIMIT = 5;\n");
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.exports).toEqual([
				{ name: "doThing", kind: "function" },
				{ name: "Engine", kind: "class" },
				{ name: "LIMIT", kind: "value" },
			]);
		}
	});

	it("PRESERVES type exports by re-exporting them from the original", () => {
		// Dropping them fails the build, and a build failure in the ablated run reads as every test failing —
		// which `assessNoOpAblation` calls inconclusive. Not a false accusation, but a run that measured nothing.
		const result = stub("export interface Config { a: number }\nexport function f() {}\n");
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.source).toContain('export type { Config } from "./original";');
		}
	});

	it("exports the RENAMED name from an export list, not the local one", () => {
		// `export { internal as publicName }` — stubbing `internal` would leave `publicName` unexported and break
		// every import, turning a verdict into a build error.
		const result = stub("export { internal as publicName };\n");
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.exports.map((entry) => entry.name)).toEqual(["publicName"]);
		}
	});

	it("handles async and generator functions", () => {
		const result = stub("export async function loadThing() {}\nexport function* walk() {}\n");
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.exports.map((entry) => entry.name)).toEqual(["loadThing", "walk"]);
		}
	});
});

describe("generateNoOpStub — the stub actually THROWS (imported and called)", () => {
	async function loadStub(source: string): Promise<Record<string, unknown>> {
		const directory = await mkdtemp(join(tmpdir(), "nklein-stub-"));
		directories.push(directory);
		const result = generateNoOpStub({ source, originalSpecifier: "./original" });
		if (!result.ok) {
			throw new Error(`expected a stub, got refusal: ${result.detail}`);
		}
		await writeFile(join(directory, "original.ts"), source, "utf8");
		await writeFile(join(directory, "stub.ts"), result.source, "utf8");
		return (await import(join(directory, "stub.ts"))) as Record<string, unknown>;
	}

	it("throws from a stubbed FUNCTION, with a marker that traces to the ablation", async () => {
		const module = await loadStub("export function doThing(a: number) {\n\treturn a + 1;\n}\n");
		expect(() => (module.doThing as () => unknown)()).toThrow(new RegExp(NO_OP_STUB_MARKER, "u"));
	});

	it("throws from a stubbed CLASS CONSTRUCTOR, not merely by being undefined", async () => {
		// An undefined binding throws a TypeError that reads like a harness bug; the stub must report itself.
		const module = await loadStub("export class Engine {\n\tstart() {\n\t\treturn true;\n\t}\n}\n");
		expect(() => new (module.Engine as new () => unknown)()).toThrow(new RegExp(NO_OP_STUB_MARKER, "u"));
	});

	it("throws on merely READING a stubbed value — the case a returned default would hide", async () => {
		// The rule the whole item turns on. A stub returning `0` here lets any test that reads the constant pass,
		// and the ablation reports `decorative` for code that is genuinely load-bearing.
		const module = await loadStub("export const LIMIT = 5;\n");
		expect(() => (module.LIMIT as { anything: unknown }).anything).toThrow(new RegExp(NO_OP_STUB_MARKER, "u"));
	});

	it("names the export that was reached, so a failure says WHICH artifact was depended on", async () => {
		const module = await loadStub("export function alpha() {}\nexport function beta() {}\n");
		expect(() => (module.beta as () => unknown)()).toThrow(/beta/u);
	});
});
