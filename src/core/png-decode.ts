/**
 * Minimal PNG → raw RGBA decoder (F12.87 screenshot leg). Playwright screenshots arrive as PNG; the visual gate and
 * baseline store speak raw RGBA — and pulling a codec dependency (or Playwright's PRIVATE utils bundle) for the one
 * decode we need is worse than the ~100 lines of the actual format. Scope: exactly what Playwright emits — 8-bit,
 * color type 6 (RGBA) or 2 (RGB), non-interlaced, standard filters 0–4. Anything else returns null (the caller
 * treats the shot as unusable rather than guessing). Inflate via node:zlib (computation, no I/O).
 */

import { inflateSync } from "node:zlib";
import type { RgbaImage } from "./visual-verification-gate";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

function paeth(a: number, b: number, c: number): number {
	const p = a + b - c;
	const pa = Math.abs(p - a);
	const pb = Math.abs(p - b);
	const pc = Math.abs(p - c);
	return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Decode a PNG buffer to raw RGBA, or null when the buffer is not a PNG this decoder supports. */
export function decodePngToRgba(png: Uint8Array): RgbaImage | null {
	if (png.length < 8 || PNG_SIGNATURE.some((byte, i) => png[i] !== byte)) {
		return null;
	}
	const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
	let offset = 8;
	let width = 0;
	let height = 0;
	let bitDepth = 0;
	let colorType = -1;
	let interlace = -1;
	const idatParts: Uint8Array[] = [];
	while (offset + 8 <= png.length) {
		const length = view.getUint32(offset);
		const type = String.fromCharCode(
			png[offset + 4] ?? 0,
			png[offset + 5] ?? 0,
			png[offset + 6] ?? 0,
			png[offset + 7] ?? 0,
		);
		const dataStart = offset + 8;
		if (dataStart + length > png.length) {
			return null;
		}
		if (type === "IHDR") {
			width = view.getUint32(dataStart);
			height = view.getUint32(dataStart + 4);
			bitDepth = png[dataStart + 8] ?? 0;
			colorType = png[dataStart + 9] ?? -1;
			interlace = png[dataStart + 12] ?? -1;
		} else if (type === "IDAT") {
			idatParts.push(png.subarray(dataStart, dataStart + length));
		} else if (type === "IEND") {
			break;
		}
		offset = dataStart + length + 4; // skip CRC
	}
	if (width <= 0 || height <= 0 || bitDepth !== 8 || (colorType !== 6 && colorType !== 2) || interlace !== 0) {
		return null;
	}
	const channels = colorType === 6 ? 4 : 3;
	let raw: Buffer;
	try {
		raw = inflateSync(Buffer.concat(idatParts.map((part) => Buffer.from(part))));
	} catch {
		return null;
	}
	const stride = width * channels;
	if (raw.length < (stride + 1) * height) {
		return null;
	}
	const out = new Uint8Array(width * height * 4);
	const prior = new Uint8Array(stride);
	const line = new Uint8Array(stride);
	for (let y = 0; y < height; y++) {
		const rowStart = y * (stride + 1);
		const filter = raw[rowStart] ?? 0;
		for (let x = 0; x < stride; x++) {
			const rawByte = raw[rowStart + 1 + x] ?? 0;
			const left = x >= channels ? (line[x - channels] ?? 0) : 0;
			const up = prior[x] ?? 0;
			const upLeft = x >= channels ? (prior[x - channels] ?? 0) : 0;
			let value: number;
			switch (filter) {
				case 0:
					value = rawByte;
					break;
				case 1:
					value = rawByte + left;
					break;
				case 2:
					value = rawByte + up;
					break;
				case 3:
					value = rawByte + ((left + up) >> 1);
					break;
				case 4:
					value = rawByte + paeth(left, up, upLeft);
					break;
				default:
					return null;
			}
			line[x] = value & 0xff;
		}
		for (let x = 0; x < width; x++) {
			const src = x * channels;
			const dst = (y * width + x) * 4;
			out[dst] = line[src] ?? 0;
			out[dst + 1] = line[src + 1] ?? 0;
			out[dst + 2] = line[src + 2] ?? 0;
			out[dst + 3] = channels === 4 ? (line[src + 3] ?? 0) : 255;
		}
		prior.set(line);
	}
	return { width, height, data: out };
}
