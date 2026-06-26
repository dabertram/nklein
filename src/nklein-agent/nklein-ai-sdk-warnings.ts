/**
 * The "System messages in the prompt or messages fields can be a security risk…" warning is emitted by the
 * external **`ai` package (Vercel AI SDK)** — a transitive dependency of the vendored `@nklein/llms` runtime —
 * on **every** model call. !Klein passes system messages in the `messages` array deliberately (some local-model
 * prompt shapes need it), so the warning is expected; emitted per call it just floods the runtime log.
 *
 * The SDK exposes an official switch — `globalThis.AI_SDK_LOG_WARNINGS` — so we set it to `false` to drop the
 * external per-call spam, and print the rationale **once at startup** so the information isn't lost. No patching
 * of the external package, no per-message bookkeeping.
 */

const STARTUP_NOTICE =
	"[nklein] AI SDK (external `ai` package): system messages are passed in the messages array by design for " +
	"local-model prompts; silencing its per-call security warning for the rest of this run.";

let configured = false;

/**
 * Silences the `ai` package's per-call warnings and logs the rationale once through the provided logger.
 * Idempotent; safe to call from every runtime entry point. Must run before the first model call.
 */
export function configureNKleinAiSdkWarnings(log: (message: string) => void): void {
	if (configured) {
		return;
	}
	configured = true;
	log(STARTUP_NOTICE);
	(globalThis as { AI_SDK_LOG_WARNINGS?: boolean }).AI_SDK_LOG_WARNINGS = false;
}
