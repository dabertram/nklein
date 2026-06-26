import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { parseValidatedJsonl } from "../../../src/state/jsonl-store";

const schema = z.object({ id: z.string(), value: z.number() });
type Record = z.infer<typeof schema>;

describe("parseValidatedJsonl — shared helper", () => {
	beforeEach(() => {
		vi.spyOn(process.stderr, "write").mockImplementation(() => true);
	});
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("parses valid records and returns them", () => {
		const content = [JSON.stringify({ id: "a", value: 1 }), JSON.stringify({ id: "b", value: 2 })].join("\n");
		const results = parseValidatedJsonl(content, schema, "test");
		expect(results).toHaveLength(2);
		expect(results[0]).toEqual({ id: "a", value: 1 });
		expect(results[1]).toEqual({ id: "b", value: 2 });
	});

	it("skips blank lines silently", () => {
		const content = `${JSON.stringify({ id: "a", value: 1 })}\n\n   \n${JSON.stringify({ id: "b", value: 2 })}`;
		const results = parseValidatedJsonl(content, schema, "test");
		expect(results).toHaveLength(2);
		expect(process.stderr.write).not.toHaveBeenCalled();
	});

	it("skips JSON-unparseable lines and surfaces a diagnostic", () => {
		const content = [
			JSON.stringify({ id: "a", value: 1 }),
			"not valid json {{",
			JSON.stringify({ id: "b", value: 2 }),
		].join("\n");
		const results = parseValidatedJsonl(content, schema, "test-ctx");
		expect(results).toHaveLength(2);
		expect(process.stderr.write).toHaveBeenCalledOnce();
		const msg = (process.stderr.write as ReturnType<typeof vi.spyOn>).mock.calls[0]?.[0] as string;
		expect(msg).toContain("[jsonl-store]");
		expect(msg).toContain("test-ctx");
		expect(msg).toContain("unparseable");
	});

	it("skips schema-invalid records and surfaces a diagnostic", () => {
		const content = [
			JSON.stringify({ id: "a", value: 1 }),
			JSON.stringify({ id: "b", value: "not-a-number" }), // wrong type for value
			JSON.stringify({ id: "c", value: 3 }),
		].join("\n");
		const results = parseValidatedJsonl(content, schema, "test-ctx");
		expect(results).toHaveLength(2);
		expect(results.map((r: Record) => r.id)).toEqual(["a", "c"]);
		expect(process.stderr.write).toHaveBeenCalledOnce();
		const msg = (process.stderr.write as ReturnType<typeof vi.spyOn>).mock.calls[0]?.[0] as string;
		expect(msg).toContain("[jsonl-store]");
		expect(msg).toContain("test-ctx");
		expect(msg).toContain("schema-invalid");
	});

	it("skips a record missing a required field and surfaces a diagnostic", () => {
		const content = [
			JSON.stringify({ id: "a", value: 1 }),
			JSON.stringify({ id: "missing-value-field" }), // missing `value`
		].join("\n");
		const results = parseValidatedJsonl(content, schema, "test-ctx");
		expect(results).toHaveLength(1);
		expect(results[0]).toEqual({ id: "a", value: 1 });
		expect(process.stderr.write).toHaveBeenCalledOnce();
	});

	it("handles entirely empty content", () => {
		expect(parseValidatedJsonl("", schema, "test")).toEqual([]);
		expect(parseValidatedJsonl("   \n\n   ", schema, "test")).toEqual([]);
		expect(process.stderr.write).not.toHaveBeenCalled();
	});
});

// Integration: one real store (chat-memory-store) wired to the helper.
// Validates that a schema-invalid record persisted in JSONL is skipped + logged, while valid neighbours survive.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readChatMemories } from "../../../src/chat/chat-memory-store";

describe("chat-memory-store — schema-invalid record is skipped + diagnosed", () => {
	let rootDir: string;

	beforeEach(async () => {
		rootDir = await mkdtemp(join(tmpdir(), "nklein-jsonl-store-test-"));
		vi.spyOn(process.stderr, "write").mockImplementation(() => true);
	});
	afterEach(async () => {
		await rm(rootDir, { force: true, recursive: true });
		vi.restoreAllMocks();
	});

	it("reads valid neighbours and skips a structurally-invalid record", async () => {
		const good = JSON.stringify({
			schemaVersion: 1,
			id: "m1",
			sessionId: "s1",
			shared: false,
			text: "hello",
			embedding: null,
			createdAt: 1000,
		});
		// Invalid: `embedding` is a string instead of array|null, `createdAt` is a string.
		const bad = JSON.stringify({
			schemaVersion: 1,
			id: "m2",
			sessionId: "s1",
			shared: false,
			text: "bad",
			embedding: "not-an-array",
			createdAt: "not-a-number",
		});
		const good2 = JSON.stringify({
			schemaVersion: 1,
			id: "m3",
			sessionId: "s1",
			shared: true,
			text: "world",
			embedding: [0.1, 0.2],
			createdAt: 2000,
		});
		await writeFile(join(rootDir, "memories.jsonl"), `${[good, bad, good2].join("\n")}\n`, "utf8");

		const memories = await readChatMemories({ rootDir });
		expect(memories).toHaveLength(2);
		expect(memories.map((m) => m.id)).toEqual(["m1", "m3"]);

		expect(process.stderr.write).toHaveBeenCalledOnce();
		const msg = (process.stderr.write as ReturnType<typeof vi.spyOn>).mock.calls[0]?.[0] as string;
		expect(msg).toContain("[jsonl-store]");
		expect(msg).toContain("chat-memory-store");
		expect(msg).toContain("schema-invalid");
	});
});
