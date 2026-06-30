#!/usr/bin/env node
// Build the vendored Cline SDK source (vendor/cline-sdk) into consumable dist.
//
// We vendor the SDK *source* (Apache-2.0, github.com/cline/cline @ the pinned commit in
// vendor/cline-sdk/NOTICE.md) and build it ourselves so we (a) never depend on upstream's
// prebuilt npm bundles surviving, and (b) can patch internals (e.g. context/compaction for
// small/slow local LLMs). This mirrors the upstream `bun.mts` build with esbuild: each
// package's `exports` entrypoints are bundled self-contained (third-party deps inlined,
// only sibling @cline/* kept external), and `.d.ts` are emitted via the package's
// tsconfig.build.json. Output goes to vendor/cline-sdk/packages/<pkg>/dist.
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SDK = join(ROOT, "vendor/cline-sdk");
const TSC = join(ROOT, "node_modules/typescript/bin/tsc");
// Dependency order: leaves first so each package's .d.ts can resolve already-built siblings.
const PACKAGES = ["shared", "llms", "agents", "core", "sdk"];
const CLINE_EXTERNAL = ["@cline/shared", "@cline/llms", "@cline/agents", "@cline/core"];

function entrypointsFromExports(dir, manifest) {
	const entries = [];
	const seen = new Set();
	const add = (importPath) => {
		if (!importPath || seen.has(importPath)) return;
		const src = importPath.replace("./dist/", "./src/").replace(/\.js$/, ".ts");
		const abs = join(dir, src);
		if (existsSync(abs)) {
			seen.add(importPath);
			entries.push({ in: abs, out: importPath.replace("./dist/", "").replace(/\.js$/, "") });
		}
	};
	for (const value of Object.values(manifest.exports ?? { ".": { import: "./dist/index.js" } })) {
		add(typeof value === "string" ? value : value?.import);
	}
	return entries;
}

let total = 0;
for (const pkg of PACKAGES) {
	const dir = join(SDK, "packages", pkg);
	const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
	const entries = entrypointsFromExports(dir, manifest);
	// The plugin sandbox bootstrap runs in an isolated child process and is emitted as a
	// standalone executable entrypoint (not part of the package `exports`).
	if (pkg === "core") {
		const bootstrap = join(dir, "src/extensions/plugin/plugin-sandbox-bootstrap.ts");
		if (existsSync(bootstrap)) entries.push({ in: bootstrap, out: "extensions/plugin-sandbox-bootstrap" });
	}
	await build({
		entryPoints: entries,
		outdir: join(dir, "dist"),
		bundle: true,
		format: "esm",
		platform: "node",
		minify: true,
		// Keep sibling SDK packages external (resolved to their own built dist); inline all
		// third-party deps so the consuming app needs no extra runtime dependencies.
		external: CLINE_EXTERNAL,
		// ESM-for-node shim: bundled CJS deps call require()/__dirname/__filename at runtime, which an
		// esbuild ESM bundle leaves as a throwing stub ("Dynamic require of X is not supported"). Provide
		// the real ones from node:module so a spawned node process (e.g. the CLI) loads the dist cleanly.
		banner: {
			js: [
				"import { createRequire as __cjsCreateRequire } from 'node:module';",
				"import { fileURLToPath as __cjsFileURLToPath } from 'node:url';",
				"import { dirname as __cjsDirname } from 'node:path';",
				"const require = __cjsCreateRequire(import.meta.url);",
				"const __filename = __cjsFileURLToPath(import.meta.url);",
				"const __dirname = __cjsDirname(__filename);",
			].join("\n"),
		},
		logLevel: "warning",
	});
	// Declarations: the package's tsconfig.build.json already encodes the right include set.
	const buildTsconfig = join(dir, "tsconfig.build.json");
	if (existsSync(buildTsconfig)) {
		execFileSync("node", [TSC, "-p", "tsconfig.build.json"], { stdio: "inherit", cwd: dir });
	} else {
		execFileSync(
			"node",
			[TSC, "src/index.ts", "--declaration", "--emitDeclarationOnly", "--outDir", "dist", "--skipLibCheck"],
			{ stdio: "inherit", cwd: dir },
		);
	}
	console.log(`✓ built @cline/${pkg} (${entries.length} entrypoints)`);
	total += entries.length;
}
console.log(`Cline SDK build complete: ${PACKAGES.length} packages, ${total} entrypoints.`);
