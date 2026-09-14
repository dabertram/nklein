import { mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import packageJson from "../package.json" with { type: "json" };
import { spawn } from "node:child_process";
import { clineSdkEsbuildAlias } from "./cline-sdk-alias.mjs";

const rootDir = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const dockerContextDir = join(rootDir, "docker", "agent-sandbox");
const bundledToolRunnerPath = join(dockerContextDir, "tool-runner.cjs");
const bundledLspSymbolServerPath = join(dockerContextDir, "lsp-symbol-mcp-server.cjs");
const imageName = process.env.NKLEIN_AGENT_SANDBOX_IMAGE?.trim() || `nklein/agent-sandbox:${packageJson.version}`;
// P1.IMGREBUILD offline refresh: overlay ONLY the freshly bundled tool-runner / LSP server onto a previously built,
// fully pinned image (docker/agent-sandbox/Dockerfile.refresh). No registry, npm, Playwright or JDT.LS traffic — the
// toolchains are already in the base image at the pinned versions. Use when the host has no usable uplink.
const refreshFrom = process.env.NKLEIN_AGENT_SANDBOX_REFRESH_FROM?.trim() || null;

await mkdir(dockerContextDir, { recursive: true });
await esbuild.build({
	entryPoints: [join(rootDir, "src", "nklein-agent", "agent-sandbox", "tool-runner.ts")],
	outfile: bundledToolRunnerPath,
	bundle: true,
	format: "cjs",
	platform: "node",
	target: "node22",
	packages: "bundle",
	external: ["@ast-grep/napi", "playwright"],
	alias: clineSdkEsbuildAlias,
	banner: {
		js: 'const __nkleinImportMetaUrl = require("node:url").pathToFileURL(__filename).href;',
	},
	define: {
		"import.meta.url": "__nkleinImportMetaUrl",
	},
});
await esbuild.build({
	entryPoints: [join(rootDir, "src", "nklein-agent", "agent-sandbox", "lsp-symbol-mcp-server.ts")],
	outfile: bundledLspSymbolServerPath,
	bundle: true,
	format: "cjs",
	platform: "node",
	target: "node22",
	packages: "bundle",
});

try {
	await runDockerBuild(imageName);
	console.log(refreshFrom ? `Refreshed ${imageName} (bundle overlay on ${refreshFrom})` : `Built ${imageName}`);
} finally {
	await Promise.all([
		rm(bundledToolRunnerPath, { force: true }),
		rm(bundledLspSymbolServerPath, { force: true }),
	]);
}

function runDockerBuild(tag) {
	return new Promise((resolve, reject) => {
		const buildArgs = [
			"NKLEIN_AGENT_SANDBOX_NODE_IMAGE",
			"NKLEIN_AGENT_SANDBOX_RUST_IMAGE",
			"NKLEIN_AGENT_SANDBOX_GO_IMAGE",
			"NKLEIN_AGENT_SANDBOX_GRADLE_IMAGE",
			"NKLEIN_AGENT_SANDBOX_MAVEN_IMAGE",
		].flatMap((name) => {
			const value = process.env[name]?.trim();
			return value ? ["--build-arg", `${name}=${value}`] : [];
		});
		const refreshArgs = refreshFrom
			? ["-f", join(dockerContextDir, "Dockerfile.refresh"), "--build-arg", `NKLEIN_AGENT_SANDBOX_REFRESH_FROM=${refreshFrom}`]
			: [];
		const child = spawn(
			"docker",
			["build", "--pull=false", "--progress=plain", ...refreshArgs, ...buildArgs, "-t", tag, dockerContextDir],
			{
			cwd: rootDir,
			stdio: "inherit",
			},
		);
		child.on("error", reject);
		child.on("exit", (code) => {
			if (code === 0) {
				resolve();
				return;
			}
			reject(new Error(`docker build failed with exit code ${code ?? "unknown"}`));
		});
	});
}
