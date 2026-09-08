import { createReadStream } from "node:fs";
import { open } from "node:fs/promises";
import { createInterface } from "node:readline";

/**
 * P0.HEAP — bounded-memory JSONL readers.
 *
 * Every day-partitioned JSONL log (`telemetry/`, `knowledge-tool-usage/`, `model-performance/`, …) was read with
 * `readFile(path, "utf8")` and then `.split("\n")`: one string the size of the whole file plus one string per line,
 * all live at once. Those files grow for the entire factory run — the 2026-09-07 heap crash's drain held a 384 MB
 * knowledge-usage day file and a 92 MB telemetry day file, read on session start, on every `decompose_project`
 * call and on every status poll. The fatal allocation in both heap crashes was exactly that decode
 * (`node::StringDecoder::DecodeData` under an `fs.readFile` promise resolving a huge UTF-8 string).
 *
 * These readers hand the caller ONE line at a time. Forward reads stream 256 KB blocks through `readline`; the
 * reverse reader walks the file from its end in blocks, splitting on the newline BYTE (0x0A never occurs inside a
 * multi-byte UTF-8 sequence, so a block boundary can split a line but never a code point — each line is decoded
 * only once it is complete). A visitor returning `false` stops the read, which is what makes "the newest N
 * matching records" cost a few KB instead of the whole file.
 *
 * Missing or unreadable files visit nothing — the previous readers' `.catch(() => "")` contract.
 */
/** Return `false` to stop the read. Anything else — including nothing — continues. */
export type JsonlLineVisitor = (line: string) => unknown;

const DEFAULT_BLOCK_BYTES = 256 * 1024;
const NEWLINE_BYTE = 0x0a;

/** Visit each non-empty line OLDEST-FIRST without materializing the file. */
export async function forEachJsonlLine(path: string, visit: JsonlLineVisitor): Promise<void> {
	const stream = createReadStream(path, { encoding: "utf8", highWaterMark: DEFAULT_BLOCK_BYTES });
	const lines = createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY });
	try {
		for await (const line of lines) {
			if (line.length === 0) {
				continue;
			}
			if (visit(line) === false) {
				break;
			}
		}
	} catch {
		// ENOENT / EACCES / a mid-read failure: the file contributes nothing, matching the old readers' catch-to-empty.
	} finally {
		lines.close();
		stream.destroy();
	}
}

/** Visit each non-empty line NEWEST-FIRST (last line first) without materializing the file. */
export async function forEachJsonlLineReverse(
	path: string,
	visit: JsonlLineVisitor,
	options: { blockBytes?: number } = {},
): Promise<void> {
	const blockBytes = Math.max(1, Math.trunc(options.blockBytes ?? DEFAULT_BLOCK_BYTES));
	let handle: Awaited<ReturnType<typeof open>>;
	try {
		handle = await open(path, "r");
	} catch {
		return;
	}
	try {
		let position = (await handle.stat()).size;
		// Bytes before the first newline of the previous block: the (possibly partial) line that continues into the
		// next block read. Kept as bytes so a split multi-byte character is only decoded once it is whole.
		let carry: Buffer = Buffer.alloc(0);
		while (position > 0) {
			const readSize = Math.min(blockBytes, position);
			position -= readSize;
			const block = Buffer.alloc(readSize);
			let filled = 0;
			while (filled < readSize) {
				const { bytesRead } = await handle.read(block, filled, readSize - filled, position + filled);
				if (bytesRead === 0) {
					break;
				}
				filled += bytesRead;
			}
			const chunk = carry.length > 0 ? Buffer.concat([block.subarray(0, filled), carry]) : block.subarray(0, filled);
			let end = chunk.length;
			let newline = end > 0 ? chunk.lastIndexOf(NEWLINE_BYTE, end - 1) : -1;
			while (newline !== -1) {
				const line = chunk.toString("utf8", newline + 1, end);
				end = newline;
				if (line.length > 0 && visit(line) === false) {
					return;
				}
				newline = end > 0 ? chunk.lastIndexOf(NEWLINE_BYTE, end - 1) : -1;
			}
			carry = Buffer.from(chunk.subarray(0, end));
		}
		if (carry.length > 0) {
			const line = carry.toString("utf8");
			if (line.length > 0) {
				visit(line);
			}
		}
	} catch {
		// A mid-read failure ends the visit; whatever was visited before it stands.
	} finally {
		await handle.close().catch(() => undefined);
	}
}
