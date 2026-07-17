import { decodePngToRgba } from "../core/png-decode";
import type { RgbaImage } from "../core/visual-verification-gate";

/**
 * F12.87 effectful leg: shoot a rendered route for the visual-verification gate. Thin, injectable adapter around
 * Playwright — the LAUNCHER is a dependency so the orchestration (console-error capture, render failure, decode,
 * teardown) unit-tests with a fake, and production passes `chromium` from the root-level playwright dependency
 * (browser binaries ship with the web-ui e2e setup). Local-only by design: the gate shoots the DEV SERVER route.
 */

export interface RouteScreenshotPage {
	on(event: "console", handler: (message: { type(): string; text(): string }) => void): void;
	on(event: "pageerror", handler: (error: Error) => void): void;
	goto(url: string, options?: { waitUntil?: "networkidle" | "load"; timeout?: number }): Promise<unknown>;
	screenshot(options?: { type?: "png" }): Promise<Uint8Array | Buffer>;
}

export interface RouteScreenshotBrowser {
	newPage(options?: { viewport?: { width: number; height: number } }): Promise<RouteScreenshotPage>;
	close(): Promise<void>;
}

export interface RouteScreenshotLauncher {
	launch(options?: { headless?: boolean }): Promise<RouteScreenshotBrowser>;
}

export interface RouteScreenshotResult {
	/** Decoded RGBA, or null when the route failed to render or the shot failed to decode. */
	readonly image: RgbaImage | null;
	/** Did navigation itself succeed? */
	readonly rendered: boolean;
	/** Console error / pageerror texts captured during the render. */
	readonly consoleErrors: readonly string[];
}

export async function captureRouteScreenshot(
	input: {
		readonly url: string;
		readonly width?: number;
		readonly height?: number;
		readonly timeoutMs?: number;
	},
	launcher: RouteScreenshotLauncher,
): Promise<RouteScreenshotResult> {
	const consoleErrors: string[] = [];
	let browser: RouteScreenshotBrowser | null = null;
	try {
		browser = await launcher.launch({ headless: true });
		const page = await browser.newPage({
			viewport: { width: input.width ?? 1280, height: input.height ?? 800 },
		});
		page.on("console", (message) => {
			if (message.type() === "error") {
				consoleErrors.push(message.text());
			}
		});
		page.on("pageerror", (error) => {
			consoleErrors.push(String(error?.message ?? error));
		});
		try {
			await page.goto(input.url, { waitUntil: "networkidle", timeout: input.timeoutMs ?? 30_000 });
		} catch (error) {
			consoleErrors.push(`navigation failed: ${error instanceof Error ? error.message : String(error)}`);
			return { image: null, rendered: false, consoleErrors };
		}
		const png = await page.screenshot({ type: "png" });
		const image = decodePngToRgba(png instanceof Uint8Array ? png : new Uint8Array(png));
		return { image, rendered: true, consoleErrors };
	} catch (error) {
		consoleErrors.push(`screenshot failed: ${error instanceof Error ? error.message : String(error)}`);
		return { image: null, rendered: false, consoleErrors };
	} finally {
		await Promise.resolve(browser?.close()).catch(() => {});
	}
}
