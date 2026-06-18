export interface ClineGuidanceSkillDefault {
	topic: ClineGuidanceSkillTopic;
	directoryName: string;
	commandName: string;
	markdown: string;
}

export type ClineGuidanceSkillTopic = "security" | "ui" | "ts";

export interface ClineGuidanceSkillRoute {
	commandName: string;
	skillFile: string;
}

export const CLINE_GUIDANCE_SKILL_TOPIC_MAP: Readonly<Record<ClineGuidanceSkillTopic, ClineGuidanceSkillRoute>> = {
	security: {
		commandName: "nklein-security",
		skillFile: "skills/nklein-security/SKILL.md",
	},
	ui: {
		commandName: "nklein-ui",
		skillFile: "skills/nklein-ui/SKILL.md",
	},
	ts: {
		commandName: "nklein-ts",
		skillFile: "skills/nklein-ts/SKILL.md",
	},
};

export const CLINE_GUIDANCE_SKILL_DEFAULTS: readonly ClineGuidanceSkillDefault[] = [
	{
		topic: "security",
		directoryName: "nklein-security",
		commandName: "nklein-security",
		markdown: `---
name: nklein-security
description: "!Klein security review guidance for local-first coding tasks."
---

Use this skill when a task touches auth, local runtime boundaries, Electron, filesystem writes, agent tools, network access, cookies, tokens, or dependency execution.

Checklist:
- Start from the trust boundary: browser UI, runtime server, local project files, Cline SDK host, child processes, and external endpoints.
- Prefer deny-by-default controls. Any bypass needs a narrow condition, a clear error, and regression coverage.
- Treat secrets as toxic data: never log them, never persist them in transcripts, and block obvious credential writes before disk.
- For Electron, keep context isolation, sandboxing, disabled Node integration, blocked popups, same-origin navigation, and CSP-covered fallback pages intact.
- For local servers, bind to loopback by default; cookies need HttpOnly, SameSite=Strict, Path, Max-Age, and Secure when TLS is active.
- For agent writes, preserve protected-test, max-file-size, max-line-count, and secret-scan guardrails.

Example:
\`\`\`ts
const secret = findPotentialSecretInText(input.newText);
if (secret) return { approved: false, reason: \`Blocked write: potential \${secret.label}.\` };
\`\`\`

!Klein specifics:
- Runtime security code usually lives in \`src/security/\`, \`src/server/\`, \`src/core/agent-write-guard.ts\`, and \`src/cline-sdk/\`.
- Desktop hardening lives under \`packages/desktop/src/\`.
- Update or add focused tests in \`test/runtime/\` and keep \`CHANGELOG.md\` current.`,
	},
	{
		topic: "ui",
		directoryName: "nklein-ui",
		commandName: "nklein-ui",
		markdown: `---
name: nklein-ui
description: "!Klein UI guidance for dense local-agent workflows."
---

Use this skill when a task touches React components, layout, styling, accessibility, task cards, detail panels, settings, model/provider UI, or developer surfaces.

Checklist:
- Build the actual workflow first; avoid landing-page patterns, ornamental cards, and explanatory feature text inside the app.
- Keep operational screens quiet, dense, scannable, and predictable. Cards are for repeated items, modals, or framed tools, not page sections.
- Use existing primitives: \`Button\`, \`Dialog\`, \`AlertDialog\`, \`Tooltip\`, \`Spinner\`, \`Kbd\`, and \`cn\` from \`src/components/ui/\`.
- Use Lucide icons in icon buttons, Radix for headless controls, and Tailwind v4 utilities over custom CSS.
- Preserve the always-dark theme. Use tokens such as \`bg-surface-0\`, \`bg-surface-1\`, \`bg-surface-2\`, \`text-text-primary\`, \`text-text-secondary\`, \`border-border\`, and \`text-accent\`.
- Make mobile and desktop text fit without overlap. Keep fixed-format controls dimensionally stable.

Example:
\`\`\`tsx
<Button variant="ghost" size="sm" icon={<Clipboard size={14} />} aria-label="Copy evidence">
  Copy evidence
</Button>
\`\`\`

!Klein specifics:
- Web UI code lives in \`web-ui/src/components/\`, \`web-ui/src/hooks/\`, \`web-ui/src/state/\`, and \`web-ui/src/runtime/\`.
- Prefer \`react-use\` hooks through \`@/kanban/utils/react-use\` when they fit.
- Cover behavior with Vitest/Testing Library tests near the touched component.`,
	},
	{
		topic: "ts",
		directoryName: "nklein-ts",
		commandName: "nklein-ts",
		markdown: `---
name: nklein-ts
description: "!Klein TypeScript and architecture guidance for maintainable changes."
---

Use this skill when a task touches shared types, runtime contracts, SDK boundaries, persistence, tRPC, task state, or non-trivial refactors.

Checklist:
- Do not use \`any\` unless there is no credible alternative. Prefer explicit unions, generics, SDK-provided types, and schemas already in the codebase.
- Do not use inline imports, dynamic type imports, or dependency downgrades to hide type errors.
- Keep boundaries clear: Cline SDK specifics belong behind \`src/cline-sdk/sdk-runtime-boundary.ts\` and adjacent adapter modules.
- Extract domain logic before presentation-only wrappers. Avoid thin shells for single call sites.
- Prefer structured data parsing over ad hoc string manipulation when a schema or parser exists.
- Keep edits scoped. Add abstractions only when they reduce real duplication or clarify ownership.
- Tests should match risk: narrow unit tests for local helpers, broader runtime/integration tests for cross-module behavior.

Example:
\`\`\`ts
type EvidenceState = { status: "idle" } | { status: "copying"; taskId: string };
\`\`\`

!Klein specifics:
- Root runtime tests live in \`test/runtime/\`; web UI tests live beside components or hooks.
- Run \`npm run typecheck\` and focused Vitest targets before committing.
- Every feature, fix, or behavior change updates the \`## [Upcoming]\` section in \`CHANGELOG.md\`.`,
	},
];

