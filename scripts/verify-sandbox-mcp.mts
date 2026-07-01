/**
 * §5.AR sandbox-hosted MCP verification.
 *
 * Proves — offline, against the REAL agent-sandbox image + the REAL MCP SDK client — that a curated MCP server baked
 * into the sandbox is reachable over the exact `docker exec -i <container> <cmd>` stdio transport the runtime builds in
 * `createToolBundle`, AND that the §5.AL fit gate offers/withholds it correctly. No model or task machinery is needed.
 *
 * It asserts:
 *   - the fit gate OFFERS sequential-thinking to a fitting model (qwen3-8b: non-reasoning, tool-capable) and WITHHOLDS
 *     it from a native-reasoning model (phi-4-reasoning-plus);
 *   - a `--network none` sandbox container runs the server and the MCP client lists its tool (`sequentialthinking`),
 *     confirming the binary is baked in and runs 100% offline inside the container (invariant #2 + prime-directive #1).
 *
 * Run:  tsx scripts/verify-sandbox-mcp.mts     (requires Docker + the built nklein/agent-sandbox image)
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { resolveAgentSandboxImageName } from "../src/nklein-agent/nklein-agent-sandbox-docker";
import {
	buildSandboxMcpDockerExecArgs,
	selectSandboxMcpServersForModel,
} from "../src/core/sandbox-mcp-catalog";

const exec = promisify(execFile);
const CONTAINER = "nklein-verify-sandbox-mcp";
const IMAGE = resolveAgentSandboxImageName();

function log(message: string): void {
	console.log(`[verify-sandbox-mcp] ${message}`);
}

async function main(): Promise<void> {
	// 1. Fit gate: sequential-thinking is offered to a fitting model and withheld from a native reasoner.
	const fitting = selectSandboxMcpServersForModel("qwen/qwen3-8b").map((s) => s.id);
	const reasoning = selectSandboxMcpServersForModel("phi-4-reasoning-plus").map((s) => s.id);
	log(`fit gate: qwen3-8b => [${fitting.join(", ")}] ; phi-4-reasoning-plus => [${reasoning.join(", ")}]`);
	if (!fitting.includes("sequential-thinking")) {
		throw new Error("fit gate should OFFER sequential-thinking to qwen3-8b");
	}
	if (reasoning.includes("sequential-thinking")) {
		throw new Error("fit gate should WITHHOLD sequential-thinking from a native-reasoning model");
	}
	const seq = selectSandboxMcpServersForModel("qwen/qwen3-8b").find((s) => s.id === "sequential-thinking");
	if (!seq) {
		throw new Error("sequential-thinking not selected");
	}

	// 2. Start a sandbox container with NO network — proves the server runs fully offline.
	await exec("docker", ["rm", "-f", CONTAINER]).catch(() => {});
	await exec("docker", ["run", "-d", "--network", "none", "--name", CONTAINER, IMAGE, "sleep", "infinity"]);
	log(`started ${CONTAINER} from ${IMAGE} (--network none)`);

	// 3. Connect the real MCP client over the docker-exec transport createToolBundle builds, and list tools.
	const args = buildSandboxMcpDockerExecArgs(
		{ containerName: CONTAINER, uid: 0, workdir: "/workspaces" },
		seq.inContainerArgv,
	);
	log(`transport: docker ${args.join(" ")}`);
	const transport = new StdioClientTransport({ command: "docker", args, stderr: "ignore" });
	const client = new Client({ name: "klein-verify-sandbox-mcp", version: "0" }, { capabilities: {} });
	await client.connect(transport);
	const listed = (await client.listTools()).tools.map((t) => t.name);
	await client.close();
	log(`connected + listTools => [${listed.join(", ")}]`);

	if (!listed.some((name) => name.toLowerCase().includes("sequential"))) {
		throw new Error(`sequential-thinking tool not found in [${listed.join(", ")}]`);
	}
	log("PASS ✓ — curated sandbox MCP server reachable over docker-exec, offline, fit-gated");
}

try {
	await main();
} catch (error) {
	console.error(`[verify-sandbox-mcp] FAIL: ${error instanceof Error ? error.message : String(error)}`);
	process.exitCode = 1;
} finally {
	await exec("docker", ["rm", "-f", CONTAINER]).catch(() => {});
}
