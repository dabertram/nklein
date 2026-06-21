#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const diff = spawnSync("git", ["diff", "--exit-code", "--", "node_modules/@clinebot"], {
	stdio: "inherit",
});

if (diff.error) {
	console.error(`Failed to inspect Cline SDK package diffs: ${diff.error.message}`);
	process.exit(1);
}

if (diff.status !== 0) {
	console.error("Cline SDK package changes detected. Keep SDK changes behind src/cline-sdk/ instead of patching node_modules.");
	process.exit(diff.status ?? 1);
}
