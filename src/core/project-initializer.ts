import { type ClarificationQuestion, type EarsCriterion, renderEarsCriterion } from "./ears-acceptance-criteria.js";
import { reviewSpec } from "./spec-review-pipeline.js";
import { fenceUntrustedContent } from "./untrusted-content-boundary.js";

export type ProjectInitializerMode = "beginner" | "pro";
export type ProjectInitializerEffort = "small" | "medium" | "large";
export type ProjectInitializerAutonomy = "autonomous" | "checkpoints" | "collaborative";
export type ProjectInitializerReferenceKind = "pasted" | "file" | "url";

export interface ProjectInitializerReference {
	kind: ProjectInitializerReferenceKind;
	value: string;
	label?: string;
	/** Server-resolved file content. Never accepted from a browser for `file` references. */
	content?: string;
}

export interface ProjectInitializerBriefInput {
	mode: ProjectInitializerMode;
	projectKind: "greenfield" | "existing";
	outcome: string;
	audience: string;
	stackRuntime: string;
	acceptanceCommands: string;
	successCriteria: string;
	inScope: string;
	outOfScope: string;
	domainConcepts: string;
	constraints: string;
	uncertainties: string;
	effort: ProjectInitializerEffort;
	autonomy: ProjectInitializerAutonomy;
	batchBrief?: string;
	references: ProjectInitializerReference[];
}

export interface ProjectInitializerReadiness {
	ready: boolean;
	blockingGaps: string[];
	clarifications: string[];
	nextClarification: ClarificationQuestion | null;
	remainingWhatWhyClarifications: number;
	lintFindings: ReturnType<typeof reviewSpec>["lintFindings"];
	quarantinedReferenceCount: number;
}

function parseCanonicalEarsLine(line: string): EarsCriterion | null {
	const normalized = clean(line).replace(/^(?:[-*+]\s+|\d+[.)]\s+)/u, "");
	const patterns: Array<{
		pattern: RegExp;
		build: (match: RegExpExecArray) => EarsCriterion;
	}> = [
		{
			pattern: /^WHILE\s+(.+?),\s*WHEN\s+(.+?),\s*THE SYSTEM SHALL\s+(.+?)[.]*$/iu,
			build: (match) => renderEarsCriterion({ state: match[1], trigger: match[2], behavior: match[3] ?? "" }),
		},
		{
			pattern: /^WHERE\s+(.+?),\s*THE SYSTEM SHALL\s+(.+?)[.]*$/iu,
			build: (match) => renderEarsCriterion({ feature: match[1], behavior: match[2] ?? "" }),
		},
		{
			pattern: /^IF\s+(.+?),\s*THEN\s+THE SYSTEM SHALL\s+(.+?)[.]*$/iu,
			build: (match) => renderEarsCriterion({ trigger: match[1], behavior: match[2] ?? "", unwanted: true }),
		},
		{
			pattern: /^WHILE\s+(.+?),\s*THE SYSTEM SHALL\s+(.+?)[.]*$/iu,
			build: (match) => renderEarsCriterion({ state: match[1], behavior: match[2] ?? "" }),
		},
		{
			pattern: /^WHEN\s+(.+?),\s*THE SYSTEM SHALL\s+(.+?)[.]*$/iu,
			build: (match) => renderEarsCriterion({ trigger: match[1], behavior: match[2] ?? "" }),
		},
		{
			pattern: /^THE SYSTEM SHALL\s+(.+?)[.]*$/iu,
			build: (match) => renderEarsCriterion({ behavior: match[1] ?? "" }),
		},
	];
	for (const candidate of patterns) {
		const match = candidate.pattern.exec(normalized);
		if (match) return candidate.build(match);
	}
	return normalized ? renderEarsCriterion({ behavior: normalized }) : null;
}

/** Turn one observable behavior per line into canonical EARS, preserving already-structured EARS patterns. */
export function renderProjectEarsCriteria(successCriteria: string): EarsCriterion[] {
	return successCriteria
		.split(/\r?\n/u)
		.map(parseCanonicalEarsLine)
		.filter((criterion): criterion is EarsCriterion => criterion !== null);
}

export interface InitialDecompositionTrack {
	title: string;
	purpose: string;
}

function clean(value: string): string {
	return value.trim();
}

function sentenceFragment(value: string): string {
	return clean(value).replace(/[.!?]+$/u, "");
}

function explicitOrGap(value: string, gap: string, gaps: string[]): string {
	const normalized = clean(value);
	if (!normalized) gaps.push(gap);
	return normalized;
}

