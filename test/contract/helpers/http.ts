export async function requestJson<T>(input: {
	baseUrl: string;
	procedure: string;
	type: "query" | "mutation";
	workspaceId?: string | null;
	payload?: unknown;
	timeoutMs?: number;
}): Promise<{ status: number; payload: T }> {
	const unwrapTrpcPayload = (value: unknown): unknown => {
		const envelope = Array.isArray(value) ? value[0] : value;
		if (!envelope || typeof envelope !== "object") {
			return value;
		}
		if ("result" in envelope) {
			const result = (envelope as { result?: { data?: unknown } }).result;
			const data = result?.data;
			if (data && typeof data === "object" && "json" in data) {
				return (data as { json: unknown }).json;
			}
			return data;
		}
		if ("error" in envelope) {
			return (envelope as { error: unknown }).error;
		}
		return value;
	};
	const headers = new Headers();
	if (input.workspaceId) {
		headers.set("x-kanban-workspace-id", input.workspaceId);
	}
	// WATCH MODE: a harness that spawned its backend with NKLEIN_WATCH_MODE_MUTATION_TOKEN holds the same
	// token in its own env — attach it so the harness's orchestration mutations pass the read-only gate
	// (browsers on the live-board link don't have it).
	const watchModeToken = process.env.NKLEIN_WATCH_MODE_MUTATION_TOKEN?.trim();
	if (watchModeToken) {
		headers.set("x-nklein-mutation-token", watchModeToken);
	}
	let url = `${input.baseUrl}/api/trpc/${input.procedure}`;
	let method: "GET" | "POST";
	let body: string | undefined;
	if (input.type === "query") {
		method = "GET";
		if (input.payload !== undefined) {
			url += `?input=${encodeURIComponent(JSON.stringify(input.payload))}`;
		}
	} else {
		method = "POST";
		body = input.payload === undefined ? undefined : JSON.stringify(input.payload);
	}
	if (body !== undefined) {
		headers.set("Content-Type", "application/json");
	}
	const response = await fetch(url, {
		method,
		headers,
		body,
		...(input.timeoutMs ? { signal: AbortSignal.timeout(input.timeoutMs) } : {}),
	});
	const payload = unwrapTrpcPayload(await response.json().catch(() => null)) as T;
	return {
		status: response.status,
		payload,
	};
}
