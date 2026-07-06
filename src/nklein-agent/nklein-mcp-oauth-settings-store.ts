import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import { toErrorMessage } from "../core/error-message";
import { lockedFileSystem } from "../fs/locked-file-system";
import { resolveMcpSettingsPath } from "./nklein-mcp-settings-service";

/**
 * §5.U — the MCP OAuth settings store extracted from `nklein-mcp-runtime-service`: the persisted per-server OAuth state
 * (client registration, tokens, PKCE verifier, discovery state, …) lives in a single JSON file next to the MCP settings.
 * This module owns its schema + the read/normalize/write/transactional-update of that file; the runtime service consumes
 * it. Isolated so the persistence + normalization rules are independently testable.
 */

export const oauthServerStateSchema = z.object({
	clientInformation: z.record(z.string(), z.unknown()).optional(),
	tokens: z.record(z.string(), z.unknown()).optional(),
	codeVerifier: z.string().optional(),
	discoveryState: z.record(z.string(), z.unknown()).optional(),
	redirectUrl: z.string().url().optional(),
	lastError: z.string().optional(),
	lastAuthenticatedAt: z.number().int().positive().optional(),
});

export const oauthSettingsSchema = z.object({
	servers: z.record(z.string(), oauthServerStateSchema).default({}),
});

export type NKleinMcpOauthServerState = z.infer<typeof oauthServerStateSchema>;
export type NKleinMcpOauthSettings = z.infer<typeof oauthSettingsSchema>;

/** The OAuth settings file path — the `NKLEIN_MCP_OAUTH_SETTINGS_PATH` override, else a sibling of the MCP settings file. */
export function resolveMcpOauthSettingsPath(): string {
	const configuredPath = process.env.NKLEIN_MCP_OAUTH_SETTINGS_PATH?.trim();
	if (configuredPath) {
		return resolve(configuredPath);
	}
	return join(dirname(resolveMcpSettingsPath()), "nklein_mcp_oauth_settings.json");
}

/** Drop absent (falsy) fields so the persisted per-server state is minimal and comparably-shaped. */
export function normalizeOauthServerState(value: NKleinMcpOauthServerState): NKleinMcpOauthServerState {
	return {
		...(value.clientInformation ? { clientInformation: value.clientInformation } : {}),
		...(value.tokens ? { tokens: value.tokens } : {}),
		...(value.codeVerifier ? { codeVerifier: value.codeVerifier } : {}),
		...(value.discoveryState ? { discoveryState: value.discoveryState } : {}),
		...(value.redirectUrl ? { redirectUrl: value.redirectUrl } : {}),
		...(value.lastError ? { lastError: value.lastError } : {}),
		...(value.lastAuthenticatedAt ? { lastAuthenticatedAt: value.lastAuthenticatedAt } : {}),
	};
}

/** True when a normalized server state carries nothing worth persisting (so its entry can be pruned). */
export function isEmptyOauthServerState(value: NKleinMcpOauthServerState): boolean {
	return Object.keys(value).length === 0;
}

/** Read + validate the OAuth settings file (missing ⇒ empty); throws with a path-scoped message on bad JSON / shape. */
export function parseOauthSettings(path: string): NKleinMcpOauthSettings {
	if (!existsSync(path)) {
		return {
			servers: {},
		};
	}

	let parsedJson: unknown;
	try {
		parsedJson = JSON.parse(readFileSync(path, "utf8"));
	} catch (error) {
		throw new Error(`Failed to parse MCP OAuth settings JSON at "${path}": ${toErrorMessage(error)}`);
	}

	const parsed = oauthSettingsSchema.safeParse(parsedJson);
	if (!parsed.success) {
		const details = parsed.error.issues
			.map((issue) => {
				const issuePath = issue.path.join(".");
				return issuePath.length > 0 ? `${issuePath}: ${issue.message}` : issue.message;
			})
			.join("; ");
		throw new Error(`Invalid MCP OAuth settings at "${path}": ${details}`);
	}

	return {
		servers: Object.fromEntries(
			Object.entries(parsed.data.servers).map(([name, state]) => [name, normalizeOauthServerState(state)]),
		),
	};
}

/** Atomically persist the OAuth settings under a file lock. */
export async function writeOauthSettings(path: string, settings: NKleinMcpOauthSettings): Promise<void> {
	await lockedFileSystem.writeJsonFileAtomic(path, settings, {
		lock: {
			path,
			type: "file",
		},
	});
}

/**
 * Transactionally update one server's OAuth state: read → apply `updater` → normalize → prune-if-empty → write. Returns
 * the normalized next state.
 */
export async function updateOauthServerState(input: {
	path: string;
	serverName: string;
	updater: (current: NKleinMcpOauthServerState) => NKleinMcpOauthServerState;
}): Promise<NKleinMcpOauthServerState> {
	const settings = parseOauthSettings(input.path);
	const current = settings.servers[input.serverName] ?? {};
	const updated = normalizeOauthServerState(input.updater(current));

	if (isEmptyOauthServerState(updated)) {
		delete settings.servers[input.serverName];
	} else {
		settings.servers[input.serverName] = updated;
	}

	await writeOauthSettings(input.path, settings);
	return updated;
}

/** True when an OAuth token bag carries a non-blank `access_token`. */
export function hasAccessToken(tokens: Record<string, unknown> | undefined): boolean {
	if (!tokens) {
		return false;
	}
	const accessToken = tokens.access_token;
	return typeof accessToken === "string" && accessToken.trim().length > 0;
}
