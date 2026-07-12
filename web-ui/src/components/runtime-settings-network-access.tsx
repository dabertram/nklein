/**
 * Desktop-only Settings › General section for LAN serving (§ desktop app #2 — "serve the UI
 * via a webserver so it can be accessed from LAN"). Rendered ONLY inside the desktop app
 * (the dialog gates on `window.desktop`, like "Start on boot"); a plain browser never sees
 * it, and a LAN browser additionally cannot read the passcode (the /api/network-access
 * endpoint answers loopback callers only).
 *
 * Two sources of truth, deliberately shown together:
 *   - the PERSISTED opt-in (window.desktop.getNetworkAccess / setNetworkAccess) — what the
 *     next runtime start will do;
 *   - the LIVE state (GET /api/network-access) — what the running runtime is doing, with
 *     the browse-to URL and the active passcode.
 * A mismatch means "restart required", and the section offers that restart (with a
 * running-tasks warning) via the existing restart-runtime path.
 */
import * as RadixSwitch from "@radix-ui/react-switch";
import { Check, Copy, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogBody,
	AlertDialogCancel,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/dialog";

/** Response of the loopback-only GET /api/network-access endpoint. */
export interface NetworkAccessInfo {
	lanServing: boolean;
	passcodeRequired: boolean;
	passcode: string | null;
	publicHost: string | null;
	port: number;
	origin: string;
}

/** Live LAN-serving state, or null when unavailable (endpoint absent / older runtime). */
async function fetchNetworkAccessInfoFromRuntime(): Promise<NetworkAccessInfo | null> {
	try {
		const res = await fetch("/api/network-access", { credentials: "same-origin" });
		if (!res.ok) {
			return null;
		}
		return (await res.json()) as NetworkAccessInfo;
	} catch {
		return null;
	}
}

const networkAccessCheckboxId = "runtime-settings-network-access";

export function NetworkAccessSettingsSection({
	open,
	bridge,
	fetchInfo = fetchNetworkAccessInfoFromRuntime,
}: {
	/** The Settings dialog's open state — persisted + live state are (re)read on each open. */
	open: boolean;
	/** The desktop preload bridge (`window.desktop`); the dialog only renders this section when present. */
	bridge: DesktopBridge;
	/** Injected for tests; defaults to the real loopback-only endpoint fetch. */
	fetchInfo?: () => Promise<NetworkAccessInfo | null>;
}): React.ReactElement {
	const [enabled, setEnabled] = useState(false);
	const [busy, setBusy] = useState(false);
	const [info, setInfo] = useState<NetworkAccessInfo | null>(null);
	const [confirmRestartOpen, setConfirmRestartOpen] = useState(false);
	const [copiedField, setCopiedField] = useState<"url" | "passcode" | null>(null);
	const copiedResetTimerRef = useRef<number | null>(null);

	// Read the persisted opt-in + the live runtime state each time the dialog opens.
	useEffect(() => {
		if (!open) {
			return;
		}
		let cancelled = false;
		bridge
			.getNetworkAccess()
			.then((value) => {
				if (!cancelled) setEnabled(value);
			})
			.catch(() => {});
		fetchInfo()
			.then((value) => {
				if (!cancelled) setInfo(value);
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, [open, bridge, fetchInfo]);

	useEffect(() => {
		return () => {
			if (copiedResetTimerRef.current !== null) {
				window.clearTimeout(copiedResetTimerRef.current);
			}
		};
	}, []);

	const handleToggle = useCallback(
		(next: boolean) => {
			setEnabled(next); // optimistic
			setBusy(true);
			bridge
				.setNetworkAccess(next)
				.then((result) => {
					if (!result.ok) setEnabled((prev) => !prev); // revert on failure
				})
				.catch(() => setEnabled((prev) => !prev))
				.finally(() => setBusy(false));
		},
		[bridge],
	);

	const handleCopy = useCallback((field: "url" | "passcode", value: string) => {
		void navigator.clipboard
			.writeText(value)
			.then(() => {
				setCopiedField(field);
				if (copiedResetTimerRef.current !== null) {
					window.clearTimeout(copiedResetTimerRef.current);
				}
				copiedResetTimerRef.current = window.setTimeout(() => {
					setCopiedField((current) => (current === field ? null : current));
					copiedResetTimerRef.current = null;
				}, 2000);
			})
			.catch(() => {});
	}, []);

	const liveServing = info?.lanServing ?? null;
	const restartRequired = liveServing !== null && liveServing !== enabled;
	const browseUrl = info?.lanServing && info.publicHost ? `http://${info.publicHost}:${info.port}` : null;
	const passcode = info?.lanServing && info.passcodeRequired ? info.passcode : null;

	return (
		<div className="rounded-lg border border-border bg-surface-0 px-4 py-3 mb-4">
			<h6 className="text-[12px] font-semibold uppercase tracking-wider text-text-secondary m-0 mb-1">
				Local network
			</h6>
			<label
				htmlFor={networkAccessCheckboxId}
				className="flex items-center gap-2 text-[13px] text-text-primary mt-2 cursor-pointer"
			>
				<RadixSwitch.Root
					id={networkAccessCheckboxId}
					checked={enabled}
					disabled={busy}
					onCheckedChange={handleToggle}
					className="relative h-5 w-9 shrink-0 cursor-pointer rounded-full bg-surface-4 data-[state=checked]:bg-accent disabled:opacity-40"
				>
					<RadixSwitch.Thumb className="block h-4 w-4 translate-x-0.5 rounded-full bg-white shadow-sm transition-transform data-[state=checked]:translate-x-[18px]" />
				</RadixSwitch.Root>
				<span>Serve on the local network (experimental)</span>
			</label>
			<p className="text-text-secondary text-[13px] ml-11 mt-0 mb-0">
				Lets other devices on your network (phone, laptop) open this board in a browser. Access is protected by a
				passcode.
			</p>

			{restartRequired ? (
				<div className="ml-11 mt-2 flex items-center gap-3">
					<p className="text-status-orange text-[13px] m-0" role="status">
						Restart the runtime to {enabled ? "start" : "stop"} serving on the network.
					</p>
					<Button
						variant="default"
						size="sm"
						icon={<RefreshCw size={14} />}
						onClick={() => setConfirmRestartOpen(true)}
					>
						Restart now
					</Button>
				</div>
			) : null}

			{info?.lanServing ? (
				<div className="ml-11 mt-3 flex flex-col gap-2">
					<div className="flex items-center gap-2 text-[13px]">
						<span className="text-text-secondary w-20 shrink-0">Address</span>
						{browseUrl ? (
							<>
								<code className="rounded-sm bg-surface-2 px-2 py-0.5 font-mono text-text-primary">
									{browseUrl}
								</code>
								<Button
									variant="ghost"
									size="sm"
									icon={copiedField === "url" ? <Check size={14} /> : <Copy size={14} />}
									aria-label="Copy address"
									onClick={() => handleCopy("url", browseUrl)}
								/>
							</>
						) : (
							<span className="text-text-secondary">
								No LAN address detected — check your network connection.
							</span>
						)}
					</div>
					{passcode ? (
						<div className="flex items-center gap-2 text-[13px]">
							<span className="text-text-secondary w-20 shrink-0">Passcode</span>
							<code className="rounded-sm bg-surface-2 px-2 py-0.5 font-mono text-text-primary">{passcode}</code>
							<Button
								variant="ghost"
								size="sm"
								icon={copiedField === "passcode" ? <Check size={14} /> : <Copy size={14} />}
								aria-label="Copy passcode"
								onClick={() => handleCopy("passcode", passcode)}
							/>
						</div>
					) : null}
					<p className="text-status-orange text-[13px] m-0">
						Anyone on your local network with the passcode can reach your projects, terminals, and files. Traffic
						uses plain unencrypted HTTP — only enable this on networks you trust.
					</p>
				</div>
			) : null}

			<AlertDialog open={confirmRestartOpen} onOpenChange={setConfirmRestartOpen}>
				<AlertDialogHeader>
					<AlertDialogTitle>Restart the runtime?</AlertDialogTitle>
				</AlertDialogHeader>
				<AlertDialogBody>
					<AlertDialogDescription>
						Serving on the local network turns {enabled ? "on" : "off"} after the restart.
					</AlertDialogDescription>
					<p>Running agent tasks will be stopped, and every window reconnects when the runtime is back.</p>
				</AlertDialogBody>
				<AlertDialogFooter>
					<AlertDialogCancel asChild>
						<Button variant="default">Cancel</Button>
					</AlertDialogCancel>
					<AlertDialogAction asChild>
						<Button
							variant="primary"
							icon={<RefreshCw size={14} />}
							onClick={() => {
								setConfirmRestartOpen(false);
								bridge.restartRuntime();
							}}
						>
							Restart runtime
						</Button>
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialog>
		</div>
	);
}
