import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const MIME_TYPES: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".ico": "image/x-icon",
	".map": "application/json; charset=utf-8",
	".txt": "text/plain; charset=utf-8",
};

export interface RuntimeAsset {
	content: Buffer;
	contentType: string;
}

export function getWebUiDir(): string {
	const here = dirname(fileURLToPath(import.meta.url));
	// Bundled output (dist/cli.js): web-ui is at dist/web-ui
	const bundledPath = resolve(here, "web-ui");
	// tsc output (dist/server/assets.js): web-ui is at dist/../web-ui → dist/web-ui
	const packagedBuildPath = resolve(here, "../web-ui");
	const repoBuildPath = resolve(here, "../../web-ui/dist");
	const repoSourcePath = resolve(here, "../../web-ui");
	const hasAssets = (dir: string) => existsSync(join(dir, "index.html")) && existsSync(join(dir, "assets"));
	if (hasAssets(bundledPath)) {
		return bundledPath;
	}
	if (hasAssets(packagedBuildPath)) {
		return packagedBuildPath;
	}
	if (hasAssets(repoBuildPath)) {
		return repoBuildPath;
	}
	return repoSourcePath;
}

/**
 * Whether [dir] holds a BUILT web UI. An `index.html` alone is not enough: the web UI's source folder has one
 * too, whose module script is `/src/main.tsx` — which only the Vite dev server can serve, never a browser.
 * `getWebUiDir()` falls back to that source folder when no build exists, and the old startup check (index.html
 * readable) passed it, so a runtime started from a checkout without `web-ui/dist` (the pinned SWE-bench drain,
 * 2026-09-18) served a blank page: the browser fetched `/src/main.tsx` as application/octet-stream and refused
 * to run it, with nothing anywhere saying the UI had never been built.
 */
export function isBuiltWebUiDir(dir: string, indexHtml: string | null): boolean {
	if (indexHtml === null) {
		return false;
	}
	if (!existsSync(join(dir, "assets"))) {
		return false;
	}
	return !/src=["']\/src\/main\.tsx["']/.test(indexHtml);
}

/** What the browser gets from a runtime with no built web UI: the reason and the fix, instead of a blank page. */
export function unbuiltWebUiPage(webUiDir: string): string {
	const escaped = webUiDir.replace(
		/[&<>"]/g,
		(c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c,
	);
	return `<!doctype html><html><head><meta charset="utf-8"><title>!Klein — web UI not built</title></head>
<body style="font-family:system-ui;background:#0d0f14;color:#e6e6e6;max-width:640px;margin:15vh auto;padding:0 24px">
<h1 style="font-size:20px">This !Klein runtime has no built web UI</h1>
<p>The runtime and its API are running. The browser UI was never built for this checkout, so there is nothing to show
here — this used to be a blank page.</p>
<p>Looked in: <code>${escaped}</code></p>
<p>Either build it — <code>npm run build</code> in the checkout the runtime runs from — or run the web UI's Vite dev
server pointed at this runtime (<code>NKLEIN_RUNTIME_PORT=&lt;this port&gt; npm run dev</code> in <code>web-ui/</code>,
on the dev port the runtime allows, 4173 by default).</p>
</body></html>`;
}

function shouldFallbackToIndexHtml(pathname: string): boolean {
	return !extname(pathname);
}

export function normalizeRequestPath(urlPathname: string): string {
	const trimmed = urlPathname === "/" ? "/index.html" : urlPathname;
	return decodeURIComponent(trimmed.split("?")[0] ?? trimmed);
}

function resolveAssetPath(rootDir: string, urlPathname: string): string {
	const normalizedRequest = normalize(urlPathname).replace(/^(\.\.(\/|\\|$))+/, "");
	const absolutePath = resolve(rootDir, `.${normalizedRequest}`);
	const normalizedRoot = rootDir.endsWith(sep) ? rootDir : `${rootDir}${sep}`;
	if (!absolutePath.startsWith(normalizedRoot)) {
		return resolve(rootDir, "index.html");
	}
	return absolutePath;
}

export async function readAsset(rootDir: string, requestPathname: string): Promise<RuntimeAsset> {
	let resolvedPath = resolveAssetPath(rootDir, requestPathname);

	try {
		const content = await readFile(resolvedPath);
		const extension = extname(resolvedPath).toLowerCase();
		return {
			content,
			contentType: MIME_TYPES[extension] ?? "application/octet-stream",
		};
	} catch (error) {
		if (!shouldFallbackToIndexHtml(requestPathname)) {
			throw error;
		}
		resolvedPath = resolve(rootDir, "index.html");
		const content = await readFile(resolvedPath);
		return {
			content,
			contentType: MIME_TYPES[".html"],
		};
	}
}
