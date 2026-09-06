import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

/**
 * §6 I4 — bundle the runnable egress proxy (docs/dev/egress-proxy-design.md §4). The proxy container bind-mounts ONE
 * self-contained `entrypoint.mjs` and runs it with `node` (the container has no src tree / node_modules), so the
 * entrypoint plus its local imports (server state-machine, DNS stub, role snapshot, audit sink, agent-rulesets) must be
 * esbuild-bundled into a single ESM file. Output lands at `dist/egress-proxy/entrypoint.mjs`, where the manager's
 * `resolveEgressProxyBundleHostPath` auto-discovers it relative to the bundled app (NKLEIN_EGRESS_PROXY_BUNDLE stays an
 * override for dev/tests). ESM keeps `import.meta.url` intact so the entrypoint's main-module guard fires in-container.
 *
 * 2026-09-06: the build also writes `build-stamp.json` beside the bundle — the bundled source inputs and a hash over
 * their contents (see src/core/egress-bundle-stamp.ts). A source-tree run compares the stamp against its current
 * sources at proxy-ensure time and rebuilds/warns instead of silently running a proxy from another month.
 */
const rootDir = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const outfile = join(rootDir, "dist", "egress-proxy", "entrypoint.mjs");
const stampFile = join(dirname(outfile), "build-stamp.json");

await mkdir(dirname(outfile), { recursive: true });
const result = await esbuild.build({
	entryPoints: [join(rootDir, "src", "nklein-agent", "egress-proxy-entrypoint.ts")],
	outfile,
	bundle: true,
	format: "esm",
	platform: "node",
	target: "node20",
	packages: "bundle",
	sourcemap: true,
	metafile: true,
});

// Stamp: every repo-local input esbuild folded in (node_modules excluded — a dependency bump ships a new bundle via
// the ordinary build), hashed the same way src/core/egress-bundle-stamp.ts recomputes it.
const inputs = Object.keys(result.metafile.inputs)
	.map((input) => relative(rootDir, join(rootDir, input)).split(sep).join("/"))
	.filter((input) => !input.startsWith("node_modules/") && !input.startsWith("../"))
	.sort();
const hash = createHash("sha256");
for (const input of inputs) {
	hash.update(input);
	hash.update("\0");
	hash.update(await readFile(join(rootDir, input)));
	hash.update("\0");
}
const stamp = { version: 1, builtAt: new Date().toISOString(), inputs, sourceHash: hash.digest("hex") };
await writeFile(stampFile, `${JSON.stringify(stamp, null, 2)}\n`, "utf8");

console.log(`esbuild: bundled ${outfile} (${inputs.length} source inputs stamped)`);
