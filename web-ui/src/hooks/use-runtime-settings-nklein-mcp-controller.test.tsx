import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useRuntimeSettingsNKleinMcpController } from "@/hooks/use-runtime-settings-nklein-mcp-controller";
import type { RuntimeAgentId, RuntimeNKleinMcpServer, RuntimeNKleinMcpServerAuthStatus } from "@/runtime/types";

const fetchNKleinMcpSettingsMock = vi.hoisted(() => vi.fn());
const fetchNKleinMcpAuthStatusesMock = vi.hoisted(() => vi.fn());
const runNKleinMcpServerOAuthMock = vi.hoisted(() => vi.fn());
const saveNKleinMcpSettingsMock = vi.hoisted(() => vi.fn());

vi.mock("@/runtime/runtime-config-query", () => ({
	fetchNKleinMcpAuthStatuses: fetchNKleinMcpAuthStatusesMock,
	fetchNKleinMcpSettings: fetchNKleinMcpSettingsMock,
	runNKleinMcpServerOAuth: runNKleinMcpServerOAuthMock,
	saveNKleinMcpSettings: saveNKleinMcpSettingsMock,
}));

interface HookSnapshot {
	mcpSettingsPath: string;
	mcpServers: RuntimeNKleinMcpServer[];
	hasUnsavedChanges: boolean;
	isLoadingMcpSettings: boolean;
	authenticatingMcpServerName: string | null;
	setMcpServers: (next: RuntimeNKleinMcpServer[]) => void;
	addMcpServer: (server: RuntimeNKleinMcpServer) => Promise<{ ok: boolean; message?: string }>;
	saveMcpSettings: () => Promise<{ ok: boolean; message?: string }>;
	runMcpServerOauth: (serverName: string) => Promise<{ ok: boolean; message?: string }>;
}

function requireSnapshot(snapshot: HookSnapshot | null): HookSnapshot {
	if (!snapshot) {
		throw new Error("Expected hook snapshot.");
	}
	return snapshot;
}

async function flushAsyncWork(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
}

function HookHarness({
	open,
	workspaceId,
	selectedAgentId,
	liveAuthStatuses = null,
	onSnapshot,
}: {
	open: boolean;
	workspaceId: string | null;
	selectedAgentId: RuntimeAgentId;
	liveAuthStatuses?: RuntimeNKleinMcpServerAuthStatus[] | null;
	onSnapshot: (snapshot: HookSnapshot) => void;
}): null {
	const state = useRuntimeSettingsNKleinMcpController({
		open,
		workspaceId,
		selectedAgentId,
		liveAuthStatuses,
	});

	useEffect(() => {
		onSnapshot({
			mcpSettingsPath: state.mcpSettingsPath,
			mcpServers: state.mcpServers,
			hasUnsavedChanges: state.hasUnsavedChanges,
			isLoadingMcpSettings: state.isLoadingMcpSettings,
			authenticatingMcpServerName: state.authenticatingMcpServerName,
			setMcpServers: (next) => {
				state.setMcpServers(next);
			},
			addMcpServer: state.addMcpServer,
			saveMcpSettings: state.saveMcpSettings,
			runMcpServerOauth: state.runMcpServerOauth,
		});
	}, [onSnapshot, state]);

	return null;
}

