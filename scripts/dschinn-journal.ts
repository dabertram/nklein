/**
 * Progress journal for "!Klein drives dschinn" (David 2026-09-06: "take screenshots occasionally and document a bit
 * how nklein becomes more and more capable to drive dschinn .. include anything interesting like model scores").
 *
 * One run = one dated entry appended to docs/journal/dschinn-drive-log.md plus screenshots of the running UI
 * (board + dependency graph) under docs/journal/. Metrics come from the live runtime (tRPC) and the board file:
 * lane counts, fleet instances, the fitness table's best rows, merge history. Usage:
 *   npx tsx scripts/dschinn-journal.ts --note "what happened" [--server http://127.0.0.1:3502]
 *     [--board <path/to/board.json>] [--label v31]
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, appendFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";

const arg = (name: string, fallback = ""): string =>
	process.argv.find((entry) => entry.startsWith(`--${name}=`))?.slice(name.length + 3) ??
	(process.argv.includes(`--${name}`) ? process.argv[process.argv.indexOf(`--${name}`) + 1] ?? fallback : fallback);
const server = arg("server", "http://127.0.0.1:3502");
const label = arg("label", "v31");
const note = arg("note", "");
const boardPath = arg("board", "");
const journalDir = resolve(process.cwd(), "docs", "journal");
const journalFile = resolve(journalDir, "dschinn-drive-log.md");
mkdirSync(journalDir, { recursive: true });

const stamp = new Date();
// Local calendar day (the ISO date flips to tomorrow at 02:00 CEST — the first entry was stamped a day early).
const day = `${stamp.getFullYear()}-${String(stamp.getMonth() + 1).padStart(2, "0")}-${String(stamp.getDate()).padStart(2, "0")}`;
const time = stamp.toTimeString().slice(0, 5);
const slugTime = time.replace(":", "");

async function trpc(path: string): Promise<unknown> {
	const response = await fetch(`${server}/api/trpc/${path}?workspaceId=ws`);
	const body = (await response.json()) as { result?: { data?: unknown } };
	return body.result?.data ?? null;
}

function lanes(): string {
	if (!boardPath || !existsSync(boardPath)) {
		return "(board file not given)";
	}
	const board = JSON.parse(readFileSync(boardPath, "utf8")) as { columns: { id: string; cards: unknown[] }[] };
	return board.columns.map((column) => `${column.id} ${column.cards.length}`).join(" · ");
}

function fleet(): string {
	try {
		const out = execFileSync("lms", ["ps", "--json"], { encoding: "utf8" });
		const rows = JSON.parse(out) as { identifier?: string; status?: string; machineId?: string; contextLength?: number; sizeBytes?: number }[];
		return rows
			.map((row) => `${row.identifier} (${row.machineId ? row.machineId.slice(0, 6) : "local"}, ctx ${row.contextLength ?? "?"}, ${row.status ?? "?"})`)
			.join("; ");
	} catch {
		return "(lms ps unavailable)";
	}
}

async function screenshots(): Promise<string[]> {
	const files: string[] = [];
	const browser = await chromium.launch();
	try {
		const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, colorScheme: "dark" });
		await page.goto(server, { waitUntil: "networkidle", timeout: 30_000 });
		// A fresh headless profile gets the onboarding + project-setup wizards; both close on Escape, and the
		// project one also has a "Skip setup" button. Repeat until the mode tabs are reachable.
		for (let attempt = 0; attempt < 4; attempt += 1) {
			await page.keyboard.press("Escape").catch(() => undefined);
			await page.waitForTimeout(600);
			const skip = page.getByRole("button", { name: /skip setup/iu });
			if (await skip.count()) {
				await skip.first().click().catch(() => undefined);
				await page.waitForTimeout(800);
			}
			if (await page.getByRole("button", { name: "Graph" }).count()) {
				break;
			}
		}
		await page.waitForTimeout(1500);
		// The "board" shot is the FULL kanban mode, not the minimalistic chat view a fresh profile lands on.
		const full = page.getByRole("button", { name: "Full" });
		if (await full.count()) {
			await full.first().click().catch(() => undefined);
			await page.waitForTimeout(2000);
		}
		const boardShot = resolve(journalDir, `${day}-${slugTime}-${label}-board.png`);
		await page.screenshot({ path: boardShot, fullPage: false });
		files.push(boardShot);
		// The mode tabs render once the board has loaded; give the Graph tab a real wait instead of a count().
		const graph = page.getByRole("button", { name: "Graph" });
		const graphVisible = await graph
			.first()
			.waitFor({ state: "visible", timeout: 15_000 })
			.then(() => true)
			.catch(() => false);
		if (graphVisible) {
			await graph.first().click();
			await page.waitForTimeout(2500);
			const graphShot = resolve(journalDir, `${day}-${slugTime}-${label}-graph.png`);
			await page.screenshot({ path: graphShot, fullPage: false });
			files.push(graphShot);
		}
	} finally {
		await browser.close();
	}
	return files;
}

async function main(): Promise<void> {
	const fitness = (await trpc("runtime.getFitnessTable").catch(() => null)) as {
		rows?: { modelKey: string; role: string; difficultyTier: string; sampleCount: number; successRate: number; confidenceBand: string }[];
	} | null;
	const merges = (await trpc("runtime.getMergeHistory").catch(() => null)) as { records?: { ok: boolean }[] } | null;
	const rows = (fitness?.rows ?? [])
		.filter((row) => row.sampleCount >= 3)
		.sort((a, b) => b.sampleCount - a.sampleCount)
		.slice(0, 10)
		.map(
			(row) =>
				`| ${row.modelKey.replace(/^lmstudio:/u, "").replace(/:http:\/\/[^|]*$/u, "")} | ${row.role} | ${row.difficultyTier} | ${row.sampleCount} | ${(row.successRate * 100).toFixed(0)}% | ${row.confidenceBand} |`,
		);
	const mergeRecords = merges?.records ?? [];
	const mergeLine = mergeRecords.length
		? `${mergeRecords.filter((record) => record.ok).length} ok / ${mergeRecords.length} recorded merge passes`
		: "(no merge history)";
	const shots = await screenshots().catch((error: unknown) => {
		console.error(`screenshots skipped: ${error instanceof Error ? error.message : String(error)}`);
		return [] as string[];
	});
	const entry = [
		`## ${day} ${time} — ${label}`,
		"",
		note ? `${note}` : "_(no note)_",
		"",
		`- **Lanes:** ${lanes()}`,
		`- **Fleet:** ${fleet()}`,
		`- **Merges:** ${mergeLine}`,
		rows.length
			? ["- **Fitness (most-sampled cells):**", "", "| model | role | tier | n | success | confidence |", "|---|---|---|---|---|---|", ...rows].join("\n")
			: "- **Fitness:** (no rows)",
		...shots.map((shot) => `\n![${shot.split("/").pop()}](${shot.split("/").pop()})`),
		"",
	].join("\n");
	if (!existsSync(journalFile)) {
		writeFileSync(
			journalFile,
			"# !Klein drives dschinn — progress journal\n\nDated entries appended by `scripts/dschinn-journal.ts` (screenshots of the live board + graph, lane counts, fleet, fitness table, merge history) plus a human note about what changed. Newest at the bottom.\n\n",
			"utf8",
		);
	}
	appendFileSync(journalFile, `${entry}\n`, "utf8");
	console.log(`journal: appended ${day} ${time} (${shots.length} screenshot(s)) → ${journalFile}`);
}

main().catch((error: unknown) => {
	console.error(`dschinn-journal failed: ${error instanceof Error ? error.message : String(error)}`);
	process.exit(1);
});