/** The canonical ten-topic intake, assessed without pretending prose proves an omitted category. */
export function assessProjectInitializerBrief(input: ProjectInitializerBriefInput): ProjectInitializerReadiness {
	const blockingGaps: string[] = [];
	const clarificationGaps: string[] = [];
	const bulk = clean(input.batchBrief ?? "");
	const outcome = clean(input.outcome);
	if (!outcome && !bulk) blockingGaps.push("Describe the outcome/vision or paste a complete pro brief.");
	if (!clean(input.acceptanceCommands)) blockingGaps.push("Provide the exact acceptance command(s) that must pass.");
	if (!clean(input.successCriteria)) {
		blockingGaps.push("Provide at least one observable required behavior for EARS acceptance criteria.");
	}
	if (input.projectKind === "existing") {
		blockingGaps.push("Existing repositories use the Existing project path and the F11.2 architecture-mapping flow.");
	}
	const explicit = [
		[input.audience, "Who the project is for"],
		[input.stackRuntime, "Stack/runtime and versions"],
		[input.inScope, "What is in scope"],
		[input.outOfScope, "What is out of scope"],
		[input.domainConcepts, "Domain concepts and rules"],
		[input.constraints, "Constraints and things not to do"],
		[input.uncertainties, "Risks or uncertainties (write ‘none known’ when there are none)"],
	] as const;
	for (const [value, gap] of explicit) {
		explicitOrGap(value, gap, clarificationGaps);
	}
	if (input.mode === "beginner") blockingGaps.push(...clarificationGaps);

	const referenceResults = input.references
		.filter((reference) => clean(reference.value) || clean(reference.content ?? ""))
		.map((reference, index) =>
			fenceUntrustedContent(reference.content ?? reference.value, {
				source: `project initializer ${reference.kind} reference ${index + 1}`,
			}),
		);
	const specForReview = [bulk, outcome, input.successCriteria, input.acceptanceCommands, input.outOfScope]
		.filter(Boolean)
		.join("\n");
	const review = reviewSpec({
		spec: specForReview,
		callerAnswered: [
			...(outcome && clean(input.audience) ? (["problem"] as const) : []),
			...(clean(input.inScope) ? (["core_actions"] as const) : []),
			...(clean(input.outOfScope) ? (["out_of_scope"] as const) : []),
			...(clean(input.successCriteria) ? (["success_criteria"] as const) : []),
		],
		callerUnanswered: clean(input.successCriteria) ? [] : ["success_criteria"],
	});
	return {
		ready: blockingGaps.length === 0,
		blockingGaps,
		clarifications: clarificationGaps,
		nextClarification: review.next,
		remainingWhatWhyClarifications: Math.min(5, review.openQuestions.length),
		lintFindings: review.lintFindings,
		quarantinedReferenceCount: referenceResults.filter((result) => result.quarantined).length,
	};
}

export function buildInitialDecompositionPreview(input: ProjectInitializerBriefInput): InitialDecompositionTrack[] {
	const tracks: InitialDecompositionTrack[] = [
		{
			title: "Foundation and executable skeleton",
			purpose: clean(input.stackRuntime)
				? `Establish ${sentenceFragment(input.stackRuntime)} with the smallest runnable/testable vertical slice.`
				: "Resolve the stack/runtime decision, then establish the smallest runnable/testable vertical slice.",
		},
		{
			title: "Core outcome and domain behavior",
			purpose: clean(input.domainConcepts)
				? `Implement the outcome around these declared concepts/rules: ${clean(input.domainConcepts)}`
				: "Turn the stated outcome into user-visible behavior; clarify domain nouns/rules before implementation.",
		},
		{
			title: "Acceptance and boundary proof",
			purpose: `Make the definition of done executable and prove in-scope behavior without crossing: ${sentenceFragment(input.outOfScope) || "the still-open out-of-scope boundary"}.`,
		},
	];
	if (clean(input.uncertainties) && !/^none\b/iu.test(clean(input.uncertainties))) {
		tracks.splice(1, 0, {
			title: "Risk closure spike",
			purpose: `Resolve before broad implementation: ${clean(input.uncertainties)}`,
		});
	}
	return tracks;
}

function renderField(value: string, missing: string): string {
	return clean(value) || `**OPEN — ${missing}. Clarify before implementation; do not guess.**`;
}

