/**
 * F12.106 external-trigger intake — the PURE half. An EVENT (webhook POST, later cron/file-watch) seeds a board
 * card from an in-repo template (`.nklein/triggers/<name>.json`): this module owns the template schema, the
 * payload → card substitution, and the name/payload safety rails. The effectful halves (template file loading,
 * the loopback-only HTTP route, the board mutation) live in `src/server/trigger-intake-handler.ts`.
 *
 * Local-only invariant: the intake NEVER makes outbound calls; the handler accepts loopback callers only. The
 * flagship recipe is the incident template ("production down → gather evidence, diagnose, propose a fix card")
 * landing at the FRONT of the Ready lane, picked up by the same autonomous ready-sweep every board card rides.
 */

import { z } from "zod";

/** URL-path-safe trigger names only — the name selects a file, so this is also the path-traversal guard. */
export const TRIGGER_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export function isSafeTriggerName(name: string): boolean {
	return TRIGGER_NAME_PATTERN.test(name);
}

/** Bound on the JSON payload an external event may attach — an intake doorbell, not a data channel. */
export const TRIGGER_PAYLOAD_MAX_BYTES = 32_768;

/** Consecutive fires of the same (workspace, trigger) inside this window are refused — alarm-storm damping. */
export const TRIGGER_COOLDOWN_MS = 30_000;

export const triggerCardTemplateSchema = z.object({
	/** Card title; supports the same substitution tokens as `prompt`. */
	title: z.string().min(1),
	/** Card prompt; tokens: {trigger}, {timestamp}, {payload} (JSON), {payload.<key>} (top-level primitives). */
	prompt: z.string().min(1),
	baseRef: z.string().min(1).default("main"),
	filesLikelyTouched: z.array(z.string()).default([]),
	/** Where the card lands. Incident-style triggers default to the FRONT of Ready. */
	lane: z.enum(["ready", "backlog"]).default("ready"),
	front: z.boolean().default(true),
	startInPlanMode: z.boolean().default(false),
	agentId: z.literal("nklein").optional(),
	/**
	 * Reserved. !Klein boards are autonomous — the ready-sweep starts every startable card — so a non-starting
	 * trigger card is not expressible yet; templates declaring `autoStart: false` are refused at load time
	 * rather than silently behaving like `true`.
	 */
	autoStart: z.literal(true).default(true),
});
export type TriggerCardTemplate = z.infer<typeof triggerCardTemplateSchema>;

export type TriggerPayload = Record<string, unknown>;

/** Parse + bound an intake request body. Empty/absent bodies are a valid "no payload" fire. */
export function parseTriggerPayload(
	bodyText: string,
): { ok: true; payload: TriggerPayload | null } | { ok: false; reason: string } {
	const trimmed = bodyText.trim();
	if (!trimmed) {
		return { ok: true, payload: null };
	}
	if (Buffer.byteLength(trimmed, "utf8") > TRIGGER_PAYLOAD_MAX_BYTES) {
		return { ok: false, reason: `Payload exceeds ${TRIGGER_PAYLOAD_MAX_BYTES} bytes.` };
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(trimmed);
	} catch {
		return { ok: false, reason: "Payload must be a JSON object." };
	}
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
		return { ok: false, reason: "Payload must be a JSON object." };
	}
	return { ok: true, payload: parsed as TriggerPayload };
}

export interface RenderedTriggerCard {
	taskId: string;
	title: string;
	prompt: string;
}

function substitute(template: string, tokens: Map<string, string>): string {
	return template.replace(/\{([a-zA-Z0-9_.-]+)\}/g, (whole, token: string) => tokens.get(token) ?? whole);
}

/**
 * Render a trigger fire into the card to seed. Unknown `{...}` tokens are left verbatim (a template typo stays
 * visible on the card instead of vanishing); the prompt gains a provenance footer so the card itself says which
 * event created it.
 */
export function renderTriggerCard(input: {
	triggerName: string;
	template: TriggerCardTemplate;
	payload: TriggerPayload | null;
	now: number;
	uniqueSuffix: string;
}): RenderedTriggerCard {
	const timestamp = new Date(input.now).toISOString();
	const tokens = new Map<string, string>([
		["trigger", input.triggerName],
		["timestamp", timestamp],
		["payload", input.payload ? JSON.stringify(input.payload) : "{}"],
	]);
	if (input.payload) {
		for (const [key, value] of Object.entries(input.payload)) {
			if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
				tokens.set(`payload.${key}`, String(value));
			}
		}
	}
	const title = substitute(input.template.title, tokens);
	const prompt = `${substitute(input.template.prompt, tokens)}\n\n(Seeded by external trigger "${input.triggerName}" at ${timestamp}.)`;
	return {
		taskId: `trigger-${input.triggerName}-${input.now}-${input.uniqueSuffix}`,
		title,
		prompt,
	};
}
