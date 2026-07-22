import { Search, ShieldAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	approveCommunitySkillImport,
	discoverCommunitySkills,
	listCommunitySkillImports,
	reviewCommunitySkillImport,
} from "@/runtime/queries/community-skills";
import type {
	RuntimeCommunitySkillDiscoveryResponse,
	RuntimeCommunitySkillImportApproveResponse,
	RuntimeCommunitySkillImportListResponse,
	RuntimeCommunitySkillImportReviewResponse,
} from "@/runtime/types";

export interface CommunitySkillImportPanelApi {
	discover: typeof discoverCommunitySkills;
	list: typeof listCommunitySkillImports;
	review: typeof reviewCommunitySkillImport;
	approve: typeof approveCommunitySkillImport;
}

const DEFAULT_API: CommunitySkillImportPanelApi = {
	discover: discoverCommunitySkills,
	list: listCommunitySkillImports,
	review: reviewCommunitySkillImport,
	approve: approveCommunitySkillImport,
};

function messageFor(error: unknown): string {
	return error instanceof Error ? error.message : "The community-skill operation failed.";
}

function JsonDetails({ label, value }: { label: string; value: unknown }) {
	return (
		<details className="rounded border border-border bg-surface-2 px-2 py-1.5">
			<summary className="cursor-pointer text-[12px] font-medium text-text-primary">{label}</summary>
			<pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-all text-[11px] text-text-secondary">
				{JSON.stringify(value, null, 2)}
			</pre>
		</details>
	);
}

