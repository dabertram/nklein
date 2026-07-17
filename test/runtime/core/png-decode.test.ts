import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { decodePngToRgba } from "../../../src/core/png-decode";

/** Hand-craft a valid PNG (filter 0 rows, one IDAT) for known pixels — the round-trip oracle. */
function encodePng(width: number, height: number, rgba: number[], colorType: 6 | 2 = 6): Uint8Array {
	const channels = colorType === 6 ? 4 : 3;
	const crcTable = Array.from({ length: 256 }, (_, n) => {
		let c = n;
		for (let k = 0; k < 8; k++) {
			c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		}
		return c >>> 0;
	});
	const crc32 = (bytes: Uint8Array): number => {
		let c = 0xffffffff;
		for (const byte of bytes) {
			c = (crcTable[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
		}
		return (c ^ 0xffffffff) >>> 0;
	};
	const chunk = (type: string, data: Uint8Array): Uint8Array => {
		const out = new Uint8Array(12 + data.length);
		const view = new DataView(out.buffer);
		view.setUint32(0, data.length);
		for (let i = 0; i < 4; i++) {
			out[4 + i] = type.charCodeAt(i);
		}
		out.set(data, 8);
		view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
		return out;
	};
	const ihdr = new Uint8Array(13);
	const ihdrView = new DataView(ihdr.buffer);
	ihdrView.setUint32(0, width);
	ihdrView.setUint32(4, height);
	ihdr[8] = 8; // bit depth
	ihdr[9] = colorType;
	// compression 0, filter 0, interlace 0
	const stride = width * channels;
	const rawRows = new Uint8Array((stride + 1) * height);
	for (let y = 0; y < height; y++) {
		rawRows[y * (stride + 1)] = 0; // filter: None
		for (let x = 0; x < stride; x++) {
			const px = y * width + Math.floor(x / channels);
			const ch = x % channels;
			rawRows[y * (stride + 1) + 1 + x] = rgba[px * 4 + ch] ?? 0;
		}
	}
	const idat = deflateSync(Buffer.from(rawRows));
	const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
	return Buffer.concat([
		signature,
		chunk("IHDR", ihdr),
		chunk("IDAT", new Uint8Array(idat)),
		chunk("IEND", new Uint8Array(0)),
	]);
}

describe("decodePngToRgba", () => {
	it("round-trips an RGBA png (filter 0)", () => {
		const pixels = [255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 255, 10, 20, 30, 40];
		const decoded = decodePngToRgba(encodePng(2, 2, pixels, 6));
		expect(decoded).not.toBeNull();
		expect(decoded?.width).toBe(2);
		expect(decoded?.height).toBe(2);
		expect([...(decoded?.data ?? [])]).toEqual(pixels);
	});

	it("decodes RGB (color type 2) with alpha filled to 255", () => {
		const pixels = [1, 2, 3, 255, 4, 5, 6, 255];
		const decoded = decodePngToRgba(encodePng(2, 1, pixels, 2));
		expect([...(decoded?.data ?? [])]).toEqual(pixels);
	});

	it("returns null for non-PNG bytes and unsupported shapes", () => {
		expect(decodePngToRgba(new Uint8Array([1, 2, 3]))).toBeNull();
		const png = encodePng(1, 1, [9, 9, 9, 255], 6);
		png[8 + 8 + 8] = 16; // corrupt bit depth in IHDR
		expect(decodePngToRgba(png)).toBeNull();
	});
});
