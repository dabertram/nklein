import { Database, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { fetchClineCodeIntelligenceStatus } from "@/runtime/runtime-config-query";
import type { RuntimeClineCodeIntelligenceStatusResponse } from "@/runtime/types";

function formatCodeIntelligenceUpdatedAt(updatedAt: number | null): string {
	if (updatedAt === null) {
		return "never";
	}
	const elapsedMs = Math.max(0, Date.now() - updatedAt);
	const minutes = Math.floor(elapsedMs / 60_000);
	if (minutes < 1) {
		return "<1m ago";
	}
	if (minutes < 60) {
		return `${minutes}m ago`;
	}
	const hours = Math.floor(minutes / 60);
	if (hours < 48) {
		return `${hours}h ago`;
	}
	return `${Math.floor(hours / 24)}d ago`;
}

function formatCodeIndexCoverage(status: RuntimeClineCodeIntelligenceStatusResponse["codeIndex"]): string {
	if (status.totalChunks === 0) {
		return "No source chunks found";
	}
	const percent = Math.round((status.indexedChunks / status.totalChunks) * 100);
	return `${status.indexedChunks}/${status.totalChunks} chunks (${percent}%)`;
}

function formatCodeIndexProgress(status: RuntimeClineCodeIntelligenceStatusResponse["codeIndex"]): string | null {
	const progress = status.progress;
	if (progress.phase === "idle" || progress.phase === "complete") {
		return null;
	}
	if (progress.phase === "scanning") {
		return `Scanning ${progress.filesProcessed}/${progress.filesTotal} files`;
	}
	if (progress.phase === "embedding") {
		return `Indexing ${progress.chunksProcessed}/${progress.chunksTotal} chunks`;
	}
	if (progress.phase === "persisting") {
		return "Writing code-index cache";
	}
	return progress.message ? `Indexing error: ${progress.message}` : "Indexing error";
}

function isCodeIndexProgressActive(status: RuntimeClineCodeIntelligenceStatusResponse["codeIndex"] | null): boolean {
	return (
		status?.progress.phase === "scanning" ||
		status?.progress.phase === "embedding" ||
		status?.progress.phase === "persisting"
	);
}

function formatEmbeddingProvider(provider: string | null): string {
	if (provider === "local_lexical") {
		return "Local lexical fallback";
	}
	if (provider === "openai_compatible") {
		return "OpenAI-compatible embeddings";
	}
	return provider ?? "none";
}

function formatEmbeddingSettings(
	settings: RuntimeClineCodeIntelligenceStatusResponse["codeEmbeddingSettings"]["effective"],
): string {
	if (settings.provider === "local_lexical") {
		return "Local lexical fallback";
	}
	return `${settings.model ?? "No model"} at ${settings.baseUrl ?? "no endpoint"}`;
}

export function CodeIntelligencePanel({
	workspaceId,
	active,
	disabled,
	onError,
	compact = false,
}: {
	workspaceId: string | null;
	active: boolean;
	disabled: boolean;
	onError: (message: string | null) => void;
	compact?: boolean;
}): React.ReactElement | null {
	const [isLoading, setIsLoading] = useState(false);
	const [status, setStatus] = useState<RuntimeClineCodeIntelligenceStatusResponse | null>(null);
	const [detailsOpen, setDetailsOpen] = useState(false);

	const refreshStatus = useCallback(() => {
		if (!active || !workspaceId) {
			return;
		}
		onError(null);
		setIsLoading(true);
		void fetchClineCodeIntelligenceStatus(workspaceId)
			.then((response) => {
				setStatus(response);
			})
			.catch((error) => {
				const message = error instanceof Error ? error.message : String(error);
				onError(`Could not load code intelligence status: ${message}`);
			})
			.finally(() => {
				setIsLoading(false);
			});
	}, [active, onError, workspaceId]);

	useEffect(() => {
		refreshStatus();
	}, [refreshStatus]);

	const codeIndex = status?.codeIndex ?? null;
	const repoMap = status?.repoMap ?? null;
	useEffect(() => {
		if (!active || !isCodeIndexProgressActive(codeIndex)) {
			return;
		}
		const timeoutId = window.setTimeout(refreshStatus, 1500);
		return () => {
			window.clearTimeout(timeoutId);
		};
	}, [active, codeIndex, refreshStatus]);

	if (!workspaceId) {
		return null;
	}

	const progressText = codeIndex ? formatCodeIndexProgress(codeIndex) : null;
	const statusText = codeIndex
		? `${progressText ?? `${formatCodeIndexCoverage(codeIndex)} indexed`} · repo map ${
				repoMap?.available ? "ready" : "unavailable"
			}`
		: "Status not loaded";

	return (
		<div
			className={
				compact
					? "mt-2 rounded-md border border-border bg-surface-2 px-3 py-2.5"
					: "mt-4 border-t border-border pt-4"
			}
		>
			<div className="flex items-center justify-between gap-3">
				<div className="min-w-0">
					<h6 className="m-0 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-text-secondary">
						<Database size={14} />
						Code intelligence
					</h6>
					<p className="mt-1 mb-0 text-[12px] text-text-secondary">{statusText}</p>
				</div>
				<div className="flex items-center gap-2">
					<Button
						size="sm"
						variant="ghost"
						disabled={disabled || !status}
						onClick={() => {
							setDetailsOpen((currentValue) => !currentValue);
						}}
					>
						Details
					</Button>
					<Button
						size="sm"
						variant="default"
						icon={<RefreshCw size={14} />}
						disabled={disabled || isLoading || !workspaceId}
						onClick={refreshStatus}
					>
						{isLoading ? "Refreshing..." : "Refresh"}
					</Button>
				</div>
			</div>
			{status ? (
				<div className="mt-2 grid gap-2 text-[12px] text-text-secondary">
					<div className="rounded-md border border-border bg-surface-1 px-2 py-2">
						<div className="font-medium text-text-primary">Repo map</div>
						<div>{repoMap?.filesScanned ?? 0} files scanned</div>
						<div>{repoMap?.symbols ?? 0} symbols</div>
						<div>{repoMap?.truncated ? "Truncated" : "Within token budget"}</div>
					</div>
					<div className="rounded-md border border-border bg-surface-1 px-2 py-2">
						<div className="font-medium text-text-primary">Code index</div>
						<div>{codeIndex ? formatCodeIndexCoverage(codeIndex) : "Not loaded"}</div>
						<div>
							{codeIndex?.indexedFiles ?? 0}/{codeIndex?.totalFiles ?? 0} files indexed
						</div>
						<div>Updated {formatCodeIntelligenceUpdatedAt(codeIndex?.updatedAt ?? null)}</div>
						<div>{formatEmbeddingProvider(codeIndex?.embeddingProvider ?? null)}</div>
						<div>
							Config: {status.codeEmbeddingSettings.source === "project" ? "Project override" : "Global default"}
						</div>
					</div>
				</div>
			) : null}
			{detailsOpen && status ? (
				<div className="mt-2 rounded-md border border-border bg-surface-1 px-2 py-2 text-[12px] text-text-secondary">
					<div>Search: {status.codeIndex.searchAvailable ? "available" : "not ready"}</div>
					<div>
						Progress: {status.codeIndex.progress.phase}
						{status.codeIndex.progress.message ? ` (${status.codeIndex.progress.message})` : ""}
					</div>
					<div>
						Indexed this run: {status.codeIndex.progress.chunksProcessed}/{status.codeIndex.progress.chunksTotal}{" "}
						chunks, {status.codeIndex.progress.filesProcessed}/{status.codeIndex.progress.filesTotal} files
					</div>
					<div>
						Cache this run: {status.codeIndex.progress.cacheHitCount} hits /{" "}
						{status.codeIndex.progress.cacheMissCount} misses
					</div>
					<div>Stale files: {status.codeIndex.staleFiles}</div>
					<div>Missing files: {status.codeIndex.missingFiles}</div>
					<div>
						Embedding: {formatEmbeddingProvider(status.codeIndex.embeddingProvider)} /{" "}
						{status.codeIndex.embeddingModel ?? "none"}
					</div>
					<div>Effective config: {formatEmbeddingSettings(status.codeEmbeddingSettings.effective)}</div>
					<div>Config source: {status.codeEmbeddingSettings.source}</div>
					<div className="break-all">Cache: {status.codeIndex.cachePath ?? "none"}</div>
					{status.repoMap.error ? (
						<div className="text-status-red">Repo map error: {status.repoMap.error}</div>
					) : null}
					{status.codeIndex.error ? (
						<div className="text-status-red">Code index error: {status.codeIndex.error}</div>
					) : null}
				</div>
			) : null}
		</div>
	);
}
