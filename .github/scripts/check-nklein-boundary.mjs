#!/usr/bin/env node
// SDK boundary guard. The agent SDK is vendored under vendor/nklein-sdk/ (aliased
// @nklein/*) and must only be imported through src/nklein-agent/ boundary modules
// (that import rule is biome-enforced). This legacy check additionally flags ad-hoc
// patches to the still-installed upstream @clinebot package in node_modules.
// A proper boundary-policy update (matching current package names) is §5.X
// architecture recommendation #10 (see todo.md §5.X).
import { spawnSync } from "node:child_process";

const diff = spawnSync("git", ["diff", "--exit-code", "--", "node_modules/@clinebot"], {
	stdio: "inherit",
});

if (diff.error) {
	console.error(`Failed to inspect SDK package diffs: ${diff.error.message}`);
	process.exit(1);
}

if (diff.status !== 0) {
	console.error("SDK package changes detected in node_modules. Keep SDK changes behind src/nklein-agent/ instead of patching node_modules.");
	process.exit(diff.status ?? 1);
}
