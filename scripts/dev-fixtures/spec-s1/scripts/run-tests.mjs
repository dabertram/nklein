import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const fixtureRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const testRoot = join(fixtureRoot, "test");
const testFilePattern = /\.test\.(js|ts)$/;

function collectTestFiles(dir) {
	const files = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const fullPath = join(dir, entry.name);
		if (entry.isDirectory()) {
			files.push(...collectTestFiles(fullPath));
			continue;
		}
		if (entry.isFile() && testFilePattern.test(entry.name)) {
			files.push(fullPath);
		}
	}
	return files;
}

const testFiles = collectTestFiles(testRoot).sort();
if (testFiles.length === 0) {
	console.error("No test files found under test/ (*.test.js or *.test.ts).");
	process.exit(1);
}

const result = spawnSync(
	process.execPath,
	["--experimental-strip-types", "--test", ...testFiles.map((file) => relative(fixtureRoot, file))],
	{
		cwd: fixtureRoot,
		stdio: "inherit",
	},
);

if (result.error) {
	console.error(result.error.message);
	process.exit(1);
}
process.exit(result.status ?? 1);
