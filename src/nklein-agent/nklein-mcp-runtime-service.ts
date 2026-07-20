import { randomUUID } from "node:crypto";
import type { OAuthClientProvider, OAuthDiscoveryState } from "@modelcontextprotocol/sdk/client/auth.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { OAuthClientInformationMixed, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { RuntimeNKleinMcpServer } from "../core/api-contract";
import { isTruthyEnv } from "../core/env-flag";
import { toErrorMessage } from "../core/error-message";
import type { LocalizationProvider } from "../core/localization-provider";
import { createMcpLocalizationProvider } from "../core/mcp-localization-provider";
import { computeToolSurfaceHash } from "../core/mcp-tool-surface-pin";
import { buildKanbanRuntimeUrl } from "../core/runtime-endpoint";
import {
	buildSandboxMcpDockerExecArgs,
	filterEnabledSandboxServers,
	listAvailableSandboxMcpServers,
	listMemoryWithheldSandboxServers,
	type SandboxExecTarget,
	type SandboxMcpServerDef,
	selectSandboxMcpServersForModel,
} from "../core/sandbox-mcp-catalog";
import { formatToolError, toolErrorFromThrown } from "../core/tool-error-contract";
import { capToolResult } from "../core/tool-output-cap";
import { getSkillPin, upsertSkillPin } from "../state/skill-pin-store";
import { recordSelfObservation } from "../telemetry/self-observation-sink";
import {
	buildMcpOauthCallbackUrl,
	createOauthClientMetadata,
	MCP_OAUTH_CALLBACK_PATH,
	matchesMcpOauthCallbackPath,
	readMcpOauthCallbackRequestId,
} from "./nklein-mcp-oauth-callback";
import {
	hasAccessToken,
	type NKleinMcpOauthServerState,
	parseOauthSettings,
	resolveMcpOauthSettingsPath,
	updateOauthServerState,
} from "./nklein-mcp-oauth-settings-store";
import { createNKleinMcpSettingsService } from "./nklein-mcp-settings-service";
import {
	createTransport,
	formatLocalMcpExecutionDisabledWarning,
	isAuthCapableTransport,
	toMcpRegistration,
} from "./nklein-mcp-transport-factory";
import {
	createSdkInMemoryMcpManager,
	createSdkMcpTools,
	type SdkMcpManager,
	type SdkMcpManagerOptions,
	type SdkMcpServerClient,
	type SdkMcpServerRegistration,
	type SdkMcpTool,
} from "./sdk-provider-boundary";

const DEFAULT_AUTH_TIMEOUT_MS = 3 * 60 * 1000;
const COMPLETED_CALLBACK_RETENTION_MS = 5 * 60 * 1000;
const CODEBASE_MEMORY_SERVER_ID = "codebase-memory";
const DEFAULT_CODEBASE_MEMORY_INDEX_MODE = "fast";

const CALLBACK_RESPONSE_HTML = {
	success:
		"<html><body><h1>Authorization complete</h1><p>You can close this tab and return to !Klein.</p></body></html>",
	failure: "<html><body><h1>OAuth failed</h1><p>You can close this tab.</p></body></html>",
	missingCode: "<html><body><h1>Missing authorization code</h1><p>You can close this tab.</p></body></html>",
	expired:
		"<html><body><h1>Authorization session expired</h1><p>Return to !Klein and run Connect OAuth again.</p></body></html>",
	missingRequestId:
		"<html><body><h1>Invalid authorization callback</h1><p>Return to !Klein and run Connect OAuth again.</p></body></html>",
} as const;

const pendingOauthCallbacksByRequestId = new Map<
	string,
	{
		resolveCode: (code: string) => void;
		rejectCode: (error: Error) => void;
		timeoutHandle: NodeJS.Timeout;
	}
>();
const completedOauthCallbacksByRequestId = new Map<
	string,
	{
		response: NKleinMcpOauthCallbackResponse;
		timeoutHandle: NodeJS.Timeout;
	}
>();

export interface NKleinMcpServerAuthStatus {
	serverName: string;
	oauthSupported: boolean;
	oauthConfigured: boolean;
	lastError: string | null;
	lastAuthenticatedAt: number | null;
}

export interface NKleinMcpServerAuthResult {
	serverName: string;
	authorized: true;
	message: string;
}

export interface NKleinMcpToolBundle {
	tools: SdkMcpTool[];
	warnings: string[];
	dispose: () => Promise<void>;
}

