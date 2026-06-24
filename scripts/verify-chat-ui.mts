/**
 * Live Playwright verification of the §5.M chat UI surface (the board-independent chat dialog wired to the `chat`
 * tRPC sub-router). Assumes the dev app is serving at BASE_URL (default http://127.0.0.1:4173) with a loaded local
 * model (LM Studio). Drives a headless Chromium: opens the chat dialog, starts a new session, sends a message, and
 * asserts a real assistant reply renders. Writes a screenshot to /tmp/nklein-chat-ui.png. Exits non-zero on failure.
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
		// Dismiss any first-run overlay so it doesn't intercept clicks.
		for (let i = 0; i < 3; i++) {
			const overlay = page.locator('[data-state="open"][aria-hidden="true"]');
			if ((await overlay.count()) === 0) {
				break;
			}
			await page.keyboard.press("Escape");
			await page.waitForTimeout(300);
		}

		// Open the chat dialog.
		const chatButton = page.locator('[data-testid="open-chat-button"]');
		await chatButton.waitFor({ state: "visible", timeout: 15_000 });
		await chatButton.click({ timeout: 10_000 });

		// Start a new session.
		const newSession = page.locator('[data-testid="chat-new-session"]');
		await newSession.waitFor({ state: "visible", timeout: 10_000 });
		await newSession.click();
		await page.locator('[data-testid="chat-session-item"]').first().waitFor({ timeout: 10_000 });

		// The editable session header (title + role + scope + goal) should render for the selected session.
		await page.locator('[data-testid="chat-session-title"]').waitFor({ state: "visible", timeout: 10_000 });
		for (const id of ["chat-session-role", "chat-session-scope", "chat-session-goal"]) {
			if ((await page.locator(`[data-testid="${id}"]`).count()) === 0) {
				failures.push(`missing session-header control: ${id}`);
			}
		}

		// Send a message.
		const composer = page.locator('[data-testid="chat-composer-input"]');
		await composer.waitFor({ state: "visible", timeout: 10_000 });
		await composer.fill("Reply with exactly the word: pong");
		await page.locator('[data-testid="chat-send-button"]').click();

		// The user bubble should appear immediately; the assistant reply after the model responds.
		await page
			.locator('[data-testid="chat-message"][data-role="user"]')
			.first()
			.waitFor({ timeout: 15_000 });
		await page
			.locator('[data-testid="chat-message"][data-role="assistant"]')
			.first()
			.waitFor({ timeout: 90_000 });

		const assistantText = await page
			.locator('[data-testid="chat-message"][data-role="assistant"]')
			.first()
			.innerText();
		if (assistantText.trim().length === 0) {
			failures.push("assistant reply was empty");
		}
		console.log(`Assistant reply: ${assistantText.trim().slice(0, 160)}`);

		const errorBanner = page.locator('[data-testid="chat-error"]');
		if ((await errorBanner.count()) > 0) {
			failures.push(`chat error banner shown: ${await errorBanner.innerText()}`);
		}

		await page.screenshot({ path: "/tmp/nklein-chat-ui.png", fullPage: true });
	} catch (error) {
		failures.push(`exception: ${error instanceof Error ? error.message : String(error)}`);
		await page.screenshot({ path: "/tmp/nklein-chat-ui-error.png", fullPage: true }).catch(() => undefined);
	} finally {
		await browser.close();
	}

	if (consoleErrors.length > 0) {
		console.log(`Console errors (${consoleErrors.length}):`);
		for (const e of consoleErrors.slice(0, 20)) {
			console.log(`  - ${e}`);
		}
	}
	if (failures.length > 0) {
		console.error(`\nFAIL — ${failures.length} issue(s):`);
		for (const f of failures) {
			console.error(`  - ${f}`);
		}
		process.exit(1);
	}
	console.log("\nPASS — chat dialog opened, a session was created, and a real assistant reply rendered.");
	console.log("Screenshot: /tmp/nklein-chat-ui.png");
}

void main();
