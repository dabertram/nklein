import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { forEachJsonlLine, forEachJsonlLineReverse } from "../../../src/state/jsonl-stream";

/**
 * P0.HEAP. Every day-partitioned JSONL log was read with `readFile(path, "utf8").split("\n")` — one string the
 * size of the whole file plus one per line, all live at once. The 2026-09-07 crash's drain held a 384 MB
 * knowledge-usage day file read on session start, on every decompose and on every status poll, and the fatal
 * allocation was exactly that decode.
 *
 * The reverse reader is the one that needs proving. It walks the file backwards in blocks and splits on the
 * newline BYTE, so a block boundary can land in the middle of a line and even in the middle of a multi-byte
 * character. The tests below force both, with a tiny block size.
 */
function fileWith(lines: string[]): string {
	const path = join(mkdtempSync(join(tmpdir(), "nklein-jsonl-")), "day.jsonl");
	writeFileSync(path, `${lines.join("\n")}\n`, "utf8");
	return path;
}

async function collect(path: string): Promise<string[]> {
	const seen: string[] = [];
	await forEachJsonlLine(path, (line) => {
		seen.push(line);
	});
	return seen;
}

async function collectReverse(path: string, blockBytes?: number): Promise<string[]> {
	const seen: string[] = [];
	await forEachJsonlLineReverse(
		path,
		(line) => {
			seen.push(line);
		},
		blockBytes === undefined ? {} : { blockBytes },
	);
	return seen;
}

describe("forEachJsonlLine", () => {
	it("hands over every line, in order", async () => {
		expect(await collect(fileWith(['{"a":1}', '{"a":2}', '{"a":3}']))).toEqual(['{"a":1}', '{"a":2}', '{"a":3}']);
	});

	it("stops when the visitor returns false — that is what makes an early exit cheap", async () => {
		const path = fileWith(['{"a":1}', '{"a":2}', '{"a":3}']);
		const seen: string[] = [];
		await forEachJsonlLine(path, (line) => {
			seen.push(line);
			return seen.length < 2;
		});
		expect(seen).toEqual(['{"a":1}', '{"a":2}']);
	});

	it("reads a missing file as no lines rather than throwing", async () => {
		await expect(collect(join(tmpdir(), "nklein-jsonl-nope", "missing.jsonl"))).resolves.toEqual([]);
	});
});

describe("forEachJsonlLineReverse", () => {
	it("hands over every line newest-first", async () => {
		expect(await collectReverse(fileWith(["one", "two", "three"]))).toEqual(["three", "two", "one"]);
	});

	it("is correct when a block boundary splits a LINE — the whole point of reading in blocks", async () => {
		const lines = Array.from({ length: 40 }, (_unused, index) => `{"n":${index},"pad":"${"x".repeat(20)}"}`);
		// A block far smaller than a line forces every boundary to land mid-line.
		expect(await collectReverse(fileWith(lines), 8)).toEqual([...lines].reverse());
	});

	it("is correct when a block boundary splits a multi-byte CHARACTER", async () => {
		// Each of these is 3 bytes in UTF-8, so a block size that is not a multiple of 3 lands inside one.
		const lines = ["€€€€€€€€", "日本語のテキスト", "→→→→→→"];
		for (const blockBytes of [1, 2, 4, 5, 7]) {
			expect(await collectReverse(fileWith(lines), blockBytes), `blockBytes ${blockBytes}`).toEqual(
				[...lines].reverse(),
			);
		}
	});

	it("stops when the visitor returns false, which is how 'the newest N' stays cheap", async () => {
		const lines = Array.from({ length: 500 }, (_unused, index) => `{"n":${index}}`);
		const path = fileWith(lines);
		const seen: string[] = [];
		await forEachJsonlLineReverse(path, (line) => {
			seen.push(line);
			return seen.length < 3;
		});
		expect(seen).toEqual(['{"n":499}', '{"n":498}', '{"n":497}']);
	});

	it("reads a missing or empty file as no lines", async () => {
		await expect(collectReverse(join(tmpdir(), "nklein-jsonl-nope", "missing.jsonl"))).resolves.toEqual([]);
		expect(await collectReverse(fileWith([]))).toEqual([]);
	});

	it("agrees with the forward reader on the same file", async () => {
		const lines = Array.from({ length: 97 }, (_unused, index) => `{"n":${index},"t":"line ${index}"}`);
		const path = fileWith(lines);
		expect(await collectReverse(path, 13)).toEqual((await collect(path)).reverse());
	});
});