describe("useRuntimeSettingsNKleinMcpController", () => {
	let container: HTMLDivElement;
	let root: Root;
	let previousActEnvironment: boolean | undefined;

	beforeEach(() => {
		fetchNKleinMcpSettingsMock.mockReset();
		fetchNKleinMcpAuthStatusesMock.mockReset();
		runNKleinMcpServerOAuthMock.mockReset();
		saveNKleinMcpSettingsMock.mockReset();
		fetchNKleinMcpSettingsMock.mockResolvedValue({
			path: "/tmp/nklein_mcp_settings.json",
			servers: [],
		});
		fetchNKleinMcpAuthStatusesMock.mockResolvedValue({
			statuses: [],
		});
		runNKleinMcpServerOAuthMock.mockResolvedValue({
			serverName: "linear",
			authorized: true,
			message: "Authorized",
		});
		saveNKleinMcpSettingsMock.mockResolvedValue({
			path: "/tmp/nklein_mcp_settings.json",
			servers: [],
		});
		previousActEnvironment = (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
			.IS_REACT_ACT_ENVIRONMENT;
		(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		container.remove();
		if (previousActEnvironment === undefined) {
			delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
		} else {
			(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
				previousActEnvironment;
		}
	});

	it("loads MCP settings when NKlein is selected", async () => {
		let latestSnapshot: HookSnapshot | null = null;
		fetchNKleinMcpSettingsMock.mockResolvedValue({
			path: "/tmp/nklein_mcp_settings.json",
			servers: [
				{
					name: "linear",
					disabled: false,
					type: "streamableHttp",
					url: "https://mcp.linear.app/mcp",
				},
			],
		});

		await act(async () => {
			root.render(
				<HookHarness
					open={true}
					workspaceId="workspace-1"
					selectedAgentId="nklein"
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
			await flushAsyncWork();
		});

		await act(async () => {
			await flushAsyncWork();
		});

		expect(fetchNKleinMcpSettingsMock).toHaveBeenCalledWith("workspace-1");
		expect(fetchNKleinMcpAuthStatusesMock).toHaveBeenCalledWith("workspace-1");
		expect(requireSnapshot(latestSnapshot).mcpSettingsPath).toBe("/tmp/nklein_mcp_settings.json");
		expect(requireSnapshot(latestSnapshot).mcpServers).toHaveLength(1);
		expect(requireSnapshot(latestSnapshot).hasUnsavedChanges).toBe(false);
	});

	it("tracks unsaved MCP changes and persists them", async () => {
		let latestSnapshot: HookSnapshot | null = null;
		fetchNKleinMcpSettingsMock.mockResolvedValue({
			path: "/tmp/nklein_mcp_settings.json",
			servers: [],
		});
		saveNKleinMcpSettingsMock.mockResolvedValue({
			path: "/tmp/nklein_mcp_settings.json",
			servers: [
				{
					name: "linear",
					disabled: false,
					type: "streamableHttp",
					url: "https://mcp.linear.app/mcp",
				},
			],
		});

		await act(async () => {
			root.render(
				<HookHarness
					open={true}
					workspaceId={null}
					selectedAgentId="nklein"
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
			await flushAsyncWork();
		});

		await act(async () => {
			requireSnapshot(latestSnapshot).setMcpServers([
				{
					name: "linear",
					disabled: false,
					type: "streamableHttp",
					url: "https://mcp.linear.app/mcp",
				},
			]);
			await flushAsyncWork();
		});

		expect(requireSnapshot(latestSnapshot).hasUnsavedChanges).toBe(true);

		await act(async () => {
			expect(await requireSnapshot(latestSnapshot).saveMcpSettings()).toEqual({ ok: true });
		});

		expect(saveNKleinMcpSettingsMock).toHaveBeenCalledWith(null, {
			servers: [
				{
					name: "linear",
					disabled: false,
					type: "streamableHttp",
					url: "https://mcp.linear.app/mcp",
				},
			],
		});
		expect(fetchNKleinMcpAuthStatusesMock).toHaveBeenCalledWith(null);
		expect(requireSnapshot(latestSnapshot).hasUnsavedChanges).toBe(false);
	});

	it("runs MCP OAuth and refreshes auth statuses", async () => {
		let latestSnapshot: HookSnapshot | null = null;
		fetchNKleinMcpSettingsMock.mockResolvedValue({
			path: "/tmp/nklein_mcp_settings.json",
			servers: [
				{
					name: "linear",
					disabled: false,
					type: "streamableHttp",
					url: "https://mcp.linear.app/mcp",
				},
			],
		});
		fetchNKleinMcpAuthStatusesMock
			.mockResolvedValueOnce({
				statuses: [
					{
						serverName: "linear",
						oauthSupported: true,
						oauthConfigured: false,
						lastError: null,
						lastAuthenticatedAt: null,
					},
				],
			})
			.mockResolvedValueOnce({
				statuses: [
					{
						serverName: "linear",
						oauthSupported: true,
						oauthConfigured: true,
						lastError: null,
						lastAuthenticatedAt: 1_700_000_000_000,
					},
				],
			});

		await act(async () => {
			root.render(
				<HookHarness
					open={true}
					workspaceId="workspace-1"
					selectedAgentId="nklein"
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
			await flushAsyncWork();
		});

		await act(async () => {
			expect(await requireSnapshot(latestSnapshot).runMcpServerOauth("linear")).toEqual({ ok: true });
		});

		expect(runNKleinMcpServerOAuthMock).toHaveBeenCalledWith("workspace-1", {
			serverName: "linear",
		});
		expect(fetchNKleinMcpAuthStatusesMock).toHaveBeenCalledTimes(2);
		expect(requireSnapshot(latestSnapshot).authenticatingMcpServerName).toBeNull();
	});

	it("applies live auth status updates while OAuth is still in progress", async () => {
		let latestSnapshot: HookSnapshot | null = null;
		let liveAuthStatuses: RuntimeNKleinMcpServerAuthStatus[] | null = null;
		let resolveOauth: (() => void) | null = null;
		runNKleinMcpServerOAuthMock.mockImplementation(
			() =>
				new Promise((resolve) => {
					resolveOauth = () => {
						resolve({
							serverName: "linear",
							authorized: true,
							message: "Authorized",
						});
					};
				}),
		);
		fetchNKleinMcpSettingsMock.mockResolvedValue({
			path: "/tmp/nklein_mcp_settings.json",
			servers: [
				{
					name: "linear",
					disabled: false,
					type: "streamableHttp",
					url: "https://mcp.linear.app/mcp",
				},
			],
		});
		fetchNKleinMcpAuthStatusesMock.mockResolvedValue({
			statuses: [
				{
					serverName: "linear",
					oauthSupported: true,
					oauthConfigured: false,
					lastError: null,
					lastAuthenticatedAt: null,
				},
			],
		});

		const renderHarness = async () => {
			await act(async () => {
				root.render(
					<HookHarness
						open={true}
						workspaceId="workspace-1"
						selectedAgentId="nklein"
						liveAuthStatuses={liveAuthStatuses}
						onSnapshot={(snapshot) => {
							latestSnapshot = snapshot;
						}}
					/>,
				);
				await flushAsyncWork();
			});
		};

		await renderHarness();

		await act(async () => {
			void requireSnapshot(latestSnapshot).runMcpServerOauth("linear");
			await flushAsyncWork();
		});

		expect(requireSnapshot(latestSnapshot).authenticatingMcpServerName).toBe("linear");

		liveAuthStatuses = [
			{
				serverName: "linear",
				oauthSupported: true,
				oauthConfigured: true,
				lastError: null,
				lastAuthenticatedAt: 1_700_000_000_000,
			},
		];
		await renderHarness();

		expect(requireSnapshot(latestSnapshot).authenticatingMcpServerName).toBeNull();

		await act(async () => {
			resolveOauth?.();
			await flushAsyncWork();
		});
	});

	it("saves unsaved MCP settings before running OAuth", async () => {
		let latestSnapshot: HookSnapshot | null = null;
		fetchNKleinMcpSettingsMock.mockResolvedValue({
			path: "/tmp/nklein_mcp_settings.json",
			servers: [
				{
					name: "linear",
					disabled: false,
					type: "streamableHttp",
					url: "https://old.linear.app/mcp",
				},
			],
		});
		saveNKleinMcpSettingsMock.mockResolvedValue({
			path: "/tmp/nklein_mcp_settings.json",
			servers: [
				{
					name: "linear",
					disabled: false,
					type: "streamableHttp",
					url: "https://mcp.linear.app/mcp",
				},
			],
		});

		await act(async () => {
			root.render(
				<HookHarness
					open={true}
					workspaceId="workspace-1"
					selectedAgentId="nklein"
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
			await flushAsyncWork();
		});

		await act(async () => {
			requireSnapshot(latestSnapshot).setMcpServers([
				{
					name: "linear",
					disabled: false,
					type: "streamableHttp",
					url: "https://mcp.linear.app/mcp",
				},
			]);
			await flushAsyncWork();
		});

		await act(async () => {
			expect(await requireSnapshot(latestSnapshot).runMcpServerOauth("linear")).toEqual({ ok: true });
		});

		expect(saveNKleinMcpSettingsMock).toHaveBeenCalledBefore(runNKleinMcpServerOAuthMock);
		expect(saveNKleinMcpSettingsMock).toHaveBeenCalledWith("workspace-1", {
			servers: [
				{
					name: "linear",
					disabled: false,
					type: "streamableHttp",
					url: "https://mcp.linear.app/mcp",
				},
			],
		});
		expect(runNKleinMcpServerOAuthMock).toHaveBeenCalledWith("workspace-1", {
			serverName: "linear",
		});
	});

	it("does not load MCP settings when a non-NKlein agent is selected", async () => {
		let latestSnapshot: HookSnapshot | null = null;

		await act(async () => {
			root.render(
				<HookHarness
					open={true}
					workspaceId="workspace-1"
					selectedAgentId="claude"
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
			await flushAsyncWork();
		});

		expect(fetchNKleinMcpSettingsMock).not.toHaveBeenCalled();
		expect(fetchNKleinMcpAuthStatusesMock).not.toHaveBeenCalled();
		expect(requireSnapshot(latestSnapshot).mcpServers).toEqual([]);
		expect(requireSnapshot(latestSnapshot).hasUnsavedChanges).toBe(false);
	});

	it("adds and persists an MCP server suggestion by name", async () => {
		let latestSnapshot: HookSnapshot | null = null;
		fetchNKleinMcpSettingsMock.mockResolvedValue({
			path: "/tmp/nklein_mcp_settings.json",
			servers: [
				{
					name: "linear",
					disabled: false,
					type: "streamableHttp",
					url: "https://mcp.linear.app/mcp",
				},
			],
		});
		saveNKleinMcpSettingsMock.mockResolvedValue({
			path: "/tmp/nklein_mcp_settings.json",
			servers: [
				{
					name: "github",
					disabled: false,
					type: "streamableHttp",
					url: "https://mcp.github.com/mcp",
				},
				{
					name: "linear",
					disabled: false,
					type: "streamableHttp",
					url: "https://mcp.linear.app/mcp",
				},
			],
		});

		await act(async () => {
			root.render(
				<HookHarness
					open={true}
					workspaceId="workspace-1"
					selectedAgentId="nklein"
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
			await flushAsyncWork();
		});

		await act(async () => {
			await flushAsyncWork();
		});

		await act(async () => {
			expect(
				await requireSnapshot(latestSnapshot).addMcpServer({
					name: "github",
					disabled: false,
					type: "streamableHttp",
					url: "https://mcp.github.com/mcp",
				}),
			).toEqual({ ok: true });
		});

		expect(saveNKleinMcpSettingsMock).toHaveBeenCalledWith("workspace-1", {
			servers: [
				{
					name: "github",
					disabled: false,
					type: "streamableHttp",
					url: "https://mcp.github.com/mcp",
				},
				{
					name: "linear",
					disabled: false,
					type: "streamableHttp",
					url: "https://mcp.linear.app/mcp",
				},
			],
		});
		expect(requireSnapshot(latestSnapshot).mcpServers).toEqual([
			{
				name: "github",
				disabled: false,
				type: "streamableHttp",
				url: "https://mcp.github.com/mcp",
			},
			{
				name: "linear",
				disabled: false,
				type: "streamableHttp",
				url: "https://mcp.linear.app/mcp",
			},
		]);
	});
});
