import type { RuntimeAppRouter } from "@runtime-trpc";
import { createTRPCProxyClient, httpBatchLink, httpSubscriptionLink, splitLink, TRPCClientError } from "@trpc/client";

const WORKSPACE_ID_HEADER = "x-nklein-workspace-id";

interface TrpcErrorDataWithConflictRevision {
	code?: string;
	conflictRevision?: number | null;
}

type RuntimeTrpcClient = ReturnType<typeof createTRPCProxyClient<RuntimeAppRouter>>;

const clientByWorkspaceId = new Map<string, RuntimeTrpcClient>();

export function getRuntimeTrpcClient(workspaceId: string | null): RuntimeTrpcClient {
	const key = workspaceId ?? "__unscoped__";
	const existing = clientByWorkspaceId.get(key);
	if (existing) {
		return existing;
	}
	const headers = () => (workspaceId ? { [WORKSPACE_ID_HEADER]: workspaceId } : {});
	const created = createTRPCProxyClient<RuntimeAppRouter>({
		links: [
			// Subscriptions (e.g. chat token streaming, todo §5.M) go over SSE; everything else stays batched HTTP.
			splitLink({
				condition: (op) => op.type === "subscription",
				true: httpSubscriptionLink({ url: "/api/trpc" }),
				false: httpBatchLink({ url: "/api/trpc", headers }),
			}),
		],
	});
	clientByWorkspaceId.set(key, created);
	return created;
}

export function createWorkspaceTrpcClient(workspaceId: string): RuntimeTrpcClient {
	return getRuntimeTrpcClient(workspaceId);
}

function readTrpcErrorData(error: TRPCClientError<RuntimeAppRouter>): TrpcErrorDataWithConflictRevision | null {
	const data = error.data as TrpcErrorDataWithConflictRevision | undefined;
	if (!data || typeof data !== "object") {
		return null;
	}
	return data;
}

export function readTrpcConflictRevision(error: unknown): number | null {
	if (!(error instanceof TRPCClientError)) {
		return null;
	}
	const data = readTrpcErrorData(error);
	if (data?.code !== "CONFLICT") {
		return null;
	}
	return typeof data.conflictRevision === "number" ? data.conflictRevision : null;
}
