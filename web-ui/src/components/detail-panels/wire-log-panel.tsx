import type React from "react";
import { useEffect, useState } from "react";
import { fetchTaskWireLog } from "@/runtime/queries/task-control";
import type { RuntimeTaskWireLogResponse } from "@/runtime/types";

/**
 * §dsh#31 — the card's WIRE TRUTH, in the detail view: every recorded model request (sizes, tool sets,
 * per-message breakdown) and every runtime injection, straight from the session-request/injection logs.
 * Read-only inspection; collapsed by default and loaded on open, like the neighbouring panels. Honest states
 * are load-bearing: a DISABLED log and an EMPTY log are different facts, and truncation is always announced.
 */

function formatChars(chars: number): string {
	if (chars >= 1_000_000) {
		return `${(chars / 1_000_000).toFixed(1)}M`;
	}
	if (chars >= 1_000) {
		return `${(chars / 1_000).toFixed(1)}k`;
	}
	return `${chars}`;
}

function formatTime(recordedAt: string): string {
	const parsed = new Date(recordedAt);
	return Number.isNaN(parsed.getTime()) ? recordedAt : parsed.toLocaleTimeString();
}

export function WireLogPanel({
	workspaceId,
	taskId,
}: {
	workspaceId: string | null;
	taskId: string;
}): React.ReactElement | null {
	const [open, setOpen] = useState(false);
	const [includeText, setIncludeText] = useState(false);
	const [wireLog, setWireLog] = useState<RuntimeTaskWireLogResponse | null>(null);
	const [loadFailed, setLoadFailed] = useState(false);
	const [expandedRequest, setExpandedRequest] = useState<number | null>(null);
	useEffect(() => {
		if (!open || workspaceId === null) {
			return;
		}
		let cancelled = false;
		setLoadFailed(false);
		void fetchTaskWireLog(workspaceId, taskId, includeText)
			.then((response) => {
				if (!cancelled) {
					setWireLog(response);
				}
			})
			.catch(() => {
				if (!cancelled) {
					// Honest failure: an unreachable endpoint must never read as "no requests were sent".
					setLoadFailed(true);
					setWireLog(null);
				}
			});
		return () => {
			cancelled = true;
		};
	}, [open, includeText, taskId, workspaceId]);
	if (workspaceId === null) {
		return null;
	}
	return (
		<div className="rounded-md border border-border bg-surface-1 p-2">
			<button
				type="button"
				className="flex w-full cursor-pointer items-center justify-between text-left text-xs font-medium text-text-secondary hover:text-text-primary"
				onClick={() => setOpen((current) => !current)}
			>
				<span>Wire log</span>
				<span className="text-text-tertiary">{open ? "▾" : "▸"}</span>
			</button>
			{open ? (
				loadFailed ? (
					<div className="pt-2 text-xs text-text-tertiary">
						Could not load the wire log (the runtime may predate this endpoint — restart it to enable).
					</div>
				) : wireLog === null ? (
					<div className="pt-2 text-xs text-text-tertiary">Loading…</div>
				) : (
					<div className="space-y-2 pt-2 text-xs text-text-secondary">
						<label className="flex cursor-pointer items-center gap-1.5 text-text-tertiary">
							<input
								type="checkbox"
								checked={includeText}
								onChange={(event) => setIncludeText(event.target.checked)}
							/>
							<span>Include message text</span>
						</label>
						{wireLog.requestLogDisabled ? (
							<div className="text-status-yellow">
								Request logging is switched off — an empty list below means "not recorded", not "nothing sent".
							</div>
						) : null}
						<div className="font-medium text-text-primary">
							Requests ({wireLog.requests.length}
							{wireLog.truncatedRequests > 0 ? ` shown · ${wireLog.truncatedRequests} older truncated` : ""})
						</div>
						{wireLog.requests.length === 0 && !wireLog.requestLogDisabled ? (
							<div className="text-text-tertiary">No recorded requests for this card.</div>
						) : (
							wireLog.requests.map((request, index) => (
								<div key={`${request.recordedAt}-${index}`} className="rounded border border-border p-1.5">
									<button
										type="button"
										className="flex w-full cursor-pointer items-center justify-between gap-2 text-left"
										onClick={() => setExpandedRequest((current) => (current === index ? null : index))}
									>
										<span className="min-w-0 truncate">
											<span className="text-text-tertiary">{formatTime(request.recordedAt)}</span>{" "}
											<span className="font-medium">{request.purpose}</span>{" "}
											<span className="text-text-tertiary">{request.modelId}</span>
										</span>
										<span className="shrink-0 text-text-tertiary">
											{request.messageCount} msg · {formatChars(request.totalChars)} ch ·{" "}
											{request.toolNames.length} tools
										</span>
									</button>
									{expandedRequest === index ? (
										<div className="space-y-1 pt-1.5">
											{request.systemPromptChars !== null ? (
												<div className="text-text-tertiary">
													system prompt: {formatChars(request.systemPromptChars)} ch
												</div>
											) : null}
											{request.toolNames.length > 0 ? (
												<div className="break-words text-text-tertiary">
													tools: {request.toolNames.join(", ")}
												</div>
											) : null}
											{request.messages.map((message, messageIndex) => (
												<div key={`${messageIndex}-${message.role}`}>
													<span className="text-text-tertiary">
														[{message.role}] {formatChars(message.chars)} ch
													</span>
													{message.text !== undefined ? (
														<pre className="mt-0.5 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-surface-2 p-1 text-[10px] text-text-secondary">
															{message.text}
														</pre>
													) : null}
												</div>
											))}
										</div>
									) : null}
								</div>
							))
						)}
						{wireLog.injectionLogDisabled ? (
							<div className="text-status-yellow">Injection logging is switched off.</div>
						) : (
							<div>
								<div className="font-medium text-text-primary">
									Injections ({wireLog.injections.length}
									{wireLog.truncatedInjections > 0
										? ` shown · ${wireLog.truncatedInjections} older truncated`
										: ""}
									)
								</div>
								{wireLog.injections.length === 0 ? (
									<div className="text-text-tertiary">No recorded injections.</div>
								) : (
									wireLog.injections.map((injection, index) => (
										<div key={`${injection.recordedAt}-${index}`} className="text-text-tertiary">
											{formatTime(injection.recordedAt)} · {injection.kind} [{injection.role}] ·{" "}
											{formatChars(injection.chars)} ch
											{injection.text !== undefined ? (
												<pre className="mt-0.5 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded bg-surface-2 p-1 text-[10px] text-text-secondary">
													{injection.text}
												</pre>
											) : null}
										</div>
									))
								)}
							</div>
						)}
						<div className="text-text-tertiary">
							Sessions inspected: {wireLog.sessionIds.length > 0 ? wireLog.sessionIds.join(", ") : "none"}
						</div>
					</div>
				)
			) : null}
		</div>
	);
}
