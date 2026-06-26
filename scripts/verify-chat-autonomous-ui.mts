/**
 * Live Playwright render-check of the §5.0.1 autonomous-run UI. Assumes the dev app is serving at BASE_URL
 * (default http://127.0.0.1:4173). Opens the chat sidebar, creates a session, and asserts the AutonomousRunBar
 * (goal field + "Auto" button) renders and enables once a goal is typed — all with zero console/page errors. This
 * verifies the UI mounts (no white-screen); the actual autonomous run needs a loaded local model (separate check).
 * Screenshot → /tmp/nklein-chat-autonomous-ui.png.
 */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const requirePlaywright = createRequire(fileURLToPath(new URL("../web-ui/package.json", import.meta.url)));
const { chromium } = requirePlaywright("playwright") as typeof import("playwright");
type ConsoleMessage = import("playwright").ConsoleMessage;

const BASE_URL = process.env.NKLEIN_DEV_URL ?? "http://127.0.0.1:4173";

async function main(): Promise<void> {
	const browser = await chromium.launch({ headless: true });
	const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
	const consoleErrors: string[] = [];
	page.on("console", (msg: ConsoleMessage) => {
		if (msg.type() === "error") consoleErrors.push(msg.text());
	});
	page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));

	const failures: string[] = [];
	try {
		await page.goto(BASE_URL, { waitUntil: "networkidle", timeout: 30_000 });
		for (let i = 0; i < 4; i++) {
			if ((await page.locator('[data-state="open"][aria-hidden="true"]').count()) === 0) break;
			await page.keyboard.press("Escape");
			await page.waitForTimeout(300);
		}
		// Expand the chat sidebar, then create a session so the composer + AutonomousRunBar render.
		await page.locator('[data-testid="open-chat-button"]').click({ timeout: 8_000 });
		await page.waitForTimeout(400);
		await page.locator('[data-testid="chat-new-session"]').click({ timeout: 8_000 });
		await page.waitForTimeout(800);

		const goalInput = page.locator('[data-testid="chat-autonomous-goal"]');
		const startButton = page.locator('[data-testid="chat-autonomous-start"]');
		const hasBar = (await goalInput.count()) > 0 && (await startButton.count()) > 0;
		if (!hasBar) failures.push("AutonomousRunBar (goal field + Auto button) did not render after creating a session");

		if (hasBar) {
			// Start is disabled with an empty goal, and enables once a goal is typed.
			if (!(await startButton.isDisabled())) failures.push("Auto button should be disabled with an empty goal");
			await goalInput.fill("Add a hello-world endpoint");
			await page.waitForTimeout(200);
			if (await startButton.isDisabled()) failures.push("Auto button should enable once a goal is typed");
		}

		await page.screenshot({ path: "/tmp/nklein-chat-autonomous-ui.png", fullPage: false });
		console.log(`Chat sidebar opened; AutonomousRunBar present: ${hasBar}.`);
	} catch (error) {
		failures.push(`navigation/interaction failed: ${error instanceof Error ? error.message : String(error)}`);
	} finally {
		await browser.close();
	}

	if (consoleErrors.length > 0) failures.push(`console errors:\n  ${consoleErrors.join("\n  ")}`);
	if (failures.length > 0) {
		console.error(`FAIL:\n${failures.join("\n")}`);
		process.exit(1);
	}
	console.log("PASS: autonomous-run UI renders + enables with zero console/page errors.");
}

void main();
