/**
 * Frontend framework-convention preamble (F12.89) — PURE core.
 *
 * Measured gap: models emit component-based frontend architecture <5% of the time (flat markup instead of idiomatic
 * components) and hallucinate APIs from the WRONG framework version (React 19 / Vue 3.x drift). Fix: detect the
 * workspace's framework + MAJOR version from its package.json dependencies and inject a TERSE convention preamble
 * into UI-touching cards' prompts — positive rules with concrete alternatives (per the F12.80 phrasing findings),
 * few enough to respect a small model's instruction budget (F12.79). The caller reads package.json; this is pure.
 */

export type FrontendFramework = "react" | "vue" | "angular" | "svelte";

export interface FrameworkDetection {
	readonly framework: FrontendFramework;
	/** Major version parsed from the dependency range ("^19.0.1" → 19); null when unparseable. */
	readonly major: number | null;
}

const FRAMEWORK_DEPENDENCY: readonly { dep: string; framework: FrontendFramework }[] = [
	{ dep: "react", framework: "react" },
	{ dep: "vue", framework: "vue" },
	{ dep: "@angular/core", framework: "angular" },
	{ dep: "svelte", framework: "svelte" },
];

function parseMajor(range: string | undefined): number | null {
	const match = /(\d+)/.exec(range ?? "");
	return match?.[1] ? Number.parseInt(match[1], 10) : null;
}

/**
 * Detect the workspace's frontend framework from merged (dev)dependencies. First match in priority order wins —
 * a repo carrying react + a stray svelte devtool is a React app. Returns null for backend-only workspaces.
 */
export function detectFrontendFramework(dependencies: Record<string, string>): FrameworkDetection | null {
	for (const { dep, framework } of FRAMEWORK_DEPENDENCY) {
		if (dependencies[dep] !== undefined) {
			return { framework, major: parseMajor(dependencies[dep]) };
		}
	}
	return null;
}

/** Version-scoped API guardrails — only rules that CHANGE behavior across the majors the fleet will meet. */
function versionRules(detection: FrameworkDetection): string[] {
	const { framework, major } = detection;
	if (framework === "react") {
		if (major !== null && major >= 19) {
			return [
				"React 19: use the `use()` hook and Actions where they fit; `forwardRef` is unnecessary (ref is a normal prop); avoid the removed `propTypes`/string refs.",
			];
		}
		return [
			"React ≤18: `use()`/Actions are NOT available — use effects/suspense patterns of this major; `forwardRef` IS required to pass refs.",
		];
	}
	if (framework === "vue") {
		return [
			"Vue 3: use `<script setup>` + the Composition API for new components; use `defineProps`/`defineEmits` instead of the Options API for new code.",
		];
	}
	if (framework === "angular") {
		return [
			"Angular: prefer STANDALONE components (no NgModule) and signals for new code; use the `inject()` function over constructor injection in new services.",
		];
	}
	return [
		"Svelte 5: use runes (`$state`, `$derived`, `$props`) for new components instead of Svelte-4 `$:` reactivity.",
	];
}

/**
 * Build the terse convention preamble for a UI-touching card. Deliberately few rules (instruction budget): the
 * component rule (the <5% gap), the import-verification rule (API hallucination), and one version-scoped block.
 * Returns [] for non-frontend workspaces so callers can spread it unconditionally.
 */
export function buildFrameworkPreamble(detection: FrameworkDetection | null): string[] {
	if (detection === null) {
		return [];
	}
	const name = detection.framework;
	const versionLabel = detection.major !== null ? `${name} ${detection.major}` : name;
	return [
		`[frontend conventions — ${versionLabel}]`,
		`Structure UI as reusable ${name} COMPONENTS with props — split any markup block you repeat into a component instead of duplicating it.`,
		"Import only APIs that exist in the INSTALLED version: check package.json before using an API you have not seen in this repo, and mirror the import style of neighboring files.",
		...versionRules(detection),
	];
}
