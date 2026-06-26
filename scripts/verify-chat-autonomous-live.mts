/**
 * Live small-model end-to-end check of the §5.0.1 autonomous loop. Assumes dev:full is serving at BASE_URL with a
 * loaded local chat model. Starts a real autonomous run from the sidebar with a goal trivially satisfiable via the
 * control tools (plan, then declare done) so the loop terminates in ~1-2 turns, and confirms the run drives the real
 * model to a stop reason (status leaves "Working…") with the transcript growing — proving the live loop end-to-end.
 * Bounded poll (default 180s). Screenshot → /tmp/nklein-chat-autonomous-live.png.
 */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const requirePlaywright = createRequire(fileURLToPath(new URL("../web-ui/package.json", import.meta.url)));
const { chromium } = requirePlaywright("playwright") as typeof import("playwright");

const BASE_URL = process.env.NKLEIN_DEV_URL ?? "http://127.0.0.1:4173";
const POLL_TIMEOUT_MS = Number(process.env.NKLEIN_LIVE_TIMEOUT_MS ?? 180_000);
const GOAL =
	"Connectivity self-test: call update_focus_chain with a single step marked done, then call declare_goal_complete with a one-line summary. Do not use any other tools.";

async function main(): Promise<void> {
	const browser = await chromium.launch({ headless: true });
	const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
	const failures: string[] = [];
	try {
		await page.goto(BASE_URL, { waitUntil: "networkidle", timeout: 30_000 });
		for (let i = 0; i < 4; i++) {
			if ((await page.locator('[data-state="open"][aria-hidden="true"]').count()) === 0) break;
			await page.keyboard.press("Escape");
			await page.waitForTimeout(300);
		}
		await page.locator('[data-testid="open-chat-button"]').click({ timeout: 8_000 });
		await page.waitForTimeout(400);
		await page.locator('[data-testid="chat-new-session"]').click({ timeout: 8_000 });
		await page.waitForTimeout(800);

		await page.locator('[data-testid="chat-autonomous-goal"]').fill(GOAL);
		await page.locator('[data-testid="chat-autonomous-start"]').click({ timeout: 8_000 });

		const statusLocator = page.locator('[data-testid="chat-autonomous-status"]');
		// It should immediately reflect a running state.
		await statusLocator.waitFor({ state: "visible", timeout: 10_000 });
		const firstStatus = (await statusLocator.textContent()) ?? "";
		console.log(`Run started; status: "${firstStatus.trim()}"`);

		// Poll until the status leaves "Working…" (a stop reason landed) or we time out.
		const deadline = Date.now() + POLL_TIMEOUT_MS;
		let finalStatus = firstStatus;
		let stopped = false;
		while (Date.now() < deadline) {
			await page.waitForTimeout(3_000);
			finalStatus = (await statusLocator.textContent().catch(() => finalStatus)) ?? finalStatus;
			if (!/Working/i.test(finalStatus)) {
				stopped = true;
				break;
			}
		}
		const messageCount = await page.locator('[data-testid="chat-message"]').count();
		await page.screenshot({ path: "/tmp/nklein-chat-autonomous-live.png", fullPage: false });
		console.log(`Final status: "${finalStatus.trim()}" · transcript messages: ${messageCount} · stopped: ${stopped}`);

		if (!stopped) {
			failures.push(`run did not reach a stop reason within ${POLL_TIMEOUT_MS / 1000}s (still: "${finalStatus.trim()}")`);
		} else if (messageCount === 0) {
			failures.push("run stopped but the transcript has no messages (the loop did not persist a turn)");
		}
	} catch (error) {
		failures.push(`live run failed: ${error instanceof Error ? error.message : String(error)}`);
	} finally {
		await browser.close();
	}

	if (failures.length > 0) {
		console.error(`FAIL:\n${failures.join("\n")}`);
		process.exit(1);
	}
	console.log("PASS: the autonomous loop drove the real local model to a stop reason end-to-end.");
}

void main();
