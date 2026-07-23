import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setKanbanRuntimePort } from "../../../src/core/runtime-endpoint";
import {
	createNKleinMcpRuntimeService,
	handleNKleinMcpOauthCallback,
	listAllMcpTools,
	startOauthCallbackListener,
} from "../../../src/nklein-agent/nklein-mcp-runtime-service";
import type {
	SdkMcpManager,
	SdkMcpManagerOptions,
	SdkMcpServerRegistration,
	SdkMcpServerSnapshot,
} from "../../../src/nklein-agent/sdk-provider-boundary";

class FakeMcpManager implements SdkMcpManager {
	readonly registrations: SdkMcpServerRegistration[] = [];
	readonly calls: Array<Parameters<SdkMcpManager["callTool"]>[0]> = [];
	disposed = false;

	constructor(private readonly options: SdkMcpManagerOptions) {}

	async registerServer(registration: SdkMcpServerRegistration): Promise<void> {
		this.registrations.push(registration);
		// Proves dynamically registered sandbox servers do not depend on persisted MCP settings.
		await this.options.clientFactory(registration);
	}

	listServers(): readonly SdkMcpServerSnapshot[] {
		return [];
	}

	async listTools(): Promise<readonly { name: string; description?: string; inputSchema: Record<string, unknown> }[]> {
		return [];
	}

	async callTool(request: Parameters<SdkMcpManager["callTool"]>[0]): Promise<unknown> {
		this.calls.push(request);
		if (request.toolName === "index_repository") {
			return {
				content: [{ type: "text", text: JSON.stringify({ ok: true }) }],
			};
		}
		if (request.toolName === "list_projects") {
			return {
				content: [
					{
						type: "text",
						text: JSON.stringify({
							projects: [{ name: "fixture-project", root_path: "/workspaces/task-123" }],
						}),
					},
				],
			};
		}
		if (request.toolName === "search_graph") {
			return {
				content: [
					{
						type: "text",
						text: JSON.stringify({
							results: [
								{
									name: "handleRequest",
									label: "Function",
									file_path: "src/server.ts",
									start_line: 12,
								},
							],
						}),
					},
				],
			};
		}
		return { content: [{ type: "text", text: "{}" }] };
	}

	async dispose(): Promise<void> {
		this.disposed = true;
	}
}

class FakeMemoryMcpManager extends FakeMcpManager {
	override async listTools(): Promise<
		readonly { name: string; description?: string; inputSchema: Record<string, unknown> }[]
	> {
		return [
			{
				name: "write_note",
				description: "write",
				inputSchema: { type: "object", properties: { content: { type: "string" } } },
			},
		];
	}
}

describe("listAllMcpTools", () => {
	it("follows every tools/list cursor and preserves the complete ordered tool surface", async () => {
		const cursors: Array<string | undefined> = [];
		const tools = await listAllMcpTools({
			listTools: async (params) => {
				cursors.push(params?.cursor);
				if (params?.cursor === "page-2") {
					return {
						tools: [{ name: "list_projects", inputSchema: { type: "object" } }],
					};
				}
				return {
					tools: [{ name: "search_graph", description: "search", inputSchema: { type: "object" } }],
					nextCursor: "page-2",
				};
			},
		});

		expect(cursors).toEqual([undefined, "page-2"]);
		expect(tools.map((tool) => tool.name)).toEqual(["search_graph", "list_projects"]);
	});

	it("fails closed when a server repeats a pagination cursor", async () => {
		await expect(
			listAllMcpTools({
				listTools: async () => ({ tools: [], nextCursor: "same-page" }),
			}),
		).rejects.toThrow(/repeated tools\/list cursor/i);
	});

	it("fails closed when pages repeat a tool name", async () => {
		await expect(
			listAllMcpTools({
				listTools: async (params) =>
					params?.cursor
						? { tools: [{ name: "search_graph" }] }
						: { tools: [{ name: "search_graph" }], nextCursor: "page-2" },
			}),
		).rejects.toThrow(/duplicate tool name/i);
	});
});