export function renderCanonicalProjectBrief(input: {
	projectName: string;
	brief: ProjectInitializerBriefInput;
}): string {
	const { brief } = input;
	const readiness = assessProjectInitializerBrief(brief);
	const tracks = buildInitialDecompositionPreview(brief);
	const earsCriteria = renderProjectEarsCriteria(brief.successCriteria);
	const references = brief.references
		.filter((reference) => clean(reference.value) || clean(reference.content ?? ""))
		.map((reference, index) => {
			const source = `project initializer ${reference.kind} reference ${index + 1}`;
			const locator = clean(reference.label ?? reference.value);
			let payload = reference.content ?? reference.value;
			if (reference.content && locator) payload = `Locator: ${locator}\n\n${payload}`;
			if (reference.kind === "url" && !reference.content) {
				payload = `${reference.value}\n[Linked only. Fetching requires the runtime's explicit retrieval-egress permission.]`;
			}
			const fenced = fenceUntrustedContent(payload, { source });
			const kindLabel = { pasted: "Pasted", file: "File", url: "URL" }[reference.kind];
			return `### ${kindLabel} reference ${index + 1}\n\n${fenced.text}`;
		});
	const lines = [
		`# Project brief: ${clean(input.projectName) || "Untitled project"}`,
		"",
		"> Canonical operator-editable brief for !Klein planning and execution. Open items are blockers to clarify, not permission to guess.",
		"",
		"## Outcome / vision",
		"",
		renderField(brief.outcome, "state what done looks like"),
		"",
		"## Audience",
		"",
		renderField(brief.audience, "identify who this is for"),
		"",
		"## Project context",
		"",
		brief.projectKind === "greenfield" ? "Greenfield project." : "Existing repository (route through F11.2 mapping).",
		"",
		"## Stack / runtime",
		"",
		renderField(brief.stackRuntime, "choose language, framework, package manager, platform, and version constraints"),
		"",
		"## Acceptance / definition of done",
		"",
		`Commands:\n\n${renderField(brief.acceptanceCommands, "name the command(s) that must pass")}`,
		"",
		`Success criteria:\n\n${renderField(brief.successCriteria, "state observable pass/fail outcomes")}`,
		"",
		`EARS criteria:\n\n${
			earsCriteria.length > 0
				? earsCriteria.map((criterion, index) => `${index + 1}. ${criterion.text}`).join("\n")
				: "**OPEN — add one observable required behavior per line; do not guess.**"
		}`,
		"",
		"## Scope boundaries",
		"",
		`In scope:\n\n${renderField(brief.inScope, "list included outcomes")}`,
		"",
		`Out of scope:\n\n${renderField(brief.outOfScope, "list exclusions")}`,
		"",
		"## Domain concepts and rules",
		"",
		renderField(brief.domainConcepts, "define nouns, states, invariants, and business rules"),
		"",
		"## Constraints / things not to do",
		"",
		renderField(brief.constraints, "state dependency, performance, style, security, and prohibited approaches"),
		"",
		"## Risks / uncertainty",
		"",
		renderField(brief.uncertainties, "name uncertainties or explicitly write ‘none known’"),
		"",
		"## Effort and checkpoints",
		"",
		`Estimated size: ${brief.effort}. Operator posture: ${brief.autonomy}.`,
	];
	if (clean(brief.batchBrief ?? "")) {
		const fenced = fenceUntrustedContent(brief.batchBrief ?? "", { source: "operator-supplied pro brief" });
		lines.push("", "## Supplied pro brief (untrusted reference)", "", fenced.text);
	}
	lines.push(
		"",
		"## References (untrusted data)",
		"",
		...(references.length > 0 ? references : ["No references supplied."]),
	);
	lines.push(
		"",
		"## Initial decomposition preview (pre-model)",
		"",
		"> Planning tracks only. The architect must refine these against this brief before any worker starts.",
		"",
		...tracks.map((track, index) => `${index + 1}. **${track.title}** — ${track.purpose}`),
		"",
		"## Readiness",
		"",
		readiness.ready ? "Ready for architect refinement." : "Not ready for implementation.",
		...readiness.blockingGaps.map((gap) => `- BLOCKING: ${gap}`),
		...(readiness.clarifications.length > 0
			? [`- ${readiness.clarifications.length} structured field(s) remain OPEN in their sections.`]
			: []),
		...(readiness.nextClarification ? [`- Next what/why question: ${readiness.nextClarification.question}`] : []),
		...readiness.lintFindings.map((finding) => `- Spec lint (${finding.kind}): ${finding.detail}`),
	);
	if (readiness.quarantinedReferenceCount > 0) {
		lines.push(`- ${readiness.quarantinedReferenceCount} reference(s) quarantined by the injection pre-screen.`);
	}
	return `${lines.join("\n")}\n`;
}

export function buildProjectInitializerSeedPrompt(projectName: string, brief: ProjectInitializerBriefInput): string {
	const preview = buildInitialDecompositionPreview(brief);
	return [
		`Plan ${clean(projectName) || "this project"} from PROJECT_BRIEF.md.`,
		"Treat that versioned file as the canonical operator brief. Resolve every OPEN/BLOCKING/Clarify entry before implementation; never guess through one.",
		"Refine the pre-model tracks into the smallest dependency-aware task graph that can satisfy the acceptance section on the declared stack.",
		"Every generated implementation or verification card must tell its agent to read PROJECT_BRIEF.md first and carry the applicable acceptance and scope boundaries into its prompt.",
		`Respect the ${brief.autonomy} checkpoint posture and ${brief.effort} effort envelope.`,
		"Initial tracks:",
		...preview.map((track) => `- ${track.title}: ${track.purpose}`),
	].join("\n");
}
