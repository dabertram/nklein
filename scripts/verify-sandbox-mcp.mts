/**
 * §5.AR sandbox-hosted MCP verification.
 *
 * Proves — offline, against the REAL agent-sandbox image + the REAL MCP SDK client — that the curated MCP servers baked
 * into the sandbox are reachable over the exact `docker exec -i <container> <cmd>` stdio transport the runtime builds in
 * `createToolBundle`, AND that the §5.AL fit gate + the default-OFF opt-in gate behave correctly. No model/task needed.
 *
 * It asserts:
 *   - the fit gate OFFERS sequential-thinking to a fitting model (qwen3-8b: non-reasoning, tool-capable) and WITHHOLDS
 *     it from a native-reasoning model (phi-4-reasoning-plus);
 *   - basic-memory is default-OFF (dropped by `filterEnabledSandboxServers` unless explicitly opted in);
 *   - a `--network none` sandbox container runs EACH baked server and the MCP client lists its tools — sequential-
 *     thinking (`sequentialthinking`), codebase-memory (`search_graph` + the code-graph tools), and basic-memory
 *     (`write_note`/`search_notes` + the authored-memory tools, its scoping/hardening env passed via `-e`) — confirming
 *     each binary is baked in and runs 100% offline inside the container (invariant #2 + prime-directive #1).
 *
 * Run:  tsx scripts/verify-sandbox-mcp.mts     (requires Docker + the built nklein/agent-sandbox image)
 */

import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { basicMemoryHardeningEnv } from "../src/core/basic-memory-scoping";
import { createMcpLocalizationProvider } from "../src/core/mcp-localization-provider";
import {
	buildSandboxMcpDockerExecArgs,
	filterEnabledSandboxServers,
	listAvailableSandboxMcpServers,
	selectSandboxMcpServersForModel,
} from "../src/core/sandbox-mcp-catalog";
import { resolveAgentSandboxImageName } from "../src/nklein-agent/nklein-agent-sandbox-docker";

const exec = promisify(execFile);
const CONTAINER = "nklein-verify-sandbox-mcp";
const IMAGE = resolveAgentSandboxImageName();

function log(message: string): void {
	console.log(`[verify-sandbox-mcp] ${message}`);
}

/** Connect the REAL MCP client over the docker-exec transport createToolBundle builds, and return the listed tools. */
async function listToolsOverDockerExec(argv: readonly string[], env?: Record<string, string>): Promise<string[]> {
	const args = buildSandboxMcpDockerExecArgs({ containerName: CONTAINER, uid: 0, workdir: "/workspaces" }, argv, env);
	log(`transport: docker ${args.join(" ")}`);
	const transport = new StdioClientTransport({ command: "docker", args, stderr: "ignore" });
	const client = new Client({ name: "klein-verify-sandbox-mcp", version: "0" }, { capabilities: {} });
	await client.connect(transport);
	const listed = (await client.listTools()).tools.map((t) => t.name);
	await client.close();
	return listed;
}