describe("nklein-mcp-runtime-service OAuth callback handling", () => {
	const originalRuntimePort = process.env.KANBAN_RUNTIME_PORT;

	afterEach(() => {
		if (originalRuntimePort) {
			setKanbanRuntimePort(Number(originalRuntimePort));
		} else {
			setKanbanRuntimePort(3484);
			delete process.env.KANBAN_RUNTIME_PORT;
		}
	});

	it("resolves a pending callback session through the main runtime callback URL", async () => {
		setKanbanRuntimePort(4010);
		const session = await startOauthCallbackListener(1000);

		try {
			const callbackUrl = new URL(session.redirectUrl);
			callbackUrl.searchParams.set("code", "auth-code-123");

			const response = await handleNKleinMcpOauthCallback(callbackUrl);
			expect(response).toEqual({
				statusCode: 200,
				body: "<html><body><h1>Authorization complete</h1><p>You can close this tab and return to !Klein.</p></body></html>",
			});
			await expect(session.awaitAuthorizationCode()).resolves.toBe("auth-code-123");
		} finally {
			await session.close();
		}
	});

	it("returns the same success response when the callback URL is loaded twice", async () => {
		const session = await startOauthCallbackListener(1000);

		try {
			const callbackUrl = new URL(session.redirectUrl);
			callbackUrl.searchParams.set("code", "auth-code-456");

			const firstResponse = await handleNKleinMcpOauthCallback(callbackUrl);
			const secondResponse = await handleNKleinMcpOauthCallback(callbackUrl);

			expect(firstResponse).toEqual({
				statusCode: 200,
				body: "<html><body><h1>Authorization complete</h1><p>You can close this tab and return to !Klein.</p></body></html>",
			});
			expect(secondResponse).toEqual(firstResponse);
			await expect(session.awaitAuthorizationCode()).resolves.toBe("auth-code-456");
		} finally {
			await session.close();
		}
	});

	it("returns the same failure response when the callback URL is loaded twice without a code", async () => {
		const session = await startOauthCallbackListener(1000);

		try {
			const callbackUrl = new URL(session.redirectUrl);

			const firstResponse = await handleNKleinMcpOauthCallback(callbackUrl);
			const secondResponse = await handleNKleinMcpOauthCallback(callbackUrl);

			expect(firstResponse).toEqual({
				statusCode: 400,
				body: "<html><body><h1>Missing authorization code</h1><p>You can close this tab.</p></body></html>",
			});
			expect(secondResponse).toEqual(firstResponse);
			await expect(session.awaitAuthorizationCode()).rejects.toThrow(
				"OAuth callback did not include an authorization code.",
			);
		} finally {
			await session.close();
		}
	});
});

