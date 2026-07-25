// P16.7b — the Field Report review surface (todo §Phase 16). The user reviews the EXACT bytes that would leave
// the machine, controls inclusion per item, and submits the GitHub issue THEMSELVES — !Klein never submits.
//
// ── WHY THIS PANEL RENDERS RAW BYTES AND NOTHING ELSE ──
// The approval-view fidelity hazard (arXiv 2607.05744, see field-report-transport.ts): any rendering layer
// between "approved" and "sent" — markdown preview, syntax highlighting, collapsed sections, truncation — is
// exactly how invisible content survives approval. So every item shows its raw bytes in a plain <pre>, always
// expanded (scrolling is fine; hiding is not), and the consent projection + draft renderer are the SAME modules
// the backend tests (@runtime-field-report-* aliases), so the bytes shown here cannot drift from the bytes
// rendered.
//
// The hidden-character REFUSAL from renderIssueDraft is surfaced as a blocking, explained state with the exact
// code points — never a silent empty draft or an unexplained disabled button.

import { defaultReviewItems } from "@runtime-field-report-assembly";
import {
	type DraftResult,
	projectReviewState,
	type ReviewItem,
	renderIssueDraft,
} from "@runtime-field-report-transport";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";

const NEW_ISSUE_URL = "https://github.com/dabertram/nklein/issues/new";

const LAYER_COPY: Record<ReviewItem["layer"], { label: string; className: string }> = {
	A: { label: "Layer A · counts only", className: "bg-status-green/10 text-status-green border-status-green/40" },
	B: { label: "Layer B · narrative", className: "bg-status-yellow/10 text-status-yellow border-status-yellow/40" },
	C: { label: "Layer C · verbatim", className: "bg-status-red/10 text-status-red border-status-red/40" },
};

