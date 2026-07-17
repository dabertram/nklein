import { deflateSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import type {
	RouteScreenshotBrowser,
	RouteScreenshotLauncher,
	RouteScreenshotPage,
} from "../../../src/nklein-agent/nklein-route-screenshot";
import { captureRouteScreenshot } from "../../../src/nklein-agent/nklein-route-screenshot";

/** Minimal valid 1x1 RGBA PNG (filter 0) — enough for the decode leg. */
function tinyPng(): Uint8Array {
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
	new DataView(ihdr.buffer).setUint32(0, 1);
	new DataView(ihdr.buffer).setUint32(4, 1);
	ihdr[8] = 8;
	ihdr[9] = 6;
	const idat = deflateSync(Buffer.from(new Uint8Array([0, 9, 8, 7, 255])));
	return Buffer.concat([
		new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk("IHDR", ihdr),
		chunk("IDAT", new Uint8Array(idat)),
		chunk("IEND", new Uint8Array(0)),
	]);
}

function fakeLauncher(page: Partial<RouteScreenshotPage>, closeSpy = vi.fn(async () => {})): RouteScreenshotLauncher {
	const browser: RouteScreenshotBrowser = {
		newPage: vi.fn(async () => ({
			on: () => {},
			goto: async () => undefined,
			screenshot: async () => tinyPng(),
			...page,
		})),
		close: closeSpy,
	};
	return { launch: vi.fn(async () => browser) };
}

describe("captureRouteScreenshot", () => {
	it("renders, decodes the PNG shot, and closes the browser", async () => {
		const closeSpy = vi.fn(async () => {});
		const result = await captureRouteScreenshot({ url: "http://localhost:4173/" }, fakeLauncher({}, closeSpy));
		expect(result.rendered).toBe(true);
		expect(result.image).toMatchObject({ width: 1, height: 1 });
		expect([...(result.image?.data ?? [])]).toEqual([9, 8, 7, 255]);
		expect(closeSpy).toHaveBeenCalled();
	});

	it("captures console errors + pageerrors during the render", async () => {
		const handlers: Record<string, (arg: never) => void> = {};
		const result = await captureRouteScreenshot(
			{ url: "http://x/" },
			fakeLauncher({
				on: ((event: string, handler: (arg: never) => void) => {
					handlers[event] = handler;
				}) as RouteScreenshotPage["on"],
				goto: async () => {
					handlers.console?.({ type: () => "error", text: () => "TypeError: boom" } as never);
					handlers.pageerror?.(new Error("unhandled") as never);
					return undefined;
				},
			}),
		);
		expect(result.consoleErrors).toEqual(["TypeError: boom", "unhandled"]);
	});

	it("reports rendered=false with the navigation error and still closes on goto failure", async () => {
		const closeSpy = vi.fn(async () => {});
		const result = await captureRouteScreenshot(
			{ url: "http://down/" },
			fakeLauncher(
				{
					goto: async () => {
						throw new Error("net::ERR_CONNECTION_REFUSED");
					},
				},
				closeSpy,
			),
		);
		expect(result).toMatchObject({ rendered: false, image: null });
		expect(result.consoleErrors[0]).toContain("navigation failed");
		expect(closeSpy).toHaveBeenCalled();
	});
});
