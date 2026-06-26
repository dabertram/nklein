import * as Sentry from "@sentry/react";

// DSN comes from the environment (VITE_SENTRY_DSN) — no telemetry endpoint is
// hardcoded. Unset (the default) ⇒ Sentry stays inert: initializeSentry() is a
// no-op and the app opens no outbound telemetry connection, which also keeps the
// served CSP's connect-src tight. To opt in, set VITE_SENTRY_DSN at build time
// (and add that host to the CSP connect-src in remote-security-policy.ts).
const sentryDsn = import.meta.env.VITE_SENTRY_DSN?.trim();
const sentryEnvironment = import.meta.env.MODE;

let initialized = false;

export function initializeSentry(): void {
	if (!sentryDsn || initialized) {
		return;
	}

	Sentry.init({
		dsn: sentryDsn,
		environment: sentryEnvironment,
		release: `kanban@${__APP_VERSION__}`,
		sendDefaultPii: false,
		initialScope: {
			tags: {
				app: "kanban",
				runtime_surface: "web",
			},
		},
	});

	initialized = true;
}

export function isSentryEnabled(): boolean {
	return initialized;
}