export function CommunitySkillImportPanel({
	workspaceId,
	open,
	api = DEFAULT_API,
}: {
	workspaceId: string | null;
	open: boolean;
	api?: CommunitySkillImportPanelApi;
}) {
	const [listing, setListing] = useState<RuntimeCommunitySkillImportListResponse | null>(null);
	const [directory, setDirectory] = useState("");
	const [sourceUrl, setSourceUrl] = useState("");
	const [query, setQuery] = useState("");
	const [includeUntrusted, setIncludeUntrusted] = useState(false);
	const [discovery, setDiscovery] = useState<RuntimeCommunitySkillDiscoveryResponse | null>(null);
	const [review, setReview] = useState<RuntimeCommunitySkillImportReviewResponse | null>(null);
	const [approval, setApproval] = useState<RuntimeCommunitySkillImportApproveResponse | null>(null);
	const [confirmed, setConfirmed] = useState(false);
	const [busy, setBusy] = useState<"list" | "search" | "review" | "approve" | null>(null);
	const [error, setError] = useState<string | null>(null);

	const refresh = useCallback(async () => {
		setBusy("list");
		setError(null);
		try {
			const next = await api.list(workspaceId);
			setListing(next);
			setDirectory(
				(current) => current || next.candidates.find((candidate) => candidate.selectable)?.directory || "",
			);
		} catch (nextError) {
			setError(messageFor(nextError));
		} finally {
			setBusy(null);
		}
	}, [api, workspaceId]);

	useEffect(() => {
		if (open) void refresh();
	}, [open, refresh]);

	const invalidateReview = () => {
		setReview(null);
		setApproval(null);
		setConfirmed(false);
	};

	const runSearch = async () => {
		setBusy("search");
		setError(null);
		try {
			setDiscovery(await api.discover(workspaceId, { query, includeUntrusted }));
		} catch (nextError) {
			setError(messageFor(nextError));
		} finally {
			setBusy(null);
		}
	};

	const runReview = async () => {
		setBusy("review");
		setError(null);
		setApproval(null);
		setConfirmed(false);
		try {
			setReview(await api.review(workspaceId, { directory, sourceUrl }));
		} catch (nextError) {
			setReview(null);
			setError(messageFor(nextError));
		} finally {
			setBusy(null);
		}
	};

	const runApprove = async () => {
		if (!review || !confirmed) return;
		setBusy("approve");
		setError(null);
		try {
			const result = await api.approve(workspaceId, {
				directory,
				sourceUrl,
				expectedContentHash: review.contentHash,
				confirmation: true,
			});
			setApproval(result);
			setConfirmed(false);
			setReview(await api.review(workspaceId, { directory, sourceUrl }));
		} catch (nextError) {
			setError(messageFor(nextError));
		} finally {
			setBusy(null);
		}
	};

	return (
		<div className="rounded-lg border border-border bg-surface-0 px-4 py-3">
			<div className="flex items-start gap-2">
				<ShieldAlert size={16} className="mt-0.5 shrink-0 text-status-yellow" />
				<div>
					<h6 className="m-0 text-[12px] font-semibold uppercase tracking-wider text-text-secondary">
						Community skill import
					</h6>
					<p className="mt-1 mb-0 text-[11px] text-text-tertiary">
						Discovery is metadata-only. Review reads a local staged bundle as inert bytes. Import pins the exact
						SHA-256 and creates a quarantined snapshot; it does not activate or execute the skill.
					</p>
				</div>
			</div>

			<div className="mt-3 grid gap-2 rounded-md border border-border bg-surface-1 p-3">
				<label className="text-[12px] text-text-secondary" htmlFor="community-skill-search">
					Browse trusted registries
				</label>
				<div className="flex gap-2">
					<input
						id="community-skill-search"
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						placeholder="e.g. repository review"
						className="min-w-0 flex-1 rounded border border-border bg-surface-2 px-2 py-1 text-[12px] text-text-primary"
					/>
					<Button
						size="sm"
						icon={<Search size={13} />}
						disabled={!query.trim() || busy !== null}
						onClick={runSearch}
					>
						Search
					</Button>
				</div>
				<label className="flex items-center gap-2 text-[11px] text-text-secondary">
					<input
						type="checkbox"
						checked={includeUntrusted}
						onChange={(event) => setIncludeUntrusted(event.target.checked)}
					/>
					Include independent community indexes (always full-review)
				</label>
				{discovery ? (
					<div className="grid gap-1">
						{discovery.results.map((result) => (
							<button
								type="button"
								key={`${result.discoveredVia.id}:${result.sourceUrl}`}
								onClick={() => {
									setSourceUrl(result.sourceUrl);
									invalidateReview();
								}}
								className="rounded border border-border bg-surface-2 px-2 py-1.5 text-left text-[11px] hover:bg-surface-3"
							>
								<span className="block font-medium text-text-primary">{result.title}</span>
								<span className="block break-all text-text-tertiary">
									{result.sourceTrust} · via {result.discoveredVia.label} · {result.sourceUrl}
								</span>
							</button>
						))}
						{discovery.failures.map((failure) => (
							<p key={failure.originId} className="m-0 text-[11px] text-status-yellow">
								{failure.originId}: {failure.code}
							</p>
						))}
					</div>
				) : null}
			</div>

			<div className="mt-3 grid gap-2">
				<div className="flex items-center justify-between gap-2">
					<p className="m-0 break-all text-[11px] text-text-tertiary">
						Stage one skill directory in: {listing?.inboxPath ?? "loading…"}
					</p>
					<Button size="sm" variant="ghost" disabled={busy !== null} onClick={refresh}>
						Refresh
					</Button>
				</div>
				<label className="text-[12px] text-text-secondary" htmlFor="community-skill-directory">
					Staged directory
				</label>
				<select
					id="community-skill-directory"
					value={directory}
					onChange={(event) => {
						setDirectory(event.target.value);
						invalidateReview();
					}}
					className="rounded border border-border bg-surface-2 px-2 py-1 text-[12px] text-text-primary"
				>
					<option value="">Select a staged skill…</option>
					{listing?.candidates.map((candidate) => (
						<option key={candidate.directory} value={candidate.directory} disabled={!candidate.selectable}>
							{candidate.directory}
							{candidate.selectable ? "" : " (not a directory)"}
						</option>
					))}
				</select>
				<label className="text-[12px] text-text-secondary" htmlFor="community-skill-source-url">
					Source URL (provenance only; import never fetches it)
				</label>
				<input
					id="community-skill-source-url"
					value={sourceUrl}
					onChange={(event) => {
						setSourceUrl(event.target.value);
						invalidateReview();
					}}
					placeholder="https://github.com/owner/repo/..."
					className="rounded border border-border bg-surface-2 px-2 py-1 text-[12px] text-text-primary"
				/>
				<Button variant="primary" disabled={!directory || !sourceUrl.trim() || busy !== null} onClick={runReview}>
					Review exact bundle
				</Button>
			</div>

			{error ? (
				<p role="alert" className="mt-3 mb-0 text-[12px] text-status-red">
					{error}
				</p>
			) : null}
			{approval ? (
				<p role="status" className="mt-3 mb-0 text-[12px] text-status-green">
					Imported as inactive quarantine snapshot {approval.snapshotId}. Activation remains a separate gate.
				</p>
			) : null}

			{review ? (
				<div className="mt-4 grid gap-2 border-t border-border pt-3">
					<div className="rounded border border-border bg-surface-1 p-2 text-[11px] text-text-secondary">
						<div>
							<strong className="text-text-primary">Identity:</strong> {review.skillId}
						</div>
						<div>
							<strong className="text-text-primary">Provenance:</strong> {review.sourceUrl}
						</div>
						<div>
							<strong className="text-text-primary">Trust:</strong> {review.trust.trust} — {review.trust.reason}
						</div>
						<div className="break-all">
							<strong className="text-text-primary">SHA-256:</strong> {review.contentHash}
						</div>
						<div>
							<strong className="text-text-primary">Pin:</strong> {review.drift.kind} — {review.drift.reason}
						</div>
						<div>
							<strong className="text-text-primary">Decision:</strong> {review.decision.reason}
						</div>
					</div>

					<details open className="rounded border border-border bg-surface-2 px-2 py-1.5">
						<summary className="cursor-pointer text-[12px] font-medium text-text-primary">
							Full SKILL.md source
						</summary>
						<pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words text-[11px] text-text-secondary">
							{review.sourceText}
						</pre>
					</details>

					{review.files
						.filter((file) => file.path !== "SKILL.md")
						.map((file) => (
							<details key={file.path} className="rounded border border-border bg-surface-2 px-2 py-1.5">
								<summary className="cursor-pointer text-[12px] font-medium text-text-primary">
									{file.path} · {file.sizeBytes} bytes · mode {file.mode.toString(8)}
								</summary>
								<pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-all text-[11px] text-text-secondary">
									{file.textContent ?? `base64:${file.contentBase64}`}
								</pre>
							</details>
						))}
					<JsonDetails label="Parsed manifest" value={review.manifest} />
					<JsonDetails label="Bundled-file findings" value={review.bundledManifest} />
					<JsonDetails label="Executable findings" value={review.executableScreen} />
					<JsonDetails label="Prompt-injection findings" value={review.injectionScreen} />
					<JsonDetails label="Least-privilege grant" value={review.capabilityGrant} />

					<label className="flex items-start gap-2 rounded border border-status-yellow/30 bg-status-yellow/5 p-2 text-[11px] text-text-secondary">
						<input
							type="checkbox"
							checked={confirmed}
							onChange={(event) => setConfirmed(event.target.checked)}
							disabled={review.decision.decision === "reject"}
						/>
						<span>
							I reviewed the exact source, bundle, findings, trust, provenance, and SHA-256 above. Import these
							exact bytes as an inactive quarantined snapshot.
						</span>
					</label>
					<Button
						variant={review.decision.decision === "reject" ? "danger" : "primary"}
						disabled={!confirmed || busy !== null || review.decision.decision === "reject"}
						onClick={runApprove}
					>
						{review.decision.pinState === "changed" ? "Re-review and replace pin" : "Import and pin exact bytes"}
					</Button>
				</div>
			) : null}
		</div>
	);
}
