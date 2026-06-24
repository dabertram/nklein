/**
 * Live Playwright smoke of the card-detail-view decomposition (todo §5.U). Assumes the dev app is serving at
 * BASE_URL (default http://127.0.0.1:4173). Boots a headless Chromium, loads the board, and if any card is present
 * opens it to confirm the detail view + extracted panels render with zero console/page errors. Writes a screenshot
 * to /tmp/nklein-card-detail-ui.png. Exits non-zero on any console error or thrown failure.
 */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const requirePlaywright = createRequire(fileURLToPath(new URL("../web-ui/package.json", import.meta.url)));
const { chromium } = requirePlaywright("playwright") as typeof import("playwright");
type ConsoleMessage = import("playwright").ConsoleMessage;

const BASE_URL = process.env.NKLEIN_DEV_URL ?? "http://127.0.0.1:4173";

async function main(): Promise<void> {
	const browser = await chromium.launch({ headless: true });
	const page = await browser.newPage();
	const consoleErrors: string[] = [];
	page.on("console", (msg: ConsoleMessage) => {
		if (msg.type() === "error") {
			consoleErrors.push(msg.text());
		}
	});
	page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));

	const failures: string[] = [];
	try {
		await page.goto(BASE_URL, { waitUntil: "networkidle", timeout: 30_000 });
		for (let i = 0; i < 3; i++) {
			const overlay = page.locator('[data-state="open"][aria-hidden="true"]');
			if ((await overlay.count()) === 0) {
				break;
			}
			await page.keyboard.press("Escape");
			await page.waitForTimeout(300);
		}
		// Open a board card. Backlog cards open the inline editor; started cards open the full card-detail-view
		// (the §5.U-decomposed component). Either way the interaction must render with zero console errors — the
		// bundle-level regression signal. The detail view's panel rendering itself is covered by the web vitest
		// component tests (they mount card-detail-view with started/review/completed selections in jsdom).
		const card = page.locator(".kb-board-card-shell").first();
		const cardCount = await card.count();
		let cardOpened = false;
		if (cardCount > 0) {
			await card.click({ timeout: 5_000 }).catch(() => {});
			await page.waitForTimeout(1_000);
			cardOpened = (await page.getByText(/Start in plan mode|Diagnostics|Focus chain|Evidence and diff/).count()) > 0;
		}
		await page.screenshot({ path: "/tmp/nklein-card-detail-ui.png", fullPage: false });
		console.log(`Loaded board (cards found: ${cardCount}, card opened: ${cardOpened}).`);
		if (cardCount > 0 && !cardOpened) {
			failures.push("clicked a card but neither the inline editor nor the detail view rendered");
		}
	} catch (error) {
		failures.push(`navigation/interaction failed: ${error instanceof Error ? error.message : String(error)}`);
	} finally {
		await browser.close();
	}

	if (consoleErrors.length > 0) {
		failures.push(`console errors:\n  ${consoleErrors.join("\n  ")}`);
	}
	if (failures.length > 0) {
		console.error(`FAIL:\n${failures.join("\n")}`);
		process.exit(1);
	}
	console.log("PASS: card-detail UI booted with zero console/page errors.");
}

void main();
