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
 *     lsp-symbols (the four narrow symbol/refactor tools), and basic-memory (`write_note`/`search_notes` + the authored-
 *     memory tools, its scoping/hardening env passed via `-e`) — confirming each binary is baked in and runs 100%
 *     offline inside the container (invariant #2 + prime-directive #1).
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
import { readMemoryAuditCandidates, stampMemoryWriteProvenance } from "../src/core/memory-audit-production";
import { createMcpLocalizationProvider } from "../src/core/mcp-localization-provider";
import {
	buildSandboxMcpDockerExecArgs,
	filterEnabledSandboxServers,
	listAvailableSandboxMcpServers,
	selectSandboxMcpServersForModel,
} from "../src/core/sandbox-mcp-catalog";
import { resolveAgentSandboxImageName } from "../src/nklein-agent/nklein-agent-sandbox-docker";
import { listAllMcpTools } from "../src/nklein-agent/nklein-mcp-runtime-service";

const exec = promisify(execFile);
const CONTAINER = "nklein-verify-sandbox-mcp";
const IMAGE = resolveAgentSandboxImageName();
const EXPECTED_CODEBASE_MEMORY_VERSION = "codebase-memory-mcp 0.9.0";
const EXPECTED_CODEBASE_MEMORY_BUDGET_MB = "2048";
let basicMemoryProofRoot: string | null = null;

function log(message: string): void {
	console.log(`[verify-sandbox-mcp] ${message}`);
}

/** Connect the REAL MCP client over the docker-exec transport createToolBundle builds, and return the listed tools. */
async function listToolsOverDockerExec(
	argv: readonly string[],
	env?: Record<string, string>,
	workdir = "/workspaces",
): Promise<string[]> {
	const args = buildSandboxMcpDockerExecArgs({ containerName: CONTAINER, uid: 0, workdir }, argv, env);
	log(`transport: docker ${args.join(" ")}`);
	const transport = new StdioClientTransport({ command: "docker", args, stderr: "ignore" });
	const client = new Client({ name: "klein-verify-sandbox-mcp", version: "0" }, { capabilities: {} });
	await client.connect(transport);
	const listed = (await listAllMcpTools(client)).map((tool) => tool.name);
	await client.close();
	return listed;
}

async function callToolOverDockerExec(
	argv: readonly string[],
	toolName: string,
	toolArgs: Record<string, unknown>,
	env?: Record<string, string>,
	workdir = "/workspaces",
): Promise<unknown> {
	const args = buildSandboxMcpDockerExecArgs({ containerName: CONTAINER, uid: 0, workdir }, argv, env);
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
	basicMemoryProofRoot = await mkdtemp(join(tmpdir(), "nklein-basic-memory-restart-"));
	await mkdir(join(basicMemoryProofRoot, "config"), { recursive: true });
	await mkdir(join(basicMemoryProofRoot, "notes"), { recursive: true });
	const startOfflineContainer = async (): Promise<void> => {
		await exec("docker", ["rm", "-f", CONTAINER]).catch(() => {});
		await exec("docker", [
			"run",
			"-d",
			"--network",
			"none",
			"--name",
			CONTAINER,
			"--mount",
			`type=bind,src=${join(basicMemoryProofRoot as string, "config")},dst=/tmp/bm/config`,
			"--mount",
			`type=bind,src=${join(basicMemoryProofRoot as string, "notes")},dst=/tmp/bm/notes`,
			IMAGE,
			"sleep",
			"infinity",
		]);
	};
	await startOfflineContainer();
	log(`started ${CONTAINER} from ${IMAGE} (--network none)`);
	const cbmVersion = (await exec("docker", ["exec", CONTAINER, "codebase-memory-mcp", "--version"])).stdout.trim();
	if (cbmVersion !== EXPECTED_CODEBASE_MEMORY_VERSION) {
		throw new Error(`codebase-memory version drift: expected ${EXPECTED_CODEBASE_MEMORY_VERSION}, got ${cbmVersion}`);
	}
	const cbmBudget = (await exec("docker", ["exec", CONTAINER, "printenv", "CBM_MEM_BUDGET_MB"])).stdout.trim();
	if (cbmBudget !== EXPECTED_CODEBASE_MEMORY_BUDGET_MB) {
		throw new Error(
			`codebase-memory memory-budget drift: expected ${EXPECTED_CODEBASE_MEMORY_BUDGET_MB} MB, got ${cbmBudget || "unset"}`,
		);
	}
	log(`codebase-memory image contract => ${cbmVersion}; memory budget ${cbmBudget} MB`);
	const basicMemoryEnv = {
		...basicMemoryHardeningEnv(),
		BASIC_MEMORY_CONFIG_DIR: "/tmp/bm/config",
		BASIC_MEMORY_MCP_PROJECT: "verify-restart",
	};
	const seedBasicMemoryProject = async (): Promise<void> => {
		const envArgs = Object.entries(basicMemoryEnv).flatMap(([key, value]) => ["-e", `${key}=${value}`]);
		await exec("docker", [
			"exec",
			...envArgs,
			CONTAINER,
			"basic-memory",
			"project",
			"add",
			"verify-restart",
			"/tmp/bm/notes",
		]);
	};
	await seedBasicMemoryProject();

	// 3. Each baked server is reachable over docker-exec and lists its tools, offline.
	const seqTools = await listToolsOverDockerExec(["mcp-server-sequential-thinking"]);
	log(`sequential-thinking => [${seqTools.join(", ")}]`);
	if (!seqTools.some((name) => name.toLowerCase().includes("sequential"))) {
		throw new Error(`sequential-thinking tool not found in [${seqTools.join(", ")}]`);
	}

	const cbmTools = await listToolsOverDockerExec(["codebase-memory-mcp"]);
	log(`codebase-memory (${cbmTools.length}) => [${cbmTools.slice(0, 10).join(", ")}…]`);
	for (const requiredTool of ["search_graph", "list_projects", "manage_adr", "ingest_traces"]) {
		if (!cbmTools.includes(requiredTool)) {
			throw new Error(`codebase-memory ${requiredTool} not found in complete paginated tool list [${cbmTools.join(", ")}]`);
		}
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

	const lspArgv = ["node", "/opt/nklein/lsp-symbol-mcp-server.cjs"];
	const lspTools = await listToolsOverDockerExec(lspArgv, undefined, cbmRepoPath);
	const requiredLspTools = ["find_symbol", "find_referencing_symbols", "get_symbols_overview", "rename_symbol"];
	log(`lsp-symbols => [${lspTools.join(", ")}]`);
	if (JSON.stringify([...lspTools].sort()) !== JSON.stringify([...requiredLspTools].sort())) {
		throw new Error(`lsp-symbols must expose exactly [${requiredLspTools.join(", ")}], got [${lspTools.join(", ")}]`);
	}
	const overview = unwrapMcpJson(
		await callToolOverDockerExec(
			lspArgv,
			"get_symbols_overview",
			{ relative_path: "src/server.ts", depth: 1 },
			undefined,
			cbmRepoPath,
		),
	);
	if (!JSON.stringify(overview).includes("handleRequest")) {
		throw new Error("lsp-symbols documentSymbol probe did not find handleRequest");
	}
	const references = unwrapMcpJson(
		await callToolOverDockerExec(
			lspArgv,
			"find_referencing_symbols",
			{ relative_path: "src/server.ts", name_path: "handleRequest" },
			undefined,
			cbmRepoPath,
		),
	);
	if (!JSON.stringify(references).includes("src/app.ts")) {
		throw new Error("lsp-symbols references probe did not resolve the cross-file call in src/app.ts");
	}
	const rename = unwrapMcpJson(
		await callToolOverDockerExec(
			lspArgv,
			"rename_symbol",
			{ relative_path: "src/server.ts", name_path: "handleRequest", new_name: "handleInput" },
			undefined,
			cbmRepoPath,
		),
	);
	const renamedServer = (await exec("docker", ["exec", CONTAINER, "cat", `${cbmRepoPath}/src/server.ts`])).stdout;
	const renamedApp = (await exec("docker", ["exec", CONTAINER, "cat", `${cbmRepoPath}/src/app.ts`])).stdout;
	log(`lsp-symbols rename result => ${JSON.stringify(rename)}`);
	if (asRecord(rename)?.filesChanged !== 2 || !renamedServer.includes("handleInput") || !renamedApp.includes("handleInput")) {
		throw new Error("lsp-symbols rename probe did not atomically apply the cross-file WorkspaceEdit");
	}
	log("lsp-symbols schema probe => overview + cross-file references + semantic rename passed");

	const bmTools = await listToolsOverDockerExec(["basic-memory", "mcp"], {
		...basicMemoryEnv,
	});
	log(`basic-memory (${bmTools.length}) => [${bmTools.slice(0, 10).join(", ")}…]`);
	if (!bmTools.includes("write_note") || !bmTools.includes("search_notes")) {
		throw new Error(`basic-memory write_note/search_notes not found in [${bmTools.join(", ")}]`);
	}

	// 4. Real durability proof: write through MCP, destroy/recreate the network-none container over the SAME bind
	// mounts, then recall through a fresh MCP process. This catches an in-container-only store or stale ephemeral index.
	const proofToken = `restart-proof-${Date.now()}`;
	await callToolOverDockerExec(
		["basic-memory", "mcp"],
		"write_note",
		{
			title: "Sandbox restart durability proof",
			directory: "proof",
			content: stampMemoryWriteProvenance(`# Sandbox restart durability proof\n\n- [fact] ${proofToken}`, {
				authorModelKey: "verify/model-author",
				taskId: "verify-restart",
				createdAtIso: new Date().toISOString(),
			}),
			project: "verify-restart",
			output_format: "json",
		},
		basicMemoryEnv,
	);
	const auditCandidates = await readMemoryAuditCandidates([
		{ scope: "project", rootDir: join(basicMemoryProofRoot, "notes") },
	]);
	const writtenCandidate = auditCandidates.find((candidate) => candidate.body.includes(proofToken));
	if (writtenCandidate?.authorModelKey !== "verify/model-author") {
		throw new Error("basic-memory did not preserve host-trusted authored_by provenance in persisted Markdown");
	}
	await exec("docker", ["rm", "-f", CONTAINER]);
	await startOfflineContainer();
	await seedBasicMemoryProject();
	const recalled = await callToolOverDockerExec(
		["basic-memory", "mcp"],
		"search_notes",
		{ query: proofToken, project: "verify-restart", output_format: "json" },
		basicMemoryEnv,
	);
	if (!JSON.stringify(unwrapMcpJson(recalled)).includes(proofToken)) {
		throw new Error("basic-memory write→container restart→search recall proof did not return the persisted token");
	}
	log(`basic-memory durability => write → container restart → recall retained ${proofToken}`);

	log(
		"PASS ✓ — all four curated sandbox MCP servers reachable over docker-exec, offline, fit/opt-in gated; codebase-memory and LSP schemas validated",
	);
}

try {
	await main();
} catch (error) {
	console.error(`[verify-sandbox-mcp] FAIL: ${error instanceof Error ? error.message : String(error)}`);
	process.exitCode = 1;
} finally {
	await exec("docker", ["rm", "-f", CONTAINER]).catch(() => {});
	if (basicMemoryProofRoot) await rm(basicMemoryProofRoot, { recursive: true, force: true }).catch(() => {});
}