/**
 * Options for {@link NKleinMcpRuntimeService.createToolBundle}. When BOTH are supplied, §5.AR curated MCP servers hosted
 * inside the task's sandbox are offered to the model IF the §5.AL fit gate clears them. Omitting either (or the whole
 * arg) yields today's behavior — only user-configured non-stdio servers. The opt-out gate lives in the CALLER: don't
 * pass `sandboxExecTarget` when the feature is disabled globally/per-project.
 */
export interface NKleinMcpToolBundleOptions {
	/** The task's model id — drives the "for models where it fits" gate over the curated sandbox servers. */
	modelId?: string;
	/** The task's sandbox `docker exec` target; when present + a curated server fits, its tools are added. */
	sandboxExecTarget?: SandboxExecTarget | null;
	/**
	 * §5.AR: the basic-memory exec env (BASIC_MEMORY_CONFIG_DIR + BASIC_MEMORY_MCP_PROJECT + hardening) for this task's
	 * project — applied ONLY to the basic-memory `docker exec` so it reads/writes the task's mounted per-project store.
	 */
	basicMemoryExecEnv?: Record<string, string>;
	/**
	 * §5.BB: the caller's resolved basic-memory opt-in (the `basicMemoryEnabled` runtime setting). ORed with the
	 * `NKLEIN_BASIC_MEMORY` env override at bundle time (either enables); absent/false + no env ⇒ the default-off
	 * basic-memory server is NOT offered even when baked + fitting.
	 */
	basicMemoryEnabled?: boolean;
}

export type CodebaseMemoryLocalizationIndexMode = "fast" | "moderate" | "full";
export type CodebaseMemoryLocalizationIndexLifecycle = "cold-per-provider";

export interface NKleinCodebaseMemoryLocalizationProviderOptions {
	/** The task sandbox that owns the repo and runs `codebase-memory-mcp` over `docker exec -i`. */
	sandboxExecTarget: SandboxExecTarget;
	/** Repo path inside the sandbox. Defaults to the sandbox workdir, matching the repair-card worktree lifecycle. */
	repoPath?: string;
	/** Defaults to `fast`; the repair kernel needs structural symbol/file lookup, not semantic similarity. */
	indexMode?: CodebaseMemoryLocalizationIndexMode;
}

export interface NKleinCodebaseMemoryLocalizationProviderBundle {
	provider: LocalizationProvider;
	dispose: () => Promise<void>;
	serverName: typeof CODEBASE_MEMORY_SERVER_ID;
	project: string;
	repoPath: string;
	indexMode: CodebaseMemoryLocalizationIndexMode;
	indexLifecycle: CodebaseMemoryLocalizationIndexLifecycle;
}

export interface NKleinMcpRuntimeService {
	createToolBundle(options?: NKleinMcpToolBundleOptions): Promise<NKleinMcpToolBundle>;
	createCodebaseMemoryLocalizationProvider(
		options: NKleinCodebaseMemoryLocalizationProviderOptions,
	): Promise<NKleinCodebaseMemoryLocalizationProviderBundle>;
	getAuthStatuses(): Promise<NKleinMcpServerAuthStatus[]>;
	authorizeServer(input: {
		serverName: string;
		timeoutMs?: number;
		onAuthorizationUrl?: (url: string) => void;
	}): Promise<NKleinMcpServerAuthResult>;
}

export interface NKleinMcpOauthCallbackResponse {
	statusCode: number;
	body: string;
}

