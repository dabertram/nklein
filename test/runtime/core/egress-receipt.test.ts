import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildEgressReceipt, verifyEgressReceiptChain } from "../../../src/core/egress-receipt";
import { appendEgressReceipt, readEgressReceipts } from "../../../src/state/egress-receipt-store";

describe("egress-receipt chain (pure)", () => {
	const base = {
		destination: "http://localhost:18888/search?q=x",
		method: "GET",
		requestSummary: "http://localhost:18888/search?q=x",
		category: "web_research",
		taintLabels: [] as string[],
	};

	it("builds a verifiable chain and detects content tampering", () => {
		const first = buildEgressReceipt({ ...base, prevHash: null, at: 1 });
		const second = buildEgressReceipt({
			...base,
			destination: "http://localhost:18888/other",
			prevHash: first.hash,
			at: 2,
		});
		expect(verifyEgressReceiptChain([first, second]).valid).toBe(true);
		const tampered = { ...second, destination: "https://evil.example" };
		const verdict = verifyEgressReceiptChain([first, tampered]);
		expect(verdict.valid).toBe(false);
		expect(verdict.reason).toContain("altered");
	});

	it("detects a broken link (removed middle receipt)", () => {
		const first = buildEgressReceipt({ ...base, prevHash: null, at: 1 });
		const second = buildEgressReceipt({ ...base, prevHash: first.hash, at: 2 });
		const third = buildEgressReceipt({ ...base, prevHash: second.hash, at: 3 });
		const verdict = verifyEgressReceiptChain([first, third]); // second removed
		expect(verdict).toMatchObject({ valid: false, brokenAt: 1 });
	});
});

describe("egress-receipt store", () => {
	let dir: string | null = null;
	afterEach(async () => {
		if (dir) {
			await rm(dir, { recursive: true, force: true });
			dir = null;
		}
	});

	it("appends chained receipts and round-trips a valid chain", async () => {
		dir = await mkdtemp(join(tmpdir(), "egress-receipts-"));
		const filePath = join(dir, "receipts.jsonl");
		await appendEgressReceipt(
			{
				destination: "http://localhost/a",
				method: "GET",
				requestSummary: "a",
				category: "web_research",
				taintLabels: [],
				at: 1,
			},
			{ filePath },
		);
		await appendEgressReceipt(
			{
				destination: "http://localhost/b",
				method: "GET",
				requestSummary: "b",
				category: "web_research",
				taintLabels: ["web"],
				at: 2,
			},
			{ filePath },
		);
		const receipts = await readEgressReceipts({ filePath });
		expect(receipts).toHaveLength(2);
		expect(receipts[1]?.prevHash).toBe(receipts[0]?.hash);
		expect(verifyEgressReceiptChain(receipts).valid).toBe(true);
	});

	it("skips a torn tail line on read (chain verification still meaningful)", async () => {
		dir = await mkdtemp(join(tmpdir(), "egress-receipts-"));
		const filePath = join(dir, "receipts.jsonl");
		await appendEgressReceipt(
			{
				destination: "http://localhost/a",
				method: "GET",
				requestSummary: "a",
				category: "web_research",
				taintLabels: [],
				at: 1,
			},
			{ filePath },
		);
		const raw = await readFile(filePath, "utf8");
		await writeFile(filePath, `${raw}{"torn`, "utf8");
		const receipts = await readEgressReceipts({ filePath });
		expect(receipts).toHaveLength(1);
		expect(verifyEgressReceiptChain(receipts).valid).toBe(true);
	});
});