export function FieldReportPanel({
	workspaceId,
	open,
}: {
	workspaceId: string | null;
	open: boolean;
}): React.ReactElement {
	const [items, setItems] = useState<ReviewItem[] | null>(null);
	const [loadError, setLoadError] = useState<string | null>(null);
	// Draft + acknowledgement reset on every toggle: both describe a SPECIFIC reviewed byte set, and consent to
	// one set is not consent to another.
	const [draft, setDraft] = useState<DraftResult | null>(null);
	const [acknowledgedHiddenCharacters, setAcknowledgedHiddenCharacters] = useState(false);
	const [copied, setCopied] = useState(false);

	useEffect(() => {
		if (!open) {
			return;
		}
		let cancelled = false;
		setLoadError(null);
		getRuntimeTrpcClient(workspaceId)
			.runtime.fieldReportCandidates.query()
			.then((response) => {
				if (!cancelled) {
					setItems(defaultReviewItems(response.candidates));
				}
			})
			.catch((cause: unknown) => {
				if (!cancelled) {
					setLoadError(cause instanceof Error ? cause.message : String(cause));
				}
			});
		return () => {
			cancelled = true;
		};
	}, [open, workspaceId]);

	const reviewState = useMemo(() => (items ? projectReviewState(items) : null), [items]);

	const toggleItem = useCallback((key: string) => {
		setItems((current) =>
			current ? current.map((item) => (item.key === key ? { ...item, included: !item.included } : item)) : current,
		);
		setDraft(null);
		setAcknowledgedHiddenCharacters(false);
		setCopied(false);
	}, []);

	const renderDraft = useCallback(
		(acknowledged: boolean) => {
			if (!reviewState) {
				return;
			}
			const includedLayers = [
				...new Set(reviewState.items.filter((item) => item.included).map((item) => item.layer)),
			]
				.sort()
				.join(", ");
			const excludedCount = reviewState.items.length - reviewState.includedCount;
			setDraft(
				renderIssueDraft(reviewState, {
					title: "!Klein field report",
					disclosure: [
						`This report includes layer(s): ${includedLayers.length > 0 ? includedLayers : "(none)"}.`,
						excludedCount > 0
							? `${excludedCount} of ${reviewState.items.length} candidate item(s) were excluded by the reporter.`
							: "Every candidate item was included.",
					].join(" "),
					acknowledgedHiddenCharacters: acknowledged,
				}),
			);
			setCopied(false);
		},
		[reviewState],
	);

	if (loadError) {
		return <p className="text-[13px] text-status-red m-0">Could not load field-report candidates: {loadError}</p>;
	}
	if (!items || !reviewState) {
		return <p className="text-[13px] text-text-tertiary m-0">Assembling report candidates from local telemetry…</p>;
	}

	return (
		<div className="flex flex-col gap-3" data-testid="field-report-panel">
			<p className="text-[13px] text-text-secondary m-0">
				A field report is assembled on this machine from your own telemetry. You review the exact bytes below,
				choose what to include, and submit the GitHub issue yourself —{" "}
				<strong>!Klein never submits anything</strong>.
			</p>

			{/* Running disclosure indicator — recomputed on every toggle so it always reflects CURRENT exposure. */}
			<div
				className="rounded-lg border border-border bg-surface-0 px-4 py-3 text-[13px]"
				data-testid="field-report-reveals-now"
			>
				<div className="font-medium text-text-primary">
					{reviewState.includedCount} of {reviewState.items.length} item(s) included · {reviewState.totalBytes}{" "}
					bytes
				</div>
				{reviewState.revealsNow.length === 0 ? (
					<p className="text-text-tertiary m-0 mt-1">Nothing is currently disclosed.</p>
				) : (
					<ul className="m-0 mt-1 pl-4 text-text-secondary">
						{reviewState.revealsNow.map((reveals, index) => (
							// Reveals strings can repeat across items; position keeps the running list stable.
							// biome-ignore lint/suspicious/noArrayIndexKey: order mirrors the included items
							<li key={index}>{reveals}</li>
						))}
					</ul>
				)}
			</div>

			<div className="flex flex-col gap-2">
				{items.map((item) => (
					<div key={item.key} className="rounded-lg border border-border bg-surface-0 px-3 py-2">
						<div className="flex items-center gap-2">
							<input
								type="checkbox"
								checked={item.included}
								onChange={() => toggleItem(item.key)}
								aria-label={`Include ${item.key}`}
							/>
							<code className="text-[12px] text-text-primary">{item.key}</code>
							<span className={`rounded border px-1.5 py-0.5 text-[11px] ${LAYER_COPY[item.layer].className}`}>
								{LAYER_COPY[item.layer].label}
							</span>
						</div>
						<p className="text-[12px] text-text-tertiary m-0 mt-1">Including this reveals: {item.reveals}</p>
						{/* Raw bytes, always expanded — a collapsed or truncated view is the approval-fidelity hazard. */}
						<pre className="m-0 mt-1 max-h-48 overflow-auto rounded bg-surface-1 p-2 text-[12px] text-text-primary whitespace-pre-wrap break-all">
							{item.bytes}
						</pre>
					</div>
				))}
			</div>

			<div>
				<button
					type="button"
					className="h-8 rounded-md border border-border bg-surface-0 px-3 text-xs text-text-primary hover:border-border-focus"
					onClick={() => renderDraft(acknowledgedHiddenCharacters)}
					data-testid="field-report-render-draft"
				>
					Render the draft from the bytes above
				</button>
			</div>

			{draft && !draft.ok && (
				<div
					className="rounded-lg border border-status-red/40 bg-status-red/5 px-4 py-3 text-[13px] text-text-primary"
					data-testid="field-report-refusal"
				>
					<div className="font-medium text-status-red">Draft refused: {draft.reason}</div>
					<ul className="m-0 mt-1 pl-4">
						{draft.hiddenCharacters.map((finding) => (
							<li key={finding.key}>
								<code>{finding.key}</code>: {finding.codePoints.join(", ")}
							</li>
						))}
					</ul>
					<label className="mt-2 flex items-center gap-2 text-[13px]">
						<input
							type="checkbox"
							checked={acknowledgedHiddenCharacters}
							onChange={(event) => {
								setAcknowledgedHiddenCharacters(event.target.checked);
								renderDraft(event.target.checked);
							}}
						/>
						I reviewed these code points and want to include them anyway.
					</label>
				</div>
			)}

			{draft?.ok && (
				<div className="flex flex-col gap-2" data-testid="field-report-draft">
					<p className="text-[13px] text-text-secondary m-0">
						These are the exact bytes of the draft. Copy them, then paste into a new GitHub issue — submission is
						your action, in your browser, under your account.
					</p>
					<pre className="m-0 max-h-72 overflow-auto rounded-lg border border-border bg-surface-1 p-3 text-[12px] text-text-primary whitespace-pre-wrap break-all">
						{draft.markdown}
					</pre>
					<div className="flex items-center gap-2">
						<button
							type="button"
							className="h-8 rounded-md border border-border bg-surface-0 px-3 text-xs text-text-primary hover:border-border-focus"
							onClick={() => {
								void navigator.clipboard.writeText(draft.markdown).then(() => setCopied(true));
							}}
						>
							{copied ? "Copied the exact bytes" : "Copy exact bytes"}
						</button>
						<a
							className="text-xs text-text-secondary underline"
							href={NEW_ISSUE_URL}
							target="_blank"
							rel="noreferrer"
						>
							Open a new GitHub issue (you paste, you submit)
						</a>
					</div>
				</div>
			)}
		</div>
	);
}