async function callToolOverDockerExec(
	argv: readonly string[],
	toolName: string,
	toolArgs: Record<string, unknown>,
	env?: Record<string, string>,
): Promise<unknown> {
	const args = buildSandboxMcpDockerExecArgs({ containerName: CONTAINER, uid: 0, workdir: "/workspaces" }, argv, env);
	const transport = new StdioClientTransport({ command: "docker", args, stderr: "ignore" });
	const client = new Client({ name: "klein-verify-sandbox-mcp", version: "0" }, { capabilities: {} });
	await client.connect(transport);
	try {
		return await client.callTool({ name: toolName, arguments: toolArgs });
	} finally {
		await client.close();
	}
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function parseJsonText(text: string): unknown {
	try {
		return JSON.parse(text) as unknown;
	} catch {
		return undefined;
	}
}

function unwrapMcpJson(result: unknown): unknown {
	const record = asRecord(result);
	if (record === undefined) {
		return result;
	}
	if (record.structuredContent !== undefined) {
		return record.structuredContent;
	}
	const content = record.content;
	if (Array.isArray(content)) {
		for (const part of content) {
			const text = asRecord(part)?.text;
			if (typeof text !== "string" || text.trim().length === 0) {
				continue;
			}
			const parsed = parseJsonText(text);
			if (parsed !== undefined) {
				return parsed;
			}
		}
	}
	return result;
}

function indexedProjectName(listProjectsResult: unknown, rootPath: string): string {
	const payload = asRecord(unwrapMcpJson(listProjectsResult));
	const projects = payload?.projects;
	if (!Array.isArray(projects)) {
		throw new Error("codebase-memory list_projects did not return a projects array");
	}
	for (const project of projects) {
		const record = asRecord(project);
		if (record?.root_path === rootPath && typeof record.name === "string" && record.name.trim().length > 0) {
			return record.name;
		}
	}
	throw new Error(`codebase-memory did not report indexed project for ${rootPath}`);
}

async function copyFixtureRepoIntoContainer(): Promise<string> {
	const fixture = await mkdtemp(join(tmpdir(), "nklein-cbm-schema-"));
	try {
		await mkdir(join(fixture, "src"), { recursive: true });
		await writeFile(
			join(fixture, "src", "server.ts"),
			[
				"export function handleRequest(input: string): string {",
				"\treturn input.trim().toUpperCase();",
				"}",
				"",
			].join("\n"),
		);
		await writeFile(
			join(fixture, "src", "app.ts"),
			[
				'import { handleRequest } from "./server";',
				"export function run(): string {",
				'\treturn handleRequest(" ok ");',
				"}",
				"",
			].join("\n"),
		);
		await exec("docker", ["exec", CONTAINER, "rm", "-rf", "/workspaces/cbm-schema-probe"]);
		await exec("docker", ["exec", CONTAINER, "mkdir", "-p", "/workspaces/cbm-schema-probe"]);
		await exec("docker", ["cp", `${fixture}/.`, `${CONTAINER}:/workspaces/cbm-schema-probe`]);
		return "/workspaces/cbm-schema-probe";
	} finally {
		await rm(fixture, { recursive: true, force: true });
	}
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

	// 1b. Default-OFF opt-in gate: basic-memory is dropped unless explicitly enabled (write-capable authored memory).
	const withoutOptIn = filterEnabledSandboxServers(listAvailableSandboxMcpServers(), new Set()).map((s) => s.id);
	if (withoutOptIn.includes("basic-memory")) {
		throw new Error("basic-memory should be default-OFF (dropped without an explicit opt-in)");
	}
	log(`opt-in gate: default set (no opt-in) => [${withoutOptIn.join(", ")}] (basic-memory correctly withheld)`);

	// 2. Start a sandbox container with NO network — proves the servers run fully offline.
	await exec("docker", ["rm", "-f", CONTAINER]).catch(() => {});
	await exec("docker", ["run", "-d", "--network", "none", "--name", CONTAINER, IMAGE, "sleep", "infinity"]);
	log(`started ${CONTAINER} from ${IMAGE} (--network none)`);
	// A writable config/notes dir stands in for basic-memory's RW mounts in this transport-only smoke test.
	await exec("docker", ["exec", CONTAINER, "mkdir", "-p", "/tmp/bm/config", "/tmp/bm/notes"]);

	// 3. Each baked server is reachable over docker-exec and lists its tools, offline.
	const seqTools = await listToolsOverDockerExec(["mcp-server-sequential-thinking"]);
	log(`sequential-thinking => [${seqTools.join(", ")}]`);
	if (!seqTools.some((name) => name.toLowerCase().includes("sequential"))) {
		throw new Error(`sequential-thinking tool not found in [${seqTools.join(", ")}]`);
	}

	const cbmTools = await listToolsOverDockerExec(["codebase-memory-mcp"]);
	log(`codebase-memory (${cbmTools.length}) => [${cbmTools.slice(0, 10).join(", ")}…]`);
	if (!cbmTools.includes("search_graph")) {
		throw new Error(`codebase-memory search_graph not found in [${cbmTools.join(", ")}]`);
	}
	const cbmRepoPath = await copyFixtureRepoIntoContainer();
	await callToolOverDockerExec(["codebase-memory-mcp"], "index_repository", {
		repo_path: cbmRepoPath,
		mode: "fast",
	});
	const cbmProject = indexedProjectName(await callToolOverDockerExec(["codebase-memory-mcp"], "list_projects", {}), cbmRepoPath);
	const cbmProvider = createMcpLocalizationProvider(
		(toolName, args) => callToolOverDockerExec(["codebase-memory-mcp"], toolName, args),
		{ project: cbmProject },
	);
	const cbmHits = await cbmProvider.localize({ query: ".*handleRequest.*", maxHits: 5 });
	log(
		`codebase-memory schema probe => [${cbmHits
			.map((hit) => `${hit.file}${hit.symbol ? `:${hit.symbol}` : ""}`)
			.join(", ")}]`,
	);
	if (!cbmHits.some((hit) => hit.file === "src/server.ts" && hit.symbol === "handleRequest")) {
		throw new Error("codebase-memory search_graph schema probe did not localize handleRequest in src/server.ts");
	}

	const bmTools = await listToolsOverDockerExec(["basic-memory", "mcp"], {
		...basicMemoryHardeningEnv(),
		BASIC_MEMORY_CONFIG_DIR: "/tmp/bm/config",
		BASIC_MEMORY_HOME: "/tmp/bm/notes",
	});
	log(`basic-memory (${bmTools.length}) => [${bmTools.slice(0, 10).join(", ")}…]`);
	if (!bmTools.includes("write_note") || !bmTools.includes("search_notes")) {
		throw new Error(`basic-memory write_note/search_notes not found in [${bmTools.join(", ")}]`);
	}

	log(
		"PASS ✓ — all three curated sandbox MCP servers reachable over docker-exec, offline, fit/opt-in gated; codebase-memory search_graph schema validated",
	);
}

try {
	await main();
} catch (error) {
	console.error(`[verify-sandbox-mcp] FAIL: ${error instanceof Error ? error.message : String(error)}`);
	process.exitCode = 1;
} finally {
	await exec("docker", ["rm", "-f", CONTAINER]).catch(() => {});
}
