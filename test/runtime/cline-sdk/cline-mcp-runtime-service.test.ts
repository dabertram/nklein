import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
	createClineMcpRuntimeService,
	handleClineMcpOauthCallback,
	startOauthCallbackListener,
} from "../../../src/cline-sdk/cline-mcp-runtime-service";
import { setKanbanRuntimePort } from "../../../src/core/runtime-endpoint";

describe("cline-mcp-runtime-service OAuth callback handling", () => {
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

			const response = await handleClineMcpOauthCallback(callbackUrl);
			expect(response).toEqual({
				statusCode: 200,
				body: "<html><body><h1>Authorization complete</h1><p>You can close this tab and return to Cline.</p></body></html>",
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

			const firstResponse = await handleClineMcpOauthCallback(callbackUrl);
			const secondResponse = await handleClineMcpOauthCallback(callbackUrl);

			expect(firstResponse).toEqual({
				statusCode: 200,
				body: "<html><body><h1>Authorization complete</h1><p>You can close this tab and return to Cline.</p></body></html>",
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

			const firstResponse = await handleClineMcpOauthCallback(callbackUrl);
			const secondResponse = await handleClineMcpOauthCallback(callbackUrl);

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

describe("createClineMcpRuntimeService", () => {
	const originalMcpSettingsPath = process.env.CLINE_MCP_SETTINGS_PATH;
	const originalMcpOauthSettingsPath = process.env.CLINE_MCP_OAUTH_SETTINGS_PATH;
	let tempDir: string | null = null;

	beforeEach(async () => {
		tempDir = await mkdtemp(join(tmpdir(), "nklein-mcp-runtime-"));
		process.env.CLINE_MCP_SETTINGS_PATH = join(tempDir, "mcp-settings.json");
		process.env.CLINE_MCP_OAUTH_SETTINGS_PATH = join(tempDir, "mcp-oauth-settings.json");
	});

	afterEach(async () => {
		if (originalMcpSettingsPath === undefined) {
			delete process.env.CLINE_MCP_SETTINGS_PATH;
		} else {
			process.env.CLINE_MCP_SETTINGS_PATH = originalMcpSettingsPath;
		}
		if (originalMcpOauthSettingsPath === undefined) {
			delete process.env.CLINE_MCP_OAUTH_SETTINGS_PATH;
		} else {
			process.env.CLINE_MCP_OAUTH_SETTINGS_PATH = originalMcpOauthSettingsPath;
		}
		if (tempDir) {
			await rm(tempDir, { recursive: true, force: true });
			tempDir = null;
		}
	});

	it("does not spawn stdio MCP servers under strict isolation", async () => {
		if (!process.env.CLINE_MCP_SETTINGS_PATH) {
			throw new Error("Expected MCP settings path to be configured.");
		}
		await writeFile(
			process.env.CLINE_MCP_SETTINGS_PATH,
			JSON.stringify({
				mcpServers: {
					local: {
						type: "stdio",
						command: "definitely-not-a-real-mcp-command",
					},
				},
			}),
		);
		const service = createClineMcpRuntimeService();

		const bundle = await service.createToolBundle();

		expect(bundle.tools).toEqual([]);
		expect(bundle.warnings).toEqual([
			'MCP local execution is disabled under strict isolation. Skipped stdio MCP server "local".',
		]);
		await bundle.dispose();
	});
});
