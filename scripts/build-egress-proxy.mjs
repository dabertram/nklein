import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

/**
 * §6 I4 — bundle the runnable egress proxy (docs/dev/egress-proxy-design.md §4). The proxy container bind-mounts ONE
 * self-contained `entrypoint.mjs` and runs it with `node` (the container has no src tree / node_modules), so the
 * entrypoint plus its local imports (server state-machine, DNS stub, role snapshot, audit sink, agent-rulesets) must be
 * esbuild-bundled into a single ESM file. Output lands at `dist/egress-proxy/entrypoint.mjs`, where the manager's
 * `resolveEgressProxyBundleHostPath` auto-discovers it relative to the bundled app (NKLEIN_EGRESS_PROXY_BUNDLE stays an
 * override for dev/tests). ESM keeps `import.meta.url` intact so the entrypoint's main-module guard fires in-container.
 */
const rootDir = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const outfile = join(rootDir, "dist", "egress-proxy", "entrypoint.mjs");

await mkdir(dirname(outfile), { recursive: true });
await esbuild.build({
	entryPoints: [join(rootDir, "src", "nklein-agent", "egress-proxy-entrypoint.ts")],
	outfile,
	bundle: true,
	format: "esm",
	platform: "node",
	target: "node20",
	packages: "bundle",
	sourcemap: true,
});

console.log(`esbuild: bundled ${outfile}`);
