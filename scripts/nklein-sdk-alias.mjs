import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The NKlein SDK lives directly in this repo under vendor/nklein-sdk (no longer an
// installed @nklein/* package). These aliases point the @nklein/* import specifiers
// — used by our code and by the SDK's own internal cross-package imports — at the
// in-repo dist. Targets are the dist *directory* so subpath imports (e.g.
// @nklein/shared/storage) resolve via directory append; `telemetry` is listed
// explicitly because its export does not follow the directory layout.
// Keep tsconfig.json "paths" in sync with this list.
const repoRoot = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const sdkDir = (relativePath) => join(repoRoot, "vendor", "nklein-sdk", relativePath);

// Order matters for prefix-based resolvers (Vite): more specific specifiers first.
export const nkleinSdkAliasEntries = [
	["@nklein/core/telemetry", sdkDir("core/dist/services/telemetry")],
	["@nklein/core", sdkDir("core/dist")],
	["@nklein/agents", sdkDir("agents/dist")],
	["@nklein/llms", sdkDir("llms/dist")],
	["@nklein/shared", sdkDir("shared/dist")],
];

/** esbuild `alias` map (longest-match wins, so order-independent). */
export const nkleinSdkEsbuildAlias = Object.fromEntries(nkleinSdkAliasEntries);

/** Vite/vitest `resolve.alias` array (ordered, prefix-based). */
export const nkleinSdkViteAlias = nkleinSdkAliasEntries.map(([find, replacement]) => ({ find, replacement }));