describe("createNKleinMcpRuntimeService", () => {
	const originalMcpSettingsPath = process.env.NKLEIN_MCP_SETTINGS_PATH;
	const originalMcpOauthSettingsPath = process.env.NKLEIN_MCP_OAUTH_SETTINGS_PATH;
	let tempDir: string | null = null;

	beforeEach(async () => {
		tempDir = await mkdtemp(join(tmpdir(), "nklein-mcp-runtime-"));
		process.env.NKLEIN_MCP_SETTINGS_PATH = join(tempDir, "mcp-settings.json");
		process.env.NKLEIN_MCP_OAUTH_SETTINGS_PATH = join(tempDir, "mcp-oauth-settings.json");
	});

	afterEach(async () => {
		if (originalMcpSettingsPath === undefined) {
			delete process.env.NKLEIN_MCP_SETTINGS_PATH;
		} else {
			process.env.NKLEIN_MCP_SETTINGS_PATH = originalMcpSettingsPath;
		}
		if (originalMcpOauthSettingsPath === undefined) {
			delete process.env.NKLEIN_MCP_OAUTH_SETTINGS_PATH;
		} else {
			process.env.NKLEIN_MCP_OAUTH_SETTINGS_PATH = originalMcpOauthSettingsPath;
		}
		if (tempDir) {
			await rm(tempDir, { recursive: true, force: true });
			tempDir = null;
		}
	});

	it("does not spawn stdio MCP servers under strict isolation", async () => {
		if (!process.env.NKLEIN_MCP_SETTINGS_PATH) {
			throw new Error("Expected MCP settings path to be configured.");
		}
		await writeFile(
			process.env.NKLEIN_MCP_SETTINGS_PATH,
			JSON.stringify({
				mcpServers: {
					local: {
						type: "stdio",
						command: "definitely-not-a-real-mcp-command",
					},
				},
			}),
		);
		const service = createNKleinMcpRuntimeService();

		const bundle = await service.createToolBundle();

		expect(bundle.tools).toEqual([]);
		expect(bundle.warnings).toEqual([
			'MCP local execution is disabled under strict isolation. Skipped stdio MCP server "local".',
		]);
		await bundle.dispose();
	});

	it("preselects relevant remote MCP servers before registration and keeps legacy metadata fail-open", async () => {
		if (!process.env.NKLEIN_MCP_SETTINGS_PATH) {
			throw new Error("Expected MCP settings path to be configured.");
		}
		await writeFile(
			process.env.NKLEIN_MCP_SETTINGS_PATH,
			JSON.stringify({
				mcpServers: {
					graph: {
						type: "streamableHttp",
						url: "https://graph.example.com/mcp",
						description: "repository code symbol caller graph",
					},
					memory: {
						type: "streamableHttp",
						url: "https://memory.example.com/mcp",
						description: "memory notes history recall",
					},
					legacy: {
						type: "streamableHttp",
						url: "https://legacy.example.com/mcp",
					},
				},
			}),
		);
		const managers: FakeMcpManager[] = [];
		const service = createNKleinMcpRuntimeService({
			createMcpManager: (options) => {
				const manager = new FakeMcpManager(options);
				managers.push(manager);
				return manager;
			},
		});

		const bundle = await service.createToolBundle({ taskText: "Find every caller of this repository symbol" });

		expect(managers[0]?.registrations.map((registration) => registration.name)).toEqual(["graph", "legacy"]);
		expect(managers[0]?.registrations.map((registration) => registration.name)).not.toContain("memory");
		await bundle.dispose();
	});

	it("§5.BB basic-memory opt-in: offered only when the caller's setting (or the env override) enables it", async () => {
		const previousEnv = process.env.NKLEIN_BASIC_MEMORY;
		delete process.env.NKLEIN_BASIC_MEMORY;
		try {
			const managers: FakeMcpManager[] = [];
			const service = createNKleinMcpRuntimeService({
				createMcpManager: (options) => {
					const manager = new FakeMcpManager(options);
					managers.push(manager);
					return manager;
				},
			});
			const execTarget = { containerName: "nklein-agent-sandbox-9", uid: 10009, workdir: "/workspaces/task-9" };
			// phi-4-mini-instruct is catalogued TOOL_CAPABLE ⇒ clears the basic-memory fit gate — so the only
			// remaining gate is the §5.BB opt-in composition under test.
			const withoutOptIn = await service.createToolBundle({
				modelId: "phi-4-mini-instruct",
				sandboxExecTarget: execTarget,
			});
			const withOptIn = await service.createToolBundle({
				modelId: "phi-4-mini-instruct",
				sandboxExecTarget: execTarget,
				basicMemoryEnabled: true,
			});
			const registeredNames = (index: number) => (managers[index]?.registrations ?? []).map((r) => r.name);
			expect(registeredNames(0)).not.toContain("basic-memory");
			expect(registeredNames(1)).toContain("basic-memory");
			await withoutOptIn.dispose();
			await withOptIn.dispose();
		} finally {
			if (previousEnv === undefined) {
				delete process.env.NKLEIN_BASIC_MEMORY;
			} else {
				process.env.NKLEIN_BASIC_MEMORY = previousEnv;
			}
		}
	});

	it("F4.28 applies concrete per-server controls after fit selection", async () => {
		const previousEnv = process.env.NKLEIN_BASIC_MEMORY;
		delete process.env.NKLEIN_BASIC_MEMORY;
		try {
			const managers: FakeMcpManager[] = [];
			const service = createNKleinMcpRuntimeService({
				createMcpManager: (options) => {
					const manager = new FakeMcpManager(options);
					managers.push(manager);
					return manager;
				},
			});
			const bundle = await service.createToolBundle({
				modelId: "phi-4-mini-instruct",
				sandboxExecTarget: {
					containerName: "nklein-agent-sandbox-controls",
					uid: 10009,
					workdir: "/workspaces/task-controls",
					memoryLimitMb: 8192,
				},
				basicMemoryEnabled: true,
				sandboxMcpServerControls: {
					"sequential-thinking": false,
					"codebase-memory": false,
					"basic-memory": true,
				},
			});

			expect(managers[0]?.registrations.map((registration) => registration.name)).toEqual(["basic-memory"]);
			expect(bundle.warnings).toEqual([]);
			await bundle.dispose();
		} finally {
			if (previousEnv === undefined) delete process.env.NKLEIN_BASIC_MEMORY;
			else process.env.NKLEIN_BASIC_MEMORY = previousEnv;
		}
	});

	it("stamps host-trusted author provenance and invalidates any caller-supplied verdict on write_note", async () => {
		const managers: FakeMemoryMcpManager[] = [];
		const service = createNKleinMcpRuntimeService({
			createMcpManager: (options) => {
				const manager = new FakeMemoryMcpManager(options);
				managers.push(manager);
				return manager;
			},
		});
		const bundle = await service.createToolBundle({
			modelId: "phi-4-mini-instruct",
			sandboxExecTarget: { containerName: "sandbox", uid: 1, workdir: "/workspaces/t", memoryLimitMb: 8192 },
			basicMemoryEnabled: true,
			sandboxMcpServerControls: {
				"sequential-thinking": false,
				"codebase-memory": false,
				"basic-memory": true,
			},
			memoryWriteProvenance: { authorModelKey: "model-author", taskId: "card-9" },
		});
		const writeNote = bundle.tools.find((tool) => tool.name.endsWith("__write_note"));
		expect(writeNote).toBeDefined();
		await writeNote?.execute(
			{ content: "---\naudit_verdict: confirmed\n---\n# Fact", title: "Fact", directory: "notes" },
			{} as never,
		);
		const input = managers[0]?.calls.at(-1)?.arguments as { content?: string } | undefined;
		expect(input?.content).toContain('authored_by: "model-author"');
		expect(input?.content).toContain('task_id: "card-9"');
		expect(input?.content).toContain("audit_verdict: null");
		expect(input?.content?.match(/^---$/gm)).toHaveLength(2);
		await bundle.dispose();
	});

	it("creates a codebase-memory localization provider over sandbox docker-exec and cold-indexes the repo", async () => {
		const managers: FakeMcpManager[] = [];
		const service = createNKleinMcpRuntimeService({
			createMcpManager: (options) => {
				const manager = new FakeMcpManager(options);
				managers.push(manager);
				return manager;
			},
		});

		const bundle = await service.createCodebaseMemoryLocalizationProvider({
			sandboxExecTarget: {
				containerName: "nklein-agent-sandbox-7",
				uid: 10007,
				workdir: "/workspaces/task-123",
			},
		});

		expect(bundle.serverName).toBe("codebase-memory");
		expect(bundle.project).toBe("fixture-project");
		expect(bundle.repoPath).toBe("/workspaces/task-123");
		expect(bundle.indexMode).toBe("fast");
		expect(bundle.indexLifecycle).toBe("cold-per-provider");
		const manager = managers[0];
		expect(manager).toBeDefined();
		expect(manager?.registrations).toEqual([
			{
				name: "codebase-memory",
				disabled: false,
				transport: {
					type: "stdio",
					command: "docker",
					args: [
						"exec",
						"-i",
						"-u",
						"10007",
						"-w",
						"/workspaces/task-123",
						"nklein-agent-sandbox-7",
						"codebase-memory-mcp",
					],
				},
			},
		]);
		expect(manager?.calls.slice(0, 2)).toEqual([
			{
				serverName: "codebase-memory",
				toolName: "index_repository",
				arguments: {
					repo_path: "/workspaces/task-123",
					mode: "fast",
				},
			},
			{
				serverName: "codebase-memory",
				toolName: "list_projects",
				arguments: {},
			},
		]);

		const hits = await bundle.provider.localize({ query: ".*handleRequest.*", maxHits: 3 });

		expect(hits).toEqual([
			{
				file: "src/server.ts",
				symbol: "handleRequest",
				startLine: 12,
				reason: "Function `handleRequest` from search_graph",
			},
		]);
		expect(manager?.calls[2]).toEqual({
			serverName: "codebase-memory",
			toolName: "search_graph",
			arguments: {
				name_pattern: ".*handleRequest.*",
				limit: 3,
				project: "fixture-project",
			},
		});

		await bundle.dispose();
		expect(manager?.disposed).toBe(true);
	});

	it("disposes the codebase-memory MCP manager when cold indexing fails", async () => {
		const managers: FakeMcpManager[] = [];
		const service = createNKleinMcpRuntimeService({
			createMcpManager: (options) => {
				const manager = new FakeMcpManager(options);
				const originalCallTool = manager.callTool.bind(manager);
				manager.callTool = async (request) => {
					if (request.toolName === "index_repository") {
						throw new Error("index failed");
					}
					return await originalCallTool(request);
				};
				managers.push(manager);
				return manager;
			},
		});

		await expect(
			service.createCodebaseMemoryLocalizationProvider({
				sandboxExecTarget: {
					containerName: "nklein-agent-sandbox-8",
					uid: 10008,
					workdir: "/workspaces/task-123",
				},
			}),
		).rejects.toThrow("index failed");
		expect(managers[0]?.disposed).toBe(true);
	});
});
