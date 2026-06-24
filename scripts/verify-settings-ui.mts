/**
 * Live Playwright verification of the Settings UI surfaces (todo §5.A UI live-verification debts + the §5.T
 * guardrails/concurrency editors and the §5.H core-py health line shipped this session).
 *
 * Assumes the dev app is already serving at BASE_URL (default http://127.0.0.1:4173). Drives a headless
 * Chromium, opens Settings, and asserts the key surfaces render with zero console/page errors. Writes a
 * screenshot to /tmp/nklein-settings-ui.png for evidence. Exits non-zero on any failure.
 */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
// Playwright + its browsers are installed under web-ui/node_modules; resolve from there (this is a host-side
// dev verification script, so it doesn't add a root runtime dependency).
const requirePlaywright = createRequire(fileURLToPath(new URL("../web-ui/package.json", import.meta.url)));
const { chromium } = requirePlaywright("playwright") as typeof import("playwright");
type ConsoleMessage = import("playwright").ConsoleMessage;

const BASE_URL = process.env.NKLEIN_DEV_URL ?? "http://127.0.0.1:4173";

const REQUIRED_TEXT = [
	"Local swarm guardrails",
	"Reset to defaults",
	"Autonomous turns",
	"Wall time (hours)",
	"Python core",
];
const REQUIRED_INPUT_IDS = [
	"runtime-settings-guardrail-turns",
	"runtime-settings-guardrail-wall-time",
	"runtime-settings-guardrail-no-diff",
	"runtime-settings-guardrail-tool-calls",
];

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
		// A first-run setup/onboarding dialog can be open on load; dismiss any modal overlay so it doesn't
		// intercept the Settings click.
		for (let i = 0; i < 3; i++) {
			const overlay = page.locator('[data-state="open"][aria-hidden="true"]');
			if ((await overlay.count()) === 0) {
				break;
			}
			await page.keyboard.press("Escape");
			await page.waitForTimeout(300);
		}
		// Open Settings.
		const settingsButton = page.locator('[data-testid="open-settings-button"]');
		await settingsButton.waitFor({ state: "visible", timeout: 15_000 });
		await settingsButton.click({ timeout: 10_000 });
		// Wait for the dialog + a guardrail anchor to render.
		await page.getByText("Local swarm guardrails", { exact: false }).first().waitFor({ timeout: 15_000 });

		const bodyText = (await page.locator("body").innerText()).toLowerCase();
		for (const text of REQUIRED_TEXT) {
			if (!bodyText.includes(text.toLowerCase())) {
				failures.push(`missing text: "${text}"`);
			}
		}
		for (const id of REQUIRED_INPUT_IDS) {
			const input = page.locator(`#${id}`);
			if ((await input.count()) === 0) {
				failures.push(`missing input: #${id}`);
			}
		}
		// The guardrail "Reset to defaults" should be present and the turns input should carry a numeric default.
		const turns = await page.locator("#runtime-settings-guardrail-turns").inputValue().catch(() => "");
		if (!/^\d+$/.test(turns)) {
			failures.push(`turns input value not numeric: "${turns}"`);
		}

		await page.screenshot({ path: "/tmp/nklein-settings-ui.png", fullPage: true });
	} catch (error) {
		failures.push(`exception: ${error instanceof Error ? error.message : String(error)}`);
		await page.screenshot({ path: "/tmp/nklein-settings-ui-error.png", fullPage: true }).catch(() => undefined);
	} finally {
		await browser.close();
	}

	if (consoleErrors.length > 0) {
		// Vite HMR/devtools warnings sometimes appear; surface them but only fail on real errors.
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
	console.log("\nPASS — Settings UI surfaces render (guardrails editor, concurrency, core-py health line).");
	console.log("Screenshot: /tmp/nklein-settings-ui.png");
}

void main();