export interface CreateNKleinMcpRuntimeServiceOptions {
	onAuthStatusesChanged?: (statuses: NKleinMcpServerAuthStatus[]) => void | Promise<void>;
	createMcpManager?: (options: SdkMcpManagerOptions) => SdkMcpManager;
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

function indexedProjectNameFromListProjects(listProjectsResult: unknown, repoPath: string): string {
	const payload = asRecord(unwrapMcpJson(listProjectsResult));
	const projects = payload?.projects;
	if (!Array.isArray(projects)) {
		throw new Error("codebase-memory list_projects did not return a projects array.");
	}
	for (const project of projects) {
		const record = asRecord(project);
		if (record?.root_path === repoPath && typeof record.name === "string" && record.name.trim().length > 0) {
			return record.name.trim();
		}
	}
	throw new Error(`codebase-memory did not report an indexed project for "${repoPath}".`);
}

function runtimeServerFromRegistration(registration: SdkMcpServerRegistration): RuntimeNKleinMcpServer {
	if (registration.transport.type === "stdio") {
		return {
			name: registration.name,
			disabled: registration.disabled === true,
			type: "stdio",
			command: registration.transport.command,
			args: registration.transport.args,
			cwd: registration.transport.cwd,
			env: registration.transport.env,
		};
	}
	return {
		name: registration.name,
		disabled: registration.disabled === true,
		type: registration.transport.type,
		url: registration.transport.url,
		headers: registration.transport.headers,
	};
}

function buildSandboxMcpRegistration(
	server: SandboxMcpServerDef,
	execTarget: SandboxExecTarget,
	env?: Record<string, string>,
): SdkMcpServerRegistration {
	return {
		name: server.id,
		disabled: false,
		transport: {
			type: "stdio",
			command: "docker",
			args: buildSandboxMcpDockerExecArgs(execTarget, server.inContainerArgv, env),
		},
	};
}

function selectCodebaseMemorySandboxServer(): SandboxMcpServerDef {
	const server = listAvailableSandboxMcpServers().find((candidate) => candidate.id === CODEBASE_MEMORY_SERVER_ID);
	if (!server) {
		throw new Error("codebase-memory MCP server is not available for repair localization.");
	}
	return server;
}

async function createOauthProviderContext(input: {
	settingsPath: string;
	serverName: string;
	redirectUrl: string;
	onAuthorizationUrl?: (url: string) => void;
}) {
	let state = parseOauthSettings(input.settingsPath).servers[input.serverName] ?? {};
	let lastAuthorizationUrl: string | null = null;

	const persist = async (nextState: NKleinMcpOauthServerState): Promise<void> => {
		state = await updateOauthServerState({
			path: input.settingsPath,
			serverName: input.serverName,
			updater: () => nextState,
		});
	};

	const patch = async (updater: (current: NKleinMcpOauthServerState) => NKleinMcpOauthServerState): Promise<void> => {
		state = await updateOauthServerState({
			path: input.settingsPath,
			serverName: input.serverName,
			updater,
		});
	};

	const provider: OAuthClientProvider = {
		get redirectUrl() {
			return state.redirectUrl ?? input.redirectUrl;
		},
		get clientMetadata() {
			return createOauthClientMetadata(state.redirectUrl ?? input.redirectUrl);
		},
		state: () => randomUUID(),
		clientInformation: () => state.clientInformation as OAuthClientInformationMixed | undefined,
		saveClientInformation: async (clientInformation) => {
			await patch((current) => ({
				...current,
				clientInformation: clientInformation as Record<string, unknown>,
				redirectUrl: input.redirectUrl,
				lastError: undefined,
			}));
		},
		tokens: () => state.tokens as OAuthTokens | undefined,
		saveTokens: async (tokens) => {
			await patch((current) => ({
				...current,
				tokens: tokens as Record<string, unknown>,
				redirectUrl: input.redirectUrl,
				lastError: undefined,
				lastAuthenticatedAt: Date.now(),
			}));
		},
		redirectToAuthorization: async (authorizationUrl: URL) => {
			lastAuthorizationUrl = authorizationUrl.toString();
			if (input.onAuthorizationUrl) {
				input.onAuthorizationUrl(lastAuthorizationUrl);
			}
		},
		saveCodeVerifier: async (codeVerifier: string) => {
			await patch((current) => ({
				...current,
				codeVerifier,
				redirectUrl: input.redirectUrl,
			}));
		},
		codeVerifier: () => {
			if (!state.codeVerifier) {
				throw new Error(`Missing OAuth code verifier for MCP server "${input.serverName}".`);
			}
			return state.codeVerifier;
		},
		invalidateCredentials: async (scope) => {
			await patch((current) => {
				if (scope === "all") {
					return {
						lastError: current.lastError,
					};
				}
				return {
					...current,
					...(scope === "client" ? { clientInformation: undefined } : {}),
					...(scope === "tokens" ? { tokens: undefined, lastAuthenticatedAt: undefined } : {}),
					...(scope === "verifier" ? { codeVerifier: undefined } : {}),
					...(scope === "discovery" ? { discoveryState: undefined } : {}),
				};
			});
		},
		saveDiscoveryState: async (discoveryState) => {
			await patch((current) => ({
				...current,
				discoveryState: discoveryState as unknown as Record<string, unknown>,
			}));
		},
		discoveryState: () => state.discoveryState as OAuthDiscoveryState | undefined,
	};

	if (state.redirectUrl !== input.redirectUrl) {
		await persist({
			...state,
			redirectUrl: input.redirectUrl,
		});
	}

	return {
		provider,
		getLastAuthorizationUrl: () => lastAuthorizationUrl,
		resetInteractiveState: async () => {
			await patch((current) => ({
				...current,
				clientInformation: undefined,
				codeVerifier: undefined,
				discoveryState: undefined,
				lastError: undefined,
				redirectUrl: input.redirectUrl,
			}));
		},
		markError: async (errorMessage: string) => {
			await patch((current) => ({
				...current,
				lastError: errorMessage,
			}));
		},
		clearError: async () => {
			await patch((current) => ({
				...current,
				lastError: undefined,
			}));
		},
	};
}

class RuntimeMcpServerClient implements SdkMcpServerClient {
	private client: Client | null = null;

