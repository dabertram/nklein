import type React from "react";
import { useState } from "react";
import { cn } from "@/components/ui/cn";
import type { RuntimeTaskEvidenceResponse } from "@/runtime/types";

/**
 * The card detail view's evidence drawer, extracted from the oversized `card-detail-view.tsx` (todo §5.U). Renders a
 * captured task-evidence bundle: the bundle path, the list of evidence file paths (summary / diff / telemetry / config
 * / eval / transcripts), and a tabbed text viewer (summary / diff / prompt). Self-contained: reads only `evidence`.
 */

type TaskEvidenceViewerTab = "summary" | "diff" | "prompt";

export function TaskEvidenceDrawer({ evidence }: { evidence: RuntimeTaskEvidenceResponse }): React.ReactElement {
	const [activeTab, setActiveTab] = useState<TaskEvidenceViewerTab>("summary");
	const evidenceFiles = [
		{ label: "Summary", path: evidence.files.summary },
		{ label: "Diff", path: evidence.files.diffPatch },
		{ label: "Telemetry", path: evidence.files.telemetry },
		{ label: "Config", path: evidence.files.configSnapshot },
		{ label: "Eval", path: evidence.files.evalResult },
		...evidence.files.transcripts.map((path, index) => ({ label: `Transcript ${index + 1}`, path })),
	].filter((entry): entry is { label: string; path: string } => Boolean(entry.path));
	const viewerTabs: Array<{ id: TaskEvidenceViewerTab; label: string; text: string }> = [
		{ id: "summary", label: "Summary", text: evidence.summaryText },
		{ id: "diff", label: "Diff", text: evidence.diffPatchText ?? "No diff evidence was captured." },
		{ id: "prompt", label: "Prompt", text: evidence.promptBlock },
	];
	const activeViewerText = viewerTabs.find((tab) => tab.id === activeTab)?.text ?? evidence.summaryText;
	return (
		<div className="mt-2 rounded-md border border-border bg-surface-2 p-2 text-[12px]">
			<div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
				<div className="font-medium text-text-primary">Evidence and diff</div>
				<div className="flex shrink-0 items-center gap-1 rounded-md bg-surface-1 p-0.5">
					{viewerTabs.map((tab) => (
						<button
							key={tab.id}
							type="button"
							onClick={() => setActiveTab(tab.id)}
							className={cn(
								"rounded-sm px-2 py-1 text-[11px] text-text-secondary hover:bg-surface-3 hover:text-text-primary",
								activeTab === tab.id && "bg-surface-3 text-text-primary",
							)}
						>
							{tab.label}
						</button>
					))}
				</div>
			</div>
			<div className="mt-1 break-all font-mono text-[11px] text-text-secondary">{evidence.bundlePath}</div>
			<div className="mt-2 grid gap-1">
				{evidenceFiles.map((entry) => (
					<div key={`${entry.label}:${entry.path}`} className="grid grid-cols-[80px_minmax(0,1fr)] gap-2">
						<span className="text-text-tertiary">{entry.label}</span>
						<span className="break-all font-mono text-[11px] text-text-secondary">{entry.path}</span>
					</div>
				))}
			</div>
			<pre className="mt-2 max-h-56 overflow-auto rounded-sm bg-surface-0 p-2 text-[11px] text-text-secondary whitespace-pre-wrap">
				{activeViewerText}
			</pre>
		</div>
	);
}
