/**
 * Live Playwright smoke of the §5.W settings regroup (General → General + Agents). Assumes the dev app is serving at
 * BASE_URL (default http://127.0.0.1:4173). Opens Settings, asserts the new "Agents" nav entry exists, clicks it, and
 * confirms the moved agent-execution content (isolation + swarm guardrails) scrolls into view — all with zero
 * console/page errors. Screenshot → /tmp/nklein-settings-agents.png. Exits non-zero on any failure.
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
		// Dismiss any modal/onboarding overlay open on first load (it intercepts pointer events).
		for (let i = 0; i < 4; i++) {
			if ((await page.locator('[data-state="open"][aria-hidden="true"]').count()) === 0) break;
			await page.keyboard.press("Escape");
			await page.waitForTimeout(300);
		}
		// Open Settings via its keyboard shortcut (⌘⇧S — shown in the sidebar shortcut list); robust to icon-only buttons.
		await page.keyboard.press("Meta+Shift+S");
		await page.waitForTimeout(900);
		// Fallback: click the navbar gear if the shortcut didn't open it.
		if ((await page.getByText("General", { exact: true }).count()) === 0) {
			await page.locator("header button, nav button").last().click({ timeout: 5_000 }).catch(() => {});
			await page.waitForTimeout(900);
		}

		// The new "Agents" nav entry must exist (it didn't before §5.W).
		const agentsNav = page.getByRole("button", { name: "Agents" }).or(page.getByText("Agents", { exact: true })).first();
		const hasAgents = (await agentsNav.count()) > 0;
		if (!hasAgents) failures.push('settings nav has no "Agents" entry');

		// General must still be present (it kept Developer Mode + Advanced).
		const hasGeneral = (await page.getByText("General", { exact: true }).count()) > 0;
		if (!hasGeneral) failures.push('settings nav lost its "General" entry');

		// Click Agents → the moved content (swarm guardrails / agent isolation) should scroll into view.
		if (hasAgents) {
			await agentsNav.click({ timeout: 5_000 }).catch(() => {});
			await page.waitForTimeout(700);
			const movedContent = await page
				.getByText(/Local swarm guardrails|Agent isolation|Agent rulesets/)
				.first()
				.isVisible()
				.catch(() => false);
			if (!movedContent) failures.push("clicked Agents but the moved agent-execution content is not visible");
		}

		await page.screenshot({ path: "/tmp/nklein-settings-agents.png", fullPage: false });
		console.log(`Settings opened. Agents nav: ${hasAgents}, General nav: ${hasGeneral}.`);
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
	console.log("PASS: settings Agents nav renders + scrolls with zero console/page errors.");
}

void main();