	constructor(
		private readonly server: RuntimeNKleinMcpServer,
		private readonly oauthSettingsPath: string,
	) {}

	private async createAuthProviderContext() {
		if (this.server.type === "stdio") {
			return null;
		}

		return await createOauthProviderContext({
			settingsPath: this.oauthSettingsPath,
			serverName: this.server.name,
			redirectUrl:
				parseOauthSettings(this.oauthSettingsPath).servers[this.server.name]?.redirectUrl ??
				buildKanbanRuntimeUrl(MCP_OAUTH_CALLBACK_PATH),
		});
	}

	private formatUnauthorizedMessage(authUrl: string | null): string {
		if (authUrl) {
			return `MCP server "${this.server.name}" requires OAuth authorization. Open Settings, run Connect OAuth, and complete this URL: ${authUrl}`;
		}
		return `MCP server "${this.server.name}" requires OAuth authorization. Open Settings and run Connect OAuth.`;
	}

	private async withErrorHandling<T>(
		operation: (context: {
			authContext: Awaited<ReturnType<RuntimeMcpServerClient["createAuthProviderContext"]>>;
		}) => Promise<T>,
	): Promise<T> {
		const authContext = await this.createAuthProviderContext();
		try {
			const value = await operation({ authContext });
			await authContext?.clearError();
			return value;
		} catch (error) {
			if (error instanceof UnauthorizedError) {
				const message = this.formatUnauthorizedMessage(authContext?.getLastAuthorizationUrl() ?? null);
				await authContext?.markError(message);
				throw new Error(message);
			}
			const message = toErrorMessage(error);
			await authContext?.markError(message);
			throw new Error(`MCP server "${this.server.name}" failed: ${message}`);
		}
	}

	async connect(): Promise<void> {
		if (this.client) {
			return;
		}

		await this.withErrorHandling(async ({ authContext }) => {
			const transport = createTransport({
				server: this.server,
				oauthProvider: authContext?.provider,
			});
			const client = new Client({
				name: "kanban-mcp-runtime-client",
				version: "1.0.0",
			});

			await client.connect(transport);
			this.client = client;
		});
	}

	async disconnect(): Promise<void> {
		const activeClient = this.client;
		this.client = null;
		if (!activeClient) {
			return;
		}
		await activeClient.close();
	}

	async listTools() {
		if (!this.client) {
			await this.connect();
		}

		const client = this.client;
		if (!client) {
			throw new Error(`MCP server "${this.server.name}" is not connected.`);
		}

		return await this.withErrorHandling(async () => {
			const result = await client.listTools();
			return result.tools.map((tool) => ({
				name: tool.name,
				description: tool.description,
				inputSchema:
					tool.inputSchema && typeof tool.inputSchema === "object" && !Array.isArray(tool.inputSchema)
						? (tool.inputSchema as Record<string, unknown>)
						: {},
			}));
		});
	}

