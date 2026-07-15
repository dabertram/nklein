import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin, type ResolvedConfig, transformWithEsbuild } from "vite";

const rootPkg = JSON.parse(readFileSync(resolve(__dirname, "../package.json"), "utf-8")) as { version: string };
const XTERM_CHUNK_NAME = "xterm-vendor";
const WEB_UI_HOST = process.env.NKLEIN_WEB_UI_HOST || process.env.KANBAN_WEB_UI_HOST || "127.0.0.1";
const RUNTIME_PROXY_HOST = process.env.NKLEIN_RUNTIME_PROXY_HOST || "127.0.0.1";
const RUNTIME_PROXY_AUTHORITY =
	RUNTIME_PROXY_HOST.includes(":") && !RUNTIME_PROXY_HOST.startsWith("[")
		? `[${RUNTIME_PROXY_HOST}]`
		: RUNTIME_PROXY_HOST;

function isXtermModule(id: string): boolean {
	return id.includes("/node_modules/@xterm/") || id.includes("\\node_modules\\@xterm\\");
}

function selectiveBuildMinifyPlugin(): Plugin {
	let resolvedConfig: ResolvedConfig | null = null;

	return {
		name: "kanban-selective-build-minify",
		apply: "build",
		configResolved(config) {
			resolvedConfig = config;
		},
		async renderChunk(code, chunk, outputOptions) {
			if (!resolvedConfig || !chunk.fileName.endsWith(".js")) {
				return null;
			}
			if (Object.keys(chunk.modules).some((id) => isXtermModule(id))) {
				return null;
			}
			const minified = await transformWithEsbuild(
				code,
				chunk.fileName,
				{
					format: outputOptions.format === "cjs" ? "cjs" : "esm",
					minify: true,
					sourcemap: Boolean(resolvedConfig.build.sourcemap),
					treeShaking: true,
				},
				undefined,
				resolvedConfig,
			);
			return {
				code: minified.code,
				map: minified.map ?? null,
			};
		},
	};
}

export default defineConfig({
	// OpenCode broke in production because esbuild minification corrupted xterm's
	// requestMode handling. We isolate all @xterm code into its own chunk and leave
	// that chunk unminified, while still minifying the rest of the app here.
	// Compared with leaving the entire frontend unminified, this saves about
	// 770 KB raw and 108.5 KB gzipped across emitted frontend assets.
	// Compared with fully minifying everything, this costs about 545 KB raw and
	// 58.5 KB gzipped, which is the current tradeoff for keeping OpenCode stable.
	plugins: [tailwindcss(), react(), selectiveBuildMinifyPlugin()],
	envPrefix: ["VITE_", "POSTHOG_"],
	define: {
		__APP_VERSION__: JSON.stringify(rootPkg.version),
	},
	build: {
		// esbuild minification corrupts xterm's DECRQM requestMode helper in the
		// production bundle, which breaks full-screen TUIs like OpenCode at runtime.
		// Keep xterm unminified, but selectively minify the rest of the app below.
		minify: false,
		sourcemap: true,
		rollupOptions: {
			output: {
				manualChunks(id) {
					if (isXtermModule(id)) {
						return XTERM_CHUNK_NAME;
					}
					return undefined;
				},
			},
		},
	},
	resolve: {
		alias: {
			"@": resolve(__dirname, "src"),
			"@runtime-contract": resolve(__dirname, "../src/core/api-contract.ts"),
			"@runtime-agent-catalog": resolve(__dirname, "../src/core/agent-catalog.ts"),
			"@runtime-clarification-option-set": resolve(__dirname, "../src/core/clarification-option-set.ts"),
			"@runtime-focus-chain": resolve(__dirname, "../src/core/focus-chain.ts"),
			"@runtime-nklein-tool-call-display": resolve(__dirname, "../src/nklein-agent/nklein-tool-call-display.ts"),
			"@runtime-home-agent-session": resolve(__dirname, "../src/core/home-agent-session.ts"),
			"@runtime-task-context-import": resolve(__dirname, "../src/core/task-context-import.ts"),
			"@runtime-shortcuts": resolve(__dirname, "../src/config/shortcut-utils.ts"),
			"@runtime-task-id": resolve(__dirname, "../src/core/task-id.ts"),
			"@runtime-task-title": resolve(__dirname, "../src/core/task-title.ts"),
			"@runtime-task-worktree-path": resolve(__dirname, "../src/workspace/task-worktree-path.ts"),
			"@runtime-task-state": resolve(__dirname, "../src/core/task-board-mutations.ts"),
			"@runtime-operator-board-health": resolve(__dirname, "../src/core/operator-board-health.ts"),
			"@runtime-agent-stuckness": resolve(__dirname, "../src/core/agent-stuckness.ts"),
			"@runtime-capability-ceiling": resolve(__dirname, "../src/core/capability-ceiling-recommendation.ts"),
			"@runtime-escalation-suggestions": resolve(__dirname, "../src/core/escalation-suggestions.ts"),
			"@runtime-escalation-resume-action": resolve(__dirname, "../src/core/escalation-resume-action.ts"),
			"@runtime-chat-execution-posture": resolve(__dirname, "../src/chat/chat-execution-posture.ts"),
		},
	},
	server: {
		host: WEB_UI_HOST,
		port: Number(process.env.NKLEIN_WEB_UI_PORT || process.env.KANBAN_WEB_UI_PORT || "4173"),
		strictPort: true,
		hmr: false,
		proxy: {
			"/api": {
				target: `http://${RUNTIME_PROXY_AUTHORITY}:${process.env.NKLEIN_RUNTIME_PORT || process.env.KANBAN_RUNTIME_PORT || "3484"}`,
				changeOrigin: true,
				ws: true,
			},
		},
	},
});
