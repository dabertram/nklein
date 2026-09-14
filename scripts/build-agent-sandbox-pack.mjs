/**
 * P1.SANDBOXPACKS — apply an ECOSYSTEM PACK overlay to the sandbox image.
 *
 *   node scripts/build-agent-sandbox-pack.mjs <pack> [--from <image>] [--tag <image>]
 *
 * A pack is `docker/agent-sandbox/Dockerfile.<pack>-pack`: a small overlay on the pinned base image (default
 * `--from nklein/agent-sandbox:<package version>`), written to `--tag` (default: the same image name, i.e. the pack
 * becomes part of the sandbox the runtime uses next). Build under a separate tag while a measurement is running so the
 * system under test does not change underneath it, then retag.
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import packageJson from "../package.json" with { type: "json" };

const rootDir = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const dockerContextDir = join(rootDir, "docker", "agent-sandbox");
const args = process.argv.slice(2);
const pack = args.find((arg) => !arg.startsWith("--"));
const option = (name) => {
	const index = args.indexOf(`--${name}`);
	return index >= 0 ? args[index + 1] : undefined;
};
if (!pack) {
	console.error("usage: build-agent-sandbox-pack.mjs <pack> [--from <image>] [--tag <image>]");
	process.exit(2);
}
const dockerfile = join(dockerContextDir, `Dockerfile.${pack}-pack`);
if (!existsSync(dockerfile)) {
	console.error(`unknown pack "${pack}": ${dockerfile} does not exist`);
	process.exit(2);
}
const baseImage = option("from") ?? process.env.NKLEIN_AGENT_SANDBOX_IMAGE?.trim() ?? `nklein/agent-sandbox:${packageJson.version}`;
const tag = option("tag") ?? baseImage;

await new Promise((resolve, reject) => {
	const child = spawn(
		"docker",
		[
			"build",
			"--pull=false",
			"--progress=plain",
			"-f",
			dockerfile,
			"--build-arg",
			`NKLEIN_AGENT_SANDBOX_PACK_FROM=${baseImage}`,
			"-t",
			tag,
			dockerContextDir,
		],
		{ cwd: rootDir, stdio: "inherit" },
	);
	child.on("error", reject);
	child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`docker build failed with exit code ${code ?? "unknown"}`))));
});
console.log(`Applied pack "${pack}" on ${baseImage} → ${tag}`);
