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
const imageName = process.env.NKLEIN_AGENT_SANDBOX_IMAGE?.trim() || `nklein/agent-sandbox:${packageJson.version}`;

await mkdir(dockerContextDir, { recursive: true });
await esbuild.build({
	entryPoints: [join(rootDir, "src", "nklein-sdk", "agent-sandbox", "tool-runner.ts")],
	outfile: bundledToolRunnerPath,
	bundle: true,
	format: "cjs",
	platform: "node",
	target: "node22",
	packages: "bundle",
	alias: clineSdkEsbuildAlias,
	banner: {
		js: 'const __nkleinImportMetaUrl = require("node:url").pathToFileURL(__filename).href;',
	},
	define: {
		"import.meta.url": "__nkleinImportMetaUrl",
	},
});

try {
	await runDockerBuild(imageName);
	console.log(`Built ${imageName}`);
} finally {
	await rm(bundledToolRunnerPath, { force: true });
}

function runDockerBuild(tag) {
	return new Promise((resolve, reject) => {
		const child = spawn("docker", ["build", "-t", tag, dockerContextDir], {
			cwd: rootDir,
			stdio: "inherit",
		});
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
