import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
	evaluateAiderRegressionGate,
	parseAiderRegressionSnapshot,
} from "../src/core/aider-polyglot-campaign";

function option(name: string): string | undefined {
	const index = process.argv.indexOf(name);
	if (index < 0) return undefined;
	const value = process.argv[index + 1];
	if (!value || value.startsWith("--")) throw new Error(`${name} requires a value.`);
	return value;
}

async function main(): Promise<void> {
	const baselinePath = process.argv[2];
	const currentPath = process.argv[3];
	if (!baselinePath || !currentPath || baselinePath.startsWith("--") || currentPath.startsWith("--")) {
		throw new Error(
			"Usage: npx tsx scripts/gate-aider-regression.mts <baseline-snapshot.json> <current-snapshot.json> [--output <receipt.json>]",
		);
	}
	const [baseline, current] = await Promise.all(
		[baselinePath, currentPath].map(async (path) =>
			parseAiderRegressionSnapshot(JSON.parse(await readFile(resolve(path), "utf8")) as unknown),
		),
	);
	const result = evaluateAiderRegressionGate(baseline, current);
	const text = `${JSON.stringify(result, null, 2)}\n`;
	const output = option("--output");
	if (output) {
		const outputPath = resolve(output);
		await mkdir(dirname(outputPath), { recursive: true });
		await writeFile(outputPath, text, { flag: "wx" }).catch((error: NodeJS.ErrnoException) => {
			if (error.code === "EEXIST") throw new Error(`Refusing to replace immutable gate receipt: ${outputPath}`);
			throw error;
		});
	}
	process.stdout.write(text);
	if (result.outcome === "fail") process.exitCode = 1;
}

await main();
