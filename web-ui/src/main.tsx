import ReactDOM from "react-dom/client";
import { Toaster } from "sonner";

import App from "@/App";
import { AppErrorBoundary } from "@/components/app-error-boundary";
import { PasscodeGateProvider } from "@/components/passcode-gate";
import { TooltipProvider } from "@/components/ui/tooltip";
import { isThemeId } from "@/hooks/use-theme";
import { LocalStorageKey, migrateLegacyLocalStorageKeys, readLocalStorageItem } from "@/storage/local-storage-store";
import { TelemetryProvider } from "@/telemetry/posthog-provider";
import { initializeSentry } from "@/telemetry/sentry";
import "@/styles/globals.css";

initializeSentry();

// Register the PWA service worker (moved from index.html to allow a strict
// script-src 'self' CSP — no inline scripts in the served HTML).
if ("serviceWorker" in navigator) {
	navigator.serviceWorker.register("/sw.js");
}

// Apply the persisted theme synchronously before first paint to prevent a flash.
try {
	migrateLegacyLocalStorageKeys();
	const _savedTheme = readLocalStorageItem(LocalStorageKey.Theme);
	// §5.AX: unset (or unknown) ⇒ the !Klein identity is the default look; an explicit "default" stays the
	// legacy palette (data-theme removed); any other stored theme is applied as-is. No pre-paint flash.
	const _bootTheme = isThemeId(_savedTheme) ? _savedTheme : "klein";
	if (_bootTheme !== "default") {
		document.documentElement.setAttribute("data-theme", _bootTheme);
	}
} catch {
	// Ignore storage access failures and keep the default theme.
}

const root = document.getElementById("root");
if (!root) {
	throw new Error("Root element was not found.");
}

ReactDOM.createRoot(root).render(
	<PasscodeGateProvider>
		<TelemetryProvider>
			<AppErrorBoundary>
				<TooltipProvider>
					<App />
					<Toaster
						theme="dark"
						position="bottom-right"
						toastOptions={{
							style: {
								background: "var(--color-surface-1)",
								border: "1px solid var(--color-border)",
								color: "var(--color-text-primary)",
								fontSize: "13px",
								whiteSpace: "pre-line",
							},
						}}
					/>
				</TooltipProvider>
			</AppErrorBoundary>
		</TelemetryProvider>
	</PasscodeGateProvider>,
);
