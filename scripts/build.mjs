import * as esbuild from "esbuild";
import { clineSdkEsbuildAlias } from "./cline-sdk-alias.mjs";

/**
 * Runtime externals — deps esbuild must NOT inline; they resolve from the published package's node_modules at runtime.
 * - `node-pty`: a native addon with a compiled binding + spawn-helper binary that must live on disk.
 * - `playwright` (+ `playwright-core`, `chromium-bidi`): the §5.M `browse_url` browser tool's engine — a heavy runtime
 *   dependency that ships its own browser binaries and CJS bundles esbuild can't resolve/inline. Externalized like
 *   node-pty; it's a first-class `dependency`, so `require("playwright")` resolves at runtime.
 * - `fsevents`: a macOS-only native `.node` file-watcher, pulled in transitively; self-guards on non-macOS.
 * Everything else esbuild can inline.
 */
const external = ["node-pty", "playwright", "playwright-core", "chromium-bidi", "fsevents"];

/** Bake OTEL telemetry env vars into the bundle at build time. */
const define = {
	"process.env.NODE_ENV": '"production"',
	"process.env.OTEL_TELEMETRY_ENABLED": JSON.stringify(process.env.OTEL_TELEMETRY_ENABLED ?? ""),
	"process.env.OTEL_EXPORTER_OTLP_ENDPOINT": JSON.stringify(process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? ""),
	"process.env.OTEL_METRICS_EXPORTER": JSON.stringify(process.env.OTEL_METRICS_EXPORTER ?? ""),
	"process.env.OTEL_LOGS_EXPORTER": JSON.stringify(process.env.OTEL_LOGS_EXPORTER ?? ""),
	"process.env.OTEL_EXPORTER_OTLP_PROTOCOL": JSON.stringify(process.env.OTEL_EXPORTER_OTLP_PROTOCOL ?? ""),
	"process.env.OTEL_METRIC_EXPORT_INTERVAL": JSON.stringify(process.env.OTEL_METRIC_EXPORT_INTERVAL ?? ""),
	"process.env.OTEL_EXPORTER_OTLP_HEADERS": JSON.stringify(process.env.OTEL_EXPORTER_OTLP_HEADERS ?? ""),
};

/**
 * Bundled CJS dependencies reference CommonJS globals that do NOT exist in ESM output:
 * - `require()` on Node built-ins (process, fs, …) — needs a real require() function.
 * - `__filename` / `__dirname` — module-path globals some deps use at runtime (e.g. to resolve a sibling asset). Without
 *   these, the server-start path throws `__filename is not defined` (a bundle-only crash the source + test suite never
 *   hit — only the built binary does). Reconstruct them from `import.meta.url`, the ESM equivalent.
 */
const cjsShimBanner = [
	'import { createRequire as __kanban_createRequire } from "node:module";',
	'import { fileURLToPath as __kanban_fileURLToPath } from "node:url";',
	'import { dirname as __kanban_dirname } from "node:path";',
	"const require = __kanban_createRequire(import.meta.url);",
	"const __filename = __kanban_fileURLToPath(import.meta.url);",
	"const __dirname = __kanban_dirname(__filename);",
].join("\n");

/** Shared esbuild options for both entry points. */
const shared = {
	bundle: true,
	format: "esm",
	platform: "node",
	target: "node20",
	external,
	define,
	alias: clineSdkEsbuildAlias,
	sourcemap: true,
	packages: "bundle",
	banner: { js: cjsShimBanner },
};

await Promise.all([
	// CLI binary
	esbuild.build({
		...shared,
		entryPoints: ["src/cli.ts"],
		outfile: "dist/cli.js",
		banner: { js: `#!/usr/bin/env node\n${cjsShimBanner}` },
	}),
	// Library export
	esbuild.build({
		...shared,
		entryPoints: ["src/index.ts"],
		outfile: "dist/index.js",
	}),
]);

console.log("esbuild: bundled dist/cli.js and dist/index.js");