function includesAny(value: string, patterns: readonly RegExp[]): boolean {
	return patterns.some((pattern) => pattern.test(value));
}

const SECURITY_PATTERNS = [
	/\bauth(?:entication|orization)?\b/i,
	/\btoken\b/i,
	/\bsecret\b/i,
	/\bcredential\b/i,
	/\bcookie\b/i,
	/\bcsrf\b/i,
	/\bxss\b/i,
	/\bpermission\b/i,
	/\bapproval\b/i,
	/\bprotected[- ]test\b/i,
	/\bsecurity\b/i,
] as const;

const UI_PATTERNS = [
	/\bui\b/i,
	/\bux\b/i,
	/\bcomponent\b/i,
	/\bdialog\b/i,
	/\bbutton\b/i,
	/\bcard\b/i,
	/\bpanel\b/i,
	/\blayout\b/i,
	/\btooltip\b/i,
	/\baccessib(?:ility|le)\b/i,
	/\btailwind\b/i,
	/\bradix\b/i,
] as const;

const TS_PATTERNS = [
	/\btypescript\b/i,
	/\btype\b/i,
	/\bschema\b/i,
	/\bzod\b/i,
	/\binterface\b/i,
	/\bcontract\b/i,
	/\btrpc\b/i,
] as const;

export function resolveClineGuidanceSkillTopic(input: {
	title?: string | null;
	prompt?: string | null;
	filesLikelyTouched?: readonly string[] | null;
}): ClineGuidanceSkillTopic | null {
	const files = input.filesLikelyTouched ?? [];
	const fileText = files.join("\n");
	const text = `${input.title ?? ""}\n${input.prompt ?? ""}\n${fileText}`;
	if (
		includesAny(text, SECURITY_PATTERNS) ||
		files.some((path) => /(^|\/)(security|auth|agent-write-guard)/i.test(path))
	) {
		return "security";
	}
	if (includesAny(text, UI_PATTERNS) || files.some((path) => /(^|\/)web-ui\/|\.tsx$|(^|\/)components\//i.test(path))) {
		return "ui";
	}
	if (includesAny(text, TS_PATTERNS) || files.some((path) => /\.tsx?$|(^|\/)src\/.*\.ts$/i.test(path))) {
		return "ts";
	}
	return null;
}

export function resolveClineGuidanceSkillCommand(topic: ClineGuidanceSkillTopic): string {
	return CLINE_GUIDANCE_SKILL_TOPIC_MAP[topic].commandName;
}
