import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RuntimeNKleinMcpServer } from "../../../src/core/api-contract";
import {
	createNKleinMcpSettingsService,
	resolveMcpSettingsPath,
} from "../../../src/nklein-agent/nklein-mcp-settings-service";

let dir: string;
let settingsPath: string;
const savedEnv = process.env.NKLEIN_MCP_SETTINGS_PATH;
const svc = () => createNKleinMcpSettingsService();

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "nklein-mcp-"));
	settingsPath = join(dir, "settings.json");
	process.env.NKLEIN_MCP_SETTINGS_PATH = settingsPath;
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
	if (savedEnv === undefined) {
		delete process.env.NKLEIN_MCP_SETTINGS_PATH;
	} else {
		process.env.NKLEIN_MCP_SETTINGS_PATH = savedEnv;
	}
});

describe("resolveMcpSettingsPath", () => {
	it("honors NKLEIN_MCP_SETTINGS_PATH", () => {
		expect(resolveMcpSettingsPath()).toBe(settingsPath);
	});

	it("falls back to the default settings path when unset", () => {
		delete process.env.NKLEIN_MCP_SETTINGS_PATH;
		expect(resolveMcpSettingsPath()).toMatch(/[/\\]\.nklein[/\\]data[/\\]settings[/\\]nklein_mcp_settings\.json$/);
	});
});

describe("NKleinMcpSettingsService — save/load round-trip", () => {
	it("loads an empty list when the file does not exist", () => {
		expect(svc().loadSettings()).toEqual({ path: settingsPath, servers: [] });
	});

	it("round-trips + normalizes: trim, sort by name, drop empty args/env entries, persist disabled only when true", async () => {
		const servers: RuntimeNKleinMcpServer[] = [
			{
				name: " zeta ",
				disabled: false,
				type: "stdio",
				command: " run ",
				args: ["a", "  ", "b"],
				env: { " K ": " v ", empty: "  " },
			},
			{ name: "alpha", disabled: true, type: "sse", url: "https://x.example/mcp", headers: { H: "1" } },
		];
		await svc().saveSettings({ servers });

		const loaded = svc().loadSettings();
		expect(loaded.servers.map((s) => s.name)).toEqual(["alpha", "zeta"]); // sorted by name
		const zeta = loaded.servers.find((s) => s.name === "zeta");
		expect(zeta).toMatchObject({ type: "stdio", command: "run", args: ["a", "b"], env: { K: "v" } });
		const alpha = loaded.servers.find((s) => s.name === "alpha");
		expect(alpha).toMatchObject({ type: "sse", url: "https://x.example/mcp", disabled: true });
	});

	it("resolves url server type on load (sse default; transportType http → streamableHttp)", () => {
		writeFileSync(
			settingsPath,
			JSON.stringify({
				mcpServers: {
					legacy: { url: "https://a.example/mcp" },
					httpish: { url: "https://b.example/mcp", transportType: "http" },
				},
			}),
		);
		const byName = Object.fromEntries(
			svc()
				.loadSettings()
				.servers.map((s) => [s.name, s]),
		);
		expect(byName.legacy?.type).toBe("sse");
		expect(byName.httpish?.type).toBe("streamableHttp");
	});

	it("throws a clear error on invalid JSON", () => {
		writeFileSync(settingsPath, "{ not json");
		expect(() => svc().loadSettings()).toThrow(/Failed to parse MCP settings/);
	});

	it("throws a clear error on a schema-invalid server (stdio with no command)", () => {
		writeFileSync(settingsPath, JSON.stringify({ mcpServers: { bad: { disabled: false } } }));
		expect(() => svc().loadSettings()).toThrow(/Invalid MCP settings/);
	});
});
