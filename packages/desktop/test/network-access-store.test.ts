import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	loadNetworkAccessEnabled,
	resolveNetworkAccessConfigPath,
	saveNetworkAccessEnabled,
} from "../src/network-access-store";

describe("network-access-store", () => {
	let dir: string;
	beforeEach(() => {
		dir = mkdtempSync(path.join(tmpdir(), "nklein-netaccess-"));
	});
	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it("defaults to false (loopback-only) when no file exists", () => {
		expect(loadNetworkAccessEnabled(dir)).toBe(false);
	});

	it("round-trips the opt-in through save/load", () => {
		saveNetworkAccessEnabled(dir, true);
		expect(loadNetworkAccessEnabled(dir)).toBe(true);
		saveNetworkAccessEnabled(dir, false);
		expect(loadNetworkAccessEnabled(dir)).toBe(false);
	});

	it("fails safe to false on a malformed or hand-edited file (only strict boolean true enables)", () => {
		writeFileSync(resolveNetworkAccessConfigPath(dir), "{ not json", "utf-8");
		expect(loadNetworkAccessEnabled(dir)).toBe(false);
		writeFileSync(resolveNetworkAccessConfigPath(dir), JSON.stringify({ enabled: "yes" }), "utf-8");
		expect(loadNetworkAccessEnabled(dir)).toBe(false);
		writeFileSync(resolveNetworkAccessConfigPath(dir), JSON.stringify({ enabled: 1 }), "utf-8");
		expect(loadNetworkAccessEnabled(dir)).toBe(false);
	});
});