	async callTool(request: { name: string; arguments?: Record<string, unknown> }): Promise<unknown> {
		if (!this.client) {
			await this.connect();
		}

		const client = this.client;
		if (!client) {
			throw new Error(`MCP server "${this.server.name}" is not connected.`);
		}

		return await this.withErrorHandling(
			async () =>
				await client.callTool({
					name: request.name,
					...(request.arguments ? { arguments: request.arguments } : {}),
				}),
		);
	}
}

function rememberCompletedOauthCallback(requestId: string, response: NKleinMcpOauthCallbackResponse): void {
	const existing = completedOauthCallbacksByRequestId.get(requestId);
	if (existing) {
		clearTimeout(existing.timeoutHandle);
	}

	const timeoutHandle = setTimeout(() => {
		completedOauthCallbacksByRequestId.delete(requestId);
	}, COMPLETED_CALLBACK_RETENTION_MS);

	completedOauthCallbacksByRequestId.set(requestId, {
		response,
		timeoutHandle,
	});
}

export async function handleNKleinMcpOauthCallback(requestUrl: URL): Promise<NKleinMcpOauthCallbackResponse | null> {
	if (!matchesMcpOauthCallbackPath(requestUrl)) {
		return null;
	}

	const requestId = readMcpOauthCallbackRequestId(requestUrl);
	if (!requestId) {
		return {
			statusCode: 400,
			body: CALLBACK_RESPONSE_HTML.missingRequestId,
		};
	}

	const completed = completedOauthCallbacksByRequestId.get(requestId);
	if (completed) {
		return completed.response;
	}

	const pending = pendingOauthCallbacksByRequestId.get(requestId);
	if (!pending) {
		return {
			statusCode: 410,
			body: CALLBACK_RESPONSE_HTML.expired,
		};
	}

	pendingOauthCallbacksByRequestId.delete(requestId);
	clearTimeout(pending.timeoutHandle);

	const errorValue = requestUrl.searchParams.get("error")?.trim();
	const errorDescription = requestUrl.searchParams.get("error_description")?.trim();
	const code = requestUrl.searchParams.get("code")?.trim();

	if (errorValue) {
		const response = {
			statusCode: 400,
			body: CALLBACK_RESPONSE_HTML.failure,
		} as const;
		rememberCompletedOauthCallback(requestId, response);
		pending.rejectCode(
			new Error(
				errorDescription
					? `OAuth authorization failed: ${errorValue} (${errorDescription})`
					: `OAuth authorization failed: ${errorValue}`,
			),
		);
		return response;
	}

	if (!code) {
		const response = {
			statusCode: 400,
			body: CALLBACK_RESPONSE_HTML.missingCode,
		} as const;
		rememberCompletedOauthCallback(requestId, response);
		pending.rejectCode(new Error("OAuth callback did not include an authorization code."));
		return response;
	}

	const response = {
		statusCode: 200,
		body: CALLBACK_RESPONSE_HTML.success,
	} as const;
	rememberCompletedOauthCallback(requestId, response);
	pending.resolveCode(code);
	return response;
}

export async function startOauthCallbackListener(timeoutMs: number): Promise<{
	redirectUrl: string;
	awaitAuthorizationCode: () => Promise<string>;
	close: () => Promise<void>;
}> {
	let resolveCode: ((code: string) => void) | null = null;
	let rejectCode: ((error: Error) => void) | null = null;
	let timeoutHandle: NodeJS.Timeout | null = null;
	const requestId = randomUUID();

	const codePromise = new Promise<string>((resolve, reject) => {
		resolveCode = resolve;
		rejectCode = (error: Error) => {
			reject(error);
		};
	});

	timeoutHandle = setTimeout(() => {
		if (!pendingOauthCallbacksByRequestId.delete(requestId)) {
			return;
		}
		rejectCode?.(new Error("Timed out waiting for MCP OAuth authorization callback."));
	}, timeoutMs);
	pendingOauthCallbacksByRequestId.set(requestId, {
		resolveCode: (code) => {
			resolveCode?.(code);
		},
		rejectCode: (error) => {
			rejectCode?.(error);
		},
		timeoutHandle,
	});

	let closed = false;
	const close = async () => {
		if (closed) {
			return;
		}
		closed = true;
		if (timeoutHandle) {
			clearTimeout(timeoutHandle);
			timeoutHandle = null;
		}
		pendingOauthCallbacksByRequestId.delete(requestId);
	};

	return {
		redirectUrl: buildMcpOauthCallbackUrl(requestId),
		awaitAuthorizationCode: async () => await codePromise,
		close,
	};
}

export function createNKleinMcpRuntimeService(
	options: CreateNKleinMcpRuntimeServiceOptions = {},
): NKleinMcpRuntimeService {
	const settingsService = createNKleinMcpSettingsService();
	const oauthSettingsPath = resolveMcpOauthSettingsPath();
	const createManager = options.createMcpManager ?? createSdkInMemoryMcpManager;

	const createMcpClient = (registration: SdkMcpServerRegistration): SdkMcpServerClient => {
		const loaded = settingsService.loadSettings().servers.find((server) => server.name === registration.name);
		return new RuntimeMcpServerClient(loaded ?? runtimeServerFromRegistration(registration), oauthSettingsPath);
	};

	const createManagerForRuntime = (): SdkMcpManager =>
		createManager({
			clientFactory: createMcpClient,
		});

	const collectAuthStatuses = (): NKleinMcpServerAuthStatus[] => {
		const loadedSettings = settingsService.loadSettings();
		const oauthSettings = parseOauthSettings(oauthSettingsPath);

		return loadedSettings.servers
			.map((server) => {
				const authState = oauthSettings.servers[server.name];
				const oauthSupported = server.type !== "stdio";
				return {
					serverName: server.name,
					oauthSupported,
					oauthConfigured: oauthSupported ? hasAccessToken(authState?.tokens) : false,
					lastError: authState?.lastError ?? null,
					lastAuthenticatedAt: authState?.lastAuthenticatedAt ?? null,
				};
			})
			.sort((left, right) => left.serverName.localeCompare(right.serverName));
	};

	const broadcastAuthStatuses = async () => {
		await options.onAuthStatusesChanged?.(collectAuthStatuses());
	};

	return {
		async createToolBundle(bundleOptions?: NKleinMcpToolBundleOptions): Promise<NKleinMcpToolBundle> {
			const loadedSettings = settingsService.loadSettings();
			// §5.AR: curated MCP servers hosted INSIDE the task's sandbox, offered only to a fitting model. Empty unless the
			// caller supplies BOTH the exec target and the model id (the opt-out gate lives in the caller). Default-OFF
			// servers (basic-memory — write-capable authored memory) are additionally gated behind an explicit opt-in so
			// they are NOT offered by default even once baked+fitting; the caller's `basicMemoryEnabled` runtime setting
			// OR the NKLEIN_BASIC_MEMORY env override enables it (§5.BB — either enables).
			const enabledOptIns = new Set<string>();
			if (bundleOptions?.basicMemoryEnabled || isTruthyEnv(process.env.NKLEIN_BASIC_MEMORY)) {
				enabledOptIns.add("basic-memory");
			}
			const curatedServers =
				bundleOptions?.sandboxExecTarget && bundleOptions.modelId
					? filterEnabledSandboxServers(
							// §5.AF: the exec target carries the container's memory limit, so a heavy server (codebase-memory) is
							// withheld from a container too small to host it without OOM under concurrent load.
							selectSandboxMcpServersForModel(
								bundleOptions.modelId,
								bundleOptions.sandboxExecTarget.memoryLimitMb,
							),
							enabledOptIns,
						)
					: [];

			// §5.AF: NEVER lose a capability SILENTLY — if the memory-fit gate withheld a model-fitting server (the
			// codebase-memory OOM guard, which triggers on the 4 GB default container), tell the operator why + how to
			// restore it. Computed BEFORE the early return so the warning survives even when it was the only server.
			const memoryWithheldWarnings: string[] =
				bundleOptions?.sandboxExecTarget && bundleOptions.modelId
					? listMemoryWithheldSandboxServers(
							bundleOptions.modelId,
							bundleOptions.sandboxExecTarget.memoryLimitMb,
						).map(
							(server) =>
								`Sandbox MCP server "${server.label}" is OFF for this task: ${server.reason}. Raise the container memory (Settings → Agents → isolation pool, "memory per container") to enable it.`,
						)
					: [];

			if (loadedSettings.servers.length === 0 && curatedServers.length === 0) {
				return {
					tools: [],
					warnings: memoryWithheldWarnings,
					dispose: async () => {},
				};
			}

			const manager: SdkMcpManager = createManagerForRuntime();

			const warnings: string[] = [...memoryWithheldWarnings];
			for (const server of loadedSettings.servers) {
				if (server.type === "stdio" && !server.disabled) {
					warnings.push(formatLocalMcpExecutionDisabledWarning(server.name));
				}
			}

			for (const server of loadedSettings.servers) {
				if (server.type === "stdio") {
					continue;
				}
				await manager.registerServer(toMcpRegistration(server));
			}

			const tools: SdkMcpTool[] = [];
			// F12.31 (RECORD-ONLY): fingerprint what the MODEL will read from this server — names, DESCRIPTIONS and
			// input schemas — and compare against the pin recorded at first approval. Tool-poisoning hides in the
			// description, and a rug-pull swaps a trusted tool after approval; both change this hash. Observe-first:
			// a drift is recorded (and TOFU pins on first sight) but tools are NOT withheld yet — withholding is an
			// approval-flow change that belongs with the S3 confirm queue.
			/**
			 * P19.2: sort one server's tools by name before they are offered.
			 *
			 * An MCP server returns its tool list in whatever order it likes, and nothing guarantees that order is stable
			 * across restarts. Anthropic's published cache-invalidation hierarchy is **tools → system → messages**: a change
			 * to the tools block invalidates the tools block AND the system prompt AND the whole message history. So a server
			 * that reorders its tools between runs silently destroys the entire prompt cache on every session — a permanent,
			 * invisible tax that shows up only as "prefill is slower than it should be".
			 *
			 * Sorting WITHIN each server preserves the server grouping (server order comes from config and is already
			 * stable) while making each contribution byte-stable. Distinct from F12.31's `computeToolSurfaceHash`, which
			 * sorts only to compare surfaces for drift — this fixes the order actually sent to the model.
			 */
			function sortToolsByNameForCacheStability<T extends { name: string }>(toolList: readonly T[]): T[] {
				return [...toolList].sort((left, right) => left.name.localeCompare(right.name));
			}

			const recordToolSurface = async (serverId: string, serverTools: readonly SdkMcpTool[]): Promise<void> => {
				try {
					const currentSurfaceHash = computeToolSurfaceHash(
						serverTools.map((tool) => ({
							name: tool.name,
							description: tool.description ?? null,
							inputSchema: (tool as { inputSchema?: unknown }).inputSchema ?? null,
						})),
					);
					const existing = await getSkillPin(`mcp:${serverId}`);
					if (!existing) {
						await upsertSkillPin({
							id: `mcp:${serverId}`,
							contentHash: currentSurfaceHash,
							version: null,
							trust: "tofu",
							pinnedAt: Date.now(),
						});
						return;
					}
					if (existing.contentHash !== currentSurfaceHash) {
						recordSelfObservation({
							signal: "custom",
							severity: "warning",
							message: `MCP tool surface CHANGED for "${serverId}" since first approval — a changed description or schema is the tool-poisoning/rug-pull signal.`,
							metadata: {
								category: "mcp_tool_surface_drift",
								serverId,
								pinnedHash: existing.contentHash,
								currentHash: currentSurfaceHash,
							},
						});
					}
				} catch {
					// Observation only — never blocks MCP registration.
				}
			};

			// F12.65: MCP results are the ONE tool surface with no built-in cap (SDK read/search/command all
			// middle-truncate) — one oversized server response can blow a small model's whole window (codebase-memory
			// has OOM'd a session before). Wrap every MCP tool's execute with the middle-truncation cap.
			// F3.T2: a THROWN MCP failure previously surfaced as a raw stack string — classify it through the same
			// typed contract every sandbox tool failure uses, so the model gets code/hint/retryability, not a dump.
			const capMcpToolOutputs = (serverTools: SdkMcpTool[]): SdkMcpTool[] =>
				serverTools.map((tool) => ({
					...tool,
					execute: async (input: unknown, context: unknown) => {
						try {
							return capToolResult(await tool.execute(input, context as never)).value;
						} catch (error) {
							throw new Error(formatToolError(toolErrorFromThrown(error, { toolName: tool.name })), {
								cause: error,
							});
						}
					},
				}));

			for (const server of loadedSettings.servers) {
				if (server.disabled || server.type === "stdio") {
					continue;
				}
				try {
					const serverTools = await createSdkMcpTools({
						serverName: server.name,
						provider: manager,
					});
					await recordToolSurface(server.name, serverTools);
					tools.push(...sortToolsByNameForCacheStability(capMcpToolOutputs(serverTools)));
				} catch (error) {
					warnings.push(`Failed to load MCP server "${server.name}": ${toErrorMessage(error)}`);
				}
			}

			// §5.AR: register the fit-gated curated servers that run IN the task's sandbox via `docker exec -i …`. Unlike a
			// user stdio server (host process → disabled under isolation), the server runs INSIDE the container and the host
			// runs only the exec pipe, so invariant #2 holds; the binary ships in the image, so nothing is fetched at runtime.
			const execTarget = bundleOptions?.sandboxExecTarget;
			if (execTarget) {
				for (const server of curatedServers) {
					try {
						await manager.registerServer(
							buildSandboxMcpRegistration(
								server,
								execTarget,
								server.id === "basic-memory" ? bundleOptions.basicMemoryExecEnv : undefined,
							),
						);
						const serverTools = await createSdkMcpTools({ serverName: server.id, provider: manager });
						await recordToolSurface(server.id, serverTools);
						tools.push(...sortToolsByNameForCacheStability(capMcpToolOutputs(serverTools)));
					} catch (error) {
						warnings.push(`Failed to load sandbox MCP server "${server.label}": ${toErrorMessage(error)}`);
					}
				}
			}

			return {
				tools,
				warnings,
				dispose: async () => {
					await manager.dispose();
				},
			};
		},

		async createCodebaseMemoryLocalizationProvider(
			localizationOptions: NKleinCodebaseMemoryLocalizationProviderOptions,
		): Promise<NKleinCodebaseMemoryLocalizationProviderBundle> {
			const server = selectCodebaseMemorySandboxServer();
			const manager = createManagerForRuntime();
			const repoPath = localizationOptions.repoPath?.trim() || localizationOptions.sandboxExecTarget.workdir;
			const indexMode = localizationOptions.indexMode ?? DEFAULT_CODEBASE_MEMORY_INDEX_MODE;

			try {
				await manager.registerServer(buildSandboxMcpRegistration(server, localizationOptions.sandboxExecTarget));
				await manager.callTool({
					serverName: CODEBASE_MEMORY_SERVER_ID,
					toolName: "index_repository",
					arguments: {
						repo_path: repoPath,
						mode: indexMode,
					},
				});
				const project = indexedProjectNameFromListProjects(
					await manager.callTool({
						serverName: CODEBASE_MEMORY_SERVER_ID,
						toolName: "list_projects",
						arguments: {},
					}),
					repoPath,
				);
				const provider = createMcpLocalizationProvider(
					(toolName, args) =>
						manager.callTool({
							serverName: CODEBASE_MEMORY_SERVER_ID,
							toolName,
							arguments: args,
						}),
					{ project },
				);

				return {
					provider,
					dispose: async () => {
						await manager.dispose();
					},
					serverName: CODEBASE_MEMORY_SERVER_ID,
					project,
					repoPath,
					indexMode,
					indexLifecycle: "cold-per-provider",
				};
			} catch (error) {
				await manager.dispose().catch(() => undefined);
				throw error;
			}
		},

		async getAuthStatuses(): Promise<NKleinMcpServerAuthStatus[]> {
			return collectAuthStatuses();
		},

		async authorizeServer(input): Promise<NKleinMcpServerAuthResult> {
			const serverName = input.serverName.trim();
			if (!serverName) {
				throw new Error("MCP server name cannot be empty.");
			}

			const loadedSettings = settingsService.loadSettings();
			const server = loadedSettings.servers.find((entry) => entry.name === serverName);
			if (!server) {
				throw new Error(`MCP server "${serverName}" is not configured.`);
			}
			if (server.disabled) {
				throw new Error(`MCP server "${serverName}" is disabled. Enable it before running OAuth.`);
			}
			if (server.type === "stdio") {
				throw new Error(`MCP server "${serverName}" uses stdio transport and does not support OAuth browser flow.`);
			}

			const callbackListener = await startOauthCallbackListener(input.timeoutMs ?? DEFAULT_AUTH_TIMEOUT_MS);
			const oauthContext = await createOauthProviderContext({
				settingsPath: oauthSettingsPath,
				serverName,
				redirectUrl: callbackListener.redirectUrl,
				onAuthorizationUrl: (url) => {
					input.onAuthorizationUrl?.(url);
				},
			});

			await oauthContext.resetInteractiveState();

			const transport = createTransport({
				server,
				oauthProvider: oauthContext.provider,
			});
			if (!isAuthCapableTransport(transport)) {
				await callbackListener.close();
				throw new Error(`MCP server "${serverName}" transport does not support OAuth.`);
			}

			const client = new Client({
				name: "kanban-mcp-oauth-client",
				version: "1.0.0",
			});
			let retryClient: Client | null = null;

			try {
				try {
					await client.connect(transport);
					await client.listTools();
					await oauthContext.clearError();
					return {
						serverName,
						authorized: true,
						message: `MCP server "${serverName}" is already authorized.`,
					};
				} catch (error) {
					if (!(error instanceof UnauthorizedError)) {
						throw error;
					}

					const authUrl = oauthContext.getLastAuthorizationUrl();
					if (!authUrl) {
						throw new Error(`MCP server "${serverName}" did not provide an authorization URL.`);
					}

					const authorizationCode = await callbackListener.awaitAuthorizationCode();
					await transport.finishAuth(authorizationCode);
					await broadcastAuthStatuses();

					retryClient = new Client({
						name: "kanban-mcp-oauth-client",
						version: "1.0.0",
					});
					const retryTransport = createTransport({
						server,
						oauthProvider: oauthContext.provider,
					});
					if (!isAuthCapableTransport(retryTransport)) {
						throw new Error(`MCP server "${serverName}" transport does not support OAuth.`);
					}
					await retryClient.connect(retryTransport);
					await retryClient.listTools();
					await oauthContext.clearError();
					return {
						serverName,
						authorized: true,
						message: `MCP server "${serverName}" OAuth authorization completed.`,
					};
				}
			} catch (error) {
				const message = toErrorMessage(error);
				await oauthContext.markError(message);
				await broadcastAuthStatuses().catch(() => undefined);
				throw new Error(message);
			} finally {
				await client.close().catch(() => undefined);
				await retryClient?.close().catch(() => undefined);
				await callbackListener.close();
			}
		},
	};
}
