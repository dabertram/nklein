import { summarizeTrayActivity, type TrayState } from "./tray-menu.js";

export const WORKSPACE_ID_HEADER = "x-nklein-workspace-id";
export const DESKTOP_TRAY_PAUSE_REASON = "Paused from !Klein desktop tray";

export interface RuntimeControlFetchResponse {
	status: number;
	json(): Promise<unknown>;
}

export interface RuntimeControlFetchInit {
	method: "GET" | "POST";
	headers: Record<string, string>;
	body?: string;
	signal?: AbortSignal;
}

export type RuntimeControlFetch = (
	url: string,
	init: RuntimeControlFetchInit,
) => Promise<RuntimeControlFetchResponse>;

export interface RuntimeControlRequestOptions {
	signal?: AbortSignal;
}

export interface DesktopRuntimeControlClient {
	getTrayState(workspaceId: string, options?: RuntimeControlRequestOptions): Promise<TrayState>;
	togglePause(workspaceId: string, options?: RuntimeControlRequestOptions): Promise<TrayState>;
}

export interface CreateDesktopRuntimeControlClientOptions {
	baseUrl: string;
	fetch?: RuntimeControlFetch;
}

type TrpcProcedureType = "query" | "mutation";

interface TrpcCallOptions {
	workspaceId: string;
	procedure: string;
	type: TrpcProcedureType;
	input?: unknown;
	signal?: AbortSignal;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function unwrapTrpcPayload(value: unknown): unknown {
	const envelope = Array.isArray(value) ? value[0] : value;
	if (!isRecord(envelope)) {
		return value;
	}
	if ("result" in envelope) {
		const result = envelope.result;
		if (!isRecord(result)) {
			return undefined;
		}
		const data = result.data;
		if (isRecord(data) && "json" in data) {
			return data.json;
		}
		return data;
	}
	if ("error" in envelope) {
		return envelope.error;
	}
	return value;
}

function readErrorMessage(payload: unknown): string | null {
	if (!isRecord(payload)) {
		return null;
	}
	const message = payload.message;
	if (typeof message === "string" && message.trim()) {
		return message;
	}
	const error = payload.error;
	if (isRecord(error) && typeof error.message === "string" && error.message.trim()) {
		return error.message;
	}
	return null;
}

function isSuccessStatus(status: number): boolean {
	return status >= 200 && status < 300;
}

function buildTrpcProcedureUrl(baseUrl: string, procedure: string): URL {
	const url = new URL(baseUrl);
	url.pathname = `/api/trpc/${procedure}`;
	url.search = "";
	url.hash = "";
	return url;
}

function createDefaultFetch(): RuntimeControlFetch {
	return async (url, init) => {
		if (typeof globalThis.fetch !== "function") {
			throw new Error("global fetch is not available");
		}
		return (await globalThis.fetch(url, init)) as RuntimeControlFetchResponse;
	};
}

export function countInProgressCards(workspaceState: unknown): number {
	if (!isRecord(workspaceState)) {
		return 0;
	}
	const board = workspaceState.board;
	if (!isRecord(board) || !Array.isArray(board.columns)) {
		return 0;
	}
	const column = board.columns.find(
		(candidate) => isRecord(candidate) && candidate.id === "in_progress",
	);
	if (!isRecord(column) || !Array.isArray(column.cards)) {
		return 0;
	}
	return column.cards.length;
}

export function isSwarmStopPaused(response: unknown): boolean {
	if (!isRecord(response)) {
		return false;
	}
	const signal = response.signal;
	return isRecord(signal) && signal.stopped === true;
}

function assertSwarmStopOk(response: unknown): void {
	if (!isRecord(response) || response.ok !== false) {
		return;
	}
	const error = typeof response.error === "string" && response.error.trim() ? response.error : null;
	throw new Error(error ?? "Runtime pause command failed");
}

export function resolveTrayWorkspaceId(input: {
	entryProjectId: string | null;
	currentUrl: string;
	runtimeUrl: string | null;
}): string | null {
	if (input.entryProjectId && input.entryProjectId.trim()) {
		return input.entryProjectId;
	}
	if (!input.currentUrl || !input.runtimeUrl) {
		return null;
	}
	let current: URL;
	let runtime: URL;
	try {
		current = new URL(input.currentUrl);
		runtime = new URL(input.runtimeUrl);
	} catch {
		return null;
	}
	if (current.origin !== runtime.origin) {
		return null;
	}
	const rawSegment = current.pathname.split("/").filter(Boolean)[0];
	if (!rawSegment) {
		return null;
	}
	try {
		const decoded = decodeURIComponent(rawSegment);
		return decoded.trim() ? decoded : null;
	} catch {
		return null;
	}
}

export function createDesktopRuntimeControlClient(
	options: CreateDesktopRuntimeControlClientOptions,
): DesktopRuntimeControlClient {
	const fetchImpl = options.fetch ?? createDefaultFetch();

	async function callTrpc<T>(call: TrpcCallOptions): Promise<T> {
		const url = buildTrpcProcedureUrl(options.baseUrl, call.procedure);
		const headers: Record<string, string> = {
			[WORKSPACE_ID_HEADER]: call.workspaceId,
		};
		let body: string | undefined;
		if (call.type === "query") {
			if (call.input !== undefined) {
				url.searchParams.set("input", JSON.stringify(call.input));
			}
		} else if (call.input !== undefined) {
			headers["content-type"] = "application/json";
			body = JSON.stringify(call.input);
		}

		const response = await fetchImpl(url.toString(), {
			method: call.type === "query" ? "GET" : "POST",
			headers,
			...(body !== undefined ? { body } : {}),
			...(call.signal ? { signal: call.signal } : {}),
		});
		const payload = unwrapTrpcPayload(await response.json().catch(() => null));
		const errorMessage = readErrorMessage(payload);
		if (!isSuccessStatus(response.status) || errorMessage) {
			throw new Error(errorMessage ?? `Runtime request failed with HTTP ${response.status}`);
		}
		return payload as T;
	}

	async function getPauseState(workspaceId: string, requestOptions?: RuntimeControlRequestOptions): Promise<boolean> {
		const response = await callTrpc<unknown>({
			workspaceId,
			procedure: "runtime.getSwarmStop",
			type: "query",
			signal: requestOptions?.signal,
		});
		return isSwarmStopPaused(response);
	}

	async function getRunningCardCount(
		workspaceId: string,
		requestOptions?: RuntimeControlRequestOptions,
	): Promise<number> {
		const workspaceState = await callTrpc<unknown>({
			workspaceId,
			procedure: "workspace.getState",
			type: "query",
			signal: requestOptions?.signal,
		});
		return countInProgressCards(workspaceState);
	}

	async function getTrayState(workspaceId: string, requestOptions?: RuntimeControlRequestOptions): Promise<TrayState> {
		const [paused, runningCards] = await Promise.all([
			getPauseState(workspaceId, requestOptions),
			getRunningCardCount(workspaceId, requestOptions),
		]);
		return {
			paused,
			activitySummary: summarizeTrayActivity(runningCards),
		};
	}

	async function togglePause(
		workspaceId: string,
		requestOptions?: RuntimeControlRequestOptions,
	): Promise<TrayState> {
		const paused = await getPauseState(workspaceId, requestOptions);
		const response = await callTrpc<unknown>({
			workspaceId,
			procedure: paused ? "runtime.clearSwarmStop" : "runtime.requestSwarmStop",
			type: "mutation",
			input: paused ? undefined : { reason: DESKTOP_TRAY_PAUSE_REASON },
			signal: requestOptions?.signal,
		});
		assertSwarmStopOk(response);
		const runningCards = await getRunningCardCount(workspaceId, requestOptions);
		return {
			paused: !paused,
			activitySummary: summarizeTrayActivity(runningCards),
		};
	}

	return {
		getTrayState,
		togglePause,
	};
}
