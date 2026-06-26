/// <reference types="vite/client" />

declare const __APP_VERSION__: string;

interface ImportMetaEnv {
	readonly POSTHOG_KEY?: string;
	readonly POSTHOG_HOST?: string;
	/** Sentry browser DSN. Unset ⇒ telemetry stays inert (no hardcoded endpoint). */
	readonly VITE_SENTRY_DSN?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
