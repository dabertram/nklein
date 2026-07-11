import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadDotEnv, parseDotEnv } from "../../src/config/load-dotenv";

describe("parseDotEnv", () => {
	it("parses KEY=VALUE lines, skipping blanks and comments", () => {
		const parsed = parseDotEnv("# a comment\n\nFOO=bar\nNKLEIN_DEVICE_RAM_GB=m5max:128,m4mini:24\n");
		expect(parsed).toEqual({ FOO: "bar", NKLEIN_DEVICE_RAM_GB: "m5max:128,m4mini:24" });
	});

	it("tolerates an 'export ' prefix and surrounding whitespace", () => {
		expect(parseDotEnv("export FOO = bar \n  BAZ=qux")).toEqual({ FOO: "bar", BAZ: "qux" });
	});

	it("strips one layer of matching quotes", () => {
		expect(parseDotEnv(`A="quoted"\nB='single'\nC="mismatch'`)).toEqual({
			A: "quoted",
			B: "single",
			C: `"mismatch'`,
		});
	});

	it("keeps a value that itself contains '=' (only the first '=' splits)", () => {
		expect(parseDotEnv("URL=https://x/y?a=b")).toEqual({ URL: "https://x/y?a=b" });
	});

	it("ignores lines with an empty key and keeps the first occurrence of a duplicate", () => {
		expect(parseDotEnv("=novalue\nK=1\nK=2")).toEqual({ K: "1" });
	});
});

describe("loadDotEnv", () => {
	const created: string[] = [];
	const touchedKeys: string[] = [];

	afterEach(() => {
		for (const dir of created.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
		for (const key of touchedKeys.splice(0)) {
			delete process.env[key];
		}
	});

	function writeEnv(content: string): string {
		const dir = mkdtempSync(join(tmpdir(), "nklein-dotenv-"));
		created.push(dir);
		const path = join(dir, ".env");
		writeFileSync(path, content);
		return path;
	}

	it("sets keys from the file that are not already in process.env", () => {
		const key = "NKLEIN_TEST_DOTENV_A";
		touchedKeys.push(key);
		expect(process.env[key]).toBeUndefined();
		loadDotEnv([writeEnv(`${key}=from-file`)]);
		expect(process.env[key]).toBe("from-file");
	});

	it("NEVER overwrites a key already present in the real environment (env wins)", () => {
		const key = "NKLEIN_TEST_DOTENV_B";
		touchedKeys.push(key);
		process.env[key] = "from-env";
		loadDotEnv([writeEnv(`${key}=from-file`)]);
		expect(process.env[key]).toBe("from-env");
	});

	it("is a silent no-op for a missing file", () => {
		expect(() => loadDotEnv([join(tmpdir(), "does-not-exist-nklein", ".env")])).not.toThrow();
	});

	it("earlier paths win over later ones for a duplicate key", () => {
		const key = "NKLEIN_TEST_DOTENV_C";
		touchedKeys.push(key);
		const first = writeEnv(`${key}=first`);
		const second = writeEnv(`${key}=second`);
		loadDotEnv([first, second]);
		expect(process.env[key]).toBe("first");
	});
});
