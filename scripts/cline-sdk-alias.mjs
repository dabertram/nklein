import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The Cline SDK lives in this repo as *source* under vendor/cline-sdk and is built by
// scripts/build-cline-sdk.mjs into packages/<pkg>/dist (self-contained: third-party deps
// inlined, only sibling @cline/* kept external). These aliases point the @cline/* import
// specifiers — used by our code and by the SDK's own internal cross-package imports — at the
// in-repo built dist. Targets are the dist *directory* so subpath imports resolve via
// directory append; entries whose export does not follow the directory layout (e.g.
// `core/telemetry`) are listed explicitly. Keep tsconfig.json "paths" in sync with this list.
const repoRoot = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const pkgDir = (relativePath) => join(repoRoot, "vendor", "cline-sdk", "packages", relativePath);

// Order matters for prefix-based resolvers (Vite): more specific specifiers first.
export const clineSdkAliasEntries = [
	["@cline/core/telemetry", pkgDir("core/dist/services/telemetry")],
	["@cline/core/hub", pkgDir("core/dist/hub")],
	["@cline/core", pkgDir("core/dist")],
	["@cline/shared/storage", pkgDir("shared/dist/storage")],
	["@cline/shared/db", pkgDir("shared/dist/db")],
	["@cline/shared", pkgDir("shared/dist")],
	["@cline/llms", pkgDir("llms/dist")],
	["@cline/agents", pkgDir("agents/dist")],
	["@cline/sdk", pkgDir("sdk/dist")],
];

/** esbuild `alias` map (longest-match wins, so order-independent). */
export const clineSdkEsbuildAlias = Object.fromEntries(clineSdkAliasEntries);

/** Vite/vitest `resolve.alias` array (ordered, prefix-based). */
export const clineSdkViteAlias = clineSdkAliasEntries.map(([find, replacement]) => ({ find, replacement }));
