/**
 * One-off live capture of the §5.AI per-project sidebar activity badge. Assumes a runtime is serving at BASE_URL with
 * dev-test projects running (e.g. via scripts/dev-test-rail.mts). Polls projects.list until a project shows live
 * running/queued agents, then screenshots the sidebar to /tmp/nklein-sidebar-activity.png and prints the counts it saw.
 */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const requirePlaywright = createRequire(fileURLToPath(new URL("../web-ui/package.json", import.meta.url)));
const { chromium } = requirePlaywright("playwright") as typeof import("playwright");

const BASE_URL = process.env.NKLEIN_DEV_URL ?? "http://127.0.0.1:3484";
const PROJECTS_URL = `${BASE_URL}/api/trpc/projects.list?batch=1&input=${encodeURIComponent('{"0":{}}')}`;
const MAX_POLL_MS = Number(process.env.SHOT_MAX_POLL_MS ?? 180_000);

interface ProjectRow {
	name: string;
	runningSessionCount?: number;
	queuedSessionCount?: number;
	taskCounts: Record<string, number>;
}

function summarize(projects: ProjectRow[]): { active: boolean; line: string } {
	let active = false;
	const parts = projects.map((p) => {
		const r = p.runningSessionCount ?? 0;
		const q = p.queuedSessionCount ?? 0;
		if (r > 0 || q > 0) {
			active = true;
		}
		return `${p.name.slice(0, 22)}(run=${r} q=${q} ip=${p.taskCounts.in_progress ?? 0} plan=${p.taskCounts.planning ?? 0})`;
	});
	return { active, line: parts.join("  ") };
}

async function main(): Promise<void> {
	const browser = await chromium.launch({ headless: true });
	const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
	try {
		await page.goto(BASE_URL, { waitUntil: "networkidle", timeout: 30_000 });
		await page.waitForSelector("aside", { timeout: 15_000 });

		const deadline = Date.now() + MAX_POLL_MS;
		let captured = false;
		let lastLine = "";
		let bestProjects: ProjectRow[] = [];
		while (Date.now() < deadline) {
			let projects: ProjectRow[] = [];
			try {
				const resp = await page.request.get(PROJECTS_URL, { timeout: 55_000 });
				const json = (await resp.json()) as Array<{ result?: { data?: { projects?: ProjectRow[] } } }>;
				projects = json[0]?.result?.data?.projects ?? [];
			} catch {
				// Under heavy parallel-agent streaming the runtime event loop starves and this query stalls; keep polling.
				console.log(`[${new Date().toISOString().slice(11, 19)}] projects.list slow/timeout — retrying`);
				continue;
			}
			const { active, line } = summarize(projects);
			if (line !== lastLine) {
				console.log(`[${new Date().toISOString().slice(11, 19)}] ${line}`);
				lastLine = line;
			}
			if (active) {
				bestProjects = projects;
				// Let the badge paint, then capture the sidebar.
				await page.waitForTimeout(400);
				const sidebar = page.locator("aside").first();
				await sidebar.screenshot({ path: "/tmp/nklein-sidebar-activity.png" });
				await page.screenshot({ path: "/tmp/nklein-sidebar-activity-full.png", fullPage: false });
				captured = true;
				console.log(`CAPTURED active sidebar: ${summarize(projects).line}`);
				break;
			}
			await page.waitForTimeout(1_500);
		}
		if (!captured) {
			const sidebar = page.locator("aside").first();
			await sidebar.screenshot({ path: "/tmp/nklein-sidebar-activity.png" });
			console.log(`No running/queued window caught within ${MAX_POLL_MS}ms; captured idle sidebar. Last: ${lastLine}`);
		}
		console.log(`projects at capture: ${bestProjects.length}`);
	} finally {
		await browser.close();
	}
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
